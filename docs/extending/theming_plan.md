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
| M5 | Next | |
| M6 to M11 | Queued | |

Resume notes:

- Work happens in a worktree of `extensible-ui`, landed with a rebase and a push to
  `origin/extensible-ui`, then `git merge --ff-only` in the main checkout.
- The harness and its baselines live in `my-extensions/dev/verify/` (decision 6).
- No-change check for a Layer 0 step: from `my-extensions/dev`, run
  `OMNI_UI_REPO=<checkout> ./verify/verify.sh --screens --token-dump --embed --compare verify/baselines`
  (about 10 minutes). It needs 0 px per screen and identical `tokens.json` and
  `tokens-embed.json` (added tokens aside), and the baseline's Chrome version. The only
  tolerance is spot-specific: inside the baseline's recorded masks of the dark code
  blocks' copy buttons (a known one-LSB flake), at most 2 per channel, with both dumps
  present and no token value changed or removed; 0 px everywhere else. The dumps were
  refreshed after the M2 follow-ups; M3 only added tokens to them.
- A worktree needs real `node_modules` (`cp -al` of the main checkout's root and
  `web/` ones): symlinked ones resolve outside the worktree, and Vite's dev server then
  refuses the Geist Mono font, which changes every mono glyph.
- Still literal after M4, for M5: the glass surfaces' rim highlights (light-dark
  `color-mix` of black and white, and OmniGlassSurface's `rgba(212, 212, 216, 0.08)`
  ring), the PDF viewer's highlight yellows, the chat's terminal-styled shell blocks
  (`lib/terminalPalette.ts` `terminalSurfaceStyle`, used when the terminal's mode
  differs from the app's; its colours equal the `terminal-*` defaults but are not read
  from them), the Changes review tree's added and deleted colours (`success` and
  `destructive`, not `file-tree-git-*`), and the 3D model viewer's colours.
  `onboarding-modal-shadow` is deprecated (unscaled); remove it in M6. CanvasPage's
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
- **Status:** success, warning, info, status-{blue,green,yellow,red,gray}.
- **Chart:** chart-1..5.
- **Code and syntax** (M4, `code.ts`): code-bg, code-selection (palette), viewer-active-line,
  viewer-search-match(-selected), viewer-selection-match, code-selected-line (unset: `sidebar-active`),
  syntax-theme-light/-dark (`github-light`/`github-dark`, a bundled Shiki theme or one
  registered with `registerSyntaxTheme`, `lib/syntaxTheme.ts`). code-inline-bg and
  code-inline-border come with the DevHub themes (M11).
- **Terminal** (M4, `terminal.ts`, `perMode`): terminal-{background,foreground,cursor,cursor-accent,selection},
  terminal-ansi-* (16, `black` to `bright-white`) and terminal-tone-{subtle,input,emphasis}
  (Codex's input box). An unset slot is left out of xterm's theme, so xterm's default applies.
- **Diff** (M4, `diff.ts`): diff-addition/deletion-base and -text, diff-number-text, diff-word-mix
  (unset: the diff's own), and diff-{line,gutter,hover}-mix with per-scheme -light/-dark defaults.
- **File tree** (M4, `fileTree.ts`): file-tree-hover, -selected(-foreground), -guide, -focus-ring,
  -radius and -git-{added,deleted,ignored,modified,renamed,untracked} (the vendored `light-dark()` pairs),
  bridged in `fileTreeStyle.ts`.
- **Brand (decision 7):** brand-* colours used by OttoIcon/NessieIcon and the logo accents.
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
