/**
 * The app version shown in the UI. package.json is the single source of
 * truth — a hardcoded copy drifted to "0.30.0" while the release was still
 * 0.29.0 (the sidebar told a different story than the About dialog and the
 * Tauri bundle).
 */
import { version } from "../../package.json";

export const APP_VERSION: string = version;
