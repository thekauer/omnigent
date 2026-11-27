// React's read of a setting: the value that applies now, re-rendering when it changes.
import { useCallback, useRef, useSyncExternalStore } from "react";

import { type ConfigurationService, configurationService } from "./configurationService";

/** The value of setting `key` (undefined when nothing sets it), kept current. */
export function useConfigurationValue<T = unknown>(
  key: string,
  service: ConfigurationService = configurationService,
): T | undefined {
  // A setting's value is a fresh copy on each read: keep one per version, so React sees the
  // same snapshot until something changes.
  const cache = useRef<{ version: number; key: string; value: T | undefined } | null>(null);
  const subscribe = useCallback(
    (onChange: () => void) => service.onDidChangeConfiguration(onChange),
    [service],
  );
  const read = () => {
    const version = service.getVersion();
    const cached = cache.current;
    if (cached && cached.version === version && cached.key === key) return cached.value;
    const value = service.getValue<T>(key);
    if (cached && cached.key === key && JSON.stringify(cached.value) === JSON.stringify(value)) {
      cache.current = { ...cached, version };
      return cached.value;
    }
    cache.current = { version, key, value };
    return value;
  };
  return useSyncExternalStore(subscribe, read, read);
}
