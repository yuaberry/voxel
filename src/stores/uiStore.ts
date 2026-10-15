import { create } from "zustand";

interface UiState {
  paletteOpen: boolean;
  aboutOpen: boolean;
  createWizardOpen: boolean;
  /** Narrow-screen sidebar mode (icons only) */
  sidebarCollapsed: boolean;
  /** Handoff into the AI Creator: project + pre-filled prompt (consumed on mount) */
  aiHandoff: { projectId: string; prompt: string } | null;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
  setAboutOpen: (open: boolean) => void;
  setCreateWizardOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setAiHandoff: (handoff: { projectId: string; prompt: string } | null) => void;
}

export const useUiStore = create<UiState>()((set, get) => ({
  paletteOpen: false,
  aboutOpen: false,
  createWizardOpen: false,
  sidebarCollapsed: false,
  aiHandoff: null,
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  togglePalette: () => set({ paletteOpen: !get().paletteOpen }),
  setAboutOpen: (open) => set({ aboutOpen: open }),
  setCreateWizardOpen: (open) => set({ createWizardOpen: open }),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
  setAiHandoff: (handoff) => set({ aiHandoff: handoff }),
}));
