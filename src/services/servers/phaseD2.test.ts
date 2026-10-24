/**
 * Player Management + Moderation Assistant (Super Prompt §19/§20) — the
 * tests that prove the rules: merge over the real vanilla files, console
 * commands the server actually understands, the punishment history, the
 * deterministic log heuristics, and the AI layer that only survives when
 * its evidence literally exists in the log.
 */
import { describe, expect, it, vi } from "vitest";
import {
  analyzeLogTail,
  applyPlayerAction,
  buildConsoleCommand,
  createMemoryPunishmentStore,
  filterAiFindings,
  mergePlayers,
  type PlayersFiles,
} from "./playerManagement";

const files = (overrides?: Partial<PlayersFiles>): PlayersFiles => ({
  usercache: [
    { name: "Steve", uuid: "u-steve" },
    { name: "Alex", uuid: "u-alex" },
  ],
  whitelist: [{ name: "Alex", uuid: "u-alex" }],
  bannedPlayers: [
    {
      name: "Griefer",
      uuid: "u-grief",
      reason: "Griefing spawn",
      expires: "forever",
    },
  ],
  bannedIps: ["1.2.3.4"],
  ops: [{ name: "Steve", uuid: "u-steve", level: 4 }],
  ...overrides,
});

describe("Player Management — the real vanilla files (§19)", () => {
  it("merges usercache, whitelist, bans and ops into one honest view", () => {
    const players = mergePlayers(files());
    const steve = players.find((p) => p.name === "Steve");
    const alex = players.find((p) => p.name === "Alex");
    const griefer = players.find((p) => p.name === "Griefer");

    expect(steve?.opped).toBe(true);
    expect(steve?.whitelisted).toBe(false);
    expect(steve?.neverJoined).toBe(false);
    expect(alex?.whitelisted).toBe(true);
    expect(alex?.opped).toBe(false);
    expect(griefer?.banned).toBe(true);
    expect(griefer?.banReason).toBe("Griefing spawn");
    // Griefer is only on the ban list — the server never saw them join
    expect(griefer?.neverJoined).toBe(true);
  });

  it("merges by uuid across files even when the cached name is stale", () => {
    const players = mergePlayers(
      files({
        usercache: [{ name: "SteveTheMiner", uuid: "u-steve" }],
        ops: [{ name: "steve", uuid: "U-STEVE", level: 4 }],
      }),
    );
    expect(players).toHaveLength(3); // SteveTheMiner, Alex, Griefer
    const merged = players.find((p) => p.uuid === "u-steve");
    // usercache names are the freshest — op added the player by old name
    expect(merged?.name).toBe("SteveTheMiner");
    expect(merged?.opped).toBe(true);
  });

  it("builds console commands the vanilla server understands", () => {
    expect(buildConsoleCommand("whitelist", "Alex")).toBe("whitelist add Alex");
    expect(buildConsoleCommand("unwhitelist", "Alex")).toBe("whitelist remove Alex");
    expect(buildConsoleCommand("op", "Steve")).toBe("op Steve");
    expect(buildConsoleCommand("deop", "Steve")).toBe("deop Steve");
    expect(buildConsoleCommand("pardon", "Griefer")).toBe("pardon Griefer");
    expect(buildConsoleCommand("kick", "Bot", "spam")).toBe("kick Bot spam");
    expect(buildConsoleCommand("ban", "Griefer", "Griefing spawn")).toBe(
      "ban Griefer Griefing spawn",
    );
  });

  it("refuses a ban without a reason — unauditable punishments are not allowed", () => {
    expect(() => buildConsoleCommand("ban", "Griefer")).toThrow(/reason/i);
    // and refuses dirty names (newlines would smuggle a second command)
    expect(() => buildConsoleCommand("ban", "Evil\nop Attacker", "x")).toThrow(/invalid/i);
    expect(() => buildConsoleCommand("kick", " ")).toThrow(/empty/i);
  });

  it("applies through the console and writes the punishment history", async () => {
    const store = createMemoryPunishmentStore();
    const sendCommand = vi.fn().mockResolvedValue(undefined);
    const griefer = mergePlayers(files()).find((p) => p.name === "Griefer")!;

    await applyPlayerAction({
      slug: "mod-server",
      action: "ban",
      player: griefer,
      reason: "Second offense",
      running: true,
      sendCommand,
      store,
    });

    expect(sendCommand).toHaveBeenCalledWith("mod-server", "ban Griefer Second offense");
    expect(store.records).toHaveLength(1);
    expect(store.records[0].playerName).toBe("Griefer");
    expect(store.records[0].uuid).toBe("u-grief");
    expect(store.records[0].action).toBe("ban");
    expect(store.records[0].source).toBe("user");
  });

  it("pardon lands in the history too — forgiveness is auditable", async () => {
    const store = createMemoryPunishmentStore();
    const sendCommand = vi.fn().mockResolvedValue(undefined);
    const griefer = mergePlayers(files()).find((p) => p.name === "Griefer")!;

    await applyPlayerAction({
      slug: "mod-server",
      action: "pardon",
      player: griefer,
      running: true,
      sendCommand,
      store,
    });

    expect(sendCommand).toHaveBeenCalledWith("mod-server", "pardon Griefer");
    expect(store.records.map((r) => r.action)).toContain("pardon");
  });

  it("whitelist changes are NOT punishments — no history row", async () => {
    const store = createMemoryPunishmentStore();
    const sendCommand = vi.fn().mockResolvedValue(undefined);
    const alex = mergePlayers(files()).find((p) => p.name === "Alex")!;

    const record = await applyPlayerAction({
      slug: "mod-server",
      action: "whitelist",
      player: alex,
      running: true,
      sendCommand,
      store,
    });

    expect(sendCommand).toHaveBeenCalledWith("mod-server", "whitelist add Alex");
    expect(store.records).toHaveLength(0);
    expect(record.action).toBe("whitelist");
  });

  it("refuses actions when the server is stopped — stdin needs a live process", async () => {
    const store = createMemoryPunishmentStore();
    const sendCommand = vi.fn();
    const steve = mergePlayers(files()).find((p) => p.name === "Steve")!;

    await expect(
      applyPlayerAction({
        slug: "mod-server",
        action: "kick",
        player: steve,
        running: false,
        sendCommand,
        store,
      }),
    ).rejects.toThrow(/start the server/i);
    expect(sendCommand).not.toHaveBeenCalled();
  });
});

