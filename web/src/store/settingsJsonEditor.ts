import { create } from "zustand";

// The settings JSON editor (theming plan M10b): a dialog any surface opens, such as
// Settings > Appearance and the command palette's "Preferences: Open Settings (JSON)".

interface SettingsJsonEditorState {
  open: boolean;
}

export const useSettingsJsonEditorStore = create<SettingsJsonEditorState>(() => ({ open: false }));

export function openSettingsJsonEditor(): void {
  useSettingsJsonEditorStore.setState({ open: true });
}

export function closeSettingsJsonEditor(): void {
  useSettingsJsonEditorStore.setState({ open: false });
}
