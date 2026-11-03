/**
 * Accessibility Provider.
 *
 * Wraps the application with accessibility infrastructure:
 * - Skip to content link
 * - Live region for screen reader announcements
 * - Global focus-visible styles
 *
 * Usage:
 *   <AccessibilityProvider>
 *     <App />
 *   </AccessibilityProvider>
 */

import { SkipLink } from "@/components/accessibility/SkipLink";
import { LiveRegion, useLiveRegion } from "@/components/accessibility/LiveRegion";

export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  useLiveRegion();

  return (
    <div className="relative min-h-full">
      {/* Skip to content — first focusable element. The target is the single
          <main id="main-content"> in AppLayout; wrapping the whole app in a
          second <main> created a nested landmark that skipped nothing. */}
      <SkipLink />

      {children}

      {/* Live region for screen reader announcements */}
      <LiveRegion children="" />
    </div>
  );
}

export { useLiveRegion };
