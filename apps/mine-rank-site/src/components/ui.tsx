import type { ReactNode } from "react";

/** A section with the standard shell + a soft top glow. */
export function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
  className = "",
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  lead?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`relative py-16 sm:py-24 ${className}`}>
      <div className="shell">
        <header className="max-w-2xl">
          {eyebrow ? (
            <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
          {lead ? (
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
              {lead}
            </p>
          ) : null}
        </header>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

/** A small statistic card. */
export function StatCard({
  value,
  label,
  hint,
}: {
  value: string;
  label: string;
  hint?: string;
}) {
  return (
    <div className="panel-soft animate-card-rise p-4 transition-colors hover:border-primary/40">
      <p className="font-mono text-2xl font-bold text-primary sm:text-3xl">{value}</p>
      <p className="mt-1 text-xs font-medium text-foreground">{label}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** A pill used for the family filters and the badges. */
export function Chip({
  active = false,
  children,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
}) {
  const className = `chip ${active ? "chip-active" : ""}`;
  if (!onClick) return <span className={className}>{children}</span>;
  return (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  );
}
