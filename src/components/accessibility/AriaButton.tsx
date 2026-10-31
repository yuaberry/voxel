/**
 * Accessibility — ARIA Button wrapper.
 *
 * Icon buttons (lucide icons without text) need an accessible name
 * for screen readers. This wrapper adds aria-label and proper keyboard
 * handling (Enter/Space to activate).
 */

import { Button } from "@/components/ui/button";
import type { ButtonProps } from "@/components/ui/button";

export function AriaButton({
  "aria-label": ariaLabel,
  ...props
}: ButtonProps & { "aria-label": string }) {
  return (
    <Button {...props} aria-label={ariaLabel}>
      {props.children}
    </Button>
  );
}
