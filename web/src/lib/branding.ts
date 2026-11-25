import { useSyncExternalStore } from "react";
import { withBasePath } from "./basePath";
import type { Branding } from "./capabilities";
import { useServerInfo } from "./CapabilitiesContext";

export const DEFAULT_APP_NAME = "Omnigent";
export const DEFAULT_HEADING = "What should we build?";

const EMPTY_BRANDING: Branding = {
  app_name: null,
  heading: null,
  logos: { main: null, loading: null, favicon: null },
  powered_by: true,
};

/**
 * Brand assets that take precedence over the server's branding: the active theme's
 * `brand` section (theming plan M6). Unset keys fall back to the server's branding,
 * then the defaults. Logos are image URLs, rendered as `<img>`.
 */
export interface BrandOverride {
  appName?: string;
  logos?: Partial<Branding["logos"]>;
}

let brandOverride: BrandOverride | null = null;
const brandListeners = new Set<() => void>();

/** The longest app name an override may set; longer names are cut. */
export const MAX_APP_NAME_LENGTH = 64;
/** The longest logo URL an override may set; longer ones are dropped. */
export const MAX_LOGO_URL_LENGTH = 2048;

// C0 and C1 control characters, which a name must not carry into the title or alt text.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
// Format characters (bidi overrides and isolates, zero-width joiners and spaces, the BOM)
// and line or paragraph separators, which could reorder or hide parts of a shown name.
const INVISIBLE_CHARACTERS = /[\p{Cf}\p{Zl}\p{Zp}]/gu;

/**
 * An override's app name as the UI may show it: control and format characters stripped, trimmed,
 * at most {@link MAX_APP_NAME_LENGTH} characters, and `undefined` when nothing is left
 * (an empty name means "unset", never a blank title).
 */
export function normalizeAppName(name: unknown): string | undefined {
  if (typeof name !== "string") return undefined;
  const clean = [...name.replace(CONTROL_CHARACTERS, "").replace(INVISIBLE_CHARACTERS, "").trim()]
    .slice(0, MAX_APP_NAME_LENGTH)
    .join("")
    .trim();
  return clean === "" ? undefined : clean;
}

function normalizeLogoUrl(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  const trimmed = url.trim();
  if (trimmed === "" || trimmed.length > MAX_LOGO_URL_LENGTH) return undefined;
  return CONTROL_CHARACTERS.test(trimmed) ? undefined : trimmed;
}

function normalizeOverride(override: BrandOverride): BrandOverride | null {
  const appName = normalizeAppName(override.appName);
  const logos: Partial<Branding["logos"]> = {};
  for (const key of ["main", "loading", "favicon"] as const) {
    const url = normalizeLogoUrl(override.logos?.[key]);
    if (url) logos[key] = url;
  }
  const normalized: BrandOverride = {};
  if (appName) normalized.appName = appName;
  if (Object.keys(logos).length > 0) normalized.logos = logos;
  return Object.keys(normalized).length > 0 ? normalized : null;
}

/**
 * Sets (or, with null, clears) the brand override; the logo, name and favicon follow.
 * Empty names and logo URLs count as unset (see {@link normalizeAppName}).
 */
export function setBrandOverride(override: BrandOverride | null): void {
  brandOverride = override ? normalizeOverride(override) : null;
  for (const listener of brandListeners) listener();
}

function subscribeBrandOverride(listener: () => void): () => void {
  brandListeners.add(listener);
  return () => {
    brandListeners.delete(listener);
  };
}

/** The current brand override, live. */
export function useBrandOverride(): BrandOverride | null {
  return useSyncExternalStore(
    subscribeBrandOverride,
    () => brandOverride,
    () => null,
  );
}

/**
 * The branding the UI shows: the override's keys over the server's branding. Without an
 * override, the server's branding object itself.
 */
