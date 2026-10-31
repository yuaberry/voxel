/**
 * Accessibility — Skip to Content link.
 *
 * Allows keyboard users to jump directly to the main content,
 * bypassing the navigation on every page load.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";

export function SkipLink({ className }: { className?: string }) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <a
      href="#main-content"
      className={cn(
        "fixed top-4 left-4 z-50 -translate-y-full transition-transform duration-200",
        isFocused && "translate-y-0",
        "bg-primary text-primary-foreground px-4 py-2 rounded-md font-medium shadow-lg",
        className,
      )}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
    >
      Skip to content
    </a>
  );
}
