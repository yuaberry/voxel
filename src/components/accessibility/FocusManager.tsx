/**
 * Accessibility — Focus Manager.
 *
 * Manages focus trapping within a container (e.g., modal dialogs).
 * When the container unmounts, focus returns to the previously
 * focused element.
 */

import { useEffect, useRef } from "react";

/**
 * Focus trap hook — traps keyboard focus within a container.
 * Use with a ref attached to the container element.
 */
export function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Save the previously focused element
    previousFocusRef.current = document.activeElement as HTMLElement;

    const container = containerRef.current;
    if (!container) return;

    // Focus the container on mount
    container.focus();

    // Trap focus within the container
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;

      const focusableElements = container.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const first = focusableElements[0] as HTMLElement;
      const last = focusableElements[focusableElements.length - 1] as HTMLElement;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", handleKeyDown);

    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      // Return focus to previous element
      previousFocusRef.current?.focus();
    };
  }, [containerRef]);
}

/**
 * FocusTrap component — creates its own ref and traps focus inside.
 * Usage: <FocusTrap>{children}</FocusTrap>
 */
export function FocusTrap({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(containerRef);
  return <div ref={containerRef}>{children}</div>;
}
