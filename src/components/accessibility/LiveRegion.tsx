/**
 * Accessibility — Live Region.
 *
 * Announces dynamic content changes to screen readers without moving focus.
 * Use for: search results, build status changes, backup completion,
 * server start/stop notifications, etc.
 *
 * The region must be *visually* hidden, never `display: none` — display:none
 * removes it from the accessibility tree and the announcement never happens.
 */

import { useLiveAnnouncer } from "./useLiveAnnouncer";

export function LiveRegion({ children }: { children: string }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {children}
    </div>
  );
}

/**
 * Imperative announcer. Delegates to useLiveAnnouncer so the live node is
 * created/removed correctly (React StrictMode remounts used to leave the
 * region detached from <body>).
 */
export function useLiveRegion() {
  const { announce } = useLiveAnnouncer();
  return { announce };
}
