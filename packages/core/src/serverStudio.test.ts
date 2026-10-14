import { describe, expect, it } from "vitest";
import { MC_COLORS, parseMotd, parseLegacyMotd, parseComponentMotd } from "@voxel/core/motd";
import { parseServerAddress, type ServerPingData } from "@voxel/core/serverPing";
import {
  SERVER_STYLE_PRESETS,
  getServerPreset,
} from "@voxel/core/serverPresets";
import { PUBLIC_SERVER_REFS } from "@voxel/core/publicServers";
import { describePing, inferPresetFromPing, designStyleWithAi } from "@voxel/core/inferStyle";

function fakePing(over: Partial<ServerPingData> = {}): ServerPingData {
  return {
    host: "play.example.net",
    port: 25565,
    latencyMs: 42,
    version: "Paper 1.20.1",
    protocol: 763,
    playersOnline: 10,
    playersMax: 100,
    motd: "Welcome",
    motdRaw: "Welcome",
    favicon: null,
    modsJson: null,
    ...over,
  };
}

describe("MOTD parser", () => {
  it("parses legacy color codes", () => {
    const parts = parseMotd("§bAqua §lBold§r plain");
    expect(parts[0]).toMatchObject({ text: "Aqua ", color: MC_COLORS.b, bold: false });
    expect(parts[1]).toMatchObject({ text: "Bold", bold: true, color: MC_COLORS.b });
    expect(parts[2]).toMatchObject({ text: " plain", color: "#8a93a6" });
  });

  it("parses §x hex colors", () => {
    const parts = parseLegacyMotd("§x§F§F§0§0§0§0RedHex");
    expect(parts[0].color.toLowerCase()).toBe("#ff0000");
    expect(parts[0].text).toBe("RedHex");
  });

  it("parses chat components with named colors and styles", () => {
    const parts = parseComponentMotd({
      text: "A ",
      extra: [{ text: "Sky", color: "aqua", bold: true }, "tail"],
    });
    expect(parts[0].text).toBe("A ");
    expect(parts[1]).toMatchObject({ text: "Sky", color: MC_COLORS.aqua, bold: true });
    expect(parts[2].text).toBe("tail");
  });

  it("handles arrays, empty strings and nulls honestly", () => {
    expect(parseComponentMotd([{ text: "x" }, "y"]).length).toBe(2);
    expect(parseLegacyMotd("§b§l").length).toBe(1); // only formatting, no text → placeholder
    expect(parseMotd(null)).toHaveLength(1);
  });
});

describe("server address parsing", () => {
  it("accepts host, host:port and URLs", () => {
    expect(parseServerAddress("play.example.net")).toEqual({ host: "play.example.net", port: 25565 });
    expect(parseServerAddress("play.example.net:25566")).toEqual({
      host: "play.example.net",
      port: 25566,
    });
    expect(parseServerAddress("https://play.example.net/join")).toEqual({
      host: "play.example.net",
      port: 25565,
    });
  });

  it("rejects garbage", () => {
    expect(parseServerAddress("")).toBeNull();
    expect(parseServerAddress("http://")).toBeNull();
    expect(parseServerAddress("play:0")).toBeNull();
    expect(parseServerAddress("play.example.net:99999")).toBeNull();
    expect(parseServerAddress("bad host")).toBeNull();
  });
});

describe("server style presets", () => {
  it("has 10 curated presets with unique ids", () => {
    expect(SERVER_STYLE_PRESETS.length).toBeGreaterThanOrEqual(10);
    const ids = new Set(SERVER_STYLE_PRESETS.map((p) => p.id));
    expect(ids.size).toBe(SERVER_STYLE_PRESETS.length);
  });

  it("covers both official and community styles", () => {
    const categories = new Set(SERVER_STYLE_PRESETS.map((p) => p.category));
    expect(categories.has("official")).toBe(true);
    expect(categories.has("community")).toBe(true);
  });

  it("properties are safe and modules are valid", () => {
    for (const preset of SERVER_STYLE_PRESETS) {
      expect(preset.software === "vanilla" || preset.software === "paper").toBe(true);
      expect(preset.ramMb).toBeGreaterThanOrEqual(1024);
      for (const [key, value] of Object.entries(preset.properties)) {
        expect(key).toMatch(/^[a-z0-9-]+$/);
        expect(value).not.toMatch(/[\r\n]/);
        expect(key).not.toBe("online-mode"); // security: never preset it
      }
      for (const module of preset.modules) {
        expect(["economy", "prison", "token", "skyblock", "factions", "bedwars"]).toContain(module);
      }
    }
  });

  it("finds presets by id", () => {
    expect(getServerPreset("prison-break")?.name).toBe("Prison Break");
    expect(getServerPreset("nope")).toBeUndefined();
  });
});

describe("public server references", () => {
  it("lists real, verifiable references", () => {
    for (const ref of PUBLIC_SERVER_REFS) {
      expect(ref.address).toMatch(/^[a-z0-9.-]+(:\d+)?$/);
      expect(ref.website.startsWith("https://")).toBe(true);
      expect(ref.note.length).toBeGreaterThan(10);
    }
    const ids = new Set(PUBLIC_SERVER_REFS.map((r) => r.id));
    expect(ids.size).toBe(PUBLIC_SERVER_REFS.length);
  });
});

describe("style inference", () => {
  it("maps MOTD keywords to the right preset", () => {
    expect(inferPresetFromPing(fakePing({ motd: "EPIC PRISON — rank up!" })).id).toBe(
      "prison-break",
    );
    expect(inferPresetFromPing(fakePing({ motd: "SkyBlock islands" })).id).toBe(
      "skyblock-isles",
    );
    expect(inferPresetFromPing(fakePing({ motd: "Practice PvP Duels" })).id).toBe(
      "pvp-arena",
    );
    expect(inferPresetFromPing(fakePing({ motd: "Friendly SMP survival" })).id).toBe(
      "vanilla-survival",
    );
  });

  it("falls back to software-based defaults", () => {
    const preset = inferPresetFromPing(fakePing({ motd: "Welcome to the server" }));
    expect(["paper-survival", "vanilla-survival"]).toContain(preset.id);
  });

  it("describes a ping compactly", () => {
    const text = describePing(fakePing());
    expect(text).toContain("play.example.net:25565");
    expect(text).toContain("Paper 1.20.1");
    expect(text).toContain("10/100");
  });

  it("designStyleWithAi validates and sanitizes the AI answer", async () => {
    const good = designStyleWithAi(fakePing(), {
      sendPrompt: async () =>
        'Here you go: {"styleName":"Neon Isles","description":"x","software":"paper","properties":{"difficulty":"hard","online-mode":"false"},"modules":["economy","nonsense"],"rationale":"r"}',
    });
    const suggestion = await good;
    expect(suggestion.styleName).toBe("Neon Isles");
    expect(suggestion.properties["difficulty"]).toBe("hard");
    expect(suggestion.properties["online-mode"]).toBeUndefined();
    expect(suggestion.modules).toEqual(["economy"]);
  });

  it("designStyleWithAi rejects answers without JSON", async () => {
    await expect(
      designStyleWithAi(fakePing(), { sendPrompt: async () => "no json here" }),
    ).rejects.toThrow(/JSON/);
  });
});
