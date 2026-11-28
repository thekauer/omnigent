"""Tests for the shared server-config loader (:mod:`omnigent.server.server_config`).

Covers path resolution (env override → ``<data_dir>/config.yaml`` →
None), loading + fail-open behavior (missing / malformed / non-mapping
→ empty dict, never a crash), and the ``config_str_list`` coercion used
for ``admins`` / ``allowed_domains``.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from io import BytesIO
from pathlib import Path

import pytest
import yaml
from PIL import Image

from omnigent.server import server_config as server_config_module
from omnigent.server.server_config import (
    BRANDING_ASSET_MAX_BYTES,
    BRANDING_ASSET_MAX_DECODED_PIXELS,
    BRANDING_ASSET_MAX_DIMENSION,
    BRANDING_ASSET_MAX_FRAMES,
    BRANDING_ASSETS_DIRNAME,
    PRODUCT_LAYOUT_MAX_CHARS,
    PRODUCT_NUMBER_COST,
    PRODUCT_SETTINGS_MAX_CHARS,
    PRODUCT_THEME_MAX_CHARS,
    PRODUCT_VALUE_MAX_DEPTH,
    PRODUCT_VALUE_MAX_NODES,
    automation_trigger_poll_minutes,
    branding_config,
    branding_logo_asset,
    config_str_list,
    load_branding_snapshot,
    load_picker_curation,
    load_product_layout,
    load_product_settings,
    load_product_theme,
    load_server_config,
    product_theme_cost,
    product_value_cost,
    resolve_config_path,
    session_title_instructions,
)


def _image_bytes(image_format: str, *, size: tuple[int, int] = (2, 2)) -> bytes:
    mode = "RGB" if image_format == "JPEG" else "RGBA"
    image = Image.new(mode, size, (25, 100, 200) if mode == "RGB" else (25, 100, 200, 255))
    output = BytesIO()
    save_kwargs: dict[str, object] = {}
    if image_format == "ICO":
        save_kwargs["sizes"] = [size]
    if image_format == "WEBP":
        save_kwargs["lossless"] = True
    image.save(output, format=image_format, **save_kwargs)
    return output.getvalue()


def _ico_bytes(entries: list[tuple[tuple[int, int], bytes]]) -> bytes:
    directory_end = 6 + len(entries) * 16
    directory = bytearray(b"\x00\x00\x01\x00" + len(entries).to_bytes(2, "little"))
    payloads = bytearray()
    for (width, height), payload in entries:
        payload_offset = directory_end + len(payloads)
        directory.extend(bytes((width if width < 256 else 0, height if height < 256 else 0, 0, 0)))
        directory.extend(b"\x00\x00\x20\x00")
        directory.extend(len(payload).to_bytes(4, "little"))
        directory.extend(payload_offset.to_bytes(4, "little"))
        payloads.extend(payload)
    return bytes(directory + payloads)


def _set_ico_entry_uint32(content: bytes, index: int, field_offset: int, value: int) -> bytes:
    modified = bytearray(content)
    start = 6 + index * 16 + field_offset
    modified[start : start + 4] = value.to_bytes(4, "little")
    return bytes(modified)


def _set_ico_entry_uint16(content: bytes, index: int, field_offset: int, value: int) -> bytes:
    modified = bytearray(content)
    start = 6 + index * 16 + field_offset
    modified[start : start + 2] = value.to_bytes(2, "little")
    return bytes(modified)


def _set_ico_entry_byte(content: bytes, index: int, field_offset: int, value: int) -> bytes:
    modified = bytearray(content)
    modified[6 + index * 16 + field_offset] = value
    return bytes(modified)


def _duplicate_ico_entry_range(content: bytes) -> bytes:
    first_size = int.from_bytes(content[14:18], "little")
    first_offset = int.from_bytes(content[18:22], "little")
    modified = _set_ico_entry_uint32(content, 1, 8, first_size)
    return _set_ico_entry_uint32(modified, 1, 12, first_offset)


def _insert_ico_payload_gap(content: bytes, gap: bytes) -> bytes:
    image_count = int.from_bytes(content[4:6], "little")
    directory_end = 6 + image_count * 16
    modified = content[:directory_end] + gap + content[directory_end:]
    for index in range(image_count):
        offset_start = 6 + index * 16 + 12
        payload_offset = int.from_bytes(modified[offset_start : offset_start + 4], "little")
        modified = _set_ico_entry_uint32(modified, index, 12, payload_offset + len(gap))
    return modified


def _dib_ico_bytes(*, size: tuple[int, int] = (16, 16)) -> bytes:
    image = Image.new("RGBA", size, (25, 100, 200, 255))
    output = BytesIO()
    image.save(output, format="ICO", sizes=[size], bitmap_format="bmp")
    return output.getvalue()


_VALID_RASTERS = {
    "logo.gif": (_image_bytes("GIF"), "image/gif"),
    "logo.ico": (_image_bytes("ICO", size=(16, 16)), "image/x-icon"),
    "logo.jpeg": (_image_bytes("JPEG"), "image/jpeg"),
    "logo.jpg": (_image_bytes("JPEG"), "image/jpeg"),
    "logo.png": (_image_bytes("PNG"), "image/png"),
    "logo.webp": (_image_bytes("WEBP"), "image/webp"),
}
_PNG = _VALID_RASTERS["logo.png"][0]


def _pin_data_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Point <data_dir> at tmp_path and clear the explicit-path override."""
    monkeypatch.delenv("OMNIGENT_CONFIG", raising=False)
    monkeypatch.setenv("OMNIGENT_ADMIN_CREDENTIALS_PATH", str(tmp_path / "admin-credentials"))


