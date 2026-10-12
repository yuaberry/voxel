# Architecture — {{MOD_NAME}}

Technical map of the codebase. Update it whenever structure changes.

## Layout
```
src/main/java/…/          Java sources (registries, items, blocks, entities)
src/main/resources/       assets/{{MOD_ID}}/ (models, lang, textures) + data/
build.gradle              build config (ForgeGradle 6 + NeoForged maven, Java {{JAVA_RELEASE}})
```

## Conventions
- One registry class per domain (ModItems, ModBlocks, …).
- All ids prefixed with `{{MOD_ID}}_`.
- Data-driven content (recipes, loot, advancements) under `data/{{MOD_ID}}/`.

## Build
- `./gradlew build` → jar in `build/libs/` (VOXEL runs this for you).
