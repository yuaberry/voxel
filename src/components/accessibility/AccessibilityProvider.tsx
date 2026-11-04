/**
 * Accessibility Provider.
 *
 * Wraps the application with accessibility infrastructure:
 * - Live region for screen reader announcements
 * - Global focus-visible styles
 *
 * Usage:
 *   <AccessibilityProvider>
 *     <App />
 *   </AccessibilityProvider>
 */

import { LiveRegion, useLiveRegion } from "@/components/accessibility/LiveRegion";

export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  useLiveRegion();

  return (
    <div className="relative min-h-full">
      {children}

      {/* Live region for screen reader announcements */}
      <LiveRegion children="" />
    </div>
  );
}

export { useLiveRegion };
