import { useCallback, useEffect, useRef, useState } from "react";
import { Coins, Link, Loader2, Globe, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  applyLedgerTx,
  initLedger,
  listLedger,
  MARKET_ITEMS,
  parseTunnelAddress,
  subscribeTunnelLog,
  tailPurchaseIntents,
  tunnelStart,
  tunnelStatus,
  tunnelStop,
  verifyLedger,
  type LedgerSnapshot,
  type VerifyResult,
} from "@/services/servers/economyService";
import { sendServerCommand } from "@/services/servers/serverService";
import type { ServerRecord } from "@/types";

interface Props {
  server: ServerRecord;
  basePath: string;
}

/**
 * Economy & Public tabs — the "wow" panel: your own coin with a real
 * SHA-256 hash chain, and a free public tunnel address (playit.gg).
 */
export function ServerEconomyPanel({ server, basePath }: Props) {
  const [ledger, setLedger] = useState<LedgerSnapshot | null>(null);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [mintTo, setMintTo] = useState("");
  const [mintAmount, setMintAmount] = useState("100");
  const [busy, setBusy] = useState(false);

  const [tunnelRunning, setTunnelRunning] = useState(false);
  const [tunnelLines, setTunnelLines] = useState<string[]>([]);
  const [tunnelAddress, setTunnelAddress] = useState<string | null>(null);
  const tunnelUnlisten = useRef<Array<() => void>>([]);

  const slug = server.slug;
  const refresh = useCallback(async () => {
    const snapshot = await listLedger(basePath, slug).catch(() => null);
    setLedger(snapshot);
    setTunnelRunning(await tunnelStatus(slug).catch(() => false));
  }, [basePath, slug]);

  useEffect(() => {
    // microtask: refresh sets ledger synchronously on failure paths
    void Promise.resolve().then(() => refresh());
    const interval = setInterval(() => void refresh(), 4000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Tunnel log subscription
  useEffect(() => {
    void subscribeTunnelLog(
      slug,
      (line) => {
        setTunnelLines((prev) => {
          const next = [...prev, line];
          const address = parseTunnelAddress(next);
          if (address) setTunnelAddress(address);
          return next.slice(-30);
        });
      },
      () => setTunnelRunning(false),
    ).then((fns) => {
      tunnelUnlisten.current = fns;
    });
    return () => {
      tunnelUnlisten.current.forEach((fn) => fn());
    };
  }, [slug]);

  // Process in-game purchases through the ledger (mint → debit → deliver)
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!ledger || ledger.length === 0) return;
      if (!tunnelRunning) return; // server is a required prop — nothing else to check
      const intents = await tailPurchaseIntents(basePath, slug).catch(() => []);
      for (const intent of intents) {
        const item = MARKET_ITEMS[intent.itemId];
        if (!item) continue;
        try {
          await applyLedgerTx({
            basePath,
            slug: slug,
            tx: "transfer",
            from: intent.player,
            to: "nexus:market",
            amount: item.price,
          });
          await sendServerCommand(slug, `give ${intent.player} ${item.giveCommand.replace("give @s ", "")}`);
          toast.success(`${intent.player} bought ${item.name} (${item.price} ₦)`, {
            description: "Debited through the hash chain and delivered in-game.",
          });
          void refresh();
        } catch {
          // insufficient or error — tell the player in-game
          await sendServerCommand(
            slug,
            `tellraw ${intent.player} [{"text":"[VoxelCoin] ","color":"#f87171"},{"text":"insufficient balance or market error","color":"gray"}]`,
          ).catch(() => {});
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [basePath, slug, ledger, tunnelRunning, refresh]);

  const handleInit = async () => {
    setBusy(true);
    try {
      await initLedger(basePath, slug, "VoxelCoin");
      toast.success("Token chain initialized", { description: "Genesis block created." });
      void refresh();
    } catch (error) {
      toast.error("Init failed", { description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleMint = async () => {
    if (!mintTo.trim()) return;
    setBusy(true);
    try {
      await applyLedgerTx({
        basePath,
        slug: slug,
        tx: "mint",
        from: "",
        to: mintTo.trim(),
        amount: Number(mintAmount),
      });
      toast.success(`Minted ${mintAmount} ₦ to ${mintTo}`, {
        description: "A new block was appended to the chain.",
      });
      setMintTo("");
      void refresh();
    } catch (error) {
      toast.error("Mint failed", { description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    setBusy(true);
    try {
      const result = await verifyLedger(basePath, slug);
      setVerify(result);
      if (result.valid) {
        toast.success(`Chain is valid — ${result.checked} blocks verified`, {
          description: "Every hash matches. The ledger is tamper-proof.",
        });
      } else {
        toast.error("CHAIN TAMPERED", {
          description: `Block #${result.firstBadIndex} has an invalid hash.`,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleTunnel = async () => {
    setBusy(true);
    try {
      if (tunnelRunning) {
        await tunnelStop(slug);
        setTunnelRunning(false);
        toast.info("Tunnel closed");
      } else {
        setTunnelLines([]);
        setTunnelAddress(null);
        await tunnelStart({ basePath, slug: slug, port: server.port });
        setTunnelRunning(true);
        toast.success("Public tunnel starting", {
          description: "Watch for your playit.gg address below — share it with friends.",
        });
      }
    } catch (error) {
      toast.error("Tunnel failed", { description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  if (!ledger || ledger.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <Coins className="h-5 w-5 text-muted-foreground/60" />
        <p className="text-xs text-muted-foreground">
          No token chain yet — install the Token Chain module in the wizard or
          initialize one now.
        </p>
        <Button size="sm" variant="secondary" onClick={() => void handleInit()} disabled={busy}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link className="h-3 w-3" />}
          Initialize chain
        </Button>
      </div>
    );
  }

  const balances = Object.entries(ledger.balances).filter(([name]) => !name.startsWith("nexus:"));

  return (
    <div className="space-y-3">
      {/* Mint + verify */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="player name"
          value={mintTo}
          onChange={(e) => setMintTo(e.target.value)}
          className="h-7 w-32 text-xs"
        />
        <Input
          type="number"
          value={mintAmount}
          onChange={(e) => setMintAmount(e.target.value)}
          className="h-7 w-20 text-xs"
        />
        <Button size="sm" variant="secondary" className="h-7 text-[11px]" onClick={() => void handleMint()} disabled={busy || !mintTo.trim()}>
          <Coins className="h-3 w-3" /> Mint ₦
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => void handleVerify()} disabled={busy}>
          <ShieldCheck className="h-3 w-3" /> Verify chain
        </Button>
        <Badge variant={verify?.valid ? "success" : verify ? "destructive" : "secondary"} className="text-[9px]">
          {verify ? (verify.valid ? `${verify.checked} blocks ✓` : `block #${verify.firstBadIndex} BAD`) : "not verified"}
        </Badge>
      </div>

      {/* Balances + recent blocks */}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-border/60 bg-card/40 p-2.5">
          <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            Balances
          </p>
          {balances.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/60">No accounts yet — mint to a player above.</p>
          ) : (
            balances.slice(0, 6).map(([name, amount]) => (
              <div key={name} className="flex items-center justify-between text-[11px]">
                <span className="font-mono">{name}</span>
                <span className="text-primary">{amount.toLocaleString()} ₦</span>
              </div>
            ))
          )}
        </div>
        <div className="rounded-lg border border-border/60 bg-card/40 p-2.5">
          <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            Recent blocks
          </p>
          {ledger.blocks.slice(-5).reverse().map((block) => (
            <div key={block.index} className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">
                #{block.index} {block.tx}
              </span>
              <span className="font-mono text-[9px] text-muted-foreground/60">
                {block.hash.slice(0, 8)}…
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* In-game market */}
      <p className="text-[9px] leading-relaxed text-muted-foreground/60">
        Players buy in-game via <span className="font-mono">/trigger nexus_token set 1-5</span> — purchases
        are debited through the chain and items delivered via console automatically (while the server runs).
      </p>

      <Separator />

      {/* Public tunnel */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Globe className="h-3 w-3" /> Public server (free)
          </span>
          <Button
            size="sm"
            variant={tunnelRunning ? "destructive" : "gradient"}
            className="h-7 text-[11px]"
            onClick={() => void handleTunnel()}
            disabled={busy}
          >
            {tunnelRunning ? "Close tunnel" : "Make public"}
          </Button>
        </div>
        {tunnelRunning && (
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-2.5">
            {tunnelAddress ? (
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs text-emerald-400">{tunnelAddress}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px]"
                  onClick={() => {
                    void navigator.clipboard.writeText(tunnelAddress);
                    toast.success("Address copied");
                  }}
                >
                  Copy
                </Button>
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                Waiting for the playit.gg address… (first run may take a few seconds)
              </p>
            )}
            {tunnelLines.length > 0 && !tunnelAddress && (
              <pre className="mt-1 max-h-16 overflow-auto font-mono text-[8px] text-muted-foreground/70">
                {tunnelLines.slice(-5).join("\n")}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
