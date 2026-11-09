/**
 * Mine Rank — E2E REAL (opt-in).
 *
 * Downloads the OFFICIAL vanilla 1.20.1 server jar (SHA-1 verified, straight
 * from Mojang's piston-meta), writes the generated Mine Rank datapack into a
 * real world, boots the server and plays the game with a REAL client
 * (mineflayer): every command of the manifest is fired as a player and the
 * mining economy is exercised for real.
 *
 * Run it with:
 *   VOXEL_E2E=1 pnpm vitest run src/services/servers/mineRankServer.e2e.test.ts
 *
 * What the vanilla taught us (and this file proves):
 *   - `/trigger` needs a real player as source — the console answers
 *     "A player is required to run this command here", so a console-only
 *     test could never prove the command surface;
 *   - `give` takes item(+NBT) → count in 1.20.1;
 *   - `scoreboard players add` only accepts an integer;
 *   - `team join` is refused inside a datapack (the team name is validated
 *     while the function is parsed);
 *   - a player who just joined has NO score, so `matches 0` is false until
 *     the module initializes them.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import mineflayer, { type Bot } from "mineflayer";
import { describe, expect, it } from "vitest";
import { MINE_RANK_COMMANDS, generateMineRankFiles } from "./mineRankServer";

const RUN_E2E = process.env.VOXEL_E2E === "1";
const MC_VERSION = "1.20.1";
const VERSION_MANIFEST = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const SERVER_PORT = 25598;

/** Cache outside the repo — the jar is ~50MB. */
function cacheDir(): string {
  return path.join(process.env.HOME ?? tmpdir(), ".cache", "voxel", "e2e");
}

/** The official jar, verified with the SHA-1 published by Mojang. */
async function ensureServerJar(): Promise<string> {
  const dir = cacheDir();
  await mkdir(dir, { recursive: true });
  const jar = path.join(dir, `minecraft-server-${MC_VERSION}.jar`);
  if (existsSync(jar)) return jar;

  const manifest = (await (await fetch(VERSION_MANIFEST)).json()) as {
    versions: Array<{ id: string; url: string }>;
  };
  const entry = manifest.versions.find((version) => version.id === MC_VERSION);
  if (!entry) throw new Error(`Mojang manifest has no ${MC_VERSION}`);

  const versionJson = (await (await fetch(entry.url)).json()) as {
    downloads: { server: { url: string; sha1: string } };
  };
  const { url, sha1 } = versionJson.downloads.server;
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
  const digest = createHash("sha1").update(bytes).digest("hex");
  if (digest !== sha1) {
    throw new Error(`server jar checksum mismatch: ${digest} != ${sha1}`);
  }
  await writeFile(jar, bytes);
  return jar;
}

/** The server properties of the test world (flat → the world builds in seconds). */
const PROPERTIES = [
  "eula=true",
  "motd=VOXEL Mine Rank E2E",
  "online-mode=false",
  "level-type=minecraft:flat",
  // the surface stays at y=63 — BELOW the Mine Rank deck (y=100), so the
  // module's structures really stand above the terrain
  'generator-settings={"layers":[{"block":"minecraft:bedrock","height":1},{"block":"minecraft:stone","height":62},{"block":"minecraft:grass_block","height":1}],"biome":"minecraft:plains"}',
  "level-name=world",
  "level-seed=7",
  "max-players=2",
  "view-distance=6",
  "simulation-distance=6",
  "spawn-protection=0",
  "spawn-npcs=false",
  "spawn-animals=false",
  "spawn-monsters=false",
  "enable-command-block=false",
  `server-port=${SERVER_PORT}`,
  "sync-chunk-writes=false",
].join("\n");

/** Patterns that mean the datapack or a command failed inside the server. */
const ERROR_PATTERNS = [
  "Unknown or incomplete command",
  "Unknown command",
  "Failed to load",
  "Couldn't load",
  "Error loading",
  "Incorrect key",
  "Parsing error",
  "has no element",
  "Unknown scoreboard objective",
  "Expected whitespace",
  "Incorrect argument for command",
  "Expected integer",
];

interface RunningServer {
  log: () => string;
  send: (line: string) => void;
  waitFor: (needle: string, timeoutMs: number) => Promise<boolean>;
  stop: () => Promise<void>;
}

