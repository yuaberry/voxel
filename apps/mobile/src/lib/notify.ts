/**
 * Local notifications (briefing §62, mobile slice) — honest scope: the app
 * pings when a build YOU started from this phone finishes. Requires OS
 * permission; without it the feature is a silent no-op (never fakes).
 */

import * as Notifications from "expo-notifications";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let permissionChecked = false;

async function ensurePermission(): Promise<boolean> {
  if (permissionChecked) {
    return (await Notifications.getPermissionsAsync()).granted;
  }
  permissionChecked = true;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch {
    return false;
  }
}

export async function notifyBuildFinished(
  projectName: string,
  success: boolean,
): Promise<void> {
  if (!(await ensurePermission())) return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: success ? "Build succeeded" : "Build failed",
        body: `${projectName} finished on your PC.`,
      },
      trigger: null, // fire now
    });
  } catch {
    // notification channels can be unavailable — a ping is never critical
  }
}
