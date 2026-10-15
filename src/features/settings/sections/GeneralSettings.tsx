import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettingsStore } from "@/stores/settingsStore";
import { Field, SectionHeader } from "../SettingsBits";
import { getVersion } from "@tauri-apps/api/app";
import { useEffect } from "react";

const LICENSES = ["MIT", "Apache-2.0", "GPL-3.0", "LGPL-3.0", "Custom", "Proprietary"];

export function GeneralSettings() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const [author, setAuthor] = useState(settings.general.authorName);
  const [appVersion, setAppVersion] = useState<string>("…");

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion("unknown"));
  }, []);

  return (
    <section>
      <SectionHeader
        title="General"
        description="Application identity and defaults for new projects."
      />

      <Field
        label="Language"
        hint="Follows the system language when set to Auto — English and Português (Brasil) ship today."
      >
        <div className="max-w-xs">
          <select
            className="h-9 w-full rounded-md border border-border bg-card/60 px-2 text-sm outline-none focus:border-primary"
            value={settings.general.language}
            onChange={(e) =>
              void update("general", {
                language: e.target.value as "auto" | "en" | "pt-BR",
              })
            }
          >
            <option value="auto">Auto (system)</option>
            <option value="en">English</option>
            <option value="pt-BR">Português (Brasil)</option>
          </select>
        </div>
      </Field>

      <Field label="App version" hint="Shown here and in the About dialog.">
        <div className="text-sm text-muted-foreground">VOXEL v{appVersion}</div>
      </Field>

      <Field
        label="Author name"
        hint="Used in generated project metadata, mods and license headers."
      >
        <div className="max-w-sm space-y-1.5">
          <Label htmlFor="author" className="sr-only">
            Author name
          </Label>
          <Input
            id="author"
            placeholder="e.g. Notch Jr."
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            onBlur={() => {
              if (author !== settings.general.authorName) {
                update("general", { authorName: author }).catch(() => {
                  toast.error("Could not save author name");
                  setAuthor(settings.general.authorName);
                });
              }
            }}
          />
        </div>
      </Field>

      <Field
        label="Default license"
        hint="Pre-selected for every new project — change per project at creation time."
      >
        <div className="max-w-sm">
          <Select
            value={settings.general.defaultLicense}
            onValueChange={(value) =>
              update("general", { defaultLicense: value }).catch(() =>
                toast.error("Could not save license preference"),
              )
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LICENSES.map((license) => (
                <SelectItem key={license} value={license}>
                  {license}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Field>
    </section>
  );
}