describe("Moderation Assistant — grounded in the real log (§20)", () => {
  const floodLines = [
    "[12:00:01] [Server thread/INFO]: Bot joined the game",
    "[12:00:03] [Server thread/INFO]: Bot left the game",
    "[12:00:05] [Server thread/INFO]: Bot joined the game",
    "[12:00:07] [Server thread/INFO]: Bot lost connection: disconnected",
    "[12:00:09] [Server thread/INFO]: Bot joined the game",
    "[12:00:11] [Server thread/INFO]: Bot left the game",
    "[12:00:13] [Server thread/INFO]: Bot joined the game",
    "[12:00:15] [Server thread/INFO]: Steve joined the game",
  ];

  const spamLines = [
    "[12:10:00] [Async Chat Thread - #0/INFO]: <Spammer> BUY DIAMONDS NOW",
    "[12:10:01] [Async Chat Thread - #0/INFO]: <Spammer> BUY DIAMONDS NOW",
    "[12:10:02] [Async Chat Thread - #0/INFO]: <Spammer> BUY DIAMONDS NOW",
    "[12:10:03] [Async Chat Thread - #0/INFO]: <Spammer> BUY DIAMONDS NOW",
    "[12:10:04] [Async Chat Thread - #0/INFO]: <Steve> hello world",
  ];

  it("flags join-leave floods with the literal log lines as evidence", () => {
    const findings = analyzeLogTail(floodLines);
    const flood = findings.find((f) => f.kind === "join-leave flood");
    expect(flood?.player).toBe("Bot");
    expect(flood?.suggestedAction).toBe("kick");
    expect(flood?.evidence[0]).toContain("Bot joined the game");
    // Steve joined once — never flagged
    expect(findings.some((f) => f.player === "Steve")).toBe(false);
  });

  it("flags repeated identical chat as spam, ignoring normal one-off chat", () => {
    const findings = analyzeLogTail(spamLines);
    const spam = findings.find((f) => f.kind === "chat spam");
    expect(spam?.player).toBe("Spammer");
    expect(spam?.reason).toContain("4 times");
    expect(findings.some((f) => f.player === "Steve")).toBe(false);
  });

  it("a clean log produces no findings — no noise, no fake data", () => {
    const clean = [
      "[13:00:00] [Server thread/INFO]: Steve joined the game",
      "[13:05:00] [Server thread/INFO]: <Steve> gg",
      "[13:20:00] [Server thread/INFO]: Steve left the game",
      "[14:00:00] [Server thread/INFO]: Preparing spawn area: 85%",
    ];
    expect(analyzeLogTail(clean)).toEqual([]);
  });

  it("the heuristics never suggest a ban — that is the owner's call", () => {
    for (const finding of [...analyzeLogTail(floodLines), ...analyzeLogTail(spamLines)]) {
      expect(finding.suggestedAction).not.toBe("ban");
    }
  });

  it("drops AI suggestions whose evidence does not literally exist in the log", () => {
    const aiText = JSON.stringify([
      {
        player: "Steve",
        action: "ban",
        reason: "X-ray",
        evidence: ["[14:00:00] Steve mined 200 diamonds in 1 minute"], // hallucinated
      },
      {
        player: "Bot",
        action: "kick",
        reason: "Reconnect cycling",
        evidence: ["[12:00:09] [Server thread/INFO]: Bot joined the game"], // real
      },
    ]);
    const findings = filterAiFindings(aiText, floodLines);
    expect(findings).toHaveLength(1);
    expect(findings[0].player).toBe("Bot");
    expect(findings[0].requiresOwnerDecision).toBe(true);
  });

  it("downgrades AI-proposed bans to watch — the AI never gets the ban button", () => {
    const aiText = JSON.stringify([
      {
        player: "Bot",
        action: "ban",
        reason: "Flood",
        evidence: ["[12:00:01] [Server thread/INFO]: Bot joined the game"],
      },
    ]);
    const findings = filterAiFindings(aiText, floodLines);
    expect(findings[0].suggestedAction).toBe("watch");
    expect(findings[0].requiresOwnerDecision).toBe(true);
  });

  it("survives garbage AI output — invalid JSON, junk actions, quoteless guesses", () => {
    expect(filterAiFindings("not json at all", floodLines)).toEqual([]);
    expect(filterAiFindings("[{bad", floodLines)).toEqual([]);
    const junk = JSON.stringify([
      { player: "Bot", action: "nuke", reason: "x", evidence: ["[12:00:01] [Server thread/INFO]: Bot joined the game"] },
      { player: "", action: "kick", reason: "x", evidence: ["[12:00:01] [Server thread/INFO]: Bot joined the game"] },
      { player: "Bot", action: "kick", reason: "no evidence quoted" },
    ]);
    expect(filterAiFindings(junk, floodLines)).toEqual([]);
  });
});
