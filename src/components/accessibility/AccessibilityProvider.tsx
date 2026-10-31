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
      {/* Skip to content — first focusable element */}
      <SkipLink />

      {/* Main content area — landmark for screen readers */}
      <main id="main-content" tabIndex={-1} role="main" className="min-h-full outline-none">
        {children}
      </main>

      {/* Live region for screen reader announcements */}
      <LiveRegion children="" />
    </div>
  );
}

export { useLiveRegion };
