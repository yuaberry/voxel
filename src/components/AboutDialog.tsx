import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NexusMark } from "@/components/brand/NexusLogo";
import { useUiStore } from "@/stores/uiStore";
import { APP_TAGLINE, LEGAL_DISCLAIMER } from "@/lib/constants";

export const APP_VERSION = "0.9.0";

export function AboutDialog() {
  const open = useUiStore((s) => s.aboutOpen);
  const setOpen = useUiStore((s) => s.setAboutOpen);
  const [runtimeVersion, setRuntimeVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    getVersion()
      .then((v) => setRuntimeVersion(v))
      .catch(() => setRuntimeVersion(APP_VERSION));
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-4">
            <NexusMark className="h-14 w-14" />
            <div>
              <DialogTitle className="text-xl">
                VOXEL{" "}
                <span className="text-brand-gradient">Studio</span>
              </DialogTitle>
              <DialogDescription className="mt-1">
                AI-Powered Creation Platform · v{runtimeVersion ?? APP_VERSION}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm italic text-muted-foreground">"{APP_TAGLINE}"</p>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <TechChip label="Tauri 2 + Rust" />
            <TechChip label="React 18 + TypeScript" />
            <TechChip label="SQLite storage" />
            <TechChip label="Provider-agnostic AI" />
          </div>

          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <p className="text-xs leading-relaxed text-amber-200/90">{LEGAL_DISCLAIMER}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              No Minecraft client binaries or proprietary assets are distributed
              with this application.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TechChip({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-secondary/40 px-3 py-2 text-muted-foreground">
      {label}
    </div>
  );
}
