import GlassSurface from "@/components/ui/glass-surface/GlassSurface";
import { cn } from "@/lib/utils";

interface OmniGlassSurfaceProps {
  variant?: "default" | "menu" | "composer";
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
  className?: string;
}

const GLASS_VARIANTS = {
  default: {
    blur: 8,
    background: "hsl(0 0% 100% / 0%)",
  },
  menu: {
    blur: 32,
    background: "hsl(0 0% 100% / 0%)",
  },
  // Typed text needs a near-opaque palette backing over light or dark transcript content.
  composer: {
    blur: 8,
    background: "color-mix(in srgb, var(--card-solid) 94%, transparent)",
  },
};

/** Decorative glass background for a positioned container; content stays in its own layout. */
export function OmniGlassSurface({
  variant = "default",
  width = "100%",
  height = "100%",
  borderRadius = 16,
  className,
}: OmniGlassSurfaceProps) {
  const surface = GLASS_VARIANTS[variant];
  const backdropFilter = `blur(var(--omni-glass-blur, ${surface.blur}px)) saturate(calc(var(--glass-saturation, 1) * 1.4)) brightness(var(--omni-glass-brightness, 1.04))`;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 [color-scheme:light] dark:[color-scheme:dark]",
        className,
      )}
    >
      <GlassSurface
        width={width}
        height={height}
        borderRadius={borderRadius}
        borderWidth={0.06}
        blur={surface.blur}
        displace={4.4}
        distortionScale={-270}
        refraction={false}
        opacity={0.45}
        className="omni-glass-surface border border-(--ui-omni-glass-border) dark:border-0 [&>.glass-surface\_\_sheen]:opacity-0 dark:[&>.glass-surface\_\_rim]:opacity-25 dark:[&>.glass-surface\_\_rim]:p-px!"
        style={{
          background: `var(--omni-glass-background, ${surface.background})`,
          WebkitBackdropFilter: backdropFilter,
          backdropFilter,
          boxShadow: [
            "inset 0 1px 0 0 var(--ui-omni-glass-highlight-top)",
            "inset 0 -1px 0 0 var(--ui-omni-glass-highlight-bottom)",
            "inset 0 0 2px 1px var(--ui-omni-glass-ring)",
            "inset 0 0 12px 3px var(--ui-omni-glass-glow)",
            "var(--omni-glass-drop-shadow, var(--ui-shadow-glass-drop))",
          ].join(", "),
        }}
      />
    </span>
  );
}
