// The host's style variants (theming plan, "Variants"): named choices a theme sets and the
// user may override ("Theme default" keeps the theme's). The theme service resolves them
// (the theme's, the user's over them) and applies them: a value other than the default sets
// `data-omni-<name>` on the theme roots (variants.css styles it), its tokens
// (VARIANT_TOKENS) join the theme's layers, and leaf components that change the DOM read
// it through `useVariant`. At every default nothing is set: the stock look. Pure.

/** Each variant's values, its default (today's look) first. */
export const VARIANTS = {
  density: ["regular", "compact", "comfortable"],
  label: ["plain", "mono-upper", "bracketed"],
  scrollbar: ["native", "hairline", "rail", "signal", "ruler", "bracket"],
  messageStyle: ["default", "document"],
  userBubble: ["rounded", "soft", "square"],
  workingIndicator: ["otto", "square-pulse", "dots"],
  workingVerbs: ["rotate", "static", "cycle"],
  composer: ["elevated", "flat", "crosses"],
  contextStrip: ["inline", "attached"],
  panelTabs: ["icons", "icons-labels"],
  header: ["glass", "solid"],
  cta: ["default", "accent-square", "light-square"],
  sheet: ["none", "floating"],
} as const satisfies Record<string, readonly string[]>;

export type VariantName = keyof typeof VARIANTS;
export type VariantValue<Name extends VariantName> = (typeof VARIANTS)[Name][number];
export type VariantValues = { readonly [Name in VariantName]?: VariantValue<Name> };

export const VARIANT_NAMES = Object.keys(VARIANTS) as VariantName[];

/** The labels Settings shows, per variant and value, with a short description. */
export const VARIANT_LABELS: {
  readonly [Name in VariantName]: {
    readonly label: string;
    readonly description: string;
    readonly values: { readonly [Value in VariantValue<Name>]: string };
  };
} = {
  density: {
    label: "Density",
    description: "Row, control and bar heights. Regular keeps the theme's own.",
    values: { regular: "Regular", compact: "Compact", comfortable: "Comfortable" },
  },
  label: {
    label: "Labels",
    description: "Section labels, view titles and the fold row.",
    values: { plain: "Plain", "mono-upper": "Mono uppercase", bracketed: "Bracketed" },
  },
  scrollbar: {
    label: "Scrollbars",
    description: "How scroll containers and the transcript draw their scrollbar.",
    values: {
      native: "Native",
      hairline: "Hairline",
      rail: "Rail",
      signal: "Signal",
      ruler: "Ruler",
      bracket: "Bracket",
    },
  },
  messageStyle: {
    label: "Message style",
    description: "Document sets replies as wider, looser prose.",
    values: { default: "Default", document: "Document" },
  },
  userBubble: {
    label: "Your messages",
    description: "The corners of your message bubbles.",
    values: { rounded: "Rounded", soft: "Soft", square: "Square" },
  },
  workingIndicator: {
    label: "Working indicator",
    description: "What shows while the agent works.",
    values: { otto: "Otto", "square-pulse": "Square pulse", dots: "Dots" },
  },
  workingVerbs: {
    label: "Working label",
    description: "The words beside the working indicator.",
    values: { rotate: "Many verbs", static: "Working only", cycle: "Three verbs" },
  },
  composer: {
    label: "Composer",
    description: "The message box's frame.",
    values: { elevated: "Elevated", flat: "Flat", crosses: "Crosses" },
  },
  contextStrip: {
    label: "Context strip",
    description: "The workspace and branch strip above the composer.",
    values: { inline: "Inline", attached: "Attached" },
  },
  panelTabs: {
    label: "Panel tabs",
    description: "The right panel's tabs.",
    values: { icons: "Icons", "icons-labels": "Icons and labels" },
  },
  header: {
    label: "Header",
    description: "The session header's background.",
    values: { glass: "Glass", solid: "Solid" },
  },
  cta: {
    label: "Share and Stop",
    description: "The Share and Stop buttons.",
    values: {
      default: "Default",
      "accent-square": "Accent, square",
      "light-square": "Light, square",
    },
  },
  sheet: {
    label: "Sheet",
    description: "Floating sets the main area on a rounded sheet.",
    values: { none: "None", floating: "Floating" },
  },
};

/** Each variant's default value: today's look. */
export function defaultVariant<Name extends VariantName>(name: Name): VariantValue<Name> {
  return VARIANTS[name][0] as VariantValue<Name>;
}

/** The theme root attribute a variant sets when it isn't at its default: `data-omni-<kebab name>`. */
export function variantAttribute(name: VariantName): string {
  return `data-omni-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/**
 * The tokens a variant value sets, as a layer above the theme's tokens and options and
 * below the user's colour customizations (Layering). Host values, not checked. The
 * density values keep each site's proportions: compact rows 24px, comfortable 34px
 * with the design's 52px bars and 46px view titles.
 */
export const VARIANT_TOKENS: {
  readonly [Name in VariantName]?: {
    readonly [Value in VariantValue<Name>]?: Readonly<Record<string, string>>;
  };
} = {
  density: {
    compact: {
      "ui-row-line": "18px",
      "ui-row-height": "24px",
      "ui-control-h-xs": "20px",
      "ui-control-h-sm": "24px",
      "ui-control-h-md": "28px",
      "ui-control-h-lg": "32px",
      "ui-header-height": "40px",
      "ui-tabstrip-padding-y": "8px",
      "ui-view-title-height": "36px",
    },
    comfortable: {
      "ui-row-line": "22px",
      "ui-row-height": "34px",
      "ui-control-h-xs": "28px",
      "ui-control-h-sm": "32px",
      "ui-control-h-md": "36px",
      "ui-control-h-lg": "40px",
      "ui-header-height": "52px",
      "ui-tabstrip-padding-y": "13.5px",
      "ui-view-title-height": "46px",
    },
  },
  label: {
    "mono-upper": {
      "ui-font-label": "var(--ui-font-mono)",
      "ui-label-transform": "uppercase",
      "ui-label-tracking": "0px",
    },
    bracketed: {
      "ui-font-label": "var(--ui-font-mono)",
      "ui-label-transform": "uppercase",
      "ui-label-tracking": "0px",
    },
  },
};

/** The tokens `variants` set, in variant order (later variants over earlier ones). */
export function variantTokens(variants: VariantValues): Record<string, string> {
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const name of VARIANT_NAMES) {
    const value = variants[name];
    if (value === undefined) continue;
    const tokens = (VARIANT_TOKENS[name] as Record<string, Record<string, string>> | undefined)?.[
      value
    ];
    if (tokens) Object.assign(out, tokens);
  }
  return out;
}

export function isVariantName(name: unknown): name is VariantName {
  return typeof name === "string" && Object.hasOwn(VARIANTS, name);
}

export function isVariantValue<Name extends VariantName>(
  name: Name,
  value: unknown,
): value is VariantValue<Name> {
  return typeof value === "string" && (VARIANTS[name] as readonly string[]).includes(value);
}

/** The known variants of `raw` with valid values; anything else is left out. */
export function checkVariants(raw: unknown): VariantValues {
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const [name, value] of Object.entries(raw)) {
    if (isVariantName(name) && isVariantValue(name, value)) out[name] = value;
  }
  return out as VariantValues;
}

/** The theme's variants with the user's choices over them (a user choice wins). */
export function resolveVariants(theme: unknown, user: unknown): VariantValues {
  return { ...checkVariants(theme), ...checkVariants(user) };
}
