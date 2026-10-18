import { t } from "@/i18n";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CommandAction, CustomCommand } from "@/services/servers/customCommands";

/**
 * Shared command designer — the same editor drives BOTH custom command
 * homes: server datapacks (Customize → Commands) and the mod's own
 * datapack (workspace → Custom commands). The user designs; the caller
 * decides where the generated functions land.
 */
export function CommandDraftEditor({
  draft,
  onChange,
  onSave,
  onCancel,
  hasEconomy,
  installHint,
}: {
  draft: CustomCommand;
  onChange: (draft: CustomCommand) => void;
  onSave: () => void;
  onCancel: () => void;
  /** whether the /convert economy flow is available in this context */
  hasEconomy: boolean;
  /** what the context does with the command (e.g. "lands in your mod's datapack") */
  installHint?: string;
}) {
  const addAction = (action: CommandAction) => {
    onChange({ ...draft, actions: [...draft.actions, action] });
  };

  return (
    <div className="space-y-2.5 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-[10px]">{t("Command id")}</Label>
          <Input
            placeholder="vip_kit"
            className="h-8 text-xs"
            value={draft.id}
            onChange={(e) => onChange({ ...draft, id: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px]">{t("What it does")}</Label>
          <Input
            placeholder="The VIP welcome kit"
            className="h-8 text-xs"
            value={draft.description}
            onChange={(e) => onChange({ ...draft, description: e.target.value })}
          />
        </div>
        {hasEconomy && (
          <>
            <div className="space-y-1">
              <Label className="text-[10px]">{t("Cost in coins (0 = free)")}</Label>
              <Input
                type="number"
                min={0}
                className="h-8 text-xs"
                value={draft.costCoins ?? 0}
                onChange={(e) => onChange({ ...draft, costCoins: Number(e.target.value) || 0 })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">{t("Cooldown seconds")}</Label>
              <Input
                type="number"
                min={0}
                className="h-8 text-xs"
                value={draft.cooldownSeconds ?? 0}
                onChange={(e) =>
                  onChange({ ...draft, cooldownSeconds: Number(e.target.value) || 0 })
                }
              />
            </div>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" onClick={() => addAction({ kind: "message", text: "Welcome!", color: "green" })}>
          + message
        </Button>
        <Button size="sm" variant="outline" onClick={() => addAction({ kind: "title", text: "ARENA" })}>
          + title
        </Button>
        <Button size="sm" variant="outline" onClick={() => addAction({ kind: "give", item: "diamond", count: 1 })}>
          + give
        </Button>
        <Button size="sm" variant="outline" onClick={() => addAction({ kind: "teleport", x: 0, y: 64, z: 0 })}>
          + teleport
        </Button>
        <Button size="sm" variant="outline" onClick={() => addAction({ kind: "effect", effect: "speed", seconds: 30, amplifier: 1 })}>
          + effect
        </Button>
        <Button size="sm" variant="outline" onClick={() => addAction({ kind: "sound", sound: "entity.player.levelup" })}>
          + sound
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            addAction({
              kind: "summon",
              mob: "zombie",
              name: "Arena Guardian",
              health: 40,
              heldItem: "iron_sword",
              helmet: "diamond_helmet",
            })
          }
        >
          + mob
        </Button>
        {hasEconomy && (
          <Button size="sm" variant="outline" onClick={() => addAction({ kind: "convert", tiers: [50, 100, 250] })}>
            + /convert
          </Button>
        )}
      </div>
      {draft.actions.length > 0 && (
        <div className="space-y-1">
          {draft.actions.map((a, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-card/60 px-2 py-1 text-[10px]"
            >
              <code className="truncate font-mono text-muted-foreground">
                {a.kind === "message" && `message "${a.text}"`}
                {a.kind === "title" && `title "${a.text}"`}
                {a.kind === "give" && `give ${a.item} x${a.count ?? 1}`}
                {a.kind === "teleport" && `tp ${a.x} ${a.y} ${a.z}`}
                {a.kind === "effect" && `effect ${a.effect} ${a.seconds}s`}
                {a.kind === "sound" && `sound ${a.sound}`}
                {a.kind === "summon" && `summon ${a.mob} "${a.name ?? ""}"`}
                {a.kind === "convert" && `convert tiers ${a.tiers.join("/")}`}
              </code>
              <button
                type="button"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => onChange({ ...draft, actions: draft.actions.filter((_, j) => j !== i) })}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button size="sm" variant="gradient" onClick={onSave}>
          {t("Add command")}
        </Button>
      </div>
      {installHint && (
        <p className="text-[10px] leading-relaxed text-muted-foreground">{installHint}</p>
      )}
    </div>
  );
}
