// The host's style variants (theming plan, "Variants"): named choices a theme sets and the
// user may override ("Theme default" keeps the theme's). M7 stores the user's choices
// (`themeService.setVariant`) and resolves them with the theme's; M9 applies them (the
// `data-omni-*` attributes and variants.css) and adds their Appearance control, which stays
// hidden until then: a choice that changes nothing on screen would only confuse. Pure.

/** Each variant's values, its default (today's look) first. */
export const VARIANTS = {
  density: ["regular", "compact", "comfortable"],
  label: ["plain", "mono-upper", "bracketed"],
  scrollbar: ["native", "hairline", "rail", "signal", "ruler", "bracket"],
  messageStyle: ["default", "document"],
  userBubble: ["rounded", "soft", "square"],
  workingIndicator: ["otto", "square-pulse", "dots"],
  composer: ["elevated", "flat", "crosses"],
  panelTabs: ["icons", "icons-labels"],
  header: ["glass", "solid"],
  cta: ["default", "accent-square", "light-square"],
  sheet: ["none", "floating"],
} as const satisfies Record<string, readonly string[]>;

export type VariantName = keyof typeof VARIANTS;
export type VariantValue<Name extends VariantName> = (typeof VARIANTS)[Name][number];
export type VariantValues = { readonly [Name in VariantName]?: VariantValue<Name> };

export const VARIANT_NAMES = Object.keys(VARIANTS) as VariantName[];

/** The labels Settings shows, per variant and value. */
export const VARIANT_LABELS: {
  readonly [Name in VariantName]: {
    readonly label: string;
    readonly values: { readonly [Value in VariantValue<Name>]: string };
  };
} = {
  density: {
    label: "Density",
    values: { regular: "Regular", compact: "Compact", comfortable: "Comfortable" },
  },
  label: {
    label: "Labels",
    values: { plain: "Plain", "mono-upper": "Mono uppercase", bracketed: "Bracketed" },
  },
  scrollbar: {
    label: "Scrollbars",
    values: {
      native: "Native",
      hairline: "Hairline",
      rail: "Rail",
      signal: "Signal",
      ruler: "Ruler",
      bracket: "Bracket",
    },
  },
  messageStyle: { label: "Message style", values: { default: "Default", document: "Document" } },
  userBubble: {
    label: "Your messages",
    values: { rounded: "Rounded", soft: "Soft", square: "Square" },
  },
  workingIndicator: {
    label: "Working indicator",
    values: { otto: "Otto", "square-pulse": "Square pulse", dots: "Dots" },
  },
  composer: {
    label: "Composer",
    values: { elevated: "Elevated", flat: "Flat", crosses: "Crosses" },
  },
  panelTabs: {
    label: "Panel tabs",
    values: { icons: "Icons", "icons-labels": "Icons and labels" },
  },
  header: { label: "Header", values: { glass: "Glass", solid: "Solid" } },
  cta: {
    label: "Share and Stop",
    values: {
      default: "Default",
      "accent-square": "Accent, square",
      "light-square": "Light, square",
    },
  },
  sheet: { label: "Sheet", values: { none: "None", floating: "Floating" } },
};

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
