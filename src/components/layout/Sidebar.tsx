import { NavLink, useNavigate } from "react-router-dom";
import { t } from "@/i18n";
import {
  Boxes,
  ChevronsLeft,
  ChevronsRight,
  Home,
  Package,
  Brush,
  Store,
  Rocket,
  Settings,
  Sparkles,
  Server,
  Palette,
  Info,
  Workflow,
  Swords,
  Images,
  GitCompare, Cpu } from "lucide-react";
import { NexusLogo, NexusMark } from "@/components/brand/NexusLogo";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUiStore } from "@/stores/uiStore";
import { APP_VERSION } from "@/components/AboutDialog";
import { cn } from "@/lib/utils";
import { useEffect } from "react";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  enabled: boolean;
  phase?: string;
}

const workspaceItems: NavItem[] = [
  { to: "/", label: "Home", icon: Home, enabled: true },
  { to: "/launcher", label: "Launcher", icon: Rocket, enabled: true },
    { to: "/modpacks", label: "Modpacks", icon: Package, enabled: true },
    { to: "/studio", label: "Asset Studio", icon: Brush, enabled: true },
    { to: "/marketplace", label: "Marketplace", icon: Store, enabled: true },
  { to: "/projects", label: "Projects", icon: Boxes, enabled: true },
  { to: "/ai-creator", label: "AI Creator", icon: Sparkles, enabled: true },
  { to: "/shaders", label: "Shaders", icon: Palette, enabled: true },
  { to: "/servers", label: "Servers", icon: Server, enabled: true },
  { to: "/logic", label: "Visual Logic", icon: Workflow, enabled: true },
  { to: "/designer", label: "Gameplay Designer", icon: Swords, enabled: true },
  { to: "/assets", label: "Asset Lab", icon: Images, enabled: true },
  { to: "/compat", label: "Compatibility", icon: GitCompare, enabled: true },
  { to: "/command", label: "AI Command", icon: Cpu, enabled: true },
];

export function Sidebar() {
  const navigate = useNavigate();
  const setAboutOpen = useUiStore((s) => s.setAboutOpen);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useUiStore((s) => s.setSidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  // Auto-collapse on narrow windows; manual toggling still works between changes
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1100px)");
    setSidebarCollapsed(mq.matches);
    const onChange = (event: MediaQueryListEvent) => setSidebarCollapsed(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [setSidebarCollapsed]);

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-border/70 bg-card/40 transition-[width] duration-200",
        collapsed ? "w-14" : "w-60",
      )}
    >
      {/* Brand */}
      <div className={cn("flex items-center pb-4 pt-5", collapsed ? "justify-center px-2" : "px-5")}>
        {collapsed ? (
          <button
            className="transition-opacity hover:opacity-85"
            onClick={() => navigate("/")}
            title="VOXEL"
          >
            <NexusMark className="h-8 w-8" />
          </button>
        ) : (
          <button
            className="w-full text-left transition-opacity hover:opacity-85"
            onClick={() => navigate("/")}
          >
            <NexusLogo />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-2">
        <p
          className={cn(
            "px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/60",
            collapsed && "hidden",
          )}
        >
          Workspace
        </p>
        <div className={cn("flex flex-col gap-0.5", collapsed && "pt-2")}>
          {workspaceItems.map((item) => (
            <NavItemButton key={item.to} item={item} collapsed={collapsed} />
          ))}
        </div>
      </nav>

      {/* Collapse toggle */}
      <div className="px-2 pb-1">
        <button
          className={cn(
            "flex w-full items-center rounded-md px-3 py-1.5 text-[11px] text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground",
            collapsed ? "justify-center" : "justify-end",
          )}
          onClick={toggleSidebar}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronsRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronsLeft className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Footer */}
      <div className="space-y-1 border-t border-border/70 p-2">
        <NavLink
          to="/settings/general"
          className={({ isActive }) =>
            cn(
              "flex items-center rounded-md px-3 py-2 text-sm transition-colors",
              collapsed && "justify-center px-2",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )
          }
          title="Settings"
        >
          <Settings className="h-4 w-4" />
          {!collapsed && <span className="ml-3">Settings</span>}
        </NavLink>
        <button
          className={cn(
            "flex w-full items-center rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground",
            collapsed && "justify-center px-2",
          )}
          onClick={() => setAboutOpen(true)}
          title="About"
        >
          <Info className="h-4 w-4" />
          {!collapsed && <span className="ml-3">About</span>}
        </button>
        {!collapsed && (
          <p className="px-3 pt-2 text-[10px] leading-relaxed text-muted-foreground/50">
            v{APP_VERSION} · Not affiliated with Mojang Studios or Microsoft
          </p>
        )}
      </div>
    </aside>
  );
}

function NavItemButton({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const Icon = item.icon;
  const link = (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center rounded-lg px-3 py-2 text-sm transition-all",
          collapsed && "justify-center px-2",
          isActive
            ? "bg-primary/12 text-primary"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span
              className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary shadow-[0_0_10px_hsl(var(--primary))]"
              aria-hidden="true"
            />
          )}
          <Icon className="h-4 w-4" />
          {!collapsed && <span className="ml-3">{t(item.label)}</span>}
        </>
      )}
    </NavLink>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block">{link}</span>
      </TooltipTrigger>
      <TooltipContent side="right">{t(item.label)}</TooltipContent>
    </Tooltip>
  );
}
