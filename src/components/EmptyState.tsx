/**
 * EmptyState — the premium version of "there is nothing here yet":
 * brand pixel-art illustration + title + hint + optional action.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  icon?: "cube" | "spark" | "server";
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}

function CubeArt() {
  return (
    <svg width="72" height="72" viewBox="0 0 24 24" fill="none" aria-hidden>
      {/* iso cube in brand tones */}
      <path
        d="M12 3.2 20 7.6v8.8L12 20.8 4 16.4V7.6z"
        fill="rgba(145,85,255,0.16)"
        stroke="rgba(145,85,255,0.55)"
        strokeWidth="0.7"
      />
      <path d="M4 7.6 12 12l8-4.4" stroke="rgba(126,232,250,0.55)" strokeWidth="0.7" />
      <path d="M12 12v8.8" stroke="rgba(145,85,255,0.4)" strokeWidth="0.7" />
      <path d="M12 3.2v8.8" stroke="rgba(255,255,255,0.14)" strokeWidth="0.5" />
      <circle cx="12" cy="3.2" r="1" fill="#7ee8fa" />
      <circle cx="20" cy="7.6" r="1" fill="#9155ff" />
      <circle cx="4" cy="7.6" r="1" fill="#9155ff" />
      <circle cx="20" cy="16.4" r="1" fill="#6ea2ff" />
      <circle cx="4" cy="16.4" r="1" fill="#6ea2ff" />
      <circle cx="12" cy="20.8" r="1" fill="#7ee8fa" />
    </svg>
  );
}

function SparkArt() {
  return (
    <svg width="72" height="72" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2.8l1.9 5.6a2 2 0 0 0 1.3 1.3L21 11.6l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 20.6l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 11.6l5.8-1.9a2 2 0 0 0 1.3-1.3z"
        fill="rgba(126,232,250,0.14)"
        stroke="rgba(126,232,250,0.6)"
        strokeWidth="0.8"
      />
      <path d="M12 8v7M8.5 11.5h7" stroke="#b79cff" strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  );
}

function ServerArt() {
  return (
    <svg width="72" height="72" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4.5" y="4" width="15" height="6.5" rx="1.4" fill="rgba(110,162,255,0.12)" stroke="rgba(110,162,255,0.55)" strokeWidth="0.8" />
      <rect x="4.5" y="13.5" width="15" height="6.5" rx="1.4" fill="rgba(110,162,255,0.12)" stroke="rgba(110,162,255,0.55)" strokeWidth="0.8" />
      <circle cx="7.5" cy="7.2" r="1" fill="#7ee8fa" />
      <circle cx="7.5" cy="16.7" r="1" fill="#7ee8fa" />
      <path d="M11 7.2h5M11 16.7h5" stroke="rgba(255,255,255,0.35)" strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyState({ icon = "cube", title, hint, action, className }: Props) {
  const Art = icon === "spark" ? SparkArt : icon === "server" ? ServerArt : CubeArt;
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/70 bg-card/30 px-6 py-10 text-center",
        className,
      )}
    >
      <div className="drop-shadow-[0_0_18px_rgba(145,85,255,0.25)]">
        <Art />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>}
      {action}
    </div>
  );
}



/** The brand illustrations, exported for standalone reuse. */
export const EmptyArt = { CubeArt, SparkArt, ServerArt };
