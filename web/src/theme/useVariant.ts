// The resolved value of one style variant, for leaf components whose DOM a variant changes.

import { useThemeVariants } from "./themeService";
import { defaultVariant, type VariantName, type VariantValue } from "./variants";

/** The variant's value on screen (the theme's, the user's over it), its default when unset. */
export function useVariant<Name extends VariantName>(name: Name): VariantValue<Name> {
  const value = useThemeVariants()[name];
  return (value ?? defaultVariant(name)) as VariantValue<Name>;
}
