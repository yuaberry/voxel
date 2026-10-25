import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/stores/settingsStore";
import { Field, SectionHeader } from "../SettingsBits";
import { cn } from "@/lib/utils";
import {
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  clampUiScale,
  uiScaleCss,
} from "@/services/settings/uiScale";
import type { AccentColor } from "@/types";

const ACCENTS: Array<{ id: AccentColor; label: string; dot: string }> = [
  { id: "purple", label: "Violet", dot: "#9155ff" },
  { id: "blue", label: "Electric Blue", dot: "#3580f7" },
  { id: "cyan", label: "Cyan", dot: "#17d9f0" },
  { id: "emerald", label: "Emerald", dot: "#2fd6a3" },
  { id: "amber", label: "Amber", dot: "#fbb133" },
  { id: "rose", label: "Rose", dot: "#f4518f" },
  { id: "teal", label: "Teal", dot: "#1bbfc4" },
];

export function AppearanceSettings() {
  const accent = useSettingsStore((s) => s.settings.appearance.accent);
  const reduceMotion = useSettingsStore((s) => s.settings.appearance.reduceMotion);
  const uiScale = useSettingsStore((s) => s.settings.appearance.uiScale);
  const update = useSettingsStore((s) => s.update);

  return (
    <section>
      <SectionHeader
        title="Appearance"
        description="VOXEL is dark-first. Fine-tune the accent and motion."
      />

      <Field label="Accent color" hint="Applies to buttons, highlights and the logo glow.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ACCENTS.map((option) => (
            <button
              key={option.id}
              onClick={() =>
                update("appearance", { accent: option.id }).catch(() =>
                  toast.error("Could not save accent preference"),
                )
              }
              className={cn(
                "group flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors",
                accent === option.id
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border/70 text-muted-foreground hover:border-primary/30",
              )}
            >
              <span
                className="h-3.5 w-3.5 rounded-full transition-transform group-hover:scale-110"
                style={{
                  backgroundColor: option.dot,
                  boxShadow: `0 0 10px ${option.dot}88`,
                }}
              />
              {option.label}
            </button>
          ))}
        </div>
      </Field>

      <Field
        label="Reduce motion"
        hint="Disables non-essential animations across the interface."
      >
        <Switch
          checked={reduceMotion}
          onCheckedChange={(checked) =>
            update("appearance", { reduceMotion: checked }).catch(() =>
              toast.error("Could not save motion preference"),
            )
          }
        />
      </Field>

      <Field
        label="Interface scale"
        hint="85%–125% — the whole UI, for comfort. The layouts are crafted at 100%."
      >
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={UI_SCALE_MIN}
            max={UI_SCALE_MAX}
            step={0.05}
            value={clampUiScale(uiScale)}
            onChange={(e) =>
              update("appearance", { uiScale: clampUiScale(Number(e.target.value)) }).catch(() =>
                toast.error("Could not save scale preference"),
              )
            }
            className="w-40 accent-[var(--accent)]"
          />
          <span className="w-10 font-mono text-xs text-muted-foreground">
            {Math.round(clampUiScale(uiScale) * 100)}%
          </span>
          {clampUiScale(uiScale) !== 1 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() =>
                update("appearance", { uiScale: 1 }).catch(() =>
                  toast.error("Could not save scale preference"),
                )
              }
            >
              Reset
            </Button>
          )}
          <span className="font-mono text-[10px] text-muted-foreground">
            var: {uiScaleCss(uiScale)}
          </span>
        </div>
      </Field>
    </section>
  );
}
