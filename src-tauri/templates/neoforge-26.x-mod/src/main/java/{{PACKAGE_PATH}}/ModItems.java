package {{PACKAGE}};

import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.CreativeModeTab;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.Rarity;
import net.minecraft.world.item.ToolMaterial;
import net.neoforged.neoforge.event.BuildCreativeModeTabContentsEvent;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * All items of {{MOD_NAME}}, registered through NeoForge's DeferredRegister.
 * Adding a new item: one DeferredItem here + an item model definition
 * (assets/<mod_id>/items/<item>.json) + a texture + a lang entry.
 *
 * NOTE on the 26.x era: SwordItem no longer exists — weapon stats live in
 * data components now. This template registers the blade's identity
 * (model, texture, lang, rarity); ask the VOXEL agent to add the
 * attribute components this era expects.
 */
public class ModItems {
    public static final DeferredRegister.Items ITEMS =
            DeferredRegister.createItems({{MOD_ID_CLASS}}.MOD_ID);

    public static final DeferredRegister<CreativeModeTab> CREATIVE_MODE_TABS =
            DeferredRegister.create(Registries.CREATIVE_MODE_TAB, {{MOD_ID_CLASS}}.MOD_ID);

    // Signature blade of the mod — the 26.x era keeps ToolMaterial for
    // mining tiers; the blade itself is a fire-immune epic relic.
    public static final DeferredItem<Item> DARKSTEEL_SWORD = ITEMS.registerSimpleItem(
            "darksteel_sword", properties -> properties
                    .rarity(Rarity.EPIC)
                    .fireResistant());

    // Simple example item — a good starting point for new content.
    public static final DeferredItem<Item> EXAMPLE_ITEM =
            ITEMS.registerSimpleItem("example_item", properties -> properties
                    .rarity(Rarity.EPIC)
                    .fireResistant());

    // The mod's creative tab, showing every item above.
    public static final DeferredHolder<CreativeModeTab, CreativeModeTab> TAB = CREATIVE_MODE_TABS.register(
            "example", () -> CreativeModeTab.builder()
                    .title(Component.translatable("itemGroup.{{MOD_ID}}"))
                    .icon(() -> DARKSTEEL_SWORD.get().getDefaultInstance())
                    .displayItems((parameters, output) -> {
                        output.accept(DARKSTEEL_SWORD.get());
                        output.accept(EXAMPLE_ITEM.get());
                    })
                    .build());

    // Also show our items in the vanilla Combat tab, next to the other swords.
    public static void addCreative(BuildCreativeModeTabContentsEvent event) {
        if (event.getTabKey() == net.minecraft.world.item.CreativeModeTabs.COMBAT) {
            event.accept(DARKSTEEL_SWORD.get());
        }
    }
}
