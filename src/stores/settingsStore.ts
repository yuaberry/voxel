import { create } from "zustand";
import { setLanguage } from "@/i18n";
import {
  loadAllSettings,
  saveSettingsSection,
} from "@/services/db/repositories/settingsRepository";
import type { AppSettings, GeneralSettings } from "@/types";

const DEFAULT_SETTINGS: AppSettings = {
  general: {
    authorName: "",
    defaultLicense: "MIT",
    language: "auto",
  },
  appearance: {
    accent: "purple",
    reduceMotion: false,
    uiScale: 1,
  },
  ai: {
    provider: "openrouter",
    model: "",
    temperature: 0.7,
    maxTokens: 4096,
    baseUrl: "",
    phaseModels: { architect: "", developer: "", reviewer: "" },
    fallbackModel: "",
  },
  minecraft: {
    defaultVersion: "1.20.1",
    defaultLoader: "fabric",
    defaultServerSoftware: "vanilla",
    defaultServerRamMb: 2048,
    defaultServerPort: 25565,
  },
  java: {
    customJavaPath: "",
  },
  storage: {
    basePath: "",
    autoSnapshotDays: 0,
  },
  launcher: {
    clientId: "",
    ramMb: 4096,
  },
  github: {
    clientId: "",
  },
};

function mergeSection<T>(base: T, loaded: unknown): T {
  if (!loaded || typeof loaded !== "object") return base;
  return { ...base, ...(loaded as object) } as T;
}

interface SettingsState {
  loaded: boolean;
  loadError: string | null;
  settings: AppSettings;
  hydrate: () => Promise<void>;
  update: <K extends keyof AppSettings>(
    section: K,
    patch: Partial<AppSettings[K]>,
  ) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  loaded: false,
  loadError: null,
  settings: DEFAULT_SETTINGS,

  hydrate: async () => {
    try {
      const raw = await loadAllSettings();
      setLanguage(
        (raw.general as { language?: "auto" | "en" | "pt-BR" } | undefined)?.language ?? "auto",
      );
      const settings: AppSettings = {
        general: mergeSection(DEFAULT_SETTINGS.general, raw.general),
        appearance: mergeSection(DEFAULT_SETTINGS.appearance, raw.appearance),
        ai: mergeSection(DEFAULT_SETTINGS.ai, raw.ai),
        minecraft: mergeSection(DEFAULT_SETTINGS.minecraft, raw.minecraft),
        java: mergeSection(DEFAULT_SETTINGS.java, raw.java),
        storage: mergeSection(DEFAULT_SETTINGS.storage, raw.storage),
        launcher: mergeSection(DEFAULT_SETTINGS.launcher, raw.launcher),
        github: mergeSection(DEFAULT_SETTINGS.github, raw.github),
      };
      set({ settings, loaded: true, loadError: null });
    } catch (error) {
      console.error("Failed to load settings:", error);
      set({
        loaded: true,
        loadError: error instanceof Error ? error.message : String(error),
      });
    }
  },

  update: async (section, patch) => {
    if (section === "general") {
      const lang = (patch as Partial<GeneralSettings>).language;
      if (lang !== undefined) setLanguage(lang);
    }
    const current = get().settings;
    const next: AppSettings = {
      ...current,
      [section]: { ...current[section], ...patch },
    };
    set({ settings: next });
    try {
      await saveSettingsSection(section, next[section]);
    } catch (error) {
      console.error(`Failed to persist settings section "${String(section)}":`, error);
      // Revert on failure to keep UI honest with what is stored
      set({ settings: current });
      throw error;
    }
  },
}));
