import { useState } from "react";
import { t } from "@/i18n";
import { Loader2, ShieldCheck, Stethoscope } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  runDiagnostics,
  type DiagnosticCheck,
} from "@/services/diagnostics/diagnosticsService";

/**
 * Real self-diagnostics. Every check runs for real (network probes, storage
 * write, java spawn, SQLite SELECT) — this is how "nothing works" turns
 * into "here is THE thing that is broken on this machine and how to fix it".
 */
export function DiagnosticsDialog({
  basePath,
  trigger,
  openExternal,
  onOpenChangeExternal,
}: {
  basePath: string;
  trigger?: React.ReactNode;
  /** Controlled mode (e.g. opened from the Servers empty state). */
  openExternal?: boolean;
  onOpenChangeExternal?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<DiagnosticCheck[] | null>(null);

  const isOpen = openExternal ?? open;
  const setOpenState = onOpenChangeExternal ?? setOpen;

  const run = async () => {
    if (busy || !basePath) return;
    setBusy(true);
    setChecks(null);
    try {
      const results = await runDiagnostics(basePath);
      setChecks(results);
    } catch (error) {
      setChecks([
        {
          id: "diagnostics",
          title: "Diagnostics",
          ok: false,
          detail: String(error),
          fix: "The diagnostics itself failed — report this message.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const failing = checks?.filter((c) => !c.ok) ?? [];

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        setOpenState(next);
        if (next) void run();
      }}
    >
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4 text-primary" />
            {t("Diagnostics")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Every check below runs for real on this machine — storage, database, Java and the official download servers. What's red is what's blocking you, with the fix next to it.",
            )}
          </DialogDescription>
        </DialogHeader>

        {busy ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("Running checks… (network probes take a few seconds)")}
          </div>
        ) : checks ? (
          <div className="space-y-2">
            {failing.length > 0 && (
              <p
                className={cn(
                  "rounded-lg border px-3 py-2 text-xs",
                  "border-destructive/40 bg-destructive/10 text-destructive",
                )}
              >
                {t(
                  `${failing.length} check${failing.length > 1 ? "s" : ""} failing — fix what's red and everything works again.`,
                )}
              </p>
            )}
            {failing.length === 0 && (
              <p className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
                {t("All green on this machine — if something still misbehaves, tell us the exact action and we hunt it.")}
              </p>
            )}
            {checks.map((check) => (
              <div
                key={check.id}
                className={cn(
                  "rounded-lg border px-3 py-2.5",
                  check.ok
                    ? "border-primary/20 bg-primary/5"
                    : "border-destructive/40 bg-destructive/5",
                )}
              >
                <p className="flex items-center gap-2 text-xs font-semibold">
                  <ShieldCheck
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      check.ok ? "text-primary" : "text-destructive",
                    )}
                  />
                  {check.title}
                </p>
                <p
                  className={cn(
                    "mt-1 break-words pl-5 text-[11px] leading-relaxed",
                    check.ok ? "text-muted-foreground" : "text-destructive",
                  )}
                >
                  {check.detail}
                </p>
                {!check.ok && check.fix && (
                  <p className="mt-1.5 pl-5 text-[11px] leading-relaxed text-foreground/80">
                    <span className="font-semibold">Fix: </span>
                    {check.fix}
                  </p>
                )}
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => void run()}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              {t("Run again")}
            </Button>
          </div>
        ) : (
          <p className="py-4 text-xs text-muted-foreground">
            {t("Checks start as soon as the dialog opens…")}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
