import { describe, expect, it } from "vitest";
import {
  buildShapedRecipe,
  buildShapelessRecipe,
} from "./gameplayDesigner";

const FABRIC_JAVA = `package com.example.dark;

public class ModItems {
    private static Item register(String name, Item item) {
        Identifier id = new Identifier(Main.MOD_ID, name);
        return Registry.register(Registries.ITEM, id, item);
    }

    public static final Item EXAMPLE_ITEM = register("example_item",
            new Item(new Item.Settings()));

    public static final Item DARKSTEEL_SWORD = register("darksteel_sword",
            new SwordItem(ToolMaterials.IRON, 4, -2.4F, new Item.Settings()));

    public static final ItemGroup EXAMPLE_GROUP = FabricItemGroup.builder()
            .entries((context, entries) -> {
                entries.add(EXAMPLE_ITEM);
                entries.add(DARKSTEEL_SWORD);
            })
            .build();
}`;

const DEFERRED_JAVA = `public class ModItems {
    public static final DeferredRegister<Item> ITEMS =
            DeferredRegister.create(ForgeRegistries.ITEMS, Main.MOD_ID);

    public static final RegistryObject<Item> DARKSTEEL_SWORD = ITEMS.register(
            "darksteel_sword", () -> new SwordItem(Tiers.NETHERITE, 3, -2.4F, new Item.Properties()));

    public static final RegistryObject<Item> EXAMPLE_ITEM = ITEMS.register(
            "example_item", () -> new Item(new Item.Properties()));
}`;

const MODERN_JAVA = `public class ModItems {
    public static final DeferredRegister<Item> ITEMS =
            DeferredRegister.create(Registries.ITEM, Main.MOD_ID);

    public static final DeferredItem<Item> DARKSTEEL_SWORD = ITEMS.registerSimpleItem(
            "darksteel_sword", properties -> properties
                    .rarity(Rarity.EPIC)
                    .fireResistant());

    public static final DeferredItem<Item> EXAMPLE_ITEM =
            ITEMS.registerSimpleItem("example_item", properties -> properties);
}`;

describe("Gameplay Designer — scanner semantics (all three loader styles)", () => {
  it("finds the item ids and constants in fabric-style java", () => {
    const re = /(?:register|registerSimpleItem)\(\s*"([a-z0-9_]+)"/g;
    const ids: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(FABRIC_JAVA)) !== null) ids.push(m[1]);
    expect(ids).toContain("example_item");
    expect(ids).toContain("darksteel_sword");
    // the CONST name lives just above the call — the parser's anchor pattern
    const before = FABRIC_JAVA.slice(
      FABRIC_JAVA.indexOf('register("darksteel_sword"') - 160,
      FABRIC_JAVA.indexOf('register("darksteel_sword"'),
    );
    expect(/([A-Z][A-Z0-9_]+)\s*=\s*$/.exec(before)![1]).toBe("DARKSTEEL_SWORD");
  });

  it("finds ids in forge DeferredRegister style and detects the style", () => {
    const style = DEFERRED_JAVA.includes("registerSimpleItem")
      ? "modern"
      : DEFERRED_JAVA.includes("RegistryObject") || DEFERRED_JAVA.includes("DeferredRegister")
        ? "deferred"
        : "fabric";
    expect(style).toBe("deferred");
    const re = /(?:register|registerSimpleItem)\(\s*"([a-z0-9_]+)"/g;
    const ids: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(DEFERRED_JAVA)) !== null) ids.push(m[1]);
    expect(ids).toEqual(["darksteel_sword", "example_item"]);
  });

  it("finds ids in the 26.x registerSimpleItem style", () => {
    const re = /(?:register|registerSimpleItem)\(\s*"([a-z0-9_]+)"/g;
    const ids: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(MODERN_JAVA)) !== null) ids.push(m[1]);
    expect(ids).toEqual(["darksteel_sword", "example_item"]);
    expect(MODERN_JAVA.includes("registerSimpleItem")).toBe(true); // modern style detected
  });
});

describe("Gameplay Designer — recipe builders (real datapack JSON)", () => {
  it("builds a shaped recipe exactly like vanilla expects", () => {
    const json = buildShapedRecipe("dark_kingdom:voidgem", 2, {
      rows: ["DID", "IDI", "DID"],
      keys: { D: "minecraft:diamond", I: "minecraft:iron_ingot" },
    });
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe("minecraft:crafting_shaped");
    expect(parsed.pattern).toEqual(["DID", "IDI", "DID"]);
    expect(parsed.key.D).toEqual({ item: "minecraft:diamond" });
    expect(parsed.result).toEqual({ item: "dark_kingdom:voidgem", count: 2 });
  });

  it("refuses shaped recipes with unbound or invalid keys", () => {
    expect(() =>
      buildShapedRecipe("x:y", 1, { rows: ["DXD", "   ", "   "], keys: { D: "minecraft:diamond" } }),
    ).toThrow(/no ingredient is bound/);
    expect(() =>
      buildShapedRecipe("x:y", 1, { rows: ["DDD", "   ", "   "], keys: { D: "diamond" } }),
    ).toThrow(/namespace/);
    expect(() =>
      buildShapedRecipe("x:y", 1, { rows: ["DDDD", "   ", "   "], keys: { D: "minecraft:diamond" } }),
    ).toThrow(/at most 3/);
  });

  it("builds a shapeless recipe with bounds", () => {
    const json = buildShapelessRecipe("minecraft:diamond", 1, [
      "minecraft:iron_ingot",
      "minecraft:gold_ingot",
    ]);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe("minecraft:crafting_shapeless");
    expect(parsed.ingredients).toHaveLength(2);
    expect(() =>
      buildShapelessRecipe("minecraft:x", 1, []),
    ).toThrow(/1 to 9/);
  });
});
