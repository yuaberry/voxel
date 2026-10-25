export type AiProviderId =
  | "openrouter"
  | "openai"
  | "anthropic"
  | "ollama"
  | "nvidia-nim";

export type AccentColor = "purple" | "cyan" | "blue" | "emerald" | "amber" | "rose" | "teal";

export interface GeneralSettings {
  authorName: string;
  defaultLicense: string;
  /** UI language — "auto" follows the OS, otherwise an exact locale */
  language: "auto" | "en" | "pt-BR";
}

export interface AppearanceSettings {
  accent: AccentColor;
  reduceMotion: boolean;
  /** 0.85–1.25 — the interface zoom (accessibility) */
  uiScale: number;
}

export interface AiSettings {
  provider: AiProviderId;
  model: string;
  temperature: number;
  maxTokens: number;
  baseUrl: string;
  /**
   * Model routing per task-force phase (briefing §66): the Architect can run
   * on a stronger model while the Reviewer stays fast/cheap. Empty string
   * falls back to the global `model`. Same provider & key as the main one.
   */
  phaseModels: AiPhaseModels;
  /**
   * Model Router v2 (Phase C): if the primary model fails BEFORE any
   * content arrives (provider outage, model retired), one retry happens
   * with this model. Empty = no fallback.
   */
  fallbackModel: string;
}

export interface AiPhaseModels {
  architect: string;
  developer: string;
  reviewer: string;
}

export interface MinecraftSettings {
  defaultVersion: string;
  defaultLoader: "fabric" | "forge" | "neoforge";
  defaultServerSoftware: "vanilla" | "paper";
  defaultServerRamMb: number;
  defaultServerPort: number;
}

export interface JavaSettings {
  customJavaPath: string;
}

export interface StorageSettings {
  basePath: string;
  /** Automatic workspace snapshots at boot: 0 = off, 1 = daily, 7 = weekly */
  autoSnapshotDays: number;
}

export interface GithubSettings {
  /** GitHub OAuth app client id (device flow). */
  clientId: string;
}

export interface LauncherSettings {
  /** Azure (MSA) application client id — required for device-flow sign-in. */
  clientId: string;
  ramMb: number;
}

export interface AppSettings {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  ai: AiSettings;
  minecraft: MinecraftSettings;
  java: JavaSettings;
  storage: StorageSettings;
  launcher: LauncherSettings;
  github: GithubSettings;
}

export type ProjectType = "mod";
export type ProjectLoader = "fabric" | "forge" | "neoforge" | "paper";

export interface ProjectRecord {
  id: string;
  name: string;
  slug: string;
  type: ProjectType;
  minecraft_version: string;
  loader: ProjectLoader;
  description: string | null;
  license: string;
  path: string;
  repository_url: string | null;
  status: string;
  last_build_status: string | null;
  last_build_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectRequest {
  storageBase: string;
  slug: string;
  name: string;
  template: string;
  modId: string;
  modIdClass: string;
  package: string;
  description: string;
  license: string;
  author: string;
  // Version Adapter Layer (auto-updating catalog)
  minecraftVersion: string;
  javaRelease: number;
  yarnMappings: string;
  mappingsLine: string;
  loaderVersion: string;
  loaderMin: string;
  fabricApiVersion: string;
  mcDepends: string;
  // Loader identity (fabric | forge | neoforge) — must agree with `template`
  loader: ProjectLoader;
  // pack.mcmeta pack_format the template declares (15 for 1.20.1)
  packFormat: number;
}

export interface CreateProjectResult {
  projectPath: string;
  filesCreated: number;
}

export interface ProjectFileEntry {
  path: string;
  is_dir: boolean;
  size_bytes: number;
}

export interface SnapshotEntry {
  sha: string;
  shortSha: string;
  label: string;
  reason: string;
  date: string;
}

export interface EnvironmentInfo {
  os: string;
  arch: string;
  java: {
    found: boolean;
    versionString: string | null;
    majorVersion: number | null;
  };
  git: {
    found: boolean;
    version: string | null;
  };
}

export interface StorageDirInfo {
  name: string;
  path: string;
  existed: boolean;
  created: boolean;
}

export interface StorageInfo {
  basePath: string;
  dirs: StorageDirInfo[];
}

export interface AppPaths {
  configDir: string;
  dataDir: string;
  databasePath: string;
  secretsNote: string;
}

export type SecretBackend = "os-keyring" | "local-file";

export interface SecretBackendInfo {
  backend: SecretBackend;
  available: boolean;
}

export interface SecretsOpResult {
  success: boolean;
  backend: SecretBackend;
}

export interface AiConnectionTestResult {
  ok: boolean;
  message: string;
  latencyMs: number;
  details?: Record<string, string>;
}

export type ServerSoftware = "vanilla" | "paper";

export interface ServerRecord {
  id: string;
  name: string;
  slug: string;
  software: ServerSoftware;
  minecraft_version: string;
  path: string;
  port: number;
  ram_mb: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ServerBackupInfo {
  id: string;
  fileName: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
}