# ── path resolution ───────────────────────────────────────────────


def test_resolve_config_path_env_override(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """``OMNIGENT_CONFIG`` wins over the data-dir default."""
    p = tmp_path / "custom.yaml"
    p.write_text("{}")
    monkeypatch.setenv("OMNIGENT_CONFIG", str(p))
    assert resolve_config_path() == p


def test_resolve_config_path_default_when_present(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Falls back to ``<data_dir>/config.yaml`` when that file exists."""
    _pin_data_dir(monkeypatch, tmp_path)
    cfg = tmp_path / "config.yaml"
    cfg.write_text("admins: [a@x.com]\n")
    assert resolve_config_path() == cfg


def test_resolve_config_path_none_when_absent(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """No env, no default file → ``None`` (pure-env back-compat)."""
    _pin_data_dir(monkeypatch, tmp_path)
    assert resolve_config_path() is None


# ── loading ───────────────────────────────────────────────────────


def test_load_server_config_parses(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """A well-formed config loads into a dict."""
    _pin_data_dir(monkeypatch, tmp_path)
    (tmp_path / "config.yaml").write_text("admins:\n  - a@x.com\nallowed_domains: [x.com]\n")
    cfg = load_server_config()
    assert cfg["admins"] == ["a@x.com"]
    assert cfg["allowed_domains"] == ["x.com"]


def test_load_server_config_empty_when_no_file(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """No config file → empty dict (not an error)."""
    _pin_data_dir(monkeypatch, tmp_path)
    assert load_server_config() == {}


def test_load_server_config_malformed_is_empty(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Malformed YAML fails open to empty rather than crashing startup."""
    _pin_data_dir(monkeypatch, tmp_path)
    (tmp_path / "config.yaml").write_text("admins: [unclosed\n")
    assert load_server_config() == {}


def test_load_server_config_non_mapping_is_empty(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """A top-level non-mapping (e.g. a list) is ignored."""
    _pin_data_dir(monkeypatch, tmp_path)
    (tmp_path / "config.yaml").write_text("- a\n- b\n")
    assert load_server_config() == {}


# ── config_str_list ───────────────────────────────────────────────


def test_config_str_list_accepts_list() -> None:
    assert config_str_list(["a@x.com", "b@x.com"]) == ["a@x.com", "b@x.com"]


def test_config_str_list_accepts_scalar() -> None:
    """A single scalar is wrapped — a one-entry value needn't be a list."""
    assert config_str_list("a@x.com") == ["a@x.com"]


def test_config_str_list_none_is_empty() -> None:
    assert config_str_list(None) == []


def test_config_str_list_strips_and_drops_empty() -> None:
    assert config_str_list(["  a@x.com  ", "", "  "]) == ["a@x.com"]


@pytest.mark.parametrize("value", [10, 30, 60, 240])
def test_automation_trigger_poll_minutes(value: int) -> None:
    assert automation_trigger_poll_minutes({}) == 10
    assert automation_trigger_poll_minutes({"automation_trigger_poll_minutes": value}) == value


@pytest.mark.parametrize("value", [9, 241, 10.5, True, "30", None])
def test_automation_trigger_poll_minutes_rejects_invalid_values(value: object) -> None:
    with pytest.raises(ValueError, match="integer from 10 to 240"):
        automation_trigger_poll_minutes({"automation_trigger_poll_minutes": value})


def test_session_title_instructions_accepts_trimmed_string() -> None:
    assert (
        session_title_instructions(
            {"session_title_instructions": "  Prefix titles with the current date.  "}
        )
        == "Prefix titles with the current date."
    )


@pytest.mark.parametrize(
    "value",
    [None, "", "   ", ["not", "a", "string"], "x" * 4_001],
)
def test_session_title_instructions_ignores_unset_or_invalid_values(value: object) -> None:
    assert session_title_instructions({"session_title_instructions": value}) is None


def _write_branding_config(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, logo: str) -> Path:
    config = tmp_path / "config.yaml"
    config.write_text(f"branding:\n  logo:\n    main: {logo}\n")
    monkeypatch.setenv("OMNIGENT_CONFIG", str(config))
    assets = tmp_path / BRANDING_ASSETS_DIRNAME
    assets.mkdir()
    return assets


@pytest.mark.parametrize(
    ("filename", "content", "media_type"),
    [
        pytest.param(filename, *fixture, id=filename)
        for filename, fixture in _VALID_RASTERS.items()
    ],
)
def test_branding_logo_accepts_fully_decoded_rasters_in_assets_dir(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    filename: str,
    content: bytes,
    media_type: str,
) -> None:
    assets = _write_branding_config(monkeypatch, tmp_path, filename)
    logo = assets / filename
    logo.write_bytes(content)

    asset = branding_logo_asset()

    assert asset is not None
    assert asset.path == logo
    assert asset.media_type == media_type
    assert asset.content == content
    assert branding_config()["logos"]["main"] == "/v1/branding/logo/main"


def test_branding_snapshot_validates_shared_logo_file_once(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    config = tmp_path / "config.yaml"
    config.write_text(
        "branding:\n  logo:\n    main: logo.png\n    loading: ./logo.png\n    favicon: logo.png\n"
    )
    monkeypatch.setenv("OMNIGENT_CONFIG", str(config))
    assets = tmp_path / BRANDING_ASSETS_DIRNAME
    assets.mkdir()
    logo = assets / "logo.png"
    logo.write_bytes(_PNG)

    validated_paths: list[Path] = []
    original = server_config_module._validated_image

    def _counted_validation(path: Path) -> server_config_module.BrandingAsset | None:
        validated_paths.append(path)
        return original(path)

    monkeypatch.setattr(server_config_module, "_validated_image", _counted_validation)

    snapshot = load_branding_snapshot()

    assert validated_paths == [logo.resolve()]
    assert snapshot.logo_asset("main") is snapshot.logo_asset("loading")
    assert snapshot.logo_asset("main") is snapshot.logo_asset("favicon")
    assert snapshot.config()["logos"] == {
        "main": "/v1/branding/logo/main",
        "loading": "/v1/branding/logo/loading",
        "favicon": "/v1/branding/logo/favicon",
    }


def test_branding_logo_accepts_every_ico_directory_entry(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    content = _ico_bytes(
        [
            ((16, 16), _image_bytes("PNG", size=(16, 16))),
            ((32, 32), _image_bytes("PNG", size=(32, 32))),
        ]
    )
    assets = _write_branding_config(monkeypatch, tmp_path, "logo.ico")
    (assets / "logo.ico").write_bytes(content)

    asset = branding_logo_asset()

    assert asset is not None
    assert asset.content == content


def test_branding_logo_rejects_corrupt_secondary_ico_entry(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    content = _ico_bytes(
        [
            ((16, 16), _image_bytes("PNG", size=(16, 16))),
            ((32, 32), b"\x89PNG\r\n\x1a\nAPI_TOKEN=top-secret"),
        ]
    )
    assets = _write_branding_config(monkeypatch, tmp_path, "logo.ico")
    (assets / "logo.ico").write_bytes(content)

    assert branding_logo_asset() is None


@pytest.mark.parametrize(
    "mutate",
    [
        pytest.param(
            lambda content: _set_ico_entry_uint32(content, 0, 8, 0),
            id="zero-size",
        ),
        pytest.param(
            lambda content: _set_ico_entry_uint32(content, 0, 12, 6),
            id="offset-in-directory",
        ),
        pytest.param(
            lambda content: _set_ico_entry_uint32(content, 1, 12, len(content) - 1),
            id="out-of-bounds",
        ),
        pytest.param(
            _duplicate_ico_entry_range,
            id="duplicate-range",
        ),
        pytest.param(
            lambda content: _set_ico_entry_uint32(
                content,
                0,
                8,
                int.from_bytes(content[14:18], "little") + 1,
            ),
            id="overlap",
        ),
        pytest.param(lambda content: content[:-1], id="truncated"),
        pytest.param(
            lambda content: _insert_ico_payload_gap(content, b"API_TOKEN=top-secret"),
            id="hidden-gap",
        ),
    ],
)
def test_branding_logo_rejects_invalid_ico_entry_ranges(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    mutate: Callable[[bytes], bytes],
) -> None:
    content = _ico_bytes(
        [
            ((16, 16), _image_bytes("PNG", size=(16, 16))),
            ((32, 32), _image_bytes("PNG", size=(32, 32))),
        ]
    )
    assets = _write_branding_config(monkeypatch, tmp_path, "logo.ico")
    (assets / "logo.ico").write_bytes(mutate(content))

    assert branding_logo_asset() is None


def test_branding_logo_rejects_hidden_bytes_inside_ico_entry(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    payload = _image_bytes("PNG", size=(16, 16)) + b"API_TOKEN=top-secret"
    content = _ico_bytes([((16, 16), payload)])
    assets = _write_branding_config(monkeypatch, tmp_path, "logo.ico")
    (assets / "logo.ico").write_bytes(content)

    assert branding_logo_asset() is None


def test_branding_logo_rejects_ico_metadata_dimension_mismatch(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    content = _ico_bytes([((32, 32), _image_bytes("PNG", size=(16, 16)))])
    assets = _write_branding_config(monkeypatch, tmp_path, "logo.ico")
    (assets / "logo.ico").write_bytes(content)

    assert branding_logo_asset() is None


@pytest.mark.parametrize(
    "mutate",
    [
        pytest.param(lambda content: _set_ico_entry_byte(content, 0, 2, 1), id="color-count"),
        pytest.param(lambda content: _set_ico_entry_byte(content, 0, 3, 1), id="reserved"),
        pytest.param(lambda content: _set_ico_entry_uint16(content, 0, 4, 2), id="planes"),
        pytest.param(lambda content: _set_ico_entry_uint16(content, 0, 6, 7), id="bit-count"),
    ],
)
def test_branding_logo_rejects_invalid_ico_directory_metadata(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    mutate: Callable[[bytes], bytes],
) -> None:
    content = _ico_bytes([((16, 16), _image_bytes("PNG", size=(16, 16)))])
    assets = _write_branding_config(monkeypatch, tmp_path, "logo.ico")
    (assets / "logo.ico").write_bytes(mutate(content))

    assert branding_logo_asset() is None


def test_branding_logo_rejects_unsupported_ico_embedded_encoding(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    assets = _write_branding_config(monkeypatch, tmp_path, "logo.ico")
    (assets / "logo.ico").write_bytes(_dib_ico_bytes())

    assert branding_logo_asset() is None


def test_branding_logo_rejects_excessive_ico_entry_count(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    payload = _image_bytes("PNG", size=(1, 1))
    content = _ico_bytes([((1, 1), payload)] * (BRANDING_ASSET_MAX_FRAMES + 1))
    assets = _write_branding_config(monkeypatch, tmp_path, "logo.ico")
    (assets / "logo.ico").write_bytes(content)

    assert branding_logo_asset() is None


def test_branding_logo_rejects_excessive_ico_aggregate_pixels(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    size = (16, 16)
    payload = _image_bytes("PNG", size=size)
    content = _ico_bytes([(size, payload), (size, payload)])
    monkeypatch.setattr(
        server_config_module,
        "BRANDING_ASSET_MAX_DECODED_PIXELS",
        size[0] * size[1] * 2 - 1,
    )
    assets = _write_branding_config(monkeypatch, tmp_path, "logo.ico")
    (assets / "logo.ico").write_bytes(content)

    assert size[0] * size[1] * 2 < BRANDING_ASSET_MAX_DECODED_PIXELS
    assert branding_logo_asset() is None


@pytest.mark.parametrize(
    ("filename", "content"),
    [
        ("secret.txt", b"api_key: super-secret"),
        ("secret.png", b"api_key: super-secret"),
        ("passive.svg", b'<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
        ("active.svg", b"<svg><script>alert(1)</script></svg>"),
        ("event.svg", b'<svg onload="alert(1)"></svg>'),
        ("external.svg", b'<svg><image href="https://example.com/x"/></svg>'),
        ("css.svg", b"<svg><style>@import url(https://example.com/x)</style></svg>"),
    ],
)
def test_branding_logo_rejects_non_images_and_all_svg(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, filename: str, content: bytes
) -> None:
    assets = _write_branding_config(monkeypatch, tmp_path, filename)
    (assets / filename).write_bytes(content)

    assert branding_logo_asset() is None
    assert branding_config()["logos"]["main"] is None


@pytest.mark.parametrize(
    ("filename", "content"),
    [
        pytest.param("secret.png", b"\x89PNG\r\n\x1a\nAPI_TOKEN=top-secret", id="png"),
        pytest.param("secret.jpg", b"\xff\xd8\xffAPI_TOKEN=top-secret\xff\xd9", id="jpeg"),
        pytest.param("secret.gif", b"GIF89aAPI_TOKEN=top-secret;", id="gif"),
        pytest.param("secret.webp", b"RIFF\x14\x00\x00\x00WEBPAPI_TOKEN=top-secret", id="webp"),
        pytest.param("secret.ico", b"\x00\x00\x01\x00API_TOKEN=top-secret", id="ico"),
    ],
)
def test_branding_logo_rejects_magic_prefixed_secrets(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, filename: str, content: bytes
) -> None:
    assets = _write_branding_config(monkeypatch, tmp_path, filename)
    (assets / filename).write_bytes(content)

    assert branding_logo_asset() is None


@pytest.mark.parametrize(
    ("filename", "content"),
    [
        pytest.param(
            filename,
            fixture[0][: max(1, len(fixture[0]) // 2)],
            id=filename,
        )
        for filename, fixture in _VALID_RASTERS.items()
    ],
)
def test_branding_logo_rejects_truncated_rasters(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, filename: str, content: bytes
) -> None:
    assets = _write_branding_config(monkeypatch, tmp_path, filename)
    (assets / filename).write_bytes(content)

    assert branding_logo_asset() is None


@pytest.mark.parametrize(
    ("filename", "content"),
    [
        pytest.param(filename, fixture[0] + b"API_TOKEN=top-secret", id=filename)
        for filename, fixture in _VALID_RASTERS.items()
    ],
)
def test_branding_logo_rejects_trailing_payloads(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, filename: str, content: bytes
) -> None:
    assets = _write_branding_config(monkeypatch, tmp_path, filename)
    (assets / filename).write_bytes(content)

    assert branding_logo_asset() is None


@pytest.mark.parametrize(
    ("filename", "content"),
    [
        pytest.param(
            "logo.jpg",
            _VALID_RASTERS["logo.jpg"][0] + b"API_TOKEN=top-secret\xff\xd9",
            id="jpeg-fake-final-eoi",
        ),
        pytest.param(
            "logo.gif",
            _VALID_RASTERS["logo.gif"][0] + b"API_TOKEN=top-secret;",
            id="gif-fake-final-trailer",
        ),
    ],
)
def test_branding_logo_rejects_payloads_hidden_before_fake_terminators(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, filename: str, content: bytes
) -> None:
    assets = _write_branding_config(monkeypatch, tmp_path, filename)
    (assets / filename).write_bytes(content)

    assert branding_logo_asset() is None


@pytest.mark.parametrize(
    "content",
    [
        pytest.param(b"", id="empty"),
        pytest.param(b"x" * (BRANDING_ASSET_MAX_BYTES + 1), id="oversized"),
    ],
)
def test_branding_logo_rejects_empty_and_oversized_files(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, content: bytes
) -> None:
    assets = _write_branding_config(monkeypatch, tmp_path, "logo.png")
    (assets / "logo.png").write_bytes(content)

    assert branding_logo_asset() is None


def test_branding_logo_rejects_excessive_dimensions(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    assets = _write_branding_config(monkeypatch, tmp_path, "logo.png")
    (assets / "logo.png").write_bytes(
        _image_bytes("PNG", size=(BRANDING_ASSET_MAX_DIMENSION + 1, 1))
    )

    assert branding_logo_asset() is None


def test_branding_logo_cannot_serve_config_directory_secret(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _write_branding_config(monkeypatch, tmp_path, "secrets.png")
    (tmp_path / "secrets.png").write_bytes(_PNG)

    assert branding_logo_asset() is None


@pytest.mark.parametrize("logo", ["../secret.png", "/tmp/secret.png"])
def test_branding_logo_rejects_escape_paths(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, logo: str
) -> None:
    _write_branding_config(monkeypatch, tmp_path, logo)
    assert branding_logo_asset() is None


def test_branding_logo_rejects_file_symlink(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    assets = _write_branding_config(monkeypatch, tmp_path, "logo.png")
    secret = tmp_path / "secret.png"
    secret.write_bytes(_PNG)
    (assets / "logo.png").symlink_to(secret)

    assert branding_logo_asset() is None


def test_branding_logo_rejects_symlinked_assets_directory(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    config = tmp_path / "config.yaml"
    config.write_text("branding:\n  logo: logo.png\n")
    monkeypatch.setenv("OMNIGENT_CONFIG", str(config))
    external = tmp_path / "external"
    external.mkdir()
    (external / "logo.png").write_bytes(_PNG)
    (tmp_path / BRANDING_ASSETS_DIRNAME).symlink_to(external, target_is_directory=True)

    assert branding_logo_asset() is None


_DEFAULT_EXTENSIONS = {".zip", ".docx", ".xlsx", ".pptx", ".db", ".sqlite", ".sqlite3", ".mp4"}


@pytest.mark.parametrize(
    ("raw", "extensions", "all_types"),
    [
        (None, _DEFAULT_EXTENSIONS, False),
        ("*", _DEFAULT_EXTENSIONS, True),
        # A list-valued setting can express "all types" the same way.
        (["*"], _DEFAULT_EXTENSIONS, True),
        (["*", "log"], _DEFAULT_EXTENSIONS | {".log"}, True),
        # A list replaces the defaults.
        ([".gz", "HAR"], {".gz", ".har"}, False),
        ([], set(), False),
        # A malformed entry is skipped; nothing usable keeps the defaults.
        ([42, ".gz"], {".gz"}, False),
        ([42], _DEFAULT_EXTENSIONS, False),
        ({"gz": True}, _DEFAULT_EXTENSIONS, False),
        # Files match on their last extension, so a compound entry can never match.
        ([".tar.gz", ".har"], {".har"}, False),
        ([".tar.gz"], _DEFAULT_EXTENSIONS, False),
    ],
)
def test_parse_filesystem_attachment_policy(
    raw: object, extensions: set[str], all_types: bool
) -> None:
    """Configured values map to the extensions delivered as files and the fallback rule."""
    from omnigent.server.server_config import parse_filesystem_attachment_policy

    policy = parse_filesystem_attachment_policy(raw)

    assert set(policy.extensions) == extensions
    assert policy.all_types is all_types


def test_filesystem_attachment_policy_reads_the_config_file(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """The setting comes from the server config file."""
    from omnigent.server.server_config import filesystem_attachment_policy

    config = tmp_path / "config.yaml"
    config.write_text('filesystem_attachment_allowed_extensions: "*"\n')
    monkeypatch.setenv("OMNIGENT_CONFIG", str(config))

    assert filesystem_attachment_policy().all_types


# ── New Chat picker curation ──────────────────────────────────────


@pytest.mark.parametrize(
    "config",
    [
        {},
        {"restrict_to_agent_names": []},
        {"restrict_to_agent_names": [""]},
        # An operator clearing a key in place means "no curation", not "nothing".
        {"restrict_to_agent_names": "  ", "default_agent_name": "  "},
    ],
    ids=["absent", "empty-list", "blank-name", "blank-values"],
)
def test_picker_curation_is_empty_without_config(config: dict[str, object]) -> None:
    """Absent, empty or blank keys mean the full roster, which is every existing deployment."""
    curation = load_picker_curation(config)

    assert curation.restrict_to_agent_names == ()
    assert curation.default_agent_name is None
    assert curation.restricted is False
    assert curation.config() == {"restrict_to_agent_names": [], "default_agent_name": None}


def test_picker_curation_keeps_the_configured_order_and_drops_repeats() -> None:
    """The order is the operator's: a deployment can put its own agent first."""
    curation = load_picker_curation(
        {"restrict_to_agent_names": ["polly", "debby", "polly"], "default_agent_name": "debby"}
    )

    assert curation.restrict_to_agent_names == ("polly", "debby")
    assert curation.default_agent_name == "debby"
    assert curation.restricted is True


def test_picker_curation_accepts_a_single_name_without_a_list() -> None:
    """One agent is the common case; requiring YAML list syntax for it is a trap."""
    curation = load_picker_curation({"restrict_to_agent_names": "polly"})

    assert curation.restrict_to_agent_names == ("polly",)


@pytest.mark.parametrize("value", [42, {"polly": True}, True, [42], ["polly", 42]])
def test_picker_restriction_of_the_wrong_type_is_ignored(
    value: object, caplog: pytest.LogCaptureFixture
) -> None:
    """Fail open: a malformed value must not empty a deployment's picker."""
    with caplog.at_level(logging.WARNING, logger="omnigent.server.server_config"):
        curation = load_picker_curation({"restrict_to_agent_names": value})

    assert curation.restrict_to_agent_names == ()
    assert "restrict_to_agent_names" in caplog.text


def test_picker_default_of_the_wrong_type_is_ignored(caplog: pytest.LogCaptureFixture) -> None:
    """Same for the default: ignore it rather than pre-selecting nonsense."""
    with caplog.at_level(logging.WARNING, logger="omnigent.server.server_config"):
        curation = load_picker_curation({"default_agent_name": ["polly"]})

    assert curation.default_agent_name is None
    assert "default_agent_name" in caplog.text


def test_a_default_outside_the_restriction_is_dropped(caplog: pytest.LogCaptureFixture) -> None:
    """It could never be selected, so keeping it would pin a pick that cannot exist."""
    with caplog.at_level(logging.WARNING, logger="omnigent.server.server_config"):
        curation = load_picker_curation(
            {"restrict_to_agent_names": ["polly"], "default_agent_name": "debby"}
        )

    assert curation.restrict_to_agent_names == ("polly",)
    assert curation.default_agent_name is None
    assert "does not offer" in caplog.text


def test_a_default_without_any_restriction_is_kept() -> None:
    """Pre-selecting an agent does not imply hiding the others."""
    curation = load_picker_curation({"default_agent_name": "polly"})

    assert curation.restrict_to_agent_names == ()
    assert curation.default_agent_name == "polly"


@pytest.mark.parametrize(
    "config",
    [{}, {"product": None}, {"product": {}}, {"product": {"theme": {}}}],
    ids=["absent", "null", "no-theme", "empty-theme"],
)
def test_product_theme_is_none_without_config(config: dict[str, object]) -> None:
    """Every existing deployment serves no product theme."""
    assert load_product_theme(config) is None


def test_product_theme_keeps_the_well_formed_keys(caplog: pytest.LogCaptureFixture) -> None:
    """Each key is checked for its shape; a malformed one is left out with a warning."""
    with caplog.at_level(logging.WARNING, logger="omnigent.server.server_config"):
        theme = load_product_theme(
            {
                "product": {
                    "theme": {
                        "default": " acme.brand/console ",
                        "allowed": ["omnigent.themes/*", "acme.brand/*", 3, "acme.brand/*"],
                        "lock_mode": "dim",
                        "locked_tokens": {"ui-radius-base": "0px", "primary": 3},
                        "locked_variants": {"density": "compact"},
                        "locked_options": ["accent"],
                        "hide_picker": True,
                        "hide_customizations": "yes",
                    }
                }
            }
        )

    assert theme == {
        "default": "acme.brand/console",
        "allowed": ["omnigent.themes/*", "acme.brand/*"],
        "locked_tokens": {"ui-radius-base": "0px"},
        "locked_variants": {"density": "compact"},
        "hide_picker": True,
    }
    for key in (
        "allowed",
        "lock_mode",
        "locked_tokens.primary",
        "locked_options",
        "hide_customizations",
    ):
        assert key in caplog.text


def test_product_theme_of_the_wrong_type_is_ignored(caplog: pytest.LogCaptureFixture) -> None:
    """Fail open: a product or theme that isn't a mapping serves nothing."""
    with caplog.at_level(logging.WARNING, logger="omnigent.server.server_config"):
        assert load_product_theme({"product": ["theme"]}) is None
        assert load_product_theme({"product": {"theme": "console"}}) is None
    assert "product.theme must be a mapping" in caplog.text


def test_product_theme_allowed_with_no_well_formed_entry_fails_open(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """An ``allowed`` list of only malformed entries restricts nothing, not everything."""
    with caplog.at_level(logging.WARNING, logger="omnigent.server.server_config"):
        theme = load_product_theme(
            {"product": {"theme": {"allowed": [3, " ", None], "hide_picker": True}}}
        )
    assert theme == {"hide_picker": True}
    assert "allowing every theme" in caplog.text


def test_product_theme_leaves_out_empty_maps() -> None:
    """An empty locked map is no opinion: it is not served, so it hides no other source's."""
    assert load_product_theme({"product": {"theme": {"locked_tokens": {}}}}) is None


def test_product_theme_warns_about_camel_case_keys(caplog: pytest.LogCaptureFixture) -> None:
    """The web's camelCase spellings are not server keys: each is named with its fix."""
    with caplog.at_level(logging.WARNING, logger="omnigent.server.server_config"):
        theme = load_product_theme(
            {"product": {"theme": {"lockMode": "dark", "hidePicker": True, "hide_picker": True}}}
        )
    assert theme == {"hide_picker": True}
    assert "lockMode is not a key; did you mean lock_mode?" in caplog.text
    assert "hidePicker is not a key; did you mean hide_picker?" in caplog.text


def test_product_theme_is_capped_to_the_web_limit(caplog: pytest.LogCaptureFixture) -> None:
    """Over the web's size limit, the last tokens go (named), and the rest of the policy stays."""
    tokens = {f"ui-tok-{index}": "x" * 250 for index in range(1000)}
    with caplog.at_level(logging.WARNING, logger="omnigent.server.server_config"):
        theme = load_product_theme(
            {
                "product": {
                    "theme": {
                        "allowed": ["omnigent.themes/nord"],
                        "lock_mode": "dark",
                        "hide_customizations": True,
                        "locked_variants": {"density": "compact"},
                        "locked_tokens": tokens,
                    }
                }
            }
        )
    assert theme is not None
    assert theme["allowed"] == ["omnigent.themes/nord"]
    assert theme["lock_mode"] == "dark"
    assert theme["hide_customizations"] is True
    assert theme["locked_variants"] == {"density": "compact"}
    kept = list(theme["locked_tokens"])
    assert 400 < len(kept) < 1000
    assert kept == list(tokens)[: len(kept)]
    size = sum(product_theme_cost(name) + 1 for name in theme["allowed"])
    for key in ("locked_variants", "locked_tokens"):
        size += sum(
            product_theme_cost(name) + product_theme_cost(value) + 2
            for name, value in theme[key].items()
        )
    assert size <= PRODUCT_THEME_MAX_CHARS
    assert f"ui-tok-{len(kept)}" in caplog.text
    assert "over the 131072-character limit" in caplog.text


def test_product_theme_cost_counts_as_javascript_does() -> None:
    """The cost is the JSON text's length in UTF-16 code units, escapes included."""
    assert product_theme_cost("ab") == 4
    assert product_theme_cost('a"b') == 6
    assert product_theme_cost("\U0001f600") == 4


def test_product_theme_drops_strings_with_a_lone_surrogate(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A lone surrogate (YAML's ``"\\ud800"``) has no UTF-16 form: each such string goes."""
    config = yaml.safe_load(
        """
product:
  theme:
    default: "acme\\ud800"
    allowed: ["omnigent.themes/*", "acme\\udfff/*"]
    locked_tokens:
      primary: "#00ff00\\ud800"
      "ring\\ud800": "#ff0000"
      accent: "#0000ff"
    locked_variants:
      density: "compact"
"""
    )
    assert config["product"]["theme"]["default"] == "acme\ud800"
    with caplog.at_level(logging.WARNING, logger="omnigent.server.server_config"):
        theme = load_product_theme(config)
    assert theme == {
        "allowed": ["omnigent.themes/*"],
        "locked_tokens": {"accent": "#0000ff"},
        "locked_variants": {"density": "compact"},
    }
    assert "product.theme.default must be a theme id" in caplog.text
    assert "product.theme.allowed has malformed entries" in caplog.text
    assert "locked_tokens.primary is malformed" in caplog.text
    assert "locked_tokens.'ring\\ud800' is malformed" in caplog.text


def test_product_theme_value_limit_counts_utf16_code_units() -> None:
    """The 256-unit value limit is counted as the web counts it: an emoji is two units."""
    fits = "\U0001f600" * 128
    over = "\U0001f600" * 129
    assert len(over) <= 256
    theme = load_product_theme(
        {"product": {"theme": {"locked_tokens": {"fits": fits, "over": over}}}}
    )
    assert theme == {"locked_tokens": {"fits": fits}}


def test_product_theme_limit_matches_the_web() -> None:
    """The server and the web share one limit."""
    source = (
        Path(__file__).resolve().parents[2] / "web" / "src" / "theme" / "productTheme.ts"
    ).read_text(encoding="utf-8")
    assert f"PRODUCT_THEME_MAX_CHARS = {PRODUCT_THEME_MAX_CHARS:_};" in source


@pytest.mark.parametrize(
    "config",
    [{}, {"product": {"theme": {}}}, {"product": {"settings": {}, "layout": {}}}],
)
def test_product_settings_and_layout_are_none_without_config(config: dict[str, object]) -> None:
    """Every existing deployment serves neither block."""
    assert load_product_settings(config) is None
    assert load_product_layout(config) is None


def test_product_settings_keep_the_well_formed_keys(caplog: pytest.LogCaptureFixture) -> None:
    """Each key fails open; a lock whose value can't be served still locks its key."""
    with caplog.at_level(logging.WARNING, logger="omnigent.server.server_config"):
        settings = load_product_settings(
            {
                "product": {
                    "settings": {
                        "defaults": {
                            "workbench.activityBar.location": "default",
                            "bad key!": 1,
                            "acme.deep": [[[[[[[[["too deep"]]]]]]]]],
                            "acme.obj": {"a": [1, True, None]},
                        },
                        "locked": {"window.titleBar.visible": True, "acme.locked": "x\ud800"},
                        "lockedInvalid": ["x"],
                    }
                }
            }
        )
    assert settings == {
        "defaults": {
            "workbench.activityBar.location": "default",
            "acme.obj": {"a": [1, True, None]},
        },
        "locked": {"window.titleBar.visible": True},
        "locked_invalid": ["acme.locked"],
    }
    assert "product.settings.defaults.bad key! is not a setting key" in caplog.text
    assert "acme.deep has a value the web can't read; ignoring it" in caplog.text
    assert "acme.locked has a value the web can't read; the key stays locked" in caplog.text
    assert "lockedInvalid is not a key; did you mean locked_invalid?" in caplog.text


def test_product_settings_of_the_wrong_type_are_ignored(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.WARNING, logger="omnigent.server.server_config"):
        assert load_product_settings({"product": {"settings": ["x"]}}) is None
        assert load_product_settings({"product": {"settings": {"locked": "x"}}}) is None
    assert "product.settings must be a mapping" in caplog.text
    assert "product.settings.locked must be a mapping" in caplog.text


def test_product_value_cost_counts_as_the_web_does() -> None:
    """Strings as their JSON text in UTF-16 units, numbers a fixed cost, brackets and commas."""
    assert product_value_cost("ab") == 4
    assert product_value_cost("\U0001f600") == 4
    assert product_value_cost(1.5) == PRODUCT_NUMBER_COST
    assert product_value_cost([True, False, None]) == 2 + 2 + 4 + 5 + 4
    assert product_value_cost({"a": 1}) == 2 + 3 + 1 + PRODUCT_NUMBER_COST
    assert product_value_cost(float("inf")) is None
    assert product_value_cost({1: "a"}) is None
    nested: object = "x"
    for _ in range(PRODUCT_VALUE_MAX_DEPTH):
        nested = [nested]
    assert product_value_cost(nested) is None
    assert product_value_cost(["x"] * (PRODUCT_VALUE_MAX_NODES - 1)) is not None
    assert product_value_cost(["x"] * PRODUCT_VALUE_MAX_NODES) is None


def test_product_settings_are_capped_locks_first(caplog: pytest.LogCaptureFixture) -> None:
    big = "x" * 60_000
    with caplog.at_level(logging.WARNING, logger="omnigent.server.server_config"):
        settings = load_product_settings(
            {
                "product": {
                    "settings": {
                        "defaults": {"acme.a": big},
                        "locked": {"acme.b": big, "acme.c": big},
                    }
                }
            }
        )
    assert settings == {"locked": {"acme.b": big, "acme.c": big}}
    assert "over the 131072-character limit; dropping acme.a" in caplog.text


def test_product_layout_keeps_the_well_formed_keys(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.WARNING, logger="omnigent.server.server_config"):
        layout = load_product_layout(
            {
                "product": {
                    "layout": {
                        "hidden_parts": ["workbench.parts.titlebar", 3, "bad id"],
                        "hidden_views": "omnigent.newSession",
                        "hidden_containers": [],
                        "container_order": ["omnigent.inbox", "omnigent.inbox", "acme.*"],
                        "lock_view_locations": "yes",
                        "hiddenParts": ["x"],
                    }
                }
            }
        )
    assert layout == {
        "hidden_parts": ["workbench.parts.titlebar"],
        "hidden_views": ["omnigent.newSession"],
        "container_order": ["omnigent.inbox", "acme.*"],
    }
    assert "product.layout.hidden_parts has malformed entries" in caplog.text
    assert "lock_view_locations must be true or false" in caplog.text
    assert "hiddenParts is not a key; did you mean hidden_parts?" in caplog.text
    assert load_product_layout({"product": {"layout": {"lock_view_locations": True}}}) == {
        "lock_view_locations": True
    }


def test_product_layout_drops_a_lone_surrogate() -> None:
    assert load_product_layout({"product": {"layout": {"hidden_views": ["a\ud800", "b"]}}}) == {
        "hidden_views": ["b"]
    }


def test_product_settings_and_layout_limits_match_the_web() -> None:
    """The server and the web share the limits."""
    source = (
        Path(__file__).resolve().parents[2] / "web" / "src" / "product" / "productConfig.ts"
    ).read_text(encoding="utf-8")
    for name, value in (
        ("PRODUCT_SETTINGS_MAX_CHARS", PRODUCT_SETTINGS_MAX_CHARS),
        ("PRODUCT_LAYOUT_MAX_CHARS", PRODUCT_LAYOUT_MAX_CHARS),
        ("PRODUCT_VALUE_MAX_DEPTH", PRODUCT_VALUE_MAX_DEPTH),
        ("PRODUCT_VALUE_MAX_NODES", PRODUCT_VALUE_MAX_NODES),
        ("PRODUCT_NUMBER_COST", PRODUCT_NUMBER_COST),
    ):
        assert f"{name} = {value:_};" in source or f"{name} = {value};" in source, name


def test_product_settings_drop_an_int_past_a_double() -> None:
    """The web reads it as Infinity and drops it: so does the server, without crashing."""
    assert product_value_cost(10**400) is None
    assert (
        load_product_settings({"product": {"settings": {"defaults": {"acme.a": 10**400}}}}) is None
    )
    assert load_product_settings({"product": {"settings": {"locked": {"acme.a": 10**400}}}}) == {
        "locked_invalid": ["acme.a"]
    }


def test_product_settings_keep_an_over_budget_lock_locked() -> None:
    """A lock that doesn't fit the budget still locks its key, to its default."""
    big = "x" * 70_000
    assert load_product_settings(
        {"product": {"settings": {"locked": {"acme.b": big, "acme.c": big}}}}
    ) == {"locked": {"acme.b": big}, "locked_invalid": ["acme.c"]}


def test_product_settings_keep_an_invalid_lock_past_the_budget_locked() -> None:
    """Invalid locks spend no budget: one after the budget is spent still locks its key."""
    big = "x" * (PRODUCT_SETTINGS_MAX_CHARS - 20)
    deep: object = 1
    for _ in range(40):
        deep = [deep]
    assert load_product_settings(
        {"product": {"settings": {"locked": {"acme.big": big, "acme.deep": deep}}}}
    ) == {"locked": {"acme.big": big}, "locked_invalid": ["acme.deep"]}


def test_product_settings_keep_locks_past_the_entry_limit_locked() -> None:
    """Locks past the entry limit lock their keys to their defaults; defaults past it go."""
    many = {f"acme.k{index}": True for index in range(501)}
    served = load_product_settings(
        {"product": {"settings": {"locked": many, "defaults": dict(many)}}}
    )
    assert served is not None
    assert len(served["locked"]) == 500
    assert served["locked_invalid"] == ["acme.k500"]
    assert len(served["defaults"]) == 500


def test_product_layout_strips_ascii_whitespace_only() -> None:
    """As the web trims: a control character other than ASCII whitespace stays (and fails)."""
    assert load_product_layout({"product": {"layout": {"hidden_views": [" a ", "\x1cb"]}}}) == {
        "hidden_views": ["a"]
    }
