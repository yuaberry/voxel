// Probe bot: a REAL client that holds a wooden shovel, so the datapack's
// `execute if data entity @s {SelectedItem:{...}}` can be tested with the
// exact conditions of the game (a player holding a shovel).
//
//   node probe-bot.mjs          → connects, equips the shovel, stays alive
//   echo "cmd" > cmd.fifo       → test the command against the username
//
// Kill the process to disconnect and disconnect the probe.

import mineflayer from "mineflayer";

const USERNAME = "VoxelProbe";
const bot = mineflayer.createBot({
  host: "127.0.0.1",
  port: 25565,
  username: USERNAME,
});

bot.on("spawn", () => {
  console.log("PROBE_READY");
  setTimeout(() => {
    const shovel = bot.inventory.items().find((i) => i.name === "minecraft:wooden_shovel");
    if (shovel) {
      bot.equip(shovel, "hand").then(() => {
        const held = bot.heldItem;
        console.log("HELD:", held ? held.name : "nothing");
        console.log("PROBE_HELD_READY");
      });
    } else {
      console.log("NO_SHOVEL — inventory:", bot.inventory.items().map((i) => i.name).join(",") || "(empty)");
      console.log("PROBE_HELD_READY");
    }
  }, 3000);
});

bot.on("playerCollect", () => {});

bot.on("error", (e) => console.log("ERR", e.message));
bot.on("kicked", (r) => console.log("KICKED", JSON.stringify(r)));