async function bootServer(jar: string, dir: string): Promise<RunningServer> {
  const child = spawn("java", ["-Xmx1024M", "-Xms512M", "-jar", jar, "nogui"], {
    cwd: dir,
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;

  let buffer = "";
  const append = (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);

  const waitFor = async (needle: string, timeoutMs: number): Promise<boolean> => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (buffer.includes(needle)) return true;
      await sleep(200);
    }
    return false;
  };

  return {
    log: () => buffer,
    send: (line: string) => {
      child.stdin.write(`${line}\n`);
    },
    waitFor,
    stop: async () => {
      child.stdin.write("stop\n");
      const exited = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 30_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve(true);
        });
      });
      if (!exited) child.kill("SIGKILL");
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A real player connected to the server. */
interface Player {
  bot: Bot;
  messages: string[];
  chat: (line: string) => void;
  /** waits until a NEW chat message matches the needle */
  waitForChat: (needle: string, timeoutMs: number) => Promise<boolean>;
  quit: () => Promise<void>;
}

/** The vanilla throttles the chat (20 messages / 10s) — we pace the commands. */
const CHAT_PACING_MS = 700;

function connectPlayer(): Promise<Player> {
  return new Promise((resolve, reject) => {
    const messages: string[] = [];
    const bot = mineflayer.createBot({
      host: "127.0.0.1",
      port: SERVER_PORT,
      username: "Tester",
      auth: "offline",
      version: MC_VERSION,
    });

    const timer = setTimeout(() => {
      reject(new Error("the client did not join the server"));
    }, 60_000);

    bot.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    bot.once("spawn", () => {
      clearTimeout(timer);
      resolve({
        bot,
        messages,
        chat: (line: string) => bot.chat(line),
        waitForChat: async (needle: string, timeoutMs: number) => {
          const from = messages.length;
          const started = Date.now();
          while (Date.now() - started < timeoutMs) {
            if (messages.slice(from).some((message) => message.includes(needle))) {
              return true;
            }
            await sleep(50);
          }
          return messages.slice(from).some((message) => message.includes(needle));
        },
        quit: async () => {
          bot.quit();
          await sleep(500);
        },
      });
    });

    bot.on("message", (message) => {
      messages.push(message.toString());
    });
  });
}

/**
 * Fires a trigger and waits for the vanilla to CONFIRM it in the SERVER LOG
 * ("Triggered [<display name>] (set value to N)").
 *
 * The log is the source of truth, not the chat: the vanilla throttles the
 * chat (a player may send ~20 messages / 10s) and silently swallows the
 * message, while the console log records EVERY trigger it processed.
 */
async function waitForTrigger(
  server: RunningServer,
  from: number,
  displayName: string,
  value: number,
  timeoutMs = 5000,
): Promise<boolean> {
  const needle = `Triggered [${displayName}] (set value to ${value})`;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (server.log().slice(from).includes(needle)) return true;
    await sleep(50);
  }
  return server.log().slice(from).includes(needle);
}

/**
 * The REAL player route: the command is typed in the chat by the client.
 * The vanilla may throttle the chat, so the command is retried.
 */
async function fireTriggerByChat(
  player: Player,
  server: RunningServer,
  trigger: string,
  displayName: string,
  value: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const from = server.log().length;
    player.chat(`/trigger ${trigger} set ${value}`);
    if (await waitForTrigger(server, from, displayName, value, 4000)) return true;
    // the chat was throttled — wait and try again
    await sleep(2000);
  }
  return false;
}

/**
 * The exhaustive route: the console runs `execute as <player> run trigger …`.
 *
 * The console cannot run `/trigger` directly ("A player is required to run
 * this command here"), but `execute as` makes the PLAYER the source of the
 * command — the trigger fires exactly as it does when the player types it,
 * without the chat throttle of the vanilla.
 */
async function fireTriggerByConsole(
  server: RunningServer,
  trigger: string,
  displayName: string,
  value: number,
): Promise<boolean> {
  const from = server.log().length;
  server.send(`execute as Tester run trigger ${trigger} set ${value}`);
  return waitForTrigger(server, from, displayName, value);
}

