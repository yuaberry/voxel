import { cn } from "@/lib/utils";

/** Skeleton — the honest loading state (design system §38): a shape that
 * says "content is coming" instead of an empty void. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse-soft rounded-lg bg-primary/10",
        className,
      )}
    />
  );
}
