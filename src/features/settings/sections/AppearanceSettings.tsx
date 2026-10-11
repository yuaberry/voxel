import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/stores/settingsStore";
import { Field, SectionHeader } from "../SettingsBits";
import { cn } from "@/lib/utils";
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
    </section>
  );
}
