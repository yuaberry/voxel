package {{PACKAGE}};

import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.CreativeModeTab;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.SwordItem;
import net.minecraft.world.item.Tiers;
import net.minecraftforge.event.BuildCreativeModeTabContentsEvent;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * All items of {{MOD_NAME}}, registered through Forge's DeferredRegister.
 * Adding a new item: one RegistryObject here + a model + a texture +
 * a lang entry (and optionally a recipe).
 */
public class ModItems {
    public static final DeferredRegister<Item> ITEMS =
            DeferredRegister.create(ForgeRegistries.ITEMS, {{MOD_ID_CLASS}}.MOD_ID);

    public static final DeferredRegister<CreativeModeTab> CREATIVE_MODE_TABS =
            DeferredRegister.create(Registries.CREATIVE_MODE_TAB, {{MOD_ID_CLASS}}.MOD_ID);

    // Signature sword of the mod — netherite tier with vanilla-like stats.
    public static final RegistryObject<Item> DARKSTEEL_SWORD = ITEMS.register(
            "darksteel_sword", () -> new SwordItem(Tiers.NETHERITE, 3, -2.4F, new Item.Properties()));

    // Simple example item — a good starting point for new content.
    public static final RegistryObject<Item> EXAMPLE_ITEM =
            ITEMS.register("example_item", () -> new Item(new Item.Properties()));

    // The mod's creative tab, showing every item above.
    public static final RegistryObject<CreativeModeTab> EXAMPLE_TAB =
            CREATIVE_MODE_TABS.register("example", () -> CreativeModeTab.builder()
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
