/**
 * Accessibility — Live Region.
 *
 * Announces dynamic content changes to screen readers without moving focus.
 * Use for: search results, build status changes, backup completion,
 * server start/stop notifications, etc.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export function LiveRegion({ children }: { children: string }) {
  const [id] = useState(() => `live-region-${Math.random().toString(36).slice(2)}`);

  return (
    <div
      id={id}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="absolute w-1 h-1 p-1 overflow-hidden hidden"
    >
      {children}
    </div>
  );
}

export function useLiveRegion() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) {
      ref.current = document.createElement("div");
      ref.current.setAttribute("role", "status");
      ref.current.setAttribute("aria-live", "polite");
      ref.current.setAttribute("aria-atomic", "true");
      ref.current.style.position = "absolute";
      ref.current.style.width = "1px";
      ref.current.style.height = "1px";
      ref.current.style.overflow = "hidden";
      ref.current.style.clip = "rect(0 0 0 0)";
      ref.current.style.whiteSpace = "nowrap";
      document.body.appendChild(ref.current);
      return () => {
        document.body.removeChild(ref.current!);
      };
    }
  }, []);

  const announce = useCallback((message: string) => {
    if (ref.current) {
      ref.current.textContent = "";
      // Force re-read by clearing then setting
      requestAnimationFrame(() => {
        ref.current!.textContent = message;
      });
    }
  }, []);

  return { announce };
}
