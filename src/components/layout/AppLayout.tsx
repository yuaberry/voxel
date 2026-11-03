import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { CommandPalette } from "@/components/CommandPalette";
import { AboutDialog } from "@/components/AboutDialog";
import { CreateProjectWizard } from "@/features/projects/CreateProjectWizard";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

export function AppLayout() {
  useKeyboardShortcuts();
  const { pathname } = useLocation();

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main
          id="main-content"
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-y-auto outline-none"
        >
          {/* Keyed by pathname so page transitions replay the fade-in */}
          <div key={pathname} className="animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette />
      <AboutDialog />
      <CreateProjectWizard />
    </div>
  );
}
