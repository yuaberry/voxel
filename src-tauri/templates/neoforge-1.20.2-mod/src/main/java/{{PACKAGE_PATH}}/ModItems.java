package {{PACKAGE}};

import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.CreativeModeTab;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.SwordItem;
import net.minecraft.world.item.Tiers;
import net.neoforged.neoforge.event.BuildCreativeModeTabContentsEvent;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * All items of {{MOD_NAME}}, registered through NeoForge's DeferredRegister.
 * Adding a new item: one DeferredItem here + a model + a texture +
 * a lang entry (and optionally a recipe).
 */
public class ModItems {
    // DeferredRegister specialized for items (NeoForge 20.2+ API).
    public static final DeferredRegister.Items ITEMS =
            DeferredRegister.createItems({{MOD_ID_CLASS}}.MOD_ID);

    public static final DeferredRegister<CreativeModeTab> CREATIVE_MODE_TABS =
            DeferredRegister.create(Registries.CREATIVE_MODE_TAB, {{MOD_ID_CLASS}}.MOD_ID);

    // Signature sword of the mod — netherite tier with vanilla-like stats.
    // NeoForge 20.2 API: the factory receives the item properties.
    public static final DeferredItem<Item> DARKSTEEL_SWORD = ITEMS.registerItem(
            "darksteel_sword", (properties) -> new SwordItem(Tiers.NETHERITE, 3, -2.4F, properties));

    // Simple example item — a good starting point for new content.
    public static final DeferredItem<Item> EXAMPLE_ITEM =
            ITEMS.registerSimpleItem("example_item", new Item.Properties());

    // The mod's creative tab, showing every item above.
    public static final DeferredHolder<CreativeModeTab, CreativeModeTab> TAB = CREATIVE_MODE_TABS.register(
            "example", () -> CreativeModeTab.builder()
                    .title(Component.translatable("itemgroup.{{MOD_ID}}.example"))
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
