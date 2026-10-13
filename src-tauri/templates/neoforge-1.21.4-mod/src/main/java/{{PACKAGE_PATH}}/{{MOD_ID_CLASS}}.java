package {{PACKAGE}};

import com.mojang.logging.LogUtils;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import org.slf4j.Logger;

/**
 * {{MOD_NAME}} — main mod class.
 *
 * FML injects the mod event bus and container into the constructor.
 * Content lives in {@link ModItems}.
 */
@Mod({{MOD_ID_CLASS}}.MOD_ID)
public class {{MOD_ID_CLASS}} {
    public static final String MOD_ID = "{{MOD_ID}}";
    public static final Logger LOGGER = LogUtils.getLogger();

    public {{MOD_ID_CLASS}}(IEventBus modEventBus, ModContainer modContainer) {
        ModItems.ITEMS.register(modEventBus);
        ModItems.CREATIVE_MODE_TABS.register(modEventBus);

        NeoForge.EVENT_BUS.register(this);

        LOGGER.info("{{MOD_NAME}} loaded — welcome!");
    }
}
