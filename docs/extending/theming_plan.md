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
| M3 | Next | |
| M4 to M11 | Queued | |

Resume notes:

- Work happens in a worktree of `extensible-ui`, landed with a rebase and a push to
  `origin/extensible-ui`, then `git merge --ff-only` in the main checkout.
- The harness and its baselines live in `my-extensions/dev/verify/` (decision 6).
- No-change check for a Layer 0 step: from `my-extensions/dev`, run
  `OMNI_UI_REPO=<checkout> ./verify/verify.sh --screens --token-dump --embed --compare verify/baselines`
  (about 10 minutes). It needs 0 px per screen and identical `tokens.json` and
  `tokens-embed.json` (added tokens aside), and the baseline's Chrome version. The only
  tolerance is spot-specific: inside the recorded masks of the dark code blocks' copy
  buttons (a known one-LSB flake), at most 2 per channel, with both dumps present and
  no token value changed or removed; 0 px everywhere else. M2 added tokens and changed
  the text of 11 embed shadow tokens (same values), so refresh the dumps only
  (`--token-dump --embed --save-baselines --only-screens none`) from M2's commit before
  comparing M3, or the embed text differences keep the tolerance off.
- M3 notes: the label tokens (`ui-label-*`) have no consumers yet; the sidebar section
  label, view title and fold row hooks should read them. Still literal: the glass
  surfaces' shadows (`components/ui/glass-surface/GlassSurface.css`,
  `OmniGlassSurface`, the drop-shadow filters in `NewChatDialog` and
  `SidebarHeaderActions`), the vendored file tree, PDF viewer and CodeMirror radii
  (M4), and the `border-radius: 100%` circle in index.css. `onboarding-modal-shadow`
  is deprecated (unscaled); remove it in M6.
- Refresh the baselines (`--save-baselines`) only on a commit that is meant to change
  the look, and say so in its message.
- The terminal screen is the transcript's shell output; the xterm panel needs a live
  terminal socket the mock does not serve (M4 can add one). The embed dump uses the
  embed build's scoped stylesheet on a harness page with the embed's two roots, not a
  mounted `OmnigentApp`.

Paths are relative to the omnigent repo root unless they start with `my-extensions/`.

## Context

- Long-term goal: Omnigent becomes a fully customizable UI platform. A future product, for example a full replacement of the App Builder editor UI, must be able to control style, layout, menus and branding. Frontend and backend stay clearly split.
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
- Embed: CSS is scoped under `.omnigent-app` (`vite.embed.config.ts`). Theme roots come from `lib/host.ts`. The embed now starts the extension host (`useWindowExtensionHost`).
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
- Extension colours (`contributes.colors`) register at runtime as `--x-<publisher>-<name>-<id>`.

### Naming (decided after M2)

- The public token names stay as they are: the registry id is the CSS variable name.
  The palette colours keep shadcn's names (`background`, `primary`, `sidebar-*`), which
  `components/ui/*`, Tailwind's `@theme` and upstream already use; host tokens added by
  this plan take the `ui-` prefix (as `ui-font-family` and `ui-shadow-neutral-rgb`
  already did upstream). No `--omni-*` rename: VS Code's `--vscode-*` exists because
  its webviews receive the workbench colours under a separate namespace, while here
  the names are the host's own variables, and the collision risk is confined by the two
  rules below.
- Namespaces never overlap: extension tokens are `--x-<publisher>-<name>-<id>`, so no
  host token may start with `x-`. Themes address tokens by id (and by the VS Code
  aliases, decision 4); plugins read them through `getThemeToken(id)` or `var(--id)`.
- `@property` registrations are document-global and cannot be scoped, so only
  standalone registers tokens. The embed build drops the token `@property` rules and
  their Tailwind no-`@property` fallbacks (`vite.embed.config.ts`), so a host page's
  own `--ui-*` variables stay untyped. There the registered tokens compute to their
  `calc()` text (`calc(.5rem * .5)` rather than `4px`), which renders identically: the
  embed dump differs from standalone in text only, and the harness checks that a host
  element's `--ui-elevation: high` reads `high`.
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
- **Status:** success, warning, info, status-{blue,green,yellow,red,gray}.
- **Chart:** chart-1..5.
- **Code and syntax:** code-bg, code-selection, viewer-active-line, code-inline-bg, code-inline-border, syntax-theme-light, syntax-theme-dark.
- **Terminal:** terminal-{background,foreground,cursor,cursor-accent,selection} and terminal-ansi-* (16). An "unset" default keeps the xterm default.
- **Diff:** diff-addition/deletion text and base, plus the mix percentages.
- **File tree:** file-tree-* (hover, selected, guide, git status).
- **Brand (decision 7):** brand-* colours used by OttoIcon/NessieIcon and the logo accents.
- **Typography:**
  - ui-font-ui, ui-font-title, ui-font-mono, ui-font-code, ui-font-label
  - ui-weight-normal/medium/strong, ui-letter-spacing
  - ui-label-size/transform/tracking/weight
- **Shape:** ui-radius-base 8px. Derived xs/sm/md/lg/xl/2xl/3xl/4xl, plus ui-radius-pill. `--radius` and `radius-otto-*` become aliases.
- **Elevation:** ui-elevation 1, shadow rgb tokens, all shadow recipes scaled by elevation.
- **Density:**
  - ui-row-height 28px, ui-row-line 20px, ui-control-h-xs/sm/md/lg 24/28/32/36px
  - ui-header-height, ui-tabstrip-height, ui-view-title-height 44px, gaps and padding at the hooked sites
  - Tailwind `--spacing` is not touched.
- **Borders:** ui-border-width, ui-border-style, ui-divider-style.
- **Scrollbar:** ui-scrollbar-size, thumb, thumb-hover, track.
- **Motion:** ui-duration-fast/base, ui-ease, ui-motion.

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
- Loaded with the FontFace API under a namespaced family `x-<publisher>-<name>-<family>`, on theme activation, `font-display: swap`.

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
- **Lengths:** px/rem/em/%, plus `calc()` of those.
- **Other kinds:** numbers in range, durations, `cubic-bezier`, enums, shadow lists.
- **Rejected values:**
  - `url(`, `image-set(`, `@`, `expression`, `attr(`, `env(`, `!important`
  - `; { } < > \`, comments
  - foreign or unregistered `var()`, cycles
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
  - `themePickerItems` comes from `themeService.list()`.
  - Appearance gets theme options, variants (with a "Theme default" choice) and colour customizations as JSON.
  - The font setting becomes a layer.

### Plugin read API

- `window.activeColorTheme` (id, label, kind, variants) and `onDidChangeActiveColorTheme` (fires after apply).
- `window.getThemeToken(id)`, read through getComputedStyle.
- The `ThemeColor` class, accepted in `SessionHeaderItem.color` now and in more plain-data fields later.
- The vendored typings check stays.

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
- `OmnigentAppProps.product?.theme = {default?, allowed?, lockMode?, lockedTokens?, hidePicker?}` is the top layer, with embed tests.
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
