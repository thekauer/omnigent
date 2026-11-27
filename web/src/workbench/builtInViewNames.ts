// The host components a built-in extension's view may name as its body (`builtInView`, layout
// plan L3): the trusted tier's first seam. Names only, so the manifest parser stays free of
// React; the components are in `shell/builtInViews.ts`.

export const BUILT_IN_VIEW_NAMES = Object.freeze([
  /** The side bar's primary navigation (New session, Automations, Inbox...). */
  "navigation",
  /** The sessions and projects list. */
  "conversationList",
  /** The inbox's compact list. */
  "inboxList",
  /** The automations' compact list. */
  "automationsList",
  /** The canvases' compact list. */
  "canvasList",
] as const);

export type BuiltInViewName = (typeof BUILT_IN_VIEW_NAMES)[number];

export function isBuiltInViewName(value: unknown): value is BuiltInViewName {
  return typeof value === "string" && (BUILT_IN_VIEW_NAMES as readonly string[]).includes(value);
}
