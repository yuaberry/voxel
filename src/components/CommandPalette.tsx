import { useNavigate } from "react-router-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Boxes,
  FolderOpen,
  Home,
  Info,
  Palette,
  Plug,
  RefreshCw,
  Rocket,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Smartphone,
  SwatchBook,
  TestTube2,
  HardDrive,
} from "lucide-react";
import { toast } from "sonner";
import { useUiStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useProjectsStore } from "@/stores/projectsStore";
import { secretsGet, AI_API_KEY_ID } from "@/services/secrets/secretsService";
import { openInFileManager } from "@/services/storage/storageService";
import { testAiConnection } from "@/services/ai/connectionService";
import { getProviderMeta } from "@/services/ai/providers";

const NAV_TARGETS = [
  { to: "/", label: "Go to Home", icon: Home, group: "Navigate" },
  { to: "/projects", label: "Go to Projects", icon: Boxes, group: "Navigate" },
  { to: "/launcher", label: "Go to Launcher", icon: Rocket, group: "Navigate" },
  { to: "/ai-creator", label: "Go to AI Creator", icon: Sparkles, group: "Navigate" },
  { to: "/shaders", label: "Go to Shaders", icon: Palette, group: "Navigate" },
  { to: "/servers", label: "Go to Servers", icon: Server, group: "Navigate" },
  { to: "/settings/general", label: "Settings · General", icon: Settings, group: "Settings" },
  { to: "/settings/appearance", label: "Settings · Appearance", icon: Palette, group: "Settings" },
  { to: "/settings/ai", label: "Settings · AI", icon: Plug, group: "Settings" },
  { to: "/settings/minecraft", label: "Settings · Minecraft", icon: SwatchBook, group: "Settings" },
  { to: "/settings/java", label: "Settings · Java", icon: TestTube2, group: "Settings" },
  { to: "/settings/launcher", label: "Settings · Launcher", icon: Sparkles, group: "Settings" },
  { to: "/settings/mobile", label: "Settings · Mobile", icon: Smartphone, group: "Settings" },
  { to: "/settings/github", label: "Settings · GitHub", icon: Sparkles, group: "Settings" },
  { to: "/settings/storage", label: "Settings · Storage", icon: HardDrive, group: "Settings" },
  { to: "/settings/security", label: "Settings · Security", icon: ShieldCheck, group: "Settings" },
];

export function CommandPalette() {
  const navigate = useNavigate();
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const setAboutOpen = useUiStore((s) => s.setAboutOpen);
  const settings = useSettingsStore((s) => s.settings);
  const projects = useProjectsStore((s) => s.projects);
  const setCreateWizardOpen = useUiStore((s) => s.setCreateWizardOpen);

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  const handleOpenStorage = async () => {
    setOpen(false);
    const basePath = settings.storage.basePath;
    if (!basePath) {
      toast.info("Storage location is not configured yet", {
        description: "Choose a folder in Settings → Storage first.",
      });
      go("/settings/storage");
      return;
    }
    try {
      await openInFileManager(basePath);
    } catch (error) {
      toast.error("Could not open storage folder", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleTestAi = async () => {
    setOpen(false);
    const meta = getProviderMeta(settings.ai.provider);
    if (meta.requiresKey) {
      const key = await secretsGet(AI_API_KEY_ID);
      if (!key) {
        toast.info("Configure your AI provider first", {
          description: "Add an API key and model in Settings → AI.",
        });
        go("/settings/ai");
        return;
      }
    }
    const key = await secretsGet(AI_API_KEY_ID);
    toast.promise(testAiConnection(settings.ai, key), {
      loading: `Testing connection to ${meta.label}…`,
      success: (result) =>
        result.ok
          ? `${result.message} (${result.latencyMs} ms)`
          : result.message,
      error: "Connection test failed unexpectedly",
    });
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[20%] z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover shadow-2xl shadow-black/60 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <Command loop>
            <CommandInput placeholder="Type a command or search…" />
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>

              <CommandGroup heading="Projects">
                <PaletteItem
                  icon={Boxes}
                  label="Create new project"
                  onSelect={() => {
                    setOpen(false);
                    setCreateWizardOpen(true);
                  }}
                />
                {projects.slice(0, 6).map((project) => (
                  <PaletteItem
                    key={project.id}
                    icon={Boxes}
                    label={`Open: ${project.name}`}
                    onSelect={() => go(`/projects/${project.id}`)}
                  />
                ))}
              </CommandGroup>

              <CommandSeparator />

              <CommandGroup heading="Navigate">
                {NAV_TARGETS.filter((t) => t.group === "Navigate").map((target) => (
                  <PaletteItem
                    key={target.to}
                    icon={target.icon}
                    label={target.label}
                    onSelect={() => go(target.to)}
                  />
                ))}
              </CommandGroup>

              <CommandSeparator />

              <CommandGroup heading="Settings">
                {NAV_TARGETS.filter((t) => t.group === "Settings").map((target) => (
                  <PaletteItem
                    key={target.to}
                    icon={target.icon}
                    label={target.label}
                    onSelect={() => go(target.to)}
                  />
                ))}
              </CommandGroup>

              <CommandSeparator />

              <CommandGroup heading="Actions">
                <PaletteItem
                  icon={FolderOpen}
                  label="Open storage folder"
                  onSelect={() => void handleOpenStorage()}
                />
                <PaletteItem
                  icon={Plug}
                  label="Test AI connection"
                  onSelect={() => void handleTestAi()}
                />
                <PaletteItem
                  icon={Info}
                  label="About VOXEL"
                  onSelect={() => {
                    setOpen(false);
                    setAboutOpen(true);
                  }}
                />
                <PaletteItem
                  icon={RefreshCw}
                  label="Reload window"
                  onSelect={() => window.location.reload()}
                />
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PaletteItem({
  icon: Icon,
  label,
  onSelect,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onSelect: () => void;
}) {
  return (
    <CommandItem onSelect={onSelect}>
      <Icon className="h-4 w-4" />
      {label}
    </CommandItem>
  );
}
