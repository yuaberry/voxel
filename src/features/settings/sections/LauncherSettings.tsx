import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ExternalLink, Loader2, LogOut, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, SectionHeader } from "../SettingsBits";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  signInWithMicrosoft,
} from "@/services/launcher/authService";
import {
  signInWithElyby,
  type ElybyDeviceCodeInfo,
} from "@/services/launcher/elyAuthService";
import {
  activateProvider,
  getStoredAccountState,
  signOutProvider,
  type StoredMinecraftAccounts,
} from "@/services/launcher/accountService";
import { downloadProjectRuntimes } from "@/services/launcher/runtimeService";
import { secretsBackendInfo } from "@/services/secrets/secretsService";
import type {
  MinecraftAccount,
  MinecraftAuthProvider,
  SecretBackend,
} from "@/types";

const RAM_OPTIONS = [2048, 4096, 6144, 8192, 12288, 16384];

interface DeviceDialogInfo extends ElybyDeviceCodeInfo {
  provider: MinecraftAuthProvider;
}

export function LauncherSettings() {
  const launcher = useSettingsStore((s) => s.settings.launcher);
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);
  const update = useSettingsStore((s) => s.update);

  const [clientIdDraft, setClientIdDraft] = useState(launcher.clientId);
  const [elyClientIdDraft, setElyClientIdDraft] = useState(launcher.elyClientId);
  const [accounts, setAccounts] = useState<StoredMinecraftAccounts>({
    microsoft: null,
    elyby: null,
  });
  const [activeProvider, setActiveProvider] =
    useState<MinecraftAuthProvider | null>(null);
  const [secretBackend, setSecretBackend] = useState<SecretBackend | null>(null);
  const [signingProvider, setSigningProvider] =
    useState<MinecraftAuthProvider | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<DeviceDialogInfo | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refreshAccounts = useCallback(async () => {
    const [state, backend] = await Promise.all([
      getStoredAccountState(),
      secretsBackendInfo(),
    ]);
    setAccounts(state.accounts);
    setActiveProvider(state.activeProvider);
    setSecretBackend(backend.backend);
  }, []);

  /**
   * The owner's requirement: configuring an account downloads Minecraft by
   * itself. The runtime is shared between projects, so this happens once per
   * version — and it never blocks the sign-in itself.
   */
  const startAutomaticDownload = useCallback(async () => {
    if (!basePath) return;
    try {
      const { listProjects } = await import(
        "@/services/db/repositories/projectsRepository"
      );
      const list = await listProjects().catch(() => []);
      if (list.length === 0) return;
      const pending = toast.loading("Downloading Minecraft…", {
        description: "Official Mojang files — first time only, then cached.",
      });
      const result = await downloadProjectRuntimes(basePath, list);
      toast.dismiss(pending);
      if (result.failed.length > 0) {
        toast.warning("Some Minecraft runtimes could not be downloaded", {
          description: result.failed
            .map((f) => `${f.project.name} (${f.project.minecraft_version}): ${f.error}`)
            .join(" · "),
        });
        return;
      }
      if (result.prepared.length === 0) {
        toast.success("Minecraft is ready", {
          description: "The runtime was already downloaded.",
        });
        return;
      }
      toast.success("Minecraft is ready to play", {
        description: result.prepared
          .map((p) => `${p.name} (${p.minecraft_version})`)
          .join(" · "),
      });
    } catch (error) {
      toast.error("Minecraft download failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [basePath]);

  useEffect(() => {
    void Promise.resolve()
      .then(() => refreshAccounts())
      .catch(() => {});
    return () => abortRef.current?.abort();
  }, [refreshAccounts]);

  // An account that is ALREADY configured but a runtime that was never
  // downloaded: the automatic download starts here too.
  useEffect(() => {
    if (!activeProvider) return;
    void startAutomaticDownload();
  }, [activeProvider, startAutomaticDownload]);

  const handleSaveClientId = () => {
    if (clientIdDraft.trim() === launcher.clientId) return;
    update("launcher", { clientId: clientIdDraft.trim() })
      .then(() => toast.success("MSA client id saved"))
      .catch(() => toast.error("Could not save client id"));
  };

  const handleSaveElyClientId = () => {
    if (elyClientIdDraft.trim() === launcher.elyClientId) return;
    update("launcher", { elyClientId: elyClientIdDraft.trim() })
      .then(() => toast.success("Ely.by client id saved"))
      .catch(() => toast.error("Could not save Ely.by client id"));
  };

  const handleSignIn = async (provider: MinecraftAuthProvider) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSigningProvider(provider);
    setDeviceInfo(null);

    try {
      if (provider === "microsoft") {
        const signed = await signInWithMicrosoft(
          (info) => setDeviceInfo({ ...info, provider }),
          { clientId: clientIdDraft.trim(), signal: controller.signal },
        );
        setAccounts((current) => ({ ...current, microsoft: signed }));
      } else {
        const signed = await signInWithElyby(
          (info) => setDeviceInfo({ ...info, provider }),
          { clientId: elyClientIdDraft.trim(), signal: controller.signal },
        );
        setAccounts((current) => ({ ...current, elyby: signed }));
      }
      setActiveProvider(provider);
      setDeviceInfo(null);
      // The account is configured — Minecraft downloads itself from here on.
      void startAutomaticDownload();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(`${provider === "elyby" ? "Ely.by" : "Microsoft"} sign-in failed`, {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setSigningProvider(null);
      }
    }
  };

  const handleSignOut = async (provider: MinecraftAuthProvider) => {
    try {
      const result = await signOutProvider(provider);
      await refreshAccounts();
      const providerName = provider === "elyby" ? "Ely.by" : "Microsoft";
      if (result.warnings.length > 0) {
        toast.warning(`${providerName} signed out locally with a warning`, {
          description: result.warnings.join(" "),
        });
      } else {
        toast.success(`${providerName} account signed out`);
      }
    } catch (error) {
      toast.error("Could not sign out", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleActivate = async (provider: MinecraftAuthProvider) => {
    try {
      await activateProvider(provider);
      setActiveProvider(provider);
      toast.success(`${provider === "elyby" ? "Ely.by" : "Microsoft"} account selected`);
    } catch (error) {
      toast.error("Could not select account", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const cancelDeviceFlow = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setDeviceInfo(null);
    setSigningProvider(null);
  };

  const openBrowser = async (url: string) => {
    try {
      const storage = await import("@/services/storage/storageService");
      await storage.openAuthUrl(url);
    } catch (error) {
      toast.info("Open this URL in your browser", {
        description: `${url} (${String(error)})`,
      });
    }
  };

  const sessionStorageHint =
    secretBackend === "os-keyring"
      ? "Session tokens are stored securely in the OS keyring."
      : secretBackend === "local-file"
        ? "The OS keyring is unavailable; tokens are stored in the protected local secrets file."
        : "Session tokens are stored in the configured local secret store.";

  return (
    <section>
      <SectionHeader
        title="Launcher"
        description="Run Minecraft with your mods using legitimate Microsoft or Ely.by OAuth device-flow sign-in. VOXEL never receives your password."
      />

      <Field
        label="Microsoft account"
        hint={accounts.microsoft ? sessionStorageHint : "Sign in with an Azure public-client application."}
      >
        <AccountCard
          provider="microsoft"
          account={accounts.microsoft}
          active={activeProvider === "microsoft"}
          signing={signingProvider === "microsoft"}
          disabled={signingProvider !== null}
          canSignIn={clientIdDraft.trim().length > 10}
          signInDisabledReason="Add the Microsoft (Azure) client id below to enable this sign-in."
          onSignIn={() => void handleSignIn("microsoft")}
          onSignOut={() => void handleSignOut("microsoft")}
          onActivate={() => void handleActivate("microsoft")}
        />
      </Field>

      <Field
        label="Ely.by account"
        hint={accounts.elyby ? sessionStorageHint : "Sign in with an Ely.by desktop application (public OAuth client)."}
      >
        <AccountCard
          provider="elyby"
          account={accounts.elyby}
          active={activeProvider === "elyby"}
          signing={signingProvider === "elyby"}
          disabled={signingProvider !== null}
          canSignIn={elyClientIdDraft.trim().length > 0}
          signInDisabledReason="Add the Ely.by client id below to enable this sign-in. Create a public desktop application at account.ely.by/dev/applications/new."
          onSignIn={() => void handleSignIn("elyby")}
          onSignOut={() => void handleSignOut("elyby")}
          onActivate={() => void handleActivate("elyby")}
        />
      </Field>

      <Field
        label="MSA client id (Azure app)"
        hint="Device-flow authentication needs a public desktop/mobile app registration at portal.azure.com → App registrations. Enable “Allow public client flows”; no secret is needed."
      >
        <div className="max-w-md space-y-1.5">
          <Input
            className="font-mono text-xs"
            placeholder="00000000-0000-0000-0000-000000000000"
            value={clientIdDraft}
            onChange={(e) => setClientIdDraft(e.target.value)}
            onBlur={handleSaveClientId}
          />
          <p className="text-[10px] leading-relaxed text-muted-foreground/70">
            Microsoft account tokens remain isolated from Ely.by tokens, so
            enabling Ely.by never replaces the existing local session.
          </p>
        </div>
      </Field>

      <Field
        label="Ely.by client id (desktop app)"
        hint="Create a Desktop application at account.ely.by/dev/applications/new. Public desktop clients use device flow without a client secret."
      >
        <div className="max-w-md space-y-2">
          <Input
            className="font-mono text-xs"
            placeholder="VOXEL desktop application client id"
            value={elyClientIdDraft}
            onChange={(e) => setElyClientIdDraft(e.target.value)}
            onBlur={handleSaveElyClientId}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              void openBrowser("https://account.ely.by/dev/applications/new")
            }
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Create Ely.by desktop app
          </Button>
        </div>
      </Field>

      <Field label="Game RAM" hint="Allocated to the game process (-Xmx).">
        <div className="flex max-w-md gap-2">
          {RAM_OPTIONS.map((ram) => (
            <Button
              key={ram}
              size="sm"
              variant={launcher.ramMb === ram ? "default" : "outline"}
              onClick={() =>
                update("launcher", { ramMb: ram }).catch(() =>
                  toast.error("Could not save RAM preference"),
                )
              }
            >
              {ram / 1024} GB
            </Button>
          ))}
        </div>
      </Field>

      <Field label="Legal" hint="Always on, by design.">
        <div className="max-w-md rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <p className="text-[11px] leading-relaxed text-amber-200/80">
            Minecraft files and the verified authlib-injector are downloaded at
            runtime for your local use — nothing is redistributed. VOXEL never
            implements account bypasses or cracked authentication.
          </p>
        </div>
      </Field>

      <Dialog
        open={deviceInfo !== null}
        onOpenChange={(open) => {
          if (!open) cancelDeviceFlow();
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Finish signing in</DialogTitle>
            <DialogDescription>
              {deviceInfo?.provider === "elyby"
                ? "Open Ely.by below and approve the code. VOXEL only receives the OAuth token."
                : "Open Microsoft's page below and approve the code. VOXEL only receives the token."}
            </DialogDescription>
          </DialogHeader>
          {deviceInfo && (
            <div className="space-y-3 text-center">
              <div className="rounded-lg border border-primary/30 bg-primary/10 py-3 font-mono text-2xl font-bold tracking-[0.3em] text-primary">
                {deviceInfo.userCode}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  void openBrowser(
                    deviceInfo.verificationUrlComplete ?? deviceInfo.verificationUrl,
                  )
                }
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {deviceInfo.verificationUrl}
              </Button>
              <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                waiting for you to complete sign-in…
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={cancelDeviceFlow}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function AccountCard({
  provider,
  account,
  active,
  signing,
  disabled,
  canSignIn,
  signInDisabledReason,
  onSignIn,
  onSignOut,
  onActivate,
}: {
  provider: MinecraftAuthProvider;
  account: MinecraftAccount | null;
  active: boolean;
  signing: boolean;
  disabled: boolean;
  canSignIn: boolean;
  /** Why the sign-in button is disabled — never a silent grey button. */
  signInDisabledReason?: string;
  onSignIn: () => void;
  onSignOut: () => void;
  onActivate: () => void;
}) {
  const providerName = provider === "elyby" ? "Ely.by" : "Microsoft";

  return (
    <div className="max-w-md space-y-2 rounded-lg border border-border/70 bg-card/60 p-4">
      {account ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <UserRound className="h-4 w-4 text-emerald-400" />
            <Badge variant="success">{account.username}</Badge>
            {active ? (
              <Badge variant="outline" className="gap-1">
                <Check className="h-3 w-3" /> Active
              </Badge>
            ) : null}
            <span className="font-mono text-[10px] text-muted-foreground">
              {account.uuid}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {!active ? (
              <Button size="sm" variant="secondary" onClick={onActivate}>
                <Check className="h-3.5 w-3.5" /> Use this account
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || signing}
              onClick={onSignOut}
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </Button>
          </div>
        </>
      ) : (
        <>
          <Button
            variant="gradient"
            size="sm"
            disabled={disabled || !canSignIn || signing}
            onClick={onSignIn}
          >
            {signing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            {signing ? "Waiting for sign-in…" : `Sign in with ${providerName}`}
          </Button>
          {!canSignIn && signInDisabledReason ? (
            <p className="text-[10px] leading-relaxed text-muted-foreground/70">
              {signInDisabledReason}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
