import { lazy, Suspense } from "react";
import { KeyboardShortcutsDialog } from "@/components/KeyboardShortcutsDialog";
import { ImportReviewGate } from "@/components/onboarding/HostImportReview";
import { Toaster } from "@/components/ui/sonner";
import type { Conversation } from "@/hooks/useConversations";
import { isFeatureEnabled, type ServerInfo } from "@/lib/capabilities";
import { isElectronShell } from "@/lib/nativeBridge";
import { updateOverlayToastOffset } from "@/lib/updateOverlayInset";
import { useSettingsJsonEditorStore } from "@/store/settingsJsonEditor";
import { CommandPalette } from "./CommandPalette";
import { RecentSessionsSwitcher } from "./RecentSessionsSwitcher";
import { useStore } from "zustand";
import { useWorkbenchScope } from "@/workbench/workbenchScope";

// The QuickPick palette and its theme picker load only with quick_pick_palette, so the
// default bundle keeps the flagged code, and what it imports, out of the first load. The
// palette mounts closed when the flag resolves, to start loading before use.
const QuickPickCommandPalette = lazy(() =>
  import("./QuickPickCommandPalette").then((module) => ({
    default: module.QuickPickCommandPalette,
  })),
);
// The settings JSON dialog brings Monaco only once it opens.
const SettingsJsonDialog = lazy(() =>
  import("./settingsJson/SettingsJsonDialog").then((module) => ({
    default: module.SettingsJsonDialog,
  })),
);
const MoveViewPicker = lazy(() =>
  import("./MoveViewPicker").then((module) => ({ default: module.MoveViewPicker })),
);
const ThemePicker = lazy(() =>
  import("./ThemePicker").then((module) => ({ default: module.ThemePicker })),
);

// Dev-only preview; lazy so the sample data never ships in production bundles.
const ImportContextPreview = import.meta.env.DEV
  ? lazy(() => import("@/components/onboarding/ImportContextPreview"))
  : null;

export interface AppShellOverlaysProps {
  isEmbedded: boolean;
  serverInfo: ServerInfo | "loading";
  sessionSearch: boolean;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleLeftSidebar: () => void;
  toggleRightPanel: () => void;
  /** Switches the open palette to searching sessions only. */
  goToSession: () => void;
  gridRoute: boolean;
  allConversations: Conversation[] | undefined;
  serverConversationId: string | undefined;
  updateOverlayHeight: number;
}

/**
 * App-global overlays mounted once after the shell layout: the shortcuts
 * reference, host import prompts, the command palette, the recent-sessions
 * switcher and the toast stack.
 */
export function AppShellOverlays({
  isEmbedded,
  serverInfo,
  sessionSearch,
  commandPaletteOpen,
  setCommandPaletteOpen,
  toggleLeftSidebar,
  toggleRightPanel,
  goToSession,
  gridRoute,
  allConversations,
  serverConversationId,
  updateOverlayHeight,
}: AppShellOverlaysProps) {
  // Both palettes take the same props; the flag picks one for ⌘K and the session switcher.
  const quickPick = isFeatureEnabled(serverInfo, "quick_pick_palette");
  const Palette = quickPick ? QuickPickCommandPalette : CommandPalette;
  const settingsJsonOpen = useSettingsJsonEditorStore((state) => state.open);
  const { toasterId, moveViewPicker } = useWorkbenchScope();
  const moveViewOpen = useStore(moveViewPicker.store, (state) => state.open);
  return (
    <>
      {/* Keyboard-shortcuts reference. Self-contained (owns its open state +
          ⌘/Ctrl+/ opener); ungated so it works on every route. */}
      <KeyboardShortcutsDialog />
      {/* Opens the import modal once per newly connected host. */}
      {!isEmbedded && <ImportReviewGate />}
      {/* Dev-only `?import-preview` for the post-setup import modal. */}
      {ImportContextPreview && (
        <Suspense fallback={null}>
          <ImportContextPreview />
        </Suspense>
      )}
      {/* Global command palette (⌘K). Ungated so it works on every route
          and in embedded mode — the sidebar's "Search" button opens it
          there even though the ⌘K hotkey is disabled (it belongs to the
          host page). */}
      <Suspense fallback={null}>
        <Palette
          key={sessionSearch ? "sessions" : "commands"}
          sessionsOnly={sessionSearch}
          open={commandPaletteOpen}
          onOpenChange={setCommandPaletteOpen}
          onToggleLeftSidebar={toggleLeftSidebar}
          onToggleRightSidebar={toggleRightPanel}
          rightSidebarShortcutEnabled={!gridRoute}
          onGoToSession={goToSession}
        />
      </Suspense>
      {/* "Select theme…" from ⌘K; previews each theme as the user moves through them. */}
      {quickPick && (
        <Suspense fallback={null}>
          <ThemePicker />
        </Suspense>
      )}
      {/* View: Move View...: where a view goes. */}
      {moveViewOpen && (
        <Suspense fallback={null}>
          <MoveViewPicker />
        </Suspense>
      )}
      {/* Settings (JSON): theme options, style variants and color customizations. */}
      {settingsJsonOpen && (
        <Suspense fallback={null}>
          <SettingsJsonDialog />
        </Suspense>
      )}
      <RecentSessionsSwitcher
        conversations={allConversations}
        activeSessionId={serverConversationId ?? null}
        enabled={isElectronShell()}
      />
      {/* Transient toasts (e.g. "session archived"). Mounted once here so
          any surface can fire one via showToast(). */}
      {/* Match the previous toast system's effectively unbounded stack so
          security prompts cannot be hidden behind ordinary notifications. */}
      <Toaster
        position="top-center"
        visibleToasts={100}
        offset={{
          top: "calc(1rem + var(--omnigent-safe-top))",
          right: "1rem",
          bottom: updateOverlayToastOffset(updateOverlayHeight),
        }}
        mobileOffset={{
          top: "calc(1rem + var(--omnigent-safe-top))",
          right: "1rem",
          bottom: updateOverlayToastOffset(updateOverlayHeight),
        }}
      />
      {/* This mount's own toasts (a reset layout's undo): never drawn in another mount. */}
      <Toaster
        id={toasterId}
        hotkey={[]}
        containerAriaLabel="Workbench notifications"
        position="top-center"
        visibleToasts={100}
        offset={{
          top: "calc(1rem + var(--omnigent-safe-top))",
          right: "1rem",
          bottom: updateOverlayToastOffset(updateOverlayHeight),
        }}
        mobileOffset={{
          top: "calc(1rem + var(--omnigent-safe-top))",
          right: "1rem",
          bottom: updateOverlayToastOffset(updateOverlayHeight),
        }}
      />
    </>
  );
}
