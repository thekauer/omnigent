import { useSyncExternalStore } from "react";
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

/** Sets (or, with null, clears) the brand override; the logo, name and favicon follow. */
export function setBrandOverride(override: BrandOverride | null): void {
  brandOverride = override;
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
    app_name: override.appName ?? base.app_name,
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
