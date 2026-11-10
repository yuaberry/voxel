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

/**
 * Holds an item in the MAIN HAND.
 *
 * The client and the server have to agree on the tool: a shovel breaks
 * stone in 7.5 seconds and the client predicts the block gone before the
 * server accepts the break — the block stays on the server and the
 * statistic is never awarded. The E2E therefore always equips the right
 * tool before digging.
 */
async function equipItem(player: Player, name: string): Promise<boolean> {
  const item = player.bot.inventory.items().find((entry) => entry.name === name);
  if (!item) return false;
  await player.bot.equip(item, "hand");
  await sleep(800);
  return player.bot.heldItem?.name === name;
}

/**
 * Holds the shovel in the MAIN HAND.
 *
 * The server validates the tool of the reward event by itself (it reads
 * `SelectedItem` from the player NBT), so the client really has to equip
 * it — the datapack never trusts what the player says.
 */
async function equipShovel(player: Player): Promise<boolean> {
  const shovel = player.bot.inventory
    .items()
    .find((item) => item.name.endsWith("_shovel"));
  if (!shovel) return false;
  await player.bot.equip(shovel, "hand");
  await sleep(800);
  return true;
}

/**
 * Reads a scoreboard value from the SERVER LOG.
 *
 * The log is the source of truth: the chat is throttled by the vanilla and
 * the score output carries the display name of the objective, so the parse
 * is exact (a loose `/Tester has (\d+)/` would match an older line).
 */
