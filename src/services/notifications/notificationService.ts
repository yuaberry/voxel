/**
 * Desktop notifications (briefing §62) — the "AI finished / build finished"
 * moment arrives while the user is somewhere else in the app.
 *
 * Honest about the OS: asks permission once, degrades to a no-op if the
 * user denies or the platform has no notifier. Never spams — callers
 * decide the moments (build exit, task-force completion).
 */
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let permissionChecked = false;
let granted = false;

async function ensurePermission(): Promise<boolean> {
  if (permissionChecked) return granted;
  permissionChecked = true;
  try {
    granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
  } catch (error) {
    console.warn("Notification permission unavailable:", error);
    granted = false;
  }
  return granted;
}

/** Fire-and-forget desktop notification; silent no-op without permission. */
export async function notifyDesktop(
  title: string,
  body: string,
): Promise<void> {
  if (!(await ensurePermission())) return;
  try {
    sendNotification({ title, body });
  } catch (error) {
    console.warn("sendNotification failed:", error);
  }
}
