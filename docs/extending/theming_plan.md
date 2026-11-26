# Theming plan: themes and variants (Stage 1)

Approved by the user on 2026-11-24. Execute autonomously, milestone by milestone.

## Status

This section is the durable state to resume from after a restart. Update it in
the same commit that lands each milestone.

| # | State | Notes |
|---|---|---|
| Step 0 | Done | This plan saved in the fork and linked from `vscode_style_extensions.md`. |
| M0 | Done | `verify.sh --screens --token-dump --embed` and `--compare` in `my-extensions/dev/verify/screens.py`; baselines of `0c1afd2594` in `my-extensions/dev/verify/baselines/` (96 screens, 16 standalone and 14 embed dumps). Two runs: 0 px, identical dumps. |
| M1 | Done | `web/src/theme/tokens/` (registry, workbench, status, chart); `PaletteTokens` and `PALETTE_TOKEN_CSS_NAMES` derived from it; `scripts/generate-theme-tokens.mjs` writes `src/themeTokens.generated.css` (`just generate-theme-tokens`, pre-commit `web-theme-token-generation`). 37 non-palette colour tokens (61 declarations) left `index.css`; its remaining `:root`/`.dark` tokens (shadows, radii, insets, motion) are listed in `registry.test.ts` for M2/M3. Against the M0 baselines: identical dumps, 0 px. |
| M2 | Done | Shape (`ui-radius-base` and its derived scale, `ui-radius-pill`, off-scale `ui-radius-3/10/12/16/20/30`; `--radius` and `radius-otto-*` aliases), typography (`ui-font-ui/title/mono/code/label`, weights, letter-spacing, label tokens) and elevation (`ui-elevation`, every shadow recipe with an elevation-scaled alpha) in `web/src/theme/tokens/`; tokens that alias a plain value are registered with `@property`. `@theme inline` reads `var(--ui-*)`; the `rounded-[Npx]` TSX uses read the scale or the off-scale aliases; the Appearance font setting is a layer over `ui-font-ui`. Derived values re-emit on the theme roots, light formulas included on dark roots. Harness (my-extensions `bc235e1`, 195 screens on `13dbdd5d14`): 0 px; the dump gains only the new tokens, plus 11 embed shadow tokens whose minified literal text became computed text of identical value. `--ui-radius-base: 0` with `--ui-elevation: 0` leaves no radius or cast shadow on the session page. |
| M2 follow-ups | Done | Radii `<length-percentage>`; every shadow alpha kind `alpha`, `<number> \| <percentage>`; `ui-elevation` a `<number>` with initial 1; the embed drops the token `@property` rules (naming section); Tailwind no longer scans `theme/tokens`. Harness masks come from the baseline only, and it probes the registrations. Dumps refreshed from `f5566ddd93` (my-extensions `a520b89`), screens untouched. |
| M3 | Done | Density, border, scrollbar and label-site tokens (token groups above), `.ui-label`, `.ui-scroll`, `.ui-scroll-hidden` and the `data-slot` hooks in `theme_hooks.md`; literal radii of AnimatedOmnigentPanel (`ui-radius-24`, `ui-radius-14`) and SuggestionChart (`ui-radius-md`) moved onto tokens. Against the refreshed baselines: 0 px on all screens, dumps gain only additions (standalone and embed). The DevHub preview reads the hooks and tokens instead of DOM shape, aria-labels and class text. |
| M3 follow-ups | Done | F5: the generator writes every value on one line (Prettier wrapped long ones and the browser kept the breaks in the computed text). F2: tokens without a default and `--ui-font-family` are reset to `initial` on the top root, so in the embed a host page's variables of those names stay out. F1: every shadow scales by `--omnigent-elevation`, registered in both builds (naming section); the M2 follow-ups' "an invalid elevation on the top root keeps full shadows" held standalone only until then, since the embed's unregistered `ui-elevation` made the whole `box-shadow` (rings and insets included) invalid. F3: the harness checks every documented hook on rendered pages (the session as a multi-user server, so Share renders), and probes F1 and F2 on the embed page. Harness: 0 px; the dump gains additions only, and standalone also 112 whitespace-only text changes (`=` in the diff), embed additions only. |
| M4 | Done | Bridges for the parallel colour systems (token groups above). xterm: `terminalTheme()` and the Codex tones read the `terminal-*` tokens through `theme/tokenValues.ts` (per mode, with `data-token-mode` probes), unset slots left out of the ITheme, re-read when a palette or theme changes them. Diffs: `DIFF_TOKEN_CSS`/`DIFF_PALETTE_CSS` read `diff-*` (the PR diff too). File tree: `FILE_TREE_THEME` maps `file-tree-*` onto the vendored `--trees-*-override` variables, the vendored CSS untouched. CodeMirror: `viewer-active-line` and the find washes are tokens, its radii `ui-radius-sm`/`-xs`. Syntax: `syntax-theme-light`/`-dark` drive Streamdown's and the code block's Shiki, CodeMirror (`refreshHighlighting`), Monaco (`useMonacoTheme`, `shell/monacoTheme.ts`) and diffs (`useDiffSyntaxTheme`); `registerSyntaxTheme` turns `tokenColors` into a Shiki theme (Monaco-safe name `registered-<n>-<name>`, loaded with `highlighter.loadTheme`, `shikiToMonaco`, diffs' `registerCustomTheme`); not wired to `contributes.themes` (M6). Glass shadows, `ui-shadow-none`, the PDF radius, the composer circle (`ui-radius-pill`) and CanvasPage's strip are on tokens. Harness (my-extensions): new `terminal-xterm`, `file-viewer` and `file-diff` screens (baselines from the Part A commit); against the baselines 0 px on all 219 screens, dumps additions only in both builds (plus Part A's whitespace-only text). A fixture theme with `tokenColors` and `terminal-*`, `diff-*`, `file-tree-*` and viewer overrides, applied live, recoloured the chat code blocks (both modes), Monaco and its diff, CodeMirror, the xterm, the PR diff and the vendored tree's git status colours (the last two only mount in workspace tabs v2, so a scratch page mounted them). The Files tab's own rows still colour status letters with raw palette classes (M5). |
| M5 | Done | Part A (M4 follow-ups): `useMonacoTheme` keeps the Monaco names it loaded (`loadSyntaxThemes` returns them), the previous pair until the new one is loaded and the default pair for a name that fails, so re-registering or unregistering the active syntax theme no longer crashes the viewer (RTL regression test); `registerSyntaxTheme` keeps only hex colours and the `fontStyle` keywords, size-capped (`theme/validate.ts`); the Shiki bridge into Monaco is installed once (`shell/monacoShikiBridge.ts`); the terminal frame reads `terminal-*` (new `-muted`, `-muted-foreground`, `-border`, `-destructive`) through `terminalSurfaceProps`; `tokenValues.ts` re-observes the embed's roots and caches reads per task; viewer backgrounds and gutters, Monaco's diff washes (`shell/monacoTokenColors.ts`, only for set tokens), the code block frames, diffstats and the review and PR trees are tokens. Harness (my-extensions): Monaco's overview ruler stays in the shots with the cursor left out, light-nord's session gets the copy-button mask; dumps refreshed from the Part A commit, dump-only (with the re-captured Monaco screens). M5: status tones, file, viewer, glass, colour picker and brand tokens (token groups above) replace the hotspots' raw colours with their exact values (Tailwind steps through `tw()`, Tailwind's own variables); a browser check of all 101 old and new class pairs in both modes found no computed difference. `lib/branding.ts` takes a brand override (M6 feeds a theme's `brand` into it). Guard `theme/noRawColors.test.ts` with `noRawColors.allowlist.ts`: before, 153 hex, 375 palette classes, 53 `rounded-[…]`, 76 `text-[Npx]`, 71 colour functions in 135 files; after, 104, 101, 53, 76, 39 in 120. Against the refreshed baselines: 0 px on all 219 screens (light-nord's session within its new spot mask), dumps additions only in both builds. |
| M6 | Done | Part A (M5 follow-ups): the raw colour guard also finds hex after `_`, named colours in colour contexts, any-case, interpolated and `color()` colour functions, every colour utility prefix, Tailwind 4.2's hues (checked against the installed `theme.css`) and `--color-<hue>-<n>`/`theme()` reads, scans `.js`/`.jsx`, skips only the test-only directories, and narrows `lib/customTheme.ts` and `theme/tokens/` to `raw-colors-data` blocks (before 104 hex, 101 palette, 53, 76, 39 colour functions in 120 files; after 108, 101, 53, 76, 49 and 13 named in 123); `UPDATE_RAW_COLOR_ALLOWLIST=1` refuses increases without `ALLOW_RAW_COLOR_INCREASE=1` and keeps the file's layout. BrandLogo sends credentials only to host paths; empty brand names are unset, capped and stripped; the title and favicon return to the page's own. `snapshotPlainData` (one read, no holes, null-prototype maps, size caps) in front of `sanitizeSyntaxTheme`. Monaco syncs on every apply. Harness: every selection's `session.png` is masked (light masks from a clean `67bab53eaa` capture), a narrowed compare skips missing dumps. M6: the theme contribution API (Theme contribution API above): `theme/themeContributions.ts`, `themeFile.ts` (with `vscodeColorAliases.ts`), `validate.ts` token kinds, `brandAssets.ts`, `themeCss.ts` and `themeService.ts` (`list`, `select`, `getActive`, `setOption`, `omnigent.selectColorTheme`, `window.omnigentDevThemes` on the dev server); the dev plugin inlines theme files (`ExtensionDescription.files`), serves fonts and brand images by exact allow-list and sends edits over HMR. Runtime selectors `:is([data-omni-theme], #omnigent-theme-runtime-root)` (ID specificity, above every generated block; `.omnigent-app`-scoped in the embed). `onboarding-modal-shadow` removed. Harness (my-extensions): dumps refreshed from the Part A commit `d579200b2b` (dump-only); against them 0 px on all 219 screens and the dumps change only by the removed token. `verify.sh --only-themes` (fixture `verify/fixtures/theme-fixture`): 20/20. |
| M7 Part A | Done | M6 review fixes, each with an attack reproduction in `theme/themeSecurity.test.ts`: asset URLs only from this origin under `/__omnigent/extension-assets/` or the bundle's `assets/` (`isHostAssetUrl`; a forged `omnigent:ui-theme-cache` with `//evil.example` assets loaded them in an M6 production build); the cache left out of settings export (skipped on import) and rewritten when its content differs from the live theme; `applyCached` no longer paints over a settled or registered theme (in production builds the built-ins settle first, so a missing extension never fell back); runtime selectors anchored to `:root` and to the embed's scope root and its direct child; an injective `extensionCssPrefix` (`x-acme__theme_2dfixture`) and `var()` of the theme's own extension's colours only; font lists check the `var()` they read; brand SVGs lose `style` and CSS image functions; app names and theme labels lose `\p{Cf}`; length ranges (0..10000px, tighter per token), capped `calc()` literals, CSS-wide keywords rejected; `__proto__` keys dropped with a warning by the dev plugin and the page (the virtual module inlines JSON text). Raw colour guard: escaped and template hex, system colours, `.json`/`.scss`/`.html`; it found 4 existing cases (allowlist raised with the increase flag). Harness (my-extensions `6317d22`): `dark-fixture` screens (Appearance and the picker with a contributed theme, baselines from `5551e93249`), anchoring checks and a production-build fallback check; against the baselines 0 px except `dark-omni/dialog-new-project` (1 px, delta 1, identical on the unmodified M6 commit: environment drift), dumps changed only by M6's removed `onboarding-modal-shadow`; `--only-themes` 24/24 (on M6: 18/24, failing the four new checks and the two that read the renamed fixture names). |
| M7 | Done | The built-in palettes are the `omnigent.themes` built-in extension (`builtinExtensions/builtInThemes.ts` generates its contributions and static theme files from `lib/themePalette.ts`; a light and dark family per palette and Custom). Their files name `omnigent.palette` (built-ins only): the service applies the precompiled `data-theme` CSS, no runtime stylesheet, and stores the palette id as before. `themeService.entries()` is the one list of the ⌘K picker and Settings > Appearance > Color theme: built-ins first (same rows, labels and chips as before), then each extension's themes under its `displayName`, families as one entry, single-mode themes "Dark only"/"Light only", swatches from `omnigent.swatch` or the resolved colours and option choices, a missing extension's chosen theme greyed "Unavailable" with the choice kept; `preview()` drives the picker's live preview (Escape reverts, nothing stored, no cache written); `setProductPolicy` (`allowed`, `hidePicker`) is wired for M10. Settings shows, under the picker, the chosen theme's options and an Advanced row (colour customizations as JSON, global and `[<theme id>]`, checked per key with inline errors, applied over built-in palettes too); the palette editor shows for built-in themes only; the mode control shows "Set by theme" and is disabled under a single-mode theme. Variants: stored (`omnigent:ui-variants`, `setVariant`, `getVariants`, `useThemeVariants`, resolved over the theme's in `getActive().variants`), their control hidden until M9 applies them (a control that changes nothing would mislead). Settings search: built-in theme names searchable, extensions' themes runtime choices, new Theme options and Advanced entries; import/export round-trips the theme, options, variants and customizations, never the cache. A declarative extension (no activation events) contributes without a warning. Harness (my-extensions `fd2248e`): `--only-themes` 30/30 through the real picker and Settings; against the baselines, the dumps change only by M6's removed token, 0 px on every screen but `settings-appearance` (all 11 selections: the Advanced row), `dark-fixture/settings-appearance` and `dark-fixture/theme-picker` (the contributed theme shown), refreshed from `273cc3feb9`, and the pre-existing 1 px of `dark-omni/dialog-new-project`. |
| M8 Part A | Done | M7 follow-ups, each with a test: per-theme customization keys apply to what is on screen (`[<extension id>/<family>]` in both modes, then `[<member id>]` in its mode; built-ins also `[nord]` below `[omnigent.themes/nord]` and `[omnigent.themes/nord-<mode>]`), unknown ids inline errors in Advanced (a missing extension's theme a warning), the editor checks the length first and parses once typing pauses (250 ms); brand SVGs lose backslashes, `xml:base`, `requiredExtensions`, foreign namespaces and any prefix but `xlink:`/`xml:`, and the dev plugin serves them with `default-src 'none'; style-src 'none'; sandbox` (checked in Chrome: opened as a document, injected `<image>`, `<style>` and `<script>` load, style and run nothing; the backend's `/v1` extension assets already sent `default-src 'none'; sandbox`); `isHostAssetUrl` takes exactly `/__omnigent/extension-assets/` and the bundle's `BASE_URL` + `assets/`; `calc()` evaluated as an interval (Validation above), colour channels and gradients capped; `allowed` binds `select()`, `preview()` and `omnigent.selectColorTheme`, `hidePicker` hides only the picker row (and the built-in palette editor), new `hideCustomizations` hides the options and Advanced; the embed's scope root carries a per-page nonce marker (`data-omnigent-scope`) and its inner root `data-omnigent-inner`, which the runtime selectors name; a non-built-in extension under the `omnigent` publisher or with a loaded id is skipped with a warning; cached labels lose `\p{Cf}`; the open picker closes (reverting its preview) when the path changes. UI polish: "Current theme" (search part label too), the theme select sized 15 to 20rem to its label, `familyLabel` from any member (and cached), the Unavailable tile and chips show the default with a marker and the explanation wraps, the locked mode control dimmed, option selects 10rem wide on phones and 15rem from `sm` up. Tests: built-in themes registered only where listed (`src/test/withBuiltInThemes.ts`): full vitest 539 s wall (setup 369 s summed) before, 530 s (setup 267 s) after, so about 9 s of wall time on 8 workers, not the 50 to 65 s expected. |
| M8 | Done | The plugin read API (Plugin read API above, `theme/colorThemes.ts`): `window.activeColorTheme`, `onDidChangeActiveColorTheme`, `getThemeToken`, `ThemeColor` and `ColorThemeKind`, `SessionHeaderItem.color`; `contributes.colors` takes `<extension id>.<camelCaseName>` ids; api tests in `vscodeExtensions/colorThemeApi.test.ts`; vendored typings updated. my-extensions: `thekauer.dev`'s session cost item uses `new ThemeColor("thekauer.dev.costBadge")` (default the muted foreground) and logs theme changes. Harness (my-extensions `d262ad9`): against the baselines the dumps change only by M6's removed token, 0 px on every screen but `settings-appearance` (all 11 selections and `dark-fixture`: the polish above), refreshed from `86ac03ff40`; after the refresh 0 px except `light-github/session` (15 px of delta 1 inside the copy-button spot mask, the known flake). `--only-themes` 31/31 (the new M8 check: one change event on select, none on preview). |
| M9 Part A | Done | M8 follow-ups, each with a test: `activeColorTheme` gains `options` and is committed-only (theme and mode; a mode preview reads the mode the roots had when it began), and the change event compares it with the service's applied key (`committedState()`), so an option or customization fires it; `calc()` reads a token at its range widened by its width, clamped to 10000 (numbers absolute), so the report's doubling chain stops at its second step, with em capped at 4 for font sizes, durations in ms and the pill's operands bounded (Validation above); the reserved publisher and duplicate id checks are case-insensitive (host and dev plugin); `select(null)` and `preview(null)` take the first allowed theme when `allowed` leaves the default out; the dev plugin's colour map has `fullId` and every asset gets the CSP; the embed nonce is documented as no defence against scripts; `cssColor` takes plain `{ id }`. Tests: 325 pure-logic `.test.ts` files run in the node environment (`// @vitest-environment node`, kept only where they passed with the same counts under node and jsdom and name no DOM global; `test-setup.ts` guards its DOM stubs): full vitest 549 s wall (environment 1134 s summed) before, 489 s (environment 769 s) after, at a load average near 16 both times. |
| M9 | Done | Variants as built (Variants above). Harness (my-extensions): against the baselines the dumps change only by additions (the 9 `ui-bubble-*`, `ui-sheet-*`, `ui-cta-*` tokens) and M6's removed token, 0 px on every screen but `settings-appearance` (all 11 selections: the Style rows) and `dark-fixture`'s two (the fixture's own compact density and mono labels now apply), refreshed from the M9 commit; new `variants-dark` (24 screens, one per non-default value) and `variants-light` (5) baselines, the scrollbar ones from a Chrome that draws scrollbars. `--only-themes` 33/33 (new: the fixture's variants as theme default, a Settings override, one change event each; the brackets out of the accessible name). |
| M10 Part A | Done | M9 follow-up: a `calc()` that reads tokens is range-checked at resolve time from the resolved values (`theme/resolveTokens.ts`, Validation above), not at parse time from widened ranges, so `calc(var(--ui-row-line) + 8px)`, the registry's own formulas and proportional radii pass; `checkCache` and the Advanced editor run the same pass. |
| M10 | Done | The product theme hook (`theme/productTheme.ts`): `OmnigentAppProps.product.theme` over the build's `web/product.json` over the server's `product: theme:` block (`server_config.py`, shape-checked, served on `GET /v1/info` as `product.theme`, `openapi.json` regenerated), merged field by field into `setProductPolicy`. `default` is what a first run and a reset choose (nothing stored; it resolves when read, so a theme whose extension loads later still applies); `allowed` takes ids and `*` patterns, a stored choice outside it yields to the default; `lockMode`, `lockedTokens` (checked as a theme's), `lockedOptions` and `lockedVariants` are the top layer at resolve time for contributed and built-in themes, `setOption`/`setVariant` refuse locked ones, the mode lock wins over a picker's preview and NativeThemeSync sends it; `hideCustomizations` also stops stored options, variants and customizations from applying. Settings shows locks disabled with "Set by product" and groups the 13 Style rows in a disclosure (open when a variant is set or a search hits it). The embed applies the product theme in a layout effect once its scope root has mounted (before, the first render resolved against the host page's `<html>`). Also: the cycling working verbs hold the first verb under reduced motion, `usePrefersReducedMotion` falls back to `addListener` (a MediaQueryList without `addEventListener`), the floating sheet is symmetric while the sidebar is collapsed and off below md (new `ui-sheet-gap-top`), and the working indicator's keyframes are `omnigent-working-*`. Checks: vitest 1211 files green (canvas's native build is missing here and jsdom runs without it, no test affected), type-check, oxlint, the token generator and `noRawColors` guard, both builds, pre-commit on the M10 files. pytest: the `test_app.py` route failure and the `asgiref` ones were the venv, not M10 (starlette 1.10 from an unlocked install; with uv.lock's versions it passes on both `extensible-ui` and M10); M10's one real failure was `openapi.json` drift, fixed; the 51 tests still failing in a clean environment fail the same on `extensible-ui` (sandbox, interpreter provenance, psycopg). Harness (my-extensions `c8ffe6d`): against the old baselines 0 px except `settings-appearance` in all 12 selections (the Style disclosure) and dumps with additions only (`ui-sheet-gap-top`); new `cta-*-share`, `sheet-floating-collapsed` and `-narrow` variant screens; refreshed from `9dc830e4d7`, then 0 px everywhere (26 px inside the copy-button masks), identical dumps. `--only-themes` 49/49 (new: the product checks standalone and in the embed, and the bracketed label's accessible name read from Chrome through CDP). |
| M10b | Done | Settings JSON (VS Code style), as designed in "M10b: settings JSON (VS Code style)" below: `theme/settingsDocument.ts` (the stored document, last good values, in-place edits, migration), `theme/settingsSchema.ts`, `theme/settingsLanguage.ts`, the theme service's `getSettingsText`, `getSettingsSchema`, `checkSettings`, `saveSettings` and `settingsWriteBlocked` (options, variants and customizations read from the document; `setOption`, `setVariant` and `setCustomizations` edit it, `SettingsWriteError` when it doesn't parse or the key is locked), the Monaco dialog (`shell/settingsJson/`, mounted in `AppShellOverlays`), Settings' "Options, style and colors" row (catalog `settings-json`, replacing the Theme options, Style, variant and Advanced entries) and the quick picks (`shell/themeSettingsCommands.ts`; palette command options take `description`, `availability` and `setting`). Dependency: `jsonc-parser` 3.3.1 (already in the lockfile through other packages). Checks: type-check, oxlint `--deny-warnings`, the token generator `--check`, the `noRawColors` guard and full vitest (1217 files, 26043 tests) green, both builds, pre-commit on the changed files (the two `.venv` hooks run through `uv`); no server change, so no pytest. Harness (my-extensions `e0c1648`): `--only-themes` 57/57 (options and variants switched through the quick picks; new: the settings JSON's completions, a wrong value's problem, a save, a malformed save keeping the last good values, an empty document, the pre-M10b keys migrated, the locked keys "Set by product" in the editor and the quick picks, standalone and in the embed); against the M10 baselines 0 px except `settings-appearance` in all 13 selections (the inline rows gone), dumps identical; new `settings-json` and `style-variant-picker` screens (default light and dark, a dark spot mask on the editor's bottom border); refreshed from `b6218a0ebb`, then 584/584, 0 px outside the copy-button masks, identical dumps. |
| M11 | Done | The DevHub Console and Paper (family `devhub`, "DevHub") and Vercel (dark only, forces dark) themes in `my-extensions/dev` (`thekauer.dev`, my-extensions `6a0b520`): tokens, options (accent Orange/Lava, corners Square/Soft 8px, Share and Stop Orange/Light; none for Vercel) and variants only, no CSS; Inter, DM Sans and Geist through `contributes.fonts` (OFL, licences shipped); `appName` and the design's product mark as logo and favicon; the CSS preview and its key cycling retired. Generic surface tokens (`07f31dfb26`, token groups "Surfaces" above and the code group; `theme/surfaceTokens.test.ts`), each today's look unset or at its default. Not matched (layout stage or no generic seam): the icon rail, top bar, sidebar width and the nav's hidden "New session" row; muted idle sidebar rows (several `text-foreground` sites); 13.5px rows and 15px chat text (the Appearance font size owns them); an accent Send; the avatar, timestamps and header items in the label font; the panel toggle's open colours; the fold row's brackets and the 0.04em label tracking (the label variant sets its own). Harness (my-extensions `b8f9688`, baselines `c355a30`): against the M10b baselines 0 px on every existing screen (the known 1 px of `dark-omni/dialog-new-project` aside) and dumps with the 25 new tokens added only, both builds; new `devhub-console`, `-paper`, `-vercel` (14 screens each) and `-console-options`, `-paper-options` (4 each), session and app views only; a second run against them 0 px. `--only-themes` 75/75 (new: the DevHub family from the picker in both modes, tokens, variants, fonts loaded, brand, options from the quick pick, Vercel forced dark, no warnings). Side-by-sides against the preview (my-extensions `c8ffe6d`) published. Checks: vitest 1218 files green, type-check, oxlint, the token generator, the `noRawColors` guard (one `text-[Npx]` fewer), both builds, the SDK typings, prettier and the reference policy. No server change, so no pytest. |
| M10b follow-up | Done | The settings JSON editor's hover and suggestions render in a node of their own (`shell/settingsJson/OverflowWidgets.tsx`), Monaco's `overflowWidgetsDomNode` with `fixedOverflowWidgets`: the dialog's translate and backdrop filter made its box their containing block, so a long hover ran past the dialog's edge and was cut there. The node is a React portal from the editor (the dialog counts a pointer or focus in it as inside, so clicking a suggestion or the hover keeps it open), on the embed's inner root or the body, with Monaco's class. Checks: type-check, oxlint `--deny-warnings`, full vitest (1219 files, 26051 tests), both builds, pre-commit on the changed files. Harness: `--only-themes` 77/77 (new: the locked key's hover shows whole, outside the dialog's box, in its own node inside the theme scope, in the editor's hover colours, standalone and in the embed); the `settings-json` screens 0 px against the baselines. |
| Embed mode fix | Done | In the embed the `dark` class is on the inner root, never on the scope root, yet the embed scoping rewrote a root selector's mode test onto the scope root: `:root:not(.dark) .x` became `.omnigent-app:not(.dark) .x`, which held in dark mode too, and `:root.dark` became `.omnigent-app.dark`, which never held. In the built embed that put the light rules of the conversations sidebar (its background and edge), the mobile glass and the custom translucent sidebar on a dark app, and the light `.menu-surface` rule on every dialog and menu (kept dark there only by source order). `vite.embed.config.ts` now moves a root's `.dark`/`:not(.dark)` onto the inner root (`.omnigent-app > :where([data-omnigent-inner]):not(.dark) .x`, same specificity), keeps the root's other conditions on the scope root and its light block (`:root:not(.dark) { … }`) as the scope root's light fallback, and fails the build on a mode test it can't move (`:root:is(.dark)`). The runtime stylesheet's scope root takes the inner root's mode (`:has(> [data-omnigent-inner]:where(.dark))`), so a theme's light-only value no longer reaches a dark inner root through it. The light dialog of the M10b embed screenshot came from the harness: it ran the embed on the dev server with the unscoped stylesheet, where `:root` is the host page's light root and `:root:not(.dark) .menu-surface` (0,3,0) beat `.dark .menu-surface`. The harness's product embed now loads the embed build's scoped stylesheet instead. Tests: `embed.test.tsx` ("embed mode tests") and `themeCss.test.ts`, failing before. Harness: `--only-themes` 80/80 (new: no light-mode rule matches the dark embed, on the session and with the settings JSON dialog and hover open; the dialog paints dark; on the old build 76/80); `--screens --token-dump --embed --compare` 0 px and identical dumps, so no baseline changed. |

Resume notes:

- For M8 (done): `colorThemes.ts` builds on `themeService.appliedTheme(mode)` and
  `isPreviewing()`, the roots' `.dark` class (through `subscribeThemeTokens`) and the
  mode preview store, and fires only when the snapshot differs from the last one fired.
- For M9 (done): `getVariants()` (and `useThemeVariants`) are the resolved variants (theme's,
  then the user's); write them as `data-omni-<name>` on the theme roots and add the
  Appearance control under the theme options (each with "Theme default"; `VARIANT_LABELS`
  in `theme/variants.ts`, its catalog entry with one part per variant). The audit's
  "web › contributed theme" scenario is the place to cover it.
  `activeColorTheme.variants` already reports `getVariants()`; a variant change fires
  `onDidChangeActiveColorTheme` once it is applied (the event compares the variants too).
  More plain-data fields can take a `ThemeColor` through `colorThemes.cssColor`; the
  header item is the pattern (the registry gets a resolver bound to the extension).
- For M10 (done): `select(null)` (Settings' reset) chooses the first allowed entry when `allowed`
  leaves the default palette out (M9 Part A); `OmnigentAppProps.product.theme.default`
  should take precedence over that. Product variant locks go after the user's in
  `resolveVariants` (themeService `resolve` and the built-in branch of `refresh`), and a
  locked variant's Settings row should show disabled. `hideCustomizations` hides the Style
  rows too.
- For M11 (done): DevHub sets `omnigent.variants` (Console and Paper: label bracketed, scrollbar
  rail, userBubble square, workingIndicator square-pulse, workingVerbs cycle, composer
  flat, contextStrip attached, header solid, cta accent-square; Vercel: userBubble soft,
  cta light-square, sheet floating, label plain) and tunes them with the `ui-bubble-*`,
  `ui-cta-*`, `ui-sheet-*` and scrollbar tokens; density stays its 34px tokens (or
  comfortable). The preview's CSS for these goes once Console matches.
  `themeService.setProductPolicy({ allowed, hidePicker, hideCustomizations })` already filters
  `entries()` (the chosen theme always kept) and hides the picker command and the Settings
  row; `lockMode`/`lockedTokens` go last in `ThemeService.resolve`'s layers.
- For M7 (done): themeService already lists contributed themes, applies families and forced
  modes, options and colour customizations (`omnigent:ui-color-customizations`, global
  and `[<theme id>]`), and caches the last applied values; the picker and Settings
  (decision 9) read `list()`/`getActive()` and call `select()`/`setOption()`, and
  subscribe with `onDidChange`. The built-in palettes still go through
  `applyThemePalette`: moving them into a built-in theme extension means static
  `ExtensionDescription.files` imports and a selection id per palette (the widened
  `omnigent:ui-theme-palette` keeps the old ids working). `list()` has no swatches yet
  (resolve them from a theme's blocks), and the mode control needs `getForcedMode()`
  for "Set by theme". Variants are parsed and stored (`getActive().variants`), applied
  in M9. Product locks (M10) go last in `ThemeService.resolve`'s layers.

- Work happens in a worktree of `extensible-ui`, landed with a rebase and a push to
  `origin/extensible-ui`, then `git merge --ff-only` in the main checkout.
- The harness and its baselines live in `my-extensions/dev/verify/` (decision 6).
- No-change check for a Layer 0 step: from `my-extensions/dev`, run
  `OMNI_UI_REPO=<checkout> ./verify/verify.sh --screens --token-dump --embed --compare verify/baselines`
  (about 10 minutes). It needs 0 px per screen and identical `tokens.json` and
  `tokens-embed.json` (added tokens aside), and the baseline's Chrome version. The only
  tolerance is spot-specific: inside the baseline's recorded masks of the dark code
  blocks' copy buttons (a known one-LSB flake), at most 2 per channel, with both dumps
  present and no token value changed or removed; 0 px everywhere else. Since M5 the
  masks also cover light-nord's session, where the flake showed too. The dumps were
  last refreshed from M5's Part A commit (dump-only).
- A worktree needs real `node_modules` (`cp -al` of the main checkout's root and
  `web/` ones): symlinked ones resolve outside the worktree, and Vite's dev server then
  refuses the Geist Mono font, which changes every mono glyph.
- Still literal after M5 (frozen by `theme/noRawColors.test.ts`): `index.css`'s
  markdown alert and preview colours, the rest of the palette classes in files outside
  the hotspots (approval and slash command cards, terminal command cards, trigger
  templates, the design tools' marks), every `rounded-[…]` and `text-[Npx]` (the guard
  counts them; no token yet), mask colours (`#000` in CSS masks, which only carry
  alpha), the colour picker's hue and value gradients (the picker's data), and the
  chat's ANSI output colours (the syntax theme's `terminal.ansi*`, not `terminal-*`).
  CanvasPage's
  thin strip reads `ui-scrollbar-width` but is not a `.ui-scroll` (it has no WebKit
  styling, which `.ui-scroll` would add in Safari). No hook yet (the DevHub preview still matches them
  by `data-testid` or class text): the sidebar nav and server picker, the header title
  and items, the view-mode toggle, timestamps, the composer's agent values and the
  chat column width (layout stage).
- Buttons wrapped in a Radix trigger (`asChild`) get the trigger's `data-slot`
  (`tooltip-trigger`) unless they set their own after their props, as
  ComposerSendButton does; a hook passed as a prop at the call site wins anyway.
- Refresh the baselines (`--save-baselines`) only on a commit that is meant to change
  the look, and say so in its message.
- Screens: `terminal-command` is the transcript's shell output; `terminal-xterm` is the
  right panel's real xterm, whose terminals list and attach WebSocket the page answers
  (Playwright `route_web_socket`); `file-viewer` and `file-diff` are Monaco (the Files
  tab and a Changes file's diff); `diff` is the pull request diff (@pierre/diffs). The
  CodeMirror viewer only mounts in the workspace tabs v2 (not routed yet), so no screen
  shows it; the M4 fixture proof mounted it on a scratch page. The embed dump uses the
  embed build's scoped stylesheet on a harness page with the embed's two roots, not a
  mounted `OmnigentApp`.
- Scripts read tokens through `theme/tokenValues.ts`: on the innermost theme root, or
  on a `data-token-mode` probe for a `perMode` token (the terminal) in the mode the
  root isn't in. M6's runtime theme CSS must also write `perMode` tokens onto the
  `[data-token-mode="light"|"dark"]` probes, or a terminal set to the other mode keeps
  the defaults. `syntax-theme-*` names are passed to Shiki as written; M6 validates them
  against Shiki's bundled themes and the registered ones (`registerSyntaxTheme`), and
  wires a theme's `tokenColors` to `registerSyntaxTheme`.

- For M6: `theme/validate.ts` exists with the syntax theme part (hex colours,
  `fontStyle`, size caps); add the token kinds there. Wire a theme's `brand` section to
  `setBrandOverride` (logos as allow-listed asset URLs). Tokens whose default is a
  Tailwind step read `var(--color-<step>)` (`tw()`): a theme replaces the token, never
  the Tailwind variable. `shell/monacoTokenColors.ts` writes Monaco's `--vscode-*`
  variables only for tokens with a value, so a token that must stay "unset = the
  syntax theme's" has no default. The raw colour guard's allowlist only shrinks; new
  UI code reads tokens.

Paths are relative to the omnigent repo root unless they start with `my-extensions/`.

## Context

- Long-term goal: Omnigent becomes a fully customizable UI platform. Products built on Omnigent must be able to control style, layout, menus and branding. Frontend and backend stay clearly split.
- Roadmap: theming (this plan, Stage 1), then layout (activity bar, sidebar view containers, top bar), menus everywhere, product config, and the trusted React tier.
- Architecture: two tiers, Theia-style.
  - Trusted products and built-ins can supply React slots.
  - Third-party extensions stay plain data.
- Theming must be usable by plugins. Token ids are public CSS variable names, shared by extensions, the future trusted tier, and product config.
- First consumer: the DevHub "Omnigent Session redesign". The design bundle is in `my-extensions/designs/omnigent-session-redesign/` (README.md, `files/_ds/.../tokens/*.css`).
- A raw-CSS preview of the Console look exists in `my-extensions/dev/src/features/devhubPreview.{js,css}`. It is the parity reference, and is retired in M11.

## User decisions (2026-11-24)

1. Console (dark) and Paper (light) form one "DevHub" family that switches with the mode toggle. Vercel is dark-only and forces dark mode while active.
2. Theme `options` ship from the start: accent (Orange/Lava) and corners (Square/Soft). Also add a CTA colour option, because the design thumbnail and README disagree on Share/Stop: Orange (default) vs Light.
3. Density: "regular" stays today's 28px rows. DevHub sets 34px through its theme tokens.
4. VS Code colour id aliases (`editor.background`, `sideBar.background`, `focusBorder`, ...) are in scope now, so stock VS Code themes partly import. Map a curated alias table onto Omnigent tokens.
5. Geist (for the Vercel look) ships in the extension via `contributes.fonts`, not bundled in the host.
6. Screenshot baselines live in `my-extensions/dev/verify/baselines/`, not upstream.
7. Brand art is themeable, not exempt. Themes can replace the Omnigent brand icon, wordmark and logo, and recolour the Otto/Nessie art. This needs:
   - brand tokens (colours used by OttoIcon/NessieIcon);
   - a theme `brand` section with sanitized SVG or woff2-style asset references for the logo, wordmark and favicon, rendered by the host as `<img>` (never inline script-capable SVG).
8. DevHub themes ship only as an extension (`my-extensions/dev`), never as a built-in. That is the point of the work. Mechanisms go in the fork; the themes stay in the extension.
9. Settings > Appearance and the theme picker (M7, decided 2026-11-25):
   - Theme options (accent, corners, CTA) and style variants (density, labels, scrollbar, message style, composer and so on, each with a "Theme default" choice) sit inline directly under the colour theme picker, not in a separate section. The advanced colour customizations JSON goes there too, as a collapsed disclosure.
   - One list, the same in Settings and the command palette: the built-in palettes, then the extension themes, grouped and labelled by extension.
   - Swatches come from each theme's resolved colours.
   - Arrowing through the list in the palette previews live; Escape reverts.
   - Families follow the existing mode setting (DevHub: Console in dark, Paper in light).
   - A single-mode theme forces the mode, and the mode control shows "Set by theme".
   - Custom stays an entry.
   - A theme whose extension is missing shows "Unavailable".
   - Products can restrict the allowed themes or hide the picker.
   - Decided in M8's Part A (M7 follow-ups): `allowed` binds `select()`, `preview()` and
     `omnigent.selectColorTheme` too, not only the list. `hidePicker` hides only the picker
     (the command and Settings' picker row, with the built-in palette editor, which would
     choose Custom); the chosen theme's options and Advanced stay unless the product also
     sets `hideCustomizations`.
   - Per-theme customization keys apply to what is on screen: `[<extension id>/<family>]`
     in both of a family's modes, then `[<member id>]` in that member's mode only; a
     built-in palette also takes its old palette id (`[nord]`) below
     `[omnigent.themes/nord]` and `[omnigent.themes/nord-dark]`. Unknown ids are inline
     errors in the Advanced editor, a missing extension's theme a warning.

## Findings to build on

- Palettes: `web/src/lib/themePalette.ts`.
  - `PaletteTokens` :63, `PALETTE_TOKEN_CSS_NAMES` :105, `PALETTES` :220.
  - `applyThemePalette` :745 stamps `data-theme` on `getThemeRoots()` (`lib/host.ts`).
- Generator (before M1): `web/scripts/generate-theme-palettes.mjs` wrote `web/src/themePalettes.generated.css`; M1 renamed both (see the token model). Pre-commit `--check` is at `.pre-commit-config.yaml:89`.
- Custom theme: `lib/customTheme.ts:528` writes `--custom-{light,dark}-*`. Mode comes from next-themes `.dark` (`components/theme/ThemeProvider.tsx`).
- Boot order: `main.tsx:117-134` and `embed.tsx` apply font/custom/palette before first paint. Contributions apply before activation (`vscodeExtensions/host.ts` `contribute()`, `contributions.ts` `parseContributions`).
- Non-palette colours live only in `index.css` `:root` (~186) and `.dark` (~310): status, destructive, primary-cta, chart, session-active, tag-pink, tooltip-bg, foreground-tertiary.
- `@theme inline` (index.css ~55-157) bakes in literal radius sm/md/lg (4/6/8px) and font stacks. Shadows use `--ui-shadow-neutral-rgb`. No density token exists.
- Hard-coded values in TSX: about 337 raw palette classes, about 65 `rounded-[...]`, about 75 `text-[Npx]`. Hex hotspots: OttoIcon 36, ThemeColorPicker 10, AppearancePreviews 10. Re-measure in M0.
- Parallel colour systems:
  - Shiki (`lib/syntaxTheme.ts`)
  - Monaco (`shell/monacoSetup.ts`)
  - CodeMirror (`shell/codeMirror/codeMirrorTheme.ts`)
  - xterm (`components/blocks/TerminalSession.ts` terminalTheme, `CodexTerminalPalette.ts`)
  - diffs (`lib/diffTheme.ts`)
  - file tree (`components/file-tree/vendored/file-tree.css`, `fileTreeStyle`)
- Embed: CSS is scoped under `.omnigent-app` (`vite.embed.config.ts`). Theme roots come from `lib/host.ts`. A root selector's mode test (`.dark`, `:not(.dark)`) is moved onto the inner root, which carries the class. The embed now starts the extension host (`useWindowExtensionHost`).
- The dev plugin serves only `.js/.mjs/.json/.css` from extension folders (`vite.omnigentExtensions.ts`).
- Persistence uses localStorage keys listed in `lib/settingsPortability.ts`.
- Repo rule (AGENTS.md): move a built-in onto each new seam. So the 7 built-in palettes move into a built-in theme extension (M7).

### Raw-CSS preview findings to fix

- Radii are baked in, which forced a global `border-radius:0 !important`. Fix with radius utilities resolving to `var(--ui-radius-*)`, derived from `--ui-radius-base` (M2).
- Fonts are baked in, and `--ui-font-family` is set inline at runtime. Fix with font utilities pointing at `var(--ui-font-*)` and the user font setting as an override layer (M2).
- There is no shadow toggle. Fix with `--ui-elevation` (0..1) multiplying every shadow alpha, plus `--ui-shadow-color` (M2).
- There are no tokens for label font/case/size, row/header/tab-strip height, Share/Stop variant, user bubble, working indicator or scrollbar. Fix in M3 (tokens and hooks) and M9 (variants).
- Fragile hooks: sidebar section label (`h2 > button`), view title bar (first div plus `h-11`), PR rows (`ul[aria-label] > li`), Share/Stop/panel toggle by aria-label, and `[class*="scrollbar-width:thin"]`. Add stable `data-slot` hooks:
  - `sidebar-section-label`, `view-title`, `pr-row`, `share-button`, `composer-stop`, `panel-toggle`
  - `user-bubble`, `working-indicator`, `composer-context-strip`, `rail-tab`
  - a `.ui-scroll` class
- Stable hooks that worked become documented public hooks:
  - `.app-shell`, `.conversations-sidebar`, `.sidebar-row`, `.chat-header.session-header-glass`, `.otto-working`
  - `--sidebar-active*`, `--composer-shadow`, `--segmented-*`, `--menu-surface-*`

## Token model

- One registry: `web/src/theme/tokens/registry.ts`, plus one module per group.
- A `TokenDef` has: id (the CSS var name without `--`), group, kind, default (`{light,dark}`, may be a `var()` of another token), `palette?`, `derived?`, description.
  - `PaletteTokens` is derived from the registry.
  - The CSS-only tokens move into the registry with byte-identical defaults.
- Generator: `generate-theme-tokens.mjs` writes `web/src/themeTokens.generated.css`.
  - Defaults go in `:root` and `.dark` (as built in M1: `:root` rather than `:root:not(.dark)`, so dark mode keeps inheriting a light-only default exactly as the hand-written blocks did).
  - Derived formulas are re-emitted on the palette-stamped roots (`[data-theme]:not(.dark)` and `.dark[data-theme]`), so embed inner roots resolve them. `derived` is computed from the value (`isDerivedValue`), not stored.
  - Palette blocks are generated as today.
- Extension colours (`contributes.colors`) register at runtime as `--x-<encoded extension id>-<id>`
  (`extensionCssPrefix`: injective, no `-` in the encoded id; `acme.theme-fixture` is
  `x-acme__theme_2dfixture`).

### Naming (decided after M2)

- The public token names stay as they are: the registry id is the CSS variable name.
  The palette colours keep shadcn's names (`background`, `primary`, `sidebar-*`), which
  `components/ui/*`, Tailwind's `@theme` and upstream already use; host tokens added by
  this plan take the `ui-` prefix (as `ui-font-family` and `ui-shadow-neutral-rgb`
  already did upstream). No `--omni-*` rename: VS Code's `--vscode-*` exists because
  its webviews receive the workbench colours under a separate namespace, while here
  the names are the host's own variables, and the collision risk is confined by the two
  rules below.
- A host token added by this plan starts with its group's prefix (`registry.test.ts`
  checks it): `ui-` (shape, typography, elevation, density, border, scrollbar and the
  status tones), `terminal-`, `diff-`, `file-tree-`, `viewer-`, `syntax-theme-` and
  `code-` (the code surfaces) and `brand-` (brand art). The one exception is the
  internal `omnigent-elevation` (below). The tokens that predate the plan keep their names.
- Namespaces never overlap: extension tokens are `--x-<encoded extension id>-<id>`, so no
  host token may start with `x-`. Themes address tokens by id (and by the VS Code
  aliases, decision 4); plugins read them through `getThemeToken(id)` or `var(--id)`.
- `@property` registrations are document-global and cannot be scoped, so only
  standalone registers tokens. The embed build drops the token `@property` rules and
  their Tailwind no-`@property` fallbacks (`vite.embed.config.ts`), so a host page's
  own `--ui-*` variables stay untyped. There the registered tokens compute to their
  `calc()` text (`calc(.5rem * .5)` rather than `4px`), which renders identically: the
  embed dump differs from standalone in text only, and the harness checks that a host
  element's `--ui-elevation: high` reads `high`. One exception: the internal
  `--omnigent-elevation` (`registerInEmbed`), a `<number>` with initial 1 declared as
  `var(--ui-elevation)` on the theme roots, stays registered in the embed too. Every
  shadow alpha and inline shadow reads it instead of `ui-elevation`, so an invalid
  elevation in the embed reads 1 there as well, and a `box-shadow` that combines rings or
  insets with an elevation-scaled layer never turns invalid as a whole. The name is
  Omnigent's own (`omnigent-`), never a host page's.
- A token with no default in either mode is reset to `initial` on the top root (so on
  the embed's scope root), and so is the Appearance layer `--ui-font-family` unless the
  app sets it inline there: a host page's own variables of those names do not inherit
  into the app. The harness probes both on the embed page.
- Registered syntaxes take every plausible value, because a value outside the syntax
  silently computes to the parent's or the initial value: radii are
  `<length-percentage>`, every shadow alpha is kind `alpha` with
  `<number> | <percentage>`. `ui-elevation` stays a `<number>`: `calc()` cannot multiply
  two percentages, so a percentage elevation would invalidate the percentage alphas. Its
  initial value is 1, so an invalid elevation on the top root keeps full shadows (below
  it, the parent's value inherits). M6's `validate.ts` rejects such values with a
  warning before they reach CSS; raw CSS from extensions gets the fallbacks above. The
  harness probes which values each registration takes.
- Derived tokens resolve where they are declared: on `:root`, `.dark` and the theme
  roots (the top root and its direct child). Overriding a base (`ui-radius-base`,
  `ui-elevation`, a palette colour) on an element below the theme roots does not
  recompute the tokens derived from it there; those inherit already computed. Nested
  theme roots deeper than one level are not supported. M6 (runtime theme CSS) and M9
  (variants) must write bases on the theme roots, or re-emit the derived formulas on
  any new scope they add.

### Token groups

Defaults must match today exactly.

- **Workbench colours.** The existing palette tokens, plus:
  - foreground-tertiary, border-weak, primary-cta(+foreground), destructive(+foreground)
  - tooltip-bg, tag-pink, session-active, search-match-foreground, button-icon-hover-color
  - composer, menu and card surfaces; segmented-*; app-shell-bg; selection-native
- **Status:** success, warning, info, status-{blue,green,yellow,red,gray}. M5's tones
  (`status.ts`, exact Tailwind pairs): ui-{success,warning,danger,merged}-tone (a hue for
  washes, borders and dots, used with alphas), ui-success-text(-strong/-emphasis),
  ui-warning-text(-soft/-strong/-emphasis), ui-danger-text(-strong), ui-info-text(-strong),
  ui-merged-text-strong, ui-warning-banner-{background,border,foreground,hover},
  ui-warning-callout-{border,background}, ui-warning-chip-{border,hover,ring},
  ui-merge-button(-hover/-foreground).
- **Chart:** chart-1..5.
- **Code and syntax** (M4, `code.ts`): code-bg, code-selection (palette), viewer-active-line,
  viewer-search-match(-selected), viewer-selection-match, code-selected-line (unset: `sidebar-active`),
  syntax-theme-light/-dark (`github-light`/`github-dark`, a bundled Shiki theme or one
  registered with `registerSyntaxTheme`, `lib/syntaxTheme.ts`). M5: viewer-background,
  viewer-gutter-{background,foreground,active-foreground} and code-block-background (unset:
  each surface's own), viewer-highlight-rgb (channels) and viewer-cited-line, the Shiki
  viewer's viewer-shiki-background and viewer-mark-{cited,icon,line,active,range}, and
  viewer-model-{background,surface} (hex, read by three.js). M11: code-inline-bg (`code-bg`),
  code-inline-border (unset: none; an inset ring, so the text does not move), code-inline-radius
  (`ui-radius-sm`) and code-block-body-background (unset: `background`).
- **Terminal** (M4, `terminal.ts`, `perMode`): terminal-{background,foreground,cursor,cursor-accent,selection},
  terminal-ansi-* (16, `black` to `bright-white`) and terminal-tone-{subtle,input,emphasis}
  (Codex's input box). An unset slot is left out of xterm's theme, so xterm's default applies.
  M5: terminal-{muted,muted-foreground,border,destructive} for the frame (`terminalSurfaceProps`).
- **Diff** (M4, `diff.ts`): diff-addition/deletion-base and -text, diff-number-text, diff-word-mix
  (unset: the diff's own), and diff-{line,gutter,hover}-mix with per-scheme -light/-dark defaults.
  The base colours also tint Monaco's diff when set. M5: diff-stat-added/-deleted (`+N −M`).
- **File tree** (M4, `fileTree.ts`): file-tree-hover, -selected(-foreground), -guide, -focus-ring,
  -radius and -git-{added,deleted,ignored,modified,renamed,untracked} (the vendored `light-dark()` pairs),
  bridged in `fileTreeStyle.ts`. M5: file-tree-row-active (the PR's changed-files list),
  file-tree-review-added/-deleted (the Changes review tree), file-tree-status-added/-modified
  (the Files tab's rows) and file-tree-icon-{pdf,document,spreadsheet,presentation,archive,code,image,media}.
- **Brand (decision 7):** brand-otto-{body,shade,buddy,buddy-shade,eye,pupil} (`brand.ts`), the
  colours OttoIcon fills its parts with; NessieIcon is `currentColor`, the accent is
  `brand-accent` (palette). Logo, wordmark and favicon images come from the brand source
  (`lib/branding.ts` `setBrandOverride`), not tokens.
- **Elevation, glass** (M5): ui-glass-rim, -sheen (images), ui-glass-rim-edge/-glow,
  ui-glass-fallback-{highlight-top,highlight-bottom,edge,glow} and
  ui-omni-glass-{highlight-top,highlight-bottom,ring,glow,border}.
- **Workbench** (M5): ui-color-swatch-border/-ring, ui-color-picker-ring/-handle/-handle-ring,
  ui-qr-background.
- **Typography:**
  - ui-font-ui, ui-font-title, ui-font-mono, ui-font-code, ui-font-label
  - ui-weight-normal/medium/strong, ui-letter-spacing
  - ui-label-size/transform/tracking/weight
- **Shape:** ui-radius-base 8px. Derived xs/sm/md/lg/xl/2xl/3xl/4xl, plus ui-radius-pill. `--radius` and `radius-otto-*` become aliases.
- **Elevation:** ui-elevation 1, shadow rgb tokens, all shadow recipes scaled by elevation
  (through the internal `omnigent-elevation` guard), the glass recipes (ui-shadow-glass,
  -glass-inset, -glass-fallback, -glass-drop on ui-shadow-glass-rgb) and ui-shadow-none.
- **Density** (M3, `density.ts`; defaults in Tailwind spacing steps, so they track `--spacing`):
  - ui-row-line 20px, ui-row-height 28px (line plus padding; a minimum, `.sidebar-row`)
  - ui-control-h-xs/sm/md/lg 24/28/32/36px (`button.tsx` sizes, `input.tsx`, the rail tabs)
  - ui-header-height 48px (session header and sidebar header row, desktop)
  - ui-tabstrip-height 49px (measured: 12px padding twice, a 24px tab, the 1px rule; a minimum),
    ui-tabstrip-padding-x/-y 8/12px
  - ui-view-title-height 44px, ui-view-title-padding-x 8px, ui-view-title-gap 2px
  - Tailwind `--spacing` is not touched.
- **Borders** (M3, `border.ts`): ui-border-width 1px, ui-border-style solid (input, textarea,
  select trigger, dropdown and context menus, kbd), ui-divider-style solid (the tab strips' rule),
  ui-divider-dashed-style dashed (subagent and task activity dividers). A style token sets
  Tailwind's `--tw-border-style`, so a caller's `border-dashed` still wins.
- **Scrollbar** (M3, `scrollbar.ts`, read by `.ui-scroll` and TranscriptScrollbar): ui-scrollbar-width
  thin, ui-scrollbar-size 8px, and ui-scrollbar-thumb/-thumb-hover/-track unset by default
  (`default: {}`), so every surface keeps its own colours until a theme sets them.
- **Label sites** (M3, typography): `.ui-label` reads ui-font-label, ui-label-transform and
  ui-label-tracking everywhere; size and weight are ui-label-size/-weight (sidebar section
  labels, the fold row's weight), ui-view-title-size/-weight and ui-fold-label-size, each
  defaulting to that site's current value. Public hooks: `theme_hooks.md`.
- **Motion:** ui-duration-fast/base, ui-ease, ui-motion.
- **Surfaces** (M11, for full-look themes; unset or at their defaults each is today's
  look): ui-shell-image (the dark shell's glow; `none` for a flat canvas), ui-panel-background
  (the right panel in dark, transparent by default), ui-sidebar-active-ring (`ui-shadow-none`),
  in `elevation.ts`; ui-sidebar-surface (the sidebar's own background apart from `sidebar`),
  ui-sidebar-edge, ui-sidebar-header-rule and ui-panel-edge in `border.ts`;
  ui-app-name-font/-size/-weight/-tracking (the sidebar's app name when the branding sets one)
  and ui-code-letter-spacing (`pre`, `code`, `kbd`, `samp`, in the base layer so tracking
  utilities win) in `typography.ts`; ui-chat-column-width (unset: the three responsive widths)
  in `density.ts`; ui-cta-radius/-font/-size/-transform/-tracking (the square Share and Stop,
  defaults the M9 values), ui-context-strip-background/-radius and ui-working-pulse-radius in
  `variantSurfaces.ts`. An unset colour in a shorthand (`border-right: 1px solid var(--x)`,
  `box-shadow: inset ... var(--x)`) makes the declaration invalid, so nothing is drawn; an
  unset inherited property (`font-family`, `letter-spacing`) inherits as before.

## Theme contribution API (VS Code-shaped)

### Manifest

`contributes.themes`: `[{id, label, uiTheme: "light"|"dark", path, family?}]`.

- The full theme id is `<extensionId>/<id>`.
- A family pairs light and dark members. The picker lists families plus single themes.
- A single-mode theme forces its mode via next-themes `forcedTheme` while active.

`contributes.colors`: `[{id, description, defaults: {light, dark}}]`.

`contributes.fonts`: `[{family, src: "./x.woff2", weight?, style?}]`.

- `.woff2` only, inside the folder, real-path checked, magic bytes `wOF2`, at most 2 MiB.
- The dev plugin allows exactly these files.
- Loaded with the FontFace API under a namespaced family `x-<encoded extension id>-<family>`, on theme activation, `font-display: swap`.

### Theme JSON

```json
{
  "colors": {...},
  "tokenColors": [...],
  "terminal": {...},
  "brand": {"logo": "./brand/logo.svg", "wordmark": "./brand/wordmark.svg", "favicon": "./brand/favicon.svg", "appName": "..."},
  "omnigent": {
    "tokens": {...},
    "variants": {...},
    "options": [{"id": "accent", "label": "...", "default": "...", "choices": {...}}]
  }
}
```

- Unset keys fall back to the registry defaults.
- Unknown keys warn and never fail.
- `colors` also accepts the VS Code ids from the alias table (decision 4), for example `editor.background` maps to `code-bg` and `background`.
- Brand assets:
  - SVG/PNG/WebP files inside the folder, real-path checked, size-capped.
  - The SVG is sanitized: no script, foreignObject, event handlers or external refs. Rendered as `<img>`.
  - Served like fonts, by exact allow-list.
  - The host's BrandLogo and favicon read the active theme's brand, falling back to server branding (`/v1/info`) and then defaults.

### Layering (low to high)

1. Registry defaults.
2. Theme colors and `omnigent.tokens`.
3. Option choices.
4. Theme variants.
5. User Appearance settings (keys they set).
6. `omnigent.colorCustomizations` / `tokenCustomizations` (global or per theme `[id]`).
7. Product locks.

### Validation

`web/src/theme/validate.ts`: pure, shared by browser and Node. It tokenizes values; regex alone is not enough.

- **Colours:** hex, functional colour functions, named colours, transparent/currentColor, `color-mix()` (depth 3 or less), `var()` of registered ids.
- **Lengths:** px/rem/em/%, plus `calc()` of those. Literals within 0..10000px (rem and em
  at 16px; tighter per token: borders 32px, scrollbars 64px, rows and bars 400px, label
  sizes 200px, letter spacing -100..100px), percentages within 0..100, and every literal in a
  `calc()` at most 10000. A `calc()` (and `min()`, `max()`, `clamp()`) is evaluated as an
  interval (`min`/`max`/`clamp` as the hull of their arguments). Parsing (`validateTokenValue`,
  also the dev plugin's) checks the syntax, units, functions, the `em` cap and literal-only
  math against the token's range; a length, number, duration or percentage whose math reads
  tokens is range-checked at resolve time (M10 Part A, `theme/resolveTokens.ts`): for each
  mode, the final layers (theme tokens, the syntax theme name, option choices, the variant
  layer, the colour customizations, the product's locked tokens) over the registry defaults
  are checked per token from the highest layer down. `var()` cycles (Tarjan over the layered
  graph, and a fallback that closes one) are left out, as CSS makes them invalid. Every other
  value's interval is computed from what each token it reads resolved to, dependencies first,
  and must lie in the token's absolute range and the 10000 cap, with no widening; a value that
  doesn't is left out with a warning, and the next layer's value (or the default) applies and
  is what its readers then read. Defaults are trusted formulas: their intervals are computed,
  not checked. Inputs that aren't theme values take their worst case: an `em` 0..64px (4rem),
  Tailwind's `--spacing` 0..16px, the text sizes (the user's font size setting) 0..200px; a
  `%` counts as its number, since its base is a box, not a theme value; `rem` is 16px (the app
  sets no root font size). So `calc(var(--ui-row-line) + 8px)`, the registry's own formulas
  and `calc(var(--ui-radius-base) * 1.5)` pass, and a doubling chain stops at the step past the
  range or cap. Read through a `var()`, the pill radius is unbounded, so no other token takes
  it. `checkCache` runs the same pass over the cached blocks, and Settings' Advanced editor
  reports what it would leave out inline. Lengths are written as given, not wrapped in
  `clamp()`: the pass is sound, the default look keeps its text, `getThemeToken` and the
  unregistered embed tokens keep reading the value written, and a px clamp would cut a `%`
  radius on a large box. Font sizes cap an `em` multiplier at 4; durations compare in
  ms (`s` scaled) within their range. It divides only by a number range that excludes
  zero (a token at its absolute range), and `infinity` only where the registry allows it
  (`allowInfinity`: `ui-radius-pill`), its other operands still bounded. Colour channels,
  shadows and gradients read tokens at their absolute ranges at parse time. Colour channels are capped
  (numbers and angles within -1000..1000, percentages -100..100, alpha 0..1 or 0..100%),
  gradients at 32 stops of at most 10000px or 1000%.
- **Other kinds:** numbers in range, durations, `cubic-bezier`, enums, shadow lists.
- **Rejected values:**
  - `url(`, `image-set(`, `@`, `expression`, `attr(`, `env(`, `!important`
  - `; { } < > \`, comments
  - foreign or unregistered `var()` (another extension's colours included), cycles
  - the CSS-wide keywords `initial`, `inherit`, `unset`, `revert`, `revert-layer` anywhere in a value
  - `__proto__` keys anywhere in a theme file (warned about and dropped, by the dev plugin and the page alike)
  - values over 256 chars
- **Limits:** 1000 tokens per theme, 64 KiB of JSON, 20 themes per extension.
- **Font families:** generic families, host-bundled families, the same extension's declared fonts, or `var(--ui-font-*)`. Names match `^[A-Za-z0-9 _-]{1,64}$`.
- **CSS generation:** the host generates all CSS. Ids go through `CSS.escape`. Bracket glyphs are fixed host strings.

### Loading and applying

- `ExtensionDescription` gains `files`. The dev plugin reads and validates theme JSON at scan time and inlines it into the virtual module (HMR on edit). Built-ins use static JSON imports.
- `web/src/theme/themeService.ts`:
  - resolves layers and writes one `<style id="omnigent-theme-runtime">`;
  - uses scoped selectors in embed (a helper in `lib/host.ts`);
  - writes variants as `data-omni-<name>` on the theme roots.
- **Persistence:**
  - `omnigent:ui-theme-palette` widens to a string, and built-in ids still work.
  - New keys: `omnigent:ui-theme-options`, `omnigent:ui-variants`, `omnigent:ui-color-customizations`, `omnigent:ui-theme-cache`.
  - All are added to settingsPortability.
- **First paint:** the cached last-applied CSS is applied in main and embed. The live version replaces it once the extension registers. If the extension is missing, fall back to the default, keep the choice, and show it as "Unavailable".
- **Picker and settings:**
  - `themePickerItems` comes from `themeService.entries()` (built on `list()`), as does
    Settings > Appearance > Color theme (M7).
  - Appearance gets theme options, variants (with a "Theme default" choice) and colour
    customizations as JSON. M7 ships the options and the customizations; the variants
    are stored (`setVariant`, `getVariants`, `useThemeVariants`) but their control stays
    hidden until M9 applies them.
  - The font setting becomes a layer.

### Plugin read API

- `window.activeColorTheme` (id, label, kind, variants) and `onDidChangeActiveColorTheme` (fires after apply).
- `window.getThemeToken(id)`, read through getComputedStyle.
- The `ThemeColor` class, accepted in `SessionHeaderItem.color` now and in more plain-data fields later.
- The vendored typings check stays.

As built (M8, `theme/colorThemes.ts`):

- `activeColorTheme` is plain data: `id` the member theme on screen (a family's member
  for the mode, `omnigent.themes/<palette>-<mode>` for a built-in, the default's while
  the chosen theme's extension is missing), its `label`, `kind` (`ColorThemeKind`,
  VS Code's values `Light=1, Dark=2, HighContrast=3, HighContrastLight=4`; only 1 and 2
  are used), the chosen theme's `options` (choice by option id; M9 Part A) and the
  resolved `variants`. It is always the committed theme and mode: a picker's preview of
  a theme or a mode never shows in it (the mode as the roots had it when a mode preview
  began, until its end settles).
- `onDidChangeActiveColorTheme` fires after a committed change is applied (the theme,
  an option, a variant or a colour customization, the mode): the theme service's changes
  and the roots' `.dark` class, compared with the last state it fired and the service's
  applied key (`committedState()`); never while the picker previews a theme or a mode,
  and not when a preview ends where it began.
- `getThemeToken(id)` takes registry ids (not internal ones) and the caller's own
  `contributes.colors` (by id or `<extension id>.<id>`); others are undefined with a
  warning. It reads the innermost theme root, as `tokenValues.ts` does, and returns a
  string, so a Worker host can carry it.
- `ThemeColor(id)` takes the same ids; `SessionHeaderItem.color` draws it as
  `var(--<token>)` and drops an unknown one with a warning. A colour string there must
  pass the validator (registry `var()`s only).
- `contributes.colors` also takes VS Code's `<extension id>.<camelCaseName>` ids
  (`thekauer.dev.costBadge` is `--x-thekauer__dev-cost-badge`).

## Variants

Host enums live in `web/src/theme/variants.ts`, with a store and a `useVariant` hook.

- CSS variants use `data-omni-*` attributes plus `web/src/theme/variants.css`.
- Variants that change the DOM are read through a hook in small leaf components.
- At the defaults, no attribute is set and the output is pixel-identical.

| Variant | Values (default first) | Where |
|---|---|---|
| density | regular, compact, comfortable | sidebar rows, buttons, tab strip, view title |
| label | plain, mono-upper, bracketed | sidebar section labels, view titles, fold row |
| scrollbar | native, hairline, rail, signal, ruler, bracket | `.ui-scroll` replaces `[scrollbar-width:thin]` in 6 files; TranscriptScrollbar |
| messageStyle | default, document | chatBubbleParts, ai-elements/message |
| userBubble | rounded, soft, square | `data-slot=user-bubble`, `--ui-bubble-*` tokens |
| workingIndicator | otto, square-pulse, dots (verb static or cycle) | WorkingIndicatorRow |
| composer | elevated, flat, crosses; contextStrip inline or attached | ChatComposer |
| panelTabs | icons, icons-labels | WorkspacePanel tab strip |
| header | glass, solid | ChatHeader |
| cta | default, accent-square, light-square | Share and Stop (`data-slot`); `--cta-*` tokens |
| sheet | none, floating (Vercel) | `.app-shell` main; `--ui-sheet-margin/radius/shadow` |

As built (M9, `theme/variants.ts`, `theme/variants.css`, `theme/useVariant.ts`):

- Two sub-variants joined the table: `workingVerbs` (rotate, static, cycle: today's many
  rotating verbs, "Working…" only, or the design's Working, Tinkering, Noodling every
  2.6 s) and `contextStrip` (inline, attached).
- The theme service resolves them (`resolveVariants`: the theme's, the user's over them;
  product locks join in M10) and, for each value other than the default, sets
  `data-omni-<kebab name>` on every theme root (`stampVariants`, both of the embed's), also
  from the first-paint cache, which now carries the theme's own variants. At every default
  no attribute and no CSS: the stock look.
- Token variants: `VARIANT_TOKENS` (density: compact 24px rows, comfortable 34px with 52px
  bars and 46px view titles; labels: the mono font, uppercase, no tracking) join the
  theme's layers above its tokens and options and below the colour customizations, so a
  variant beats a theme's own rows and a user's customization beats the variant. "Regular"
  is the theme's own density. Built-in palettes get a runtime block only when a variant
  sets tokens.
- CSS variants (variants.css, every rule under its attribute): bracketed labels
  (`content: "[" / ""`, out of the accessibility tree; on `[data-label-text]` where a label
  holds more than its text), the five scrollbars on `.ui-scroll` (WebKit's styled bar,
  with `scrollbar-width`/`-color` auto) and the transcript's bar, document messages,
  soft and square bubbles (`ui-bubble-background/-border/-radius`), a flat or crossed
  composer (the crosses one `::after` of eight gradients), the attached context strip,
  labelled panel tabs (the tab's own `sr-only` label shown), a solid header, square
  accent or light Share and Stop (`ui-cta-background/-foreground/-hover`), and the
  floating sheet on the new `main-area` hook (`ui-sheet-gap/-radius/-shadow`). Colours
  are tokens or palette fallbacks.
- DOM variants: only the working indicator (`WorkingIndicatorBody` in chatBubbleParts):
  the square pulse or the dots instead of Otto, the verbs. Their animation stops under
  reduced motion; the verbs keep changing, as the stock label does (a text swap is not
  motion). The row stays `aria-hidden`; its status region still says "Working…".
- Settings (until M10b): under the theme options, one row per variant, each a select of
  "Theme default" and the values. Since M10b they are `omnigent.style.<variant>` keys of
  the settings JSON and the "Preferences: Select Style Variant…" quick pick.

## M10b: settings JSON (VS Code style)

User decision (2026-11-26), superseding decision 9's inline rows: Settings > Appearance keeps
only Mode, Terminal theme and the Color theme picker (with the built-in palette editor,
which is how Custom is made). Theme options and style variants move into a settings JSON
document edited in the UI, as VS Code's `settings.json` with `workbench.colorCustomizations`;
the command palette gets quick picks for them.

- **One document.** `omnigent:ui-settings` stores `{ "version": 1, "text": ..., "values": ... }`:
  the user's text as written (JSONC: comments and trailing commas allowed and kept) and the
  last values that parsed. Its keys:
  - `workbench.colorCustomizations`: the colour customizations, as before (token ids, and
    `[<theme id>]` scopes of them). VS Code's own key and shape; the old Advanced JSON
    folds into it.
  - `omnigent.themeOptions`: `{ "[<scope>]": { "<option id>": "<choice id>" } }`, the scope a
    theme's options are kept under (`<extension id>/<family>` for a family, else the
    theme's id), the same scope names as the customizations'.
  - `omnigent.style.<variant>`: one key per style variant (`"omnigent.style.density":
    "compact"`); an unset key is "Theme default".
- **Last good.** A text that parses (jsonc-parser) applies; a value a key doesn't take is
  left out with an error and the other keys still apply. A text with syntax errors is
  stored (nothing typed is lost) while the previous values keep applying, as VS Code does;
  so a malformed document never changes the theme. Values are checked again where they
  apply (variants, option choices, token values), so a forged `values` can't add anything.
- **Writes** (Settings, the quick picks, `setOption`, `setVariant`, `setCustomizations`) edit
  the text in place (jsonc-parser `modify`, comments kept) and are refused while it has
  syntax errors ("Fix the errors in the settings JSON first"), as VS Code refuses.
- **Layers** are unchanged: the options, variants and customizations come from the document
  where they came from their three keys; product locks stay the top layer.
- **Schema.** `themeService.getSettingsSchema()` builds a JSON Schema-shaped tree
  (`description`, `enum`, `enumDescriptions`, `default`, plus `locked` and `hidden`) from the
  registry tokens, the chosen theme's extension colours, every registered theme's options
  under its scope (extension themes included, so a theme's accent, corners and CTA options
  appear with nothing to register), the variants (`VARIANTS`, `VARIANT_LABELS`) and the
  known theme scopes. It changes with `onDidChange`.
- **Language service** (`theme/settingsLanguage.ts`, pure, offsets only): diagnostics (syntax
  errors, unknown keys as warnings, wrong types and values as errors, token values through
  the theme service's checks, locked keys as "Set by product" information with the
  unnecessary tag, hidden keys), completions (keys not yet set and not locked, enum values
  with their labels) and hover (the description, the value's label, the default, the lock).
  The Monaco adapter (`shell/settingsJson/`) registers it for the settings model only, with
  Shiki's `jsonc` grammar tokenizing; Monaco's JSON worker stays out (`monacoSetup.ts` ships
  no language workers).
- **UI.** Under the picker, one "Options, style and colors" row with "Edit in settings
  JSON", which opens a dialog: the editor, its problems, Save (and Cmd/Ctrl+S) and Cancel.
  The command palette: "Preferences: Open Settings (JSON)", "Color Theme: Select Option…"
  (the chosen theme's options, each a page of its choices) and "Preferences: Select Style
  Variant…" (each variant, a page of "Theme default" and its values). Generic: a palette
  command's option may carry a `setting`, which opens that setting's values page, and Back
  returns to the options.
- **Locks.** `lockedTokens`, `lockedOptions` and `lockedVariants` never apply from the
  document; writes to them are refused; the editor marks the key "Set by product" (hover
  and a faded information diagnostic) and leaves it out of completions; the quick picks
  show the row greyed with "Set by product". `hidePicker` hides only the picker.
- **`hideCustomizations`.** The three keys are customizations: they don't apply (as in
  M10), the schema marks them hidden, and the Settings row, the dialog and the quick picks
  are gone.
- **Migration.** On the first read, the old `omnigent:ui-theme-options`,
  `omnigent:ui-variants` and `omnigent:ui-color-customizations` are written into the
  document (over the same keys when it exists) and removed. Settings export writes only
  `omnigent:ui-settings`; import still takes the old keys (an older export) and migrates
  them. The first-paint cache is unchanged: it holds applied values, and the user's
  variants over it now come from the document.
- **Tests:** schema generation (extension options included, locks, hidden), parse and
  last-good (a malformed text keeps the values and the theme), per-key errors, writes
  keeping comments and refusing malformed text, locks (never applied, refused, marked),
  migration and import of an older export, the quick picks (nested pages, greyed locks,
  hidden under `hideCustomizations`), and the dialog.

## Layer 0 core refactor

Every step must be a visual no-op, proven by:

- a token dump: computed values of every registry token on every theme root, for 8 selections times 2 modes, standalone and embed;
- 0-pixel screenshot diffs.

Steps:

1. Registry and generator. Move the non-palette colours.
2. Shape, fonts and elevation through vars:
   - `@theme inline` entries become `var(--ui-*)`;
   - convert the `rounded-[Npx]` uses;
   - the font setting becomes a layer.
3. Density, label, border and scrollbar tokens; `data-slot` hooks; `.ui-scroll`.
4. Bridges: terminal, CodeMirror, diff and file tree. Shiki and Monaco syntax themes come from tokens and `tokenColors`.
5. Hard-coded colour cleanup in the hotspot files. Brand art moves onto brand tokens (decision 7).
6. Guard test `web/src/theme/noRawColors.test.ts`. It uses an allowlist of per-file counts; counts may only go down.

## Embed and native

- The runtime CSS uses the scoped selector helper. The variant attributes go on both theme roots.
- `OmnigentAppProps.product?.theme = {default?, allowed?, lockMode?, lockedTokens?, lockedOptions?, lockedVariants?, hidePicker?, hideCustomizations?}` is the top layer, over the build's `web/product.json` and the server's `product.theme`, with embed tests.
- NativeThemeSync sends the forced mode.

## DevHub themes in `my-extensions/dev` (decision 8: extension only)

- **Theme files:**
  - `themes/console.json` and `themes/paper.json` (family `devhub`);
  - `themes/vercel.json` (dark-only, forces dark).
- **Their contents:**
  - colours from the design README;
  - tokens: radius 0 (Vercel 6px), elevation 0, fonts, label, row 34px, bubble, inline code, brand-* colours;
  - variants;
  - options: accent, corners, and CTA orange or light;
  - a `brand` section with the product logo from the design assets;
  - fonts: Inter, DM Sans, Geist (decision 5) via `contributes.fonts`.
- Retire `devhubPreview` once Console reaches parity.
- Out of scope for this stage (layout stage):
  - icon rail, top bar, Inbox/Canvas/Automations sidebar views, sidebar width;
  - context strip contents, right panel title meta and refresh, removing the Files tab, PR row content, auto-hiding the right panel below 1180px.

## Testing

- **Vitest:** registry, validate, themeService, contributions (themes/colors/fonts/brand), api, the dev plugin font and brand allow-list, the VS Code alias table, and the brand SVG sanitizer.
- **Screenshot baselines:** `verify.py --screens`, run on the mocked backend.
  - Environment: pinned fontconfig font, Chrome flags for deterministic rendering, a fixed viewport, animations off.
  - Screens: session, sidebar, right panel tabs, settings Appearance, theme picker, code block, terminal, diff, menu.
  - Matrix: default light and dark, each built-in palette (dark), and Console/Paper/Vercel.
  - Baselines go in `my-extensions/dev/verify/baselines/` (decision 6).
- **No-change check** after each Layer 0 step: `--compare` gives 0 px, plus an identical `--token-dump`.
- **`--only-themes` verify:**
  - select each DevHub theme;
  - check token values, variant attributes, fonts loaded, brand logo swapped;
  - reload with no flash;
  - options switch accent, corners and CTA;
  - an invalid theme fixture warns and does not apply;
  - embed scope is respected;
  - a stock VS Code theme JSON fixture partly imports via the aliases.

## Milestones

| # | Milestone | Acceptance |
|---|---|---|
| M0 | Screenshot and token-dump harness, plus baselines of today | Two runs give 0 px diff; the dump covers every CSS var on the theme roots |
| M1 | Token registry and generator; non-palette colours moved | Dump identical (all selections, modes, embed); 0 px |
| M2 | Shape, fonts and elevation as vars; rounded-[] conversion; font setting as a layer | As M1; setting radius-base 0 and elevation 0 by hand squares and flattens everything without `!important` |
| M3 | Density, label, border and scrollbar tokens; data-slot hooks; .ui-scroll | 0 px; the preview's fragile selectors rewritten onto hooks |
| M4 | Terminal, diff, file tree, CodeMirror and Shiki/Monaco bridges | 0 px; a tokenColors test theme recolours all code surfaces |
| M5 | Hard-coded colour cleanup, brand tokens and guard test | Guard fails on new raw colours; 0 px or user-approved sub-perceptual diffs |
| M6 | contributes.themes/colors/fonts/brand, validate, themeService, cache, VS Code aliases, dev plugin inlining | Unit tests green; a fixture theme applies with no flash; invalid values rejected |
| M7 | Built-in palettes become the omnigent.themes built-in extension; picker and settings list contributed themes; families and forced mode; customizations; portability | 0 px for the built-ins; import/export round-trips |
| M8 | Plugin read API | api tests; vendored typings updated |
| M9 | Variants and their Appearance settings | Per-variant DOM test and screenshot; defaults 0 px |
| M10 | Embed product theme hook; native forced mode | Embed tests |
| M11 | DevHub Console, Paper and Vercel plus fonts and brand in my-extensions/dev; preview retired | `--only-themes` green; side-by-side with the design thumbnail |

Order: M0 > M1 > M2 > M3 > M4 > M5. M6 can start after M1. M7 and M8 need M6. M9 needs M3 and M6. M10 needs M7. M11 needs M6 through M9.

## Risks

- `@theme inline` vars may change Tailwind output. The dump and 0 px checks catch it.
- Derived tokens in the embed must be re-emitted on the inner roots.
- Screenshot flakiness: pin fonts; only as a last resort allow a 0.01% tolerance, together with an exact dump.
- Cache staleness: key it on hash plus extension version.
- Prop variants add branches in hot components.
- DevHub is dev-only until server-installed extensions exist.
- Font and brand asset CSP in embed hosts.
- Scope creep into layout.