async function scoreOf(
  server: RunningServer,
  objective: string,
  display: string,
): Promise<number | null> {
  const from = server.log().length;
  server.send(`scoreboard players get Tester ${objective}`);
  await sleep(700);
  const escaped = display.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`Tester has (-?\\d+) \\[${escaped}\\]`).exec(
    server.log().slice(from),
  );
  return match ? Number(match[1]) : null;
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
          await writeFile(
            target,
            file.base64 ? Buffer.from(file.base64, "base64") : file.content,
          );
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

          // the mining economy works for real: break a block and earn a coin.
          //
          // The sweep above ends wherever the last teleport left the player
          // and the server corrects the position for a few ticks — the
          // correction ABORTS the dig of the client (mineflayer resolves
          // the dig on `forcedMove`). So the bot goes back to the hub, waits
          // for the position to settle and then breaks a block at its own
          // level (the floor is not the target — the bot would fall into
          // the hole and the dig would be interrupted again).
          server.send("execute as Tester run tp @s 0 101 0");
          await sleep(3000);
          server.send("gamemode survival Tester");
          // stone by hand takes 7.5 seconds — a pickaxe makes it instant
          server.send("give Tester minecraft:diamond_pickaxe 1");
          await sleep(1000);
          expect(
            await equipItem(player, "diamond_pickaxe"),
            "the client could not equip the pickaxe",
          ).toBe(true);

          const stoneTarget = player.bot.entity.position.floored().offset(2, 0, 0);
          server.send(
            `setblock ${stoneTarget.x} ${stoneTarget.y} ${stoneTarget.z} minecraft:stone`,
          );
          await sleep(1000);

          let broken = false;
          let digError = "";
          for (let attempt = 0; attempt < 4 && !broken; attempt += 1) {
            const target = player.bot.blockAt(stoneTarget);
            if (!target || target.name === "air") {
              broken = true;
              break;
            }
            try {
              await player.bot.dig(target, true);
            } catch (error) {
              // the client refused or aborted the dig — try again
              digError = String(error);
            }
            await sleep(1500);
            broken = player.bot.blockAt(stoneTarget)?.name === "air";
          }

          // the SERVER state — the client can predict a broken block, so the
          // only truth is what the server holds
          const probe = server.log().length;
          server.send("scoreboard players set #mr_probe mr_const 0");
          server.send(
            `execute if block ${stoneTarget.x} ${stoneTarget.y} ${stoneTarget.z} minecraft:air run scoreboard players set #mr_probe mr_const 1`,
          );
          server.send("scoreboard players get #mr_probe mr_const");
          await sleep(1000);
          const serverBroke = /#mr_probe has 1/.test(server.log().slice(probe));

          expect(
            broken && serverBroke,
            `the client could not break the stone block — client: ${broken} · server: ${serverBroke} · ${digError} · position: ${JSON.stringify(player.bot.entity.position)} · held: ${JSON.stringify(player.bot.heldItem?.name)} · log tail:\n${server.log().slice(-3000)}`,
          ).toBe(true);
          await sleep(2500); // the tick that pays the reward

          // the REAL vanilla statistic moved — the module reads it through a
          // delta and never drains the player statistics
          const mined = await scoreOf(server, "mr_s_stone", "Mined stone");
          expect(mined ?? 0, "the vanilla mined statistic did not move").toBeGreaterThan(0);

          const coins = await scoreOf(server, "mr_coins", "Mine Rank — coins");
          expect(
            coins ?? 0,
            `the mining economy did not pay a coin — log:\n${server.log().slice(-1200)}`,
          ).toBeGreaterThan(0);

          // ---- the pre-rank mines (Terra) ---------------------------------
          // The player warps to the Terra mine, digs the dirt under their
          // feet and the EXACT reward lands: base_value_cents × shovel_mult
          // is kept in milli-cents, so nothing is lost to a division.
          const terra = MINE_RANK_COMMANDS.find(
            (command) => command.id === "mina terra",
          );
          expect(terra).toBeDefined();
          expect(
            await fireTriggerByConsole(
              server,
              terra!.trigger,
              terra!.description.slice(0, 32),
              1,
            ),
          ).toBe(true);
          await sleep(2000);

          // the player really landed on the dirt of the Terra mine
          const underFeet = player.bot.blockAt(
            player.bot.entity.position.offset(0, -1, 0),
          );
          expect(
            underFeet?.name,
            "the Terra mine did not put the player on dirt",
          ).toBe("dirt");

          // the same caveat as the hub: the teleport correction aborts the
          // dig of the client, so the position settles first
          await sleep(3000);

          // the reward only happens with a shovel in the main hand — the
          // server validates the tool by itself
          expect(
            await equipShovel(player),
            "the module did not give the player a shovel",
          ).toBe(true);

          // the block under the feet is the one that pays — its position is
          // captured BEFORE the dig, because the player falls into the hole
          // as soon as the dirt breaks
          const terraTarget = player.bot.entity.position.offset(0, -1, 0);
          let terraDug = false;
          for (let attempt = 0; attempt < 4 && !terraDug; attempt += 1) {
            const digTarget = player.bot.blockAt(terraTarget);
            if (!digTarget || digTarget.name === "air") {
              terraDug = true;
              break;
            }
            try {
              await player.bot.dig(digTarget, true);
            } catch {
              // the client aborted the dig — try again
            }
            await sleep(1500);
            terraDug = player.bot.blockAt(terraTarget)?.name === "air";
          }
          expect(terraDug, "the client could not dig the dirt").toBe(true);
          await sleep(2500); // the tick that pays the reward

          const terraBlocks = await scoreOf(
            server,
            "mr_blocks_terra",
            "Mine Rank — blocks in terra",
          );
          expect(
            terraBlocks ?? 0,
            "the Terra mine did not count the block",
          ).toBeGreaterThanOrEqual(1);

          // the reward accumulator holds the EXACT value: 10 cents × 0.20
          // (the wooden shovel) = 2000 milli-cents — nothing is lost to a
          // division, the rest is carried to the next block
          const accum = await scoreOf(
            server,
            "mr_pick_accum",
            "Mine Rank — reward accumulator",
          );
          if ((accum ?? 0) <= 0) {
            // the diagnostic: every score of the reward chain
            const from = server.log().length;
            for (const objective of [
              "mr_prerank",
              "mr_in_terra",
              "mr_terra_off",
              "mr_terra_pending",
              "mr_s_dirt",
              "mr_last_dirt",
              "mr_pick_tmp",
              "mr_pick_reward",
              "mr_pick_mult",
              "mr_blocks_terra",
              "mr_coins",
            ]) {
              server.send(`scoreboard players get Tester ${objective}`);
            }
            server.send("scoreboard players get #mr_k100000 mr_const");
            server.send("data get entity Tester SelectedItem");
            await sleep(1500);
            const toolMult = await scoreOf(
              server,
              "mr_pick_mult",
              "Mine Rank — validated shovel mult",
            );
            throw new Error(
              `the Terra reward did not land — accum: ${accum} · validated mult: ${toolMult} · chat: ${player.messages.slice(-6).join(" | ")} · scores:\n${server.log().slice(from)} · log:\n${server.log().slice(-1500)}`,
            );
          }
          expect(accum ?? 0).toBeGreaterThan(0);

          // ---- the shovel upgrade ------------------------------------------
          // the sweep above fired every trigger three times, so the shovel
          // was already upgraded — the state is reset to make the upgrade
          // measurable
          server.send("scoreboard players set Tester mr_pickaxe_level 0");
          server.send("scoreboard players set Tester mr_pickaxe_mult 200");
          server.send("scoreboard players set Tester mr_pickaxe_price 50");
          server.send("scoreboard players set Tester mr_coins 100");
          await sleep(700);
          const pickUp = MINE_RANK_COMMANDS.find(
            (command) => command.id === "pá upgrade",
          );
          expect(pickUp).toBeDefined();
          expect(
            await fireTriggerByConsole(
              server,
              pickUp!.trigger,
              pickUp!.description.slice(0, 32),
              1,
            ),
          ).toBe(true);
          await sleep(1500);
          const mult = await scoreOf(
            server,
            "mr_pickaxe_mult",
            "Mine Rank — shovel mult",
          );
          expect(
            mult,
            "the shovel upgrade did not change the multiplier",
          ).toBe(400);
          const afterUpgrade = await scoreOf(
            server,
            "mr_coins",
            "Mine Rank — coins",
          );
          expect(
            afterUpgrade,
            "the shovel upgrade did not charge the price",
          ).toBe(50);

          // ---- the MineCoin gate --------------------------------------------
          const mnc = MINE_RANK_COMMANDS.find((command) => command.id === "mnc");
          expect(mnc).toBeDefined();
          expect(
            await fireTriggerByConsole(
              server,
              mnc!.trigger,
              mnc!.description.slice(0, 32),
              1,
            ),
          ).toBe(true);
          await sleep(1200);
          expect(
            player.messages.some((message) =>
              message.includes("MineCoin só é liberada no Rank Bronze"),
            ),
            "the MineCoin gate did not lock a player below Bronze",
          ).toBe(true);

          // at Bronze the MineCoin opens and the custom pickaxe is bought
          server.send("scoreboard players set Tester mr_prerank 2");
          for (const permission of [
            "mr_p_view",
            "mr_p_market",
            "mr_p_recv",
            "mr_p_send",
            "mr_p_trade",
            "mr_p_premium",
          ]) {
            server.send(`scoreboard players set Tester ${permission} 1`);
          }
          server.send("scoreboard players set Tester mr_mnc 30");
          await sleep(800);
          expect(
            await fireTriggerByConsole(
              server,
              mnc!.trigger,
              mnc!.description.slice(0, 32),
              8,
            ),
          ).toBe(true);
          await sleep(1500);
          const customPickaxe = player.bot
            .inventory.items()
            .some((item) =>
              JSON.stringify(item.nbt ?? {}).includes("CustomModelData"),
            );
          expect(
            customPickaxe,
            "the mining pickaxe with the custom model was not delivered",
          ).toBe(true);

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