export function resolveBranding(server: Branding | null, override: BrandOverride | null): Branding {
  const base = server ?? EMPTY_BRANDING;
  if (!override) return base;
  return {
    ...base,
    app_name: normalizeAppName(override.appName) ?? base.app_name,
    logos: {
      main: override.logos?.main ?? base.logos.main,
      loading: override.logos?.loading ?? base.logos.loading,
      favicon: override.logos?.favicon ?? base.logos.favicon,
    },
  };
}

/** Current branding: the brand override over the operator's, all-null while loading / when unset. */
export function useBranding(): Branding {
  const info = useServerInfo();
  const override = useBrandOverride();
  return resolveBranding(info !== "loading" ? (info.branding ?? null) : null, override);
}

/** Operator app name, falling back to the built-in default. */
export function useAppName(): string {
  return useBranding().app_name ?? DEFAULT_APP_NAME;
}

/** Operator hero heading; an explicit `""` is kept (hides it), default only when unset. */
export function useHeading(): string {
  return useBranding().heading ?? DEFAULT_HEADING;
}

/** Logo URL for a variant, or null to fall back to the mascot; `loading` falls back to `main`. */
export function useLogoUrl(variant: "main" | "loading"): string | null {
  const { logos } = useBranding();
  return variant === "loading" ? (logos.loading ?? logos.main) : logos.main;
}

/** Show "Powered by Omnigent" only when custom branding is set and not disabled. */
export function usePoweredBy(): boolean {
  const info = useServerInfo();
  const branding = info !== "loading" ? info.branding : null;
  return branding != null && branding.powered_by;
}

/**
 * How a brand image URL may be loaded:
 * - `"host"`: an app-absolute path (`/v1/...`, a host asset path), served by the
 *   Omnigent host itself; the embed fetches it with the host's credentials.
 * - `"inline"`: a `blob:` or `data:` image URL, which needs no request.
 * - `"same-origin"`: an absolute URL on the page's own origin.
 * - `"cross-origin"`: anything else; loaded as a plain `<img>` with no credentials and
 *   no referrer, never through the host's authenticated fetch.
 */
export type BrandUrlKind = "host" | "inline" | "same-origin" | "cross-origin";

/** Classifies a brand image URL ({@link BrandUrlKind}). */
export function classifyBrandUrl(url: string): BrandUrlKind {
  if (url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\")) return "host";
  if (/^(?:blob:|data:image\/)/i.test(url)) return "inline";
  if (typeof window === "undefined") return "cross-origin";
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.origin === window.location.origin ? "same-origin" : "cross-origin";
  } catch {
    return "cross-origin";
  }
}

/** The document's own title and favicon, to restore when no branding sets them. */
export interface DocumentBrandDefaults {
  title: string;
  favicon: { href: string; type: string | null } | null;
}

/** Reads the document's title and favicon as the page shipped them. */
export function readDocumentBrandDefaults(doc: Document = document): DocumentBrandDefaults {
  const link = doc.querySelector<HTMLLinkElement>('link[rel="icon"]');
  return {
    title: doc.title || DEFAULT_APP_NAME,
    favicon: link
      ? { href: link.getAttribute("href") ?? "", type: link.getAttribute("type") }
      : null,
  };
}

/**
 * Puts `branding`'s app name and favicon on the document, restoring `defaults` for
 * whichever it leaves unset, so clearing an override (or the server's branding) never
 * leaves the previous name or icon behind.
 */
export function applyDocumentBranding(
  branding: Branding,
  defaults: DocumentBrandDefaults,
  doc: Document = document,
): void {
  doc.title = branding.app_name ?? defaults.title;
  const faviconUrl = branding.logos.favicon;
  let link = doc.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!faviconUrl) {
    if (!link) return;
    if (!defaults.favicon) {
      link.remove();
      return;
    }
    link.href = defaults.favicon.href;
    if (defaults.favicon.type) link.type = defaults.favicon.type;
    else link.removeAttribute("type");
    return;
  }
  if (!link) {
    link = doc.createElement("link");
    link.rel = "icon";
    doc.head.appendChild(link);
  }
  link.removeAttribute("type");
  link.href = classifyBrandUrl(faviconUrl) === "host" ? withBasePath(faviconUrl) : faviconUrl;
}
