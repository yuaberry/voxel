/**
** * Server Automation (Super Prompt §22).
 * Provides automated server management:
 * - Scheduled backups
 * - Scheduled restarts
 * - Offline alerts
 * - Auto-restart on crash
 *
 * Nothing runs silently - all actions are logged.
 */

export type AutomationType = "backup" | "restart" | "alert" | "start";