describe.skipIf(!RUN_E2E)("Mine Rank — E2E real (vanilla 1.20.1 server)", () => {
  it(
    "plays the whole command surface with a real client and mines for real",
    async () => {
      const jar = await ensureServerJar();
      const dir = await mkdtemp(path.join(tmpdir(), "voxel-mine-rank-e2e-"));

      try {
        await writeFile(path.join(dir, "eula.txt"), "eula=true\n");
        await writeFile(path.join(dir, "server.properties"), `${PROPERTIES}\n`);

        // write the generated datapack BEFORE the first boot
        for (const file of generateMineRankFiles()) {
          const target = path.join(dir, file.path);
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, file.content);
        }

        const server = await bootServer(jar, dir);
        let player: Player | null = null;
        try {
          const booted = await server.waitFor("Done (", 240_000);
          expect(booted, `server did not boot:\n${server.log().slice(-4000)}`).toBe(true);

          // the datapack really loaded (no datapack error at boot)
          for (const pattern of ERROR_PATTERNS) {
            expect(server.log(), `datapack error "${pattern}"`).not.toContain(pattern);
          }

          // every trigger objective exists under its exact internal name
          for (const command of MINE_RANK_COMMANDS) {
            server.send(`scoreboard players set #mr_probe ${command.trigger} 0`);
          }
          await sleep(2000);
          expect(server.log()).not.toContain("Unknown scoreboard objective");

          // a REAL player joins — the console could never prove the triggers
          player = await connectPlayer();
          await sleep(2000);

          // 1) the REAL player route — the client types the command in chat.
          //    A sample covers the first, the last and the social commands
          //    (the vanilla throttles the chat, so the whole surface is
          //    swept through the console route below).
          const byChat = [
            MINE_RANK_COMMANDS[0],
            MINE_RANK_COMMANDS[Math.floor(MINE_RANK_COMMANDS.length / 2)],
            MINE_RANK_COMMANDS[MINE_RANK_COMMANDS.length - 1],
            MINE_RANK_COMMANDS.find((command) => command.id === "p add"),
          ].filter((command): command is (typeof MINE_RANK_COMMANDS)[number] =>
            Boolean(command),
          );
          for (const command of byChat) {
            const fired = await fireTriggerByChat(
              player,
              server,
              command.trigger,
              command.description.slice(0, 32),
              1,
            );
            expect(
              fired,
              `${command.id} did not fire from the chat — last chat: ${player.messages.slice(-4).join(" | ")}`,
            ).toBe(true);
            await sleep(CHAT_PACING_MS);
          }

          // 2) the whole surface — every command, every branch
          for (const command of MINE_RANK_COMMANDS) {
            for (const value of [1, 2, 3]) {
              const fired = await fireTriggerByConsole(
                server,
                command.trigger,
                command.description.slice(0, 32),
                value,
              );
              expect(
                fired,
                `${command.id} (value ${value}) did not fire — log tail:\n${server.log().slice(-1500)}`,
              ).toBe(true);
              await sleep(120);
            }
          }

          // the menus really render (the module answers in the chat)
          expect(
            player.messages.some((message) => message.includes("[Mine Rank]")),
            "the module never answered in the chat",
          ).toBe(true);
          await sleep(2000);

          // the mining economy works for real: dig a block and earn a coin
          const block = player.bot.blockAt(
            player.bot.entity.position.offset(0, -1, 0),
          );
          if (block && block.name !== "air") {
            await player.bot.dig(block);
            await sleep(1500);
            server.send("scoreboard players get Tester mr_coins");
            await sleep(1000);
            const coins = /Tester has (\d+)/.exec(server.log());
            expect(coins, "the mining economy did not pay a coin").not.toBeNull();
            expect(Number(coins?.[1] ?? "0")).toBeGreaterThan(0);
          }

          // the final log is clean
          const log = server.log();
          for (const pattern of ERROR_PATTERNS) {
            expect(log, `command error "${pattern}"`).not.toContain(pattern);
          }
          // the world is compact on purpose: a long teleport makes the
          // vanilla load the whole chunk corridor and stall the tick
          expect(log, "the server stalled — the world is too big").not.toContain(
            "Can't keep up",
          );
          expect(log).not.toContain("A single server tick took");
          expect(log).toContain("Done (");
        } finally {
          if (player) await player.quit();
          await server.stop();
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    900_000,
  );
});
