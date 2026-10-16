# Plan.md — VOXEL · Documento-Mãe de Continuidade

> **⚡ AI-Powered Creation Platform** — o usuário descreve em linguagem natural; o agente opera sobre um projeto REAL (arquivos, código, build, launcher, servidores, GitHub) com sandbox e auditoria. Nada de fake data — nunca.
>
> **Este arquivo é a memória integral do projeto.** Se o chat foi compactado: leia este documento INTEIRO, depois `README.md`, `docs/PROJECT_AUDIT.md` e `docs/VOXEL_ROADMAP.md`, execute o Protocolo de Retomada (§12) e só então toque em código.
>
> **REGRA PERMANENTE DO DONO**: quando ele disser *"crie o arquivo Plan.md"*, gerar/atualizar este documento com o estado atual completo (sessões, decisões, riscos, roadmap) e commitar. Este arquivo é a base de continuidade pós-compactação.

---

## 1. Identidade do produto

| Campo | Valor |
|---|---|
| Nome | **VOXEL** (desde a Sessão 16 — antes "NexusCraft Studio"; rebrand por briefing do dono de 115 seções) |
| Tagline | "Imagine. Create. Build. Play." |
| Descrição | AI-Powered Creation Platform |
| Repo local | `~/nexuscraft-studio` (pasta local mantém o nome — histórico preservado) |
| GitHub | https://github.com/yuaberry/voxel (**PÚBLICO**, renomeado de nexuscraft-studio na Sessão 16 com redirect automático) |
| Site oficial | https://yuaberry.github.io/voxel/ (GitHub Pages, deploy por workflow) |
| Downloads | https://github.com/yuaberry/voxel/releases — assets `VOXEL_<v>_*` (Windows .exe/.msi · Linux .deb/.AppImage · macOS .dmg arm64+x64) |
| gh CLI | Autenticado (scopes: gist, read:org, repo, workflow) |
| Legal | "VOXEL is an independent third-party creation platform and is not affiliated with Mojang Studios or Microsoft." |
| Idioma | Prompts do dono: PT-BR · Produto/commits: inglês (README em PT-BR, site em EN) |
| ⚠️ Sem LICENSE ainda | repo público sem licença — site/README NÃO afirmam "open source" (honesto). Dono decide depois |
| **IDs internos preservados** (compat) | identifier `dev.yuadevs.nexuscraft-studio`, DB `nexuscraft.db`, crate name, namespaces `nexus_*`, temp dirs de teste — **nunca renomear sem migration planejada** (audit §5 P4) |

## 2. Stack (estabelecida e funcionando — não mudar sem justificativa)

- **Frontend**: React 18 + TypeScript (strict) + Vite 5 + Tailwind 3.4 (shadcn-style, tema dark próprio `nexus-dark`, acentos purple/cyan/blue via `data-accent`), fonts Inter Variable + JetBrains Mono, zustand, react-router (HashRouter), lucide, sonner, cmdk, react-markdown, @monaco-editor/react (bundled local, workers via `?worker`, exports-map: imports SEM prefixo `esm/vs/`)
- **Backend**: Tauri 2 (Rust) — crates: tauri, tauri-plugin-sql (SQLite), tauri-plugin-http, tauri-plugin-dialog, reqwest 0.13 (blocking+rustls default), sha1, sha2, zip, keyring 3
- **Build frontend**: `NODE_OPTIONS=--max-old-space-size=4096` no script `build` (Monaco exige — OOM sem isso)
- **Qualidade**: ESLint 9 (flat config `eslint.config.js`), Vitest 2, CI `.github/workflows/ci.yml`, Release `.github/workflows/release.yml`
- **Sistema**: Java 21 (OpenJDK), Gradle 8.8 wrapper, git, Linux Mint (webkit2gtk-4.1 ✓)
- **Dev**: pnpm 12 (não usar bun para scripts do tauri); `pnpm tauri dev`
- **⚠️ Versões críticas**: vitest@2 (não 5 — vite 5 incompatível), eslint@9 (não 10 — node 18), reqwest 0.13 com rustls default (não `--features rustls-tls` — mudou a API)

## 3. Estrutura essencial

```
src/
  components/ (ui shadcn-style, layout, brand, CommandPalette, AboutDialog, ErrorBoundary)
  features/
    home/                     # Launcher-style home com projetos reais
    projects/                 # + workspace/ (BuildDrawer, LaunchDialog, PublishDialog, FileTree, SnapshotPanel)
    ai-creator/               # (ChatPanel, SpecPreview, InspectorPanel, ChangesView)
    shaders/                  # (ShadersPage, ShaderPreviewCanvas, ShaderPackEditor)
    servers/                  # (ServersPage, CreateServerDialog, ServerConsoleDialog, ServerEconomyPanel)
    settings/sections/       # (General, Appearance, Ai, Minecraft, Java, Launcher, Github, Storage, Security, Advanced)
    roadmap/                 # Página honesta para features futuras (não fake)
  services/
    db/repositories/         # projectsRepository, serversRepository, settingsRepository
    ai/                      # providers, streaming (3 protocolos), connectionService, sessions, contextService, references
    ai/agent/                # tools (12), orchestrator (loop), audit, promptBuilder, toolCallFormat (3 providers)
    build/                   # buildService (process events), errorParser (javac/dependency/configuration)
    launcher/                # authService (MSA device flow), instanceService (prepare/launch/stop)
    servers/                 # serverService (create/start/stop/backup/restore/console)
    servers/serverModules.ts # Economy/Prison/Token Chain datapack generators
    servers/economyService.ts # Token Chain panel + market + tunnel (playit.gg)
    shaders/                  # shaderStyleCatalog (32 presets), shaderPackGenerator,
                              # shaderPreviewSource (WebGL), shaderService, tests
    github/githubService.ts  # device flow + createRepo + push (header transitório)
    minecraft/versionCatalog.ts # Mojang+Fabric+Forge+NeoForge+Paper auto-update
    storage/storageService.ts   # open_in_file_manager, open_auth_url
    environment/environmentService.ts # detect java/git
    secrets/secretsService.ts    # keyring wrappers
    cloud/cloudConfig.ts         # Supabase opcional (honest: UnconfiguredCloudBackend)
  stores/ (settingsStore, projectsStore, uiStore)
  lib/ (monaco.ts com workers locais, utils.ts)

src-tauri/src/commands/
  fs.rs           # path guard + read/write/edit/search/rename/delete + base64
  git.rs          # snapshots (create/list/restore) + git_status + git_diff + civil_from_days
  process.rs      # spawn_monitored (allowlist + streaming + stdin) + stop + is_running
  projects.rs     # create_project (template render + git init) + validation
  templates.rs    # token engine ({{...}}) + write_template (embedded files)
  templates_embed.rs # include_bytes! de TODOS os arquivos do template
  launcher.rs     # download oficial (manifest→version.json→libs→assets→natives) + launch (KnotClient)
  servers.rs      # create (vanilla/Paper jar) + start/stop (stdin) + backup/restore (zip)
  ledger.rs       # Token Chain: SHA-256 hash chain (init/apply/list/verify) + purchase intents (log tail)
  shaders.rs      # shaderpacks: create (allowlist vsh/fsh/glsl/properties/json, immutável),
                  #   list (manifest nexuscraft.json), delete, install→instance, list_instances
  tunnel.rs       # playit.gg agent download + spawn + stop (free public address)
  github.rs       # git_commit_all + git_push_github (transient auth header)
  secrets.rs      # OS keyring + fallback file (chmod 600)
  storage.rs      # get_default_storage_base + ensure_storage_dirs + open_in_file_manager + open_auth_url
  environment.rs  # detect java/git (fixed commands, no user input)

src-tauri/src/migrations/
  001_init.sql            # 18 tabelas (projects, ai_tool_calls, settings, logs, servers, backups, etc.)
  002_version_catalog.sql # colunas do catálogo (kind, yarn, fabric_api, forge, neoforge, etc.)
  # ⚠️ append-only — NUNCA editar uma migration publicada

src-tauri/templates/fabric-1.20.1-mod/
  # 21 arquivos: build.gradle, gradle.properties (tokens de versão), ModItems (com Darksteel Sword),
  # fabric.mod.json, lang, models, recipes (darksteel_sword), advancements (root),
  # .nexus/ (project-spec.json, style-bible.md, ai-memory.md), gradlew (exec-bit restored), CHANGELOG.md

src-tauri/capabilities/default.json  # ACL: sql, dialog, http (AI providers + Mojang + Fabric + Paper + MSA + GitHub)
```

**Workspace do usuário**: `~/VOXEL/{projects,instances,servers,backups,logs,shaderpacks,.gradle-cache,minecraft,tunnel}` — basePath configurável em Settings→Storage. DB: `~/.config/dev.yuadevs.nexuscraft-studio/nexuscraft.db`.

## 4. Como cada sistema funciona (arquitetura funcional)

### 4.1 Projects Core (Fase 1)
- **Create**: wizard com versão do catálogo ao vivo → `create_project` Rust → template embutido (`include_bytes!`) renderizado com tokens (`{{MOD_ID}}`, `{{PACKAGE_PATH}}`, `{{MC_VERSION}}`, `{{JAVA_RELEASE}}`, `{{MAPPINGS_LINE}}` yarn ou mojmap, etc.) → `git init` + primeiro commit → DB row.
- **Edit**: FileTree (explorer) → Monaco (tabs, Ctrl+S, diff no Changes tab do AI Creator) → `write_project_file` via path guard.
- **Snapshots**: `project_create_snapshot` = `git add -A && git commit -m "nexuscraft/snapshot/<label>"`. Restore = `git checkout <sha> -- .` (história preservada).

### 4.2 AI Creator (Fase 2)
- **Streaming**: 3 protocolos (OpenAI-compat SSE, Anthropic events, Ollama NDJSON) via `plugin-http` (Rust-side, zero CORS). `streamChat` generator → ChatPanel com markdown + streaming indicator.
- **Context Assembly**: carrega `.nexus/project-spec.json` + `style-bible.md` + `ai-memory.md` + file tree → monta system prompt.
- **Spec**: IA responde com ```json block → `extractSpecProposal` valida → SpecPreview mostra (tab "Specification") → Save com snapshot automático.
- **Reference Board**: upload de imagens → `import_project_file` (binário) → `.nexus/references/` → attach como `ImagePart` (vision base64) nas mensagens.
- **Sessions**: `ai_sessions`/`ai_messages` no SQLite, carregadas ao trocar de projeto.

### 4.3 Nexus Agent (Fase 3)
- **Tools**: 12 sandboxed (read/write/edit/delete/rename/create_directory/list/search/inspect_dependencies/git_status/git_diff/create_snapshot/list_snapshots) — TODAS via path guard Rust.
- **Orchestrator**: loop ≤8 steps, ≤30 writes, abort cooperativo, snapshot automático antes da 1ª escrita. `onEvent` → timeline UI (cards de tools coloridos).
- **Policy 3 camadas**: (1) Rust path guard, (2) auditoria em `ai_tool_calls`, (3) confirmação UI para destrutivos.
- **Auto-Fix (Fase 4)**: build falha → errorParser extrai erros → agent corrige via tools → rebuild → loop ≤5 tentativas. Destrutivos auto-negados no modo autônomo.

### 4.4 Build System (Fase 4)
- **`start_build`** Rust: gradlew com allowlist (build/clean/jar), `GRADLE_USER_HOME` compartilhado (`.gradle-cache/`), eventos `build:log`/`build:exit` via Tauri.
- **BuildDrawer**: terminal colorido ao vivo (`BUILD SUCCESS` verde, `BUILD FAILED` vermelho), Error Center (javac/dependency/configuration cards), botão "Fix with Nexus Agent".
- **Persistence**: `projects.last_build_status` + resumo na tabela `logs`.

### 4.5 Launcher (Fase 5)
- **`launcher_prepare`**: piston-meta manifest → version.json (BOM-safe) → Fabric profile (meta.fabricmc.net) merge → downloads SHA-1 (client.jar + 88 libs vanilla + 8 fabric + 3.672 assets com 8 workers scoped-threads) → natives extraídos (zip-slip guard) → instância isolada `instances/<slug>/`.
- **`launcher_launch`**: args vanilla+Fabric mesclados (Mojang rules avaliadas), placeholders `${...}` substituídos, KnotClient, `java -Xmx{ram}M -cp ...` → processo monitorado com eventos `launch:log`/`launch:exit`.
- **Auth MSA**: device flow (devicecode → MSA token → XBL → XSTS → Minecraft services → profile), tokens no keyring, client_id configurável em Settings→Launcher.
- **Mod deployment**: `launcher_copy_mod_jar` copia o jar mais recente de `build/libs/` para `instances/<slug>/mods/`.

### 4.6 Server Studio (Fase 6)
- **`server_create`**: vanilla (piston-meta, SHA-1) ou Paper (Fill API, SHA-256), eula gate obrigatório, properties curadas (`online-mode=true` SEMPRE), isolated `servers/<slug>/`.
- **`server_start`**: `java -Xmx{ram}M -jar server.jar nogui` com stdin aberto → console em tempo real (`server:log`/`server:exit`), comandos via `send_line` (stdin).
- **`server_stop`**: `stop` via stdin (world-safe), fallback force após 30s (guard contra vanilla 1.20.1+Java 21 shutdown hang).
- **Backups**: zips timestamped de world/plugins/config/properties (cap 4000 entries), restore com zip-slip guard + path restriction.
- **Properties editor**: textarea com save direto.

### 4.7 Server Modules (Pós-MVP Wave 1 — Sessão 11)
- **Mixable datapacks** (briefing §27/§28): Economy Coin (moeda scoreboard + depósitos + shop), Prison (ranks por mineração + warps + prestígio), Token Chain (mercado in-game ligado ao ledger). Namespaces separados (`nexus_economy`, `nexus_prison`, `nexus_token`) — nunca colidem.
- **Instalação**: wizard com checkboxes → `generateSelectedModules()` → datapacks escritos em `world/datapacks/` ANTES do primeiro boot.
- **Token Chain**: `ledger.rs` — SHA-256 hash chain real (`hash = sha256(index|time|tx|from|to|amount|prev)`), append-only JSONL, `ledger_verify` re-processa toda a cadeia. O app é o banco central: painel Economy minta/transfere/verifica; compras in-game (`/trigger nexus_token set <1-5>`) → datapack loga no latest.log → `ledger_tail_intents` (offset incremental) → painel debita via ledger + entrega item via `sendServerCommand`.
- **Compliance (briefing §28)**: moeda interna do jogo, SEM valor monetário; chains externas/NFT real → interface `ChainProvider` RESERVADA até o dono completar o Monetization Compliance Checklist.
- **Túnel público grátis**: `tunnel.rs` — playit.gg agent (download dos releases oficiais GitHub, spawn `--platform minecraft-java`), UI mostra endereço `*.playit.gg` copiável.

### 4.8 GitHub (Fase 7)
- **`git_commit_all`**: `git add -A && git commit -m <msg>` (identity local já configurada).
- **`git_push_github`**: remote add origin + push com **header transitório** `-c http.https://github.com/.extraheader="AUTHORIZATION: basic <base64(x-access-token:TOKEN)>"` — token NUNCA em URL/config/disco.
- **Auth**: GitHub OAuth device flow (client_id configurável em Settings→GitHub), token no keyring.
- **PublishDialog**: commit → create repo (private toggle) → push → `github_repositories` row.

### 4.9 Version Catalog (Fase 2 — fundamental)
- **Auto-update**: boot refresh + TTL 12h + manual (Settings→Minecraft). Cache SQLite (migration 002). Fallback embutido (1.20.1/1.21.1).
- **2026 reality**: versões `26.3` (novo esquema YY.M), Yarn NÃO cobre 26.x → `loom.officialMojangMappings()`, Paper v2 sunset → Fill API v3, NeoForge mapeia `26.3.0.x`→`26.3`.
- **Java por faixa**: ≥1.20.5→21, ≥1.17→17, senão 8. Versões >1.21.1 = experimental para o template.

### 4.10 Shader Studio (Pós-MVP Wave 2 — Sessão 13)
- **32 style presets** (`shaderStyleCatalog.ts`): BSL, SEUS, Complementary Reimagined, Photon, Kappa, Solas, Astralex, Fantasy (Unbound), Bliss, Spooklementary, EmanRux, Iteration T, Sundial, UShader, Verlixia, Moz, Nostalgia, CTR, Adistira, Hysteria, Shrimple, SuperDuperVanilla, Sildur's Vibrant, VTXS, N87, Vanilletix, Alpha Piscium, Derivative, Reverie, Ripple, E-Lite + categorias (cinematic/vibrant/natural/dreamy/performance). Cada preset = ~14 params (exposure, contrast, saturation, vibrance, temperature, bloom, godRays, fog, vignette, skyTop/skyHorizon/sunColor, tonemap) validados por `validateStyleParams` (ranges testados).
- **Compliance**: presets evocam looks icônicos com **GLSL 100% original** — nada copiado/redistribuído; cada card linka busca pública do original (`modrinth.com/shaders?q=`). README do pack carrega o mesmo aviso.
- **Gerador** (`shaderPackGenerator.ts`): pack Iris/OptiFire-compat (`shaders/composite.{vsh,fsh}` reais: exposure→tonemap ACES/Reinhard/filmic/linear, grading, bloom threshold 12-tap dual-ring, fog por depth (depthtex0), god rays screen-space (sunPosition→gbufferProjection), sky tint, vignette) + `shaders.properties` + `nexuscraft.json` (manifest lido pelo Rust) + README honesto. Packs são imutáveis (slug duplicado recusado no Rust).
- **Preview WebGL** (`shaderPreviewSource.ts`): cena analítica (céu/sol/montanhas fbm/água animada) com o MESMO pipeline de grading do pack — o que você vê é o que o estilo faz. Fallback honesto sem WebGL.
- **Backend** (`shaders.rs`): create com allowlist de extensões (vsh/fsh/glsl/properties/json), caps 64 arquivos/256KB, path guard compartilhado; list via manifest; install copia para `instances/<slug>/shaderpacks/` (instância preparada = `options.txt` do launcher; `copy_tree` recusa symlinks); delete guardado. Editor de packs usa `read/write_project_file` com rel `shaderpacks/<slug>/...` (zero command novo).
- **UI** (`ShadersPage`): grid com swatch de céu por estilo + filtros de categoria; painel sticky com preview vivo + params + create; seção "Your shaderpacks" (Install→instância via Select, Edit files→Monaco com abas e Ctrl+S, Reveal, Delete com confirm). Rota `/shaders`, sidebar Palette, Topbar, Ctrl+K.

## 5. Histórico de sessões (44 sessões)

| # | Fase | O que foi feito | Bugs caçados |
|---|---|---|---|
| 1 | Planejamento | Briefing 61 seções → 11 ADs, riscos, 8 fases, critérios | — |
| 2 | Fase 0 | Shell + SQLite 18 tabelas + Settings + keyring + palette + ícones | — |
| 3 | Fase 1 + .env | Template embedded + Monaco + FS sandbox + snapshots + wizard | plugin-http inexistente |
| 4 | Fase 2 | Version catalog 2026 + streaming 3 protocolos + AI Creator + Reference Board | OOM Monaco (heap 4GB), reqwest 0.13 features |
| 5 | Fase 3 | Nexus Agent: 12 tools + orchestrator + auditoria + UI timeline | (Mirai Studio revert — prompt errado) |
| 6 | Fase 4 | Build system + Error Center + Auto-Fix + E2E jar compilado | gradlew sem exec-bit |
| 7 | Fase 5 | Launcher completo + E2E 718MB + MSA device flow + Run | serde camelCase (`assetIndex`, `mainClass`) |
| 8 | Fase 6 | Server Studio + E2E ciclo completo + console stdin | `Path::ends_with` não é sufixo, flush stdin |
| 9 | Fase 7 + Quality | GitHub + Dark Kingdom auto + ESLint + Vitest + CI + ErrorBoundary | **família de serialização snake/camel** (6+ tipos) |
| 10 | GitHub publish | gh repo create + push + CI | scope `workflow`, pnpm 9 vs 12 |
| 11 | Pós-MVP Wave 1 | Módulos misturáveis + Token Chain SHA-256 + túnel playit.gg + release.yml | genesis block hash ≠ campos |
| 12 | Verificação total | 28 testes verdes + CI SUCCESS + tag v0.1.0 + Release queued | — |
| 13 | Wave 2: Shader Studio | 32 presets de estilo + gerador GLSL real + preview WebGL + editor Monaco + install em instância | race ledger (família temp-dir), bloomTaps com parênteses faltando |
| 14 | Site + Release público | Causa raiz da release v0.1.0 (mismatch tauri) + cross-env (Windows) + site premium + GitHub Pages + repo PÚBLICO + executáveis multi-OS | mismatch npm↔crate fatal no build, `VAR=x` não existe em cmd.exe |
| 15 | Wave 3: Server Styles + Ícone + Responsividade | Ícone premium v2 (51 variantes) + SLP real em Rust + 10 presets de servidor + import por endereço com MOTD colorido + IA design + referências públicas + sidebar colapsável + v0.1.2 | parser MOTD perdia texto na troca de estilo, keyword "friendly" genérica, § não-ASCII em byte-string, `online-mode` override bloqueado |
| 16 | Wave 4: REBRAND VOXEL | Auditoria primeiro (PROJECT_AUDIT/VOXEL_ROADMAP/OPENCODE) + rename completo de 100 arquivos + `.voxel/` (8 arquivos) + repo → `yuaberry/voxel` + v0.2.0 | migration 001 tocada (revertida), `com.nexuscraft` lowercase fora dos patterns, PKG do site em cascata |
| 17 | Skin "Next" | Reskin do app (tokens/aurora/voxel grid/sidebar glow/splash/Monaco voxel-dark/ícone v3) + site re-pelado + v0.3.0 | — |
| 18 | Phase B: MOBILE | `@voxel/core` extraído + **VOXEL Bridge** (axum, token, console ring, SLP, AI relay — key nunca sai do PC) + Expo SDK 51 (5 abas, pairing) + Settings→Mobile + v0.3.1 | `expo/fetch` inexistente no SDK 51 → polling/ask one-shot; `sceneStyle` não existe no bottom-tabs |
| 19 | Executáveis mobile | **APK Android real** (build completo 17m, apksigner/aapt, publicado) + pipeline iOS (xcarchive unsigned no CI) + workflow mobile-builds | settings.gradle pnpm paths-trick, nodeLinker hoisted, Metro subpath-exports, SDK removido das runners, ANDROID_SDK_ROOT conflito, xcworkspace nasce do pod install |
| 20 | Visão + iOS PWA | Imagem no chat (desktop clip + mobile 📎 + bridge multimodal 3 dialetos) + **PWA embutida no desktop servida pelo bridge** (iOS Add to Home Screen sem App Store) + APK 0.2.0 | react aninhado duplicado quebrando SSR web do Metro |
| 21 | Task force + polimento | NVIDIA NIM + model picker por seleção + **SRV fix do live import** (reproduzido: 49s→2s) + Launcher page + 7 temas + micro-motion + ~/Voxel + migration + CSP real + live preview no console + **Task force multi-agent** (Architect→Developer→Reviewer) + v0.3.3 | shields DDoS só aceitam o alvo SRV; Bungee reporta max=0; TDZ do ESLint (família sessão 9) |
| 22 | Era dos três loaders | **Templates Forge + NeoForge** derivados dos MDKs oficiais (FG6, mods.toml, DeferredRegister, pack.mcmeta factual) + wizard com chips por loader + disponibilidade viva + consistência loader↔template no Rust + **E2E 3/3: fabric/forge/neoforge compilam jar real** + v0.3.4 | wrapper files na raiz do template; `#` não é comentário Groovy; `pkill -f` self-match mata o próprio shell (pattern `"tauri de[v]"`) |
| 44 | HOTFIX congelamento | **Causa raiz**: commands sync rodam na MAIN THREAD (Tauri 2) — server_ping 8-10s × série + polling = UI travada. 4 commands → async+spawn_blocking; polling paralelo e pausa com janela oculta + v0.5.10 | — |
| 43 | Deploy↔build↔pt-BR | **project_deploy_datapack** (datapack do mod no servidor, formato lido do pack real, replace atômico, versões compatíveis) + elapsed no BuildDrawer + pt-BR amp + v0.5.9 | escapes no mcmeta; Date.now() impuro (compiler); building antes da declaração |
| 42 | PT-BR + agent handoff | **i18n honesto** (fallback inglês, setting Auto/EN/PT-BR, nav+títulos+seções traduzidas) + **chat de alterações no Studio** (handoff pro AI Creator, nunca auto-envia) + v0.5.8 | replace de uiStore não casou; togglePalette 0-arg |
| 41 | Correções do dono | Botão criar nunca-morto (feedback do requisito), delete dentro do projeto, **Community servers ao vivo** (SLP 45s + nerdzone.gg), túnel público no wizard, inferência prison/coin/chain + v0.5.7 | botão disabled silencioso; delete escondido no ⋮ |
| 40 | Custom Realm | **8º módulo**: dimensão custom real no datapack do server (era-factual, tests com parse do JSON, UNSUPPORTED honesto p/ 26.x) + Vanilla Survival + realm + v0.5.6 | — |
| 39 | Snapshots agendados + seeds | **snapshot_auto_check** (cadência Off/Diário/Semanal, last-auto.json portátil, boot hook) + seed de monuments do dono no wizard + v0.5.5 | off-by-one de horas (24 vs 23 — o teste ensinou); modules é Set |
| 38 | Restore guiado + presets | **workspace_import_snapshot** (só VOXEL, seções conhecidas, nunca sobrescreve — restore só adiciona) + Creative Workshop+Monuments, Hardcore Realm+Factions + v0.5.4 | import plugin-dialog duplicado |
| 37 | Monuments + Snapshots | **Módulo Monuments** (.nbt reais no datapack do server, /place template via trigger, wizard gera via Rust) + **Workspace Snapshots** (autoria zipada com manifest includes/excludes) + v0.5.3 | guard de output_kind só na escrita (preview vazava); Write trait ausente; imports dupes |
| 36 | Marketplace + editor | **Marketplace local** (modpacks/shaders com swatch real/mods com Play) + **editor de modpack salvo** (manifest re-pack atômico, byte-identical) + agent /place guidance + v0.5.2 | linha de rascunho inválida; read_to_end API; Rgb vs number[] |
| 35 | Era 26.x + presets reais | **6º template** (MDK-26.3-ModDevGradle, MDG 2.0.148, Gradle 9.2.1, Java 25, items/*.json) **E2E com jar real** (SwordItem não existe em 26.x — pescado pelo E2E) + presets skyblock-isles/pvp-arena com os módulos NOVOS de verdade + v0.5.1 | — |
| 34 | 3 módulos de gameplay | **SkyBlock Islands** (16 ilhas construídas, chest NBT, slots literais + cap honesto) + **Factions War** (3 times, kills via statistic real) + **BedWars Lite** (kit/arena/contagem/cama via statistic) + READMEs com tabelas + v0.5.0 | rascunho semi-feito do skyblock detectado na revisão e refeito; replace não casou com dispatch real |
| 33 | /mine real + comandos nos READMEs | **Prison ganha /trigger nexus_mine** (loading personalizada com barras + tp para a mina do rank atual) + **tabelas de comandos nos READMEs** (por módulo, fidelidade contra as mcfunctions + seção vanilla admin) + v0.4.5 | `#` de mcfunction dentro do JS (esbuild pegou); doc de /function inexistente (shop→balance) |
| 32 | Documentação viva + research 26.x | **README próprio nos 3 níveis**: servers (fatos do properties + objetivos/comandos dos módulos), modpacks (README no zip + guia por loader + import aceita), mods (guia de instalação ×5 templates) + **era 26.x mapeada** (NeoForgeMDKs/MDK-26.3, MDG 2.0.148, Java 25, Gradle 9.2.1) + v0.4.4 | #[test] duplicado empilhado (harness duplicava o teste → race); import recusava README; push char/str; assert vs markdown |
| 31 | Dimensions modernas + Library | World Studio **1.21.2-1.21.8** (flatten de int providers por era, testado byte-a-byte) + **Modpack Library** (modpack_list lê manifests dos zips; install 1-clique, reveal, delete guardado) + v0.4.3 | replace python não casou `json!(` (teste pegou); &str vs String; pkill self-match com daemon Java; --quiet escondendo erros de compilação |
| 30 | Agent structures + World | **Tool generate_structure no agent** (orçamento+snapshot, princípio "make it REAL") + **World Studio v1**: dimensões custom datapack (dimension_type+dimension, 4 presets, 1.21.2+ recusado) + 4ª tab no Studio + v0.4.2 | `serde_json::json!` corrupto por replace; assert torto pré-build |
| 29 | Structure Studio + Visual | **Estruturas .nbt reais** (NBT writer próprio, 4 templates determinísticos, DataVersion por era, pasta por versão) + **preview isométrico canvas** + tab Structure no Studio + **títulos brand-gradient em todas as páginas + EmptyState com arte pixel** + v0.4.1 | chaminé fora do size (bound assert); u32→i32 negativo no rubble; compiler de novo (useCallback desfeito) |
| 28 | Era ModDevGradle | **5º template** (MDG 2.0.91, neoForge{} DSL, neoforge.mods.toml em templates/, data formats 1.21, wrapper 8.14.2) cobrindo 1.21.4-1.21.8 + catalog por era + **E2E REAL 5/5** + v0.4.0 | `FMLJavaModLoadingContext` sumiu (injeção no @Mod); `Tiers`→`ToolMaterial`; 1.20.2 sem data files (cp silencioso); OOM transitório do NeoForm |
| 27 | Grafo + Blocos + Push mobile | **Resolver de dependências** (BFS required, optional skipped, incompatible falha, cap 25, 6 testes) + **block textures** (bricks/planks/ore/panel, asset_kind enforced) + **mobile 0.3.1** (notifications de build, watcher honesto) + v0.3.9 | aspas duplas em strings JS via python-replace (2×); handler SDK 51 vs 52; imports órfãos |
| 26 | Modpack v3: Modrinth | **Catálogo externo oficial**: busca via API pública (facets MC+loader reais) + download SHA-1-verified no perímetro (allowlist host exato, cap 256MB) + card no Modpacks + **E2E real com fabric-api vivo** + v0.3.8 | guard recusava `+` Maven no filename (E2E pegou); `getState()` em useMemo quebra o React Compiler; import órfão |
| 25 | Studio + Score + Secure | **Asset Studio** (7 receitas 16x16 no Rust, agent tool, /studio) + **Compatibility Score** (manifests lidos dos jars, parser Maven+SemVer, bug de fronteira corrigido) + **mobile 0.3.0** (secure-store + biometria honesta) + v0.3.7 | validated_path exige parent (ordem do guard); intersect equal-boundary (bug real); prebuild apagou local.properties; escape python corrupto |
| 24 | Assets + Modpacks v1 | **Sprites premium** (char-map pixel art: darksteel sword, Voxel Gem, mod icon 128) nos 4 templates + **Modpack Creator v1** (export/import real com manifest camelCase, workspace guards, zip-slip, fatos dos records) + rota /modpacks + v0.3.6 | en_us.json faltava no template 1.20.2 (cp silencioso); `<name>` literal engolido pelo parser JSX; manifest com fatos reais (não placeholders) |
| 23 | Router + Notifications + NeoForge Moderno | **Model Router por fase** (phaseModels, provider/key global) + **desktop notifications** (plugin-notification 2.6.0 same-minor; build exit + fim da task force; no-op honesto sem permissão) + **template NeoGradle 7** (repo oficial neoforged/MDK@1.20.2; 1.20.2-1.21.1 incl. LTS; wizard escolhe a era) + **E2E 4/4** + v0.3.5 | permission é `notification:` (singular); `registerItem(String, Function<Props,Item>)` é a assinatura 20.2 (Supplier não existe); `register()` retorna DeferredHolder |

## 6. Decisões-chave (respeitar SEMPRE)

1. **No fake data** — features pendentes recebem interfaces reais com TODO ou páginas de roadmap honestas.
2. **Rust = perímetro de segurança** — todo FS/processo/segredo passa por commands validados com path guard/allowlist.
3. **Serialização camelCase**: Rust `#[serde(rename_all = "camelCase")]` em TODOS os results → TS lê camelCase. **NÃO reintroduzir bug snake/camel!**
4. **Migrations append-only** — nunca editar uma publicada.
5. **Allowlist de processos** — sem shell, args de array. Tokens: keyring sempre.
6. **Device flows legítimos** — MSA e GitHub, client_id configurável. **Nunca bypass de auth/DRM.**
7. **Downloads oficiais com checksum** — nada redistribuído.
8. **E2E culture** — todo sistema crítico ganha teste `#[ignore]` executado de verdade. Bug → reproduzir → corrigir → teste que cubra.
9. **Orçamentos do agente** — ≤8 steps, ≤30 writes, destrutivos com confirmação UI.
10. **Esquema versões 2026** — `26.x` sem yarn → mojmap; `1.x` com yarn; >1.21.1 experimental.
11. **Template embedded** (`include_bytes!`) — determinístico em dev/release.
12. **Token Chain compliance** — moeda interna do jogo, sem valor monetário. Externo = `ChainProvider` reservada.

## 7. Bugs caçados (18 total — NÃO re-introduzir)

| Bug | Como foi achado | Fix |
|---|---|---|
| gradlew sem exec-bit | E2E gradle (PermissionDenied) | chmod 755 pós-render |
| serde camelCase (`assetIndex`, `mainClass`) | E2E launcher | `rename_all = "camelCase"` |
| `Path::ends_with(".zip")` compara componentes | E2E server | `.file_name().ends_with()` |
| flush faltante no stdin stop | E2E server 3× | `write_all + flush()` |
| **Família snake/camel serialização** | Validação viva (logs table) | TODOS os types TS → camelCase |
| OOM vite build (Monaco) | Build crash | heap 4GB NODE_OPTIONS |
| reqwest 0.13 mudou features | cargo add | usar rustls default |
| listener race do build | Revisão fase 5→6 | listeners ANTES do spawn |
| stale closures customJava/refreshContext | ESLint hooks v6 | deps corrigidas |
| vitest 5 exige vite 6 | ERR_PACKAGE_PATH | vitest@2 |
| eslint 10 exige node 20 | util.styleText | eslint@9 |
| plugin-http fetch em api/core | typecheck | import de plugin-http |
| StrictMode double-mount exemplo | Validação viva | idempotência (adota pasta existente) |
| Java 21 trava shutdown vanilla 1.20.1 | E2E server (hang) | fallback force 30s + aviso UI |
| Race temp-dir entre testes | cargo test flaky | bases com label único |
| CI pnpm 9 vs workspace yaml | 1ª rodada GitHub | version: 12 |
| Push sem scope `workflow` | gh token | device-flow refresh |
| Genesis block hash ≠ campos serializados | teste verify falhou | hash dos campos finais (struct-update) |
| **Race temp-dir ledger** (base compartilhada + remove_dir_all em testes paralelos, 1-in-5 flaky) | cargo test 10x após o sintoma | base_dir(label) por teste (mesma família fs.rs) |
| **bloomTaps: 3 `(` vs 2 `)`** — GLSL gerado não compilaria in-game | teste de paridade no gerador | sanidade (braces/parens/tokens) em TODO GLSL gerado |
| **Mismatch @tauri-apps npm↔crate** (api 2.9 vs tauri 2.12; plugins 2.7.3/2.4.1/2.7.0 vs 2.8/2.5/2.8) — warning no dev, **FATAL no `tauri build`** (derrubou a release v0.1.0 em TODAS as plataformas) | log do job de release no GitHub | deps alinhadas (api 2.12, plugins same-minor, cli 2.12) |
| **`NODE_OPTIONS=… vite build` inline** — sintaxe sh-only; cmd.exe do runner Windows: `'NODE_OPTIONS' is not recognized` → beforeBuildCommand morria antes do vite | log do job Windows (exit 1 em 66s) | `cross-env NODE_OPTIONS=…` (portátil nas 3 plataformas) |
| **Parser MOTD perdia texto na troca de estilo** — só dava flush no fim, então `§bAqua §lBold§r plain` virava só " plain" | teste vitest do parser (part[0] errado) | flush do texto acumulado a CADA mudança de estado de estilo (comportamento fiel do jogo) |
| **Keyword heurística genérica** — "friendly" solta casava "Friendly SMP survival" como family-craft | teste de inferência | keywords compostas ("family friendly") |
| **§ não-ASCII em `br#"…"#`** — Rust byte-string exige ASCII | cargo test não compilava | string normal + `.as_bytes()` |
| **`online-mode` via properties** — presets nunca podem desligar | teste Rust dedicado | merge Rust descarta a key explicitamente (defense in depth no server_create) |

## 8. Estado atual (verificado — Sessão 44, v0.5.10)

### Testes (TODOS verdes)
| Suíte | Resultado |
|---|---|
| Rust unit (67) | ✅ template×3 loaders (render+consistência), ledger+tamper, shaderpack, SLP parse, **bridge multimodal/PWA/dialects**, server presets merge |
| Vitest (77) | ✅ 32 shaders, gerador GLSL, errorParser, serverModules, **task-force personas + read-only toolset**, **loader availability + maven ranges** |
| E2E gradle | ✅ jar compilado (Sessão 12) |
| E2E launcher | ✅ 3.695 arquivos SHA-1 (Sessão 12) |
| E2E server | ✅ boot→stop→backup→restore (Sessão 12) |
| E2E SLP multi-server | ✅ Hypixel + CubeCraft + **Minemen via SRV** (reprodução do bug do dono) |
| **E2E compilação ×6 templates** | ✅ **fabric 158s · forge 339s · neo-legacy 170s · neo-NG7 854s · neo-MDG 64s · neo-26.x 71s(warm)/19min(1ª) — todos produzem dark_kingdom-0.1.0.jar real** (Sessões 22-35) |
| Typecheck / ESLint | ✅ 0 errors (warns set-state-in-effect = backlog família conhecida) |
| Mobile typecheck | ✅ `pnpm --filter @voxel/mobile typecheck` (CI verde) |
| Vite build | ✅ resolve @voxel/core via workspace |
| Boot smoke | ✅ vivo com CSP ativa, 0 violações |

### Releases publicadas (tudo HTTP 206)
| Tag | Conteúdo |
|---|---|
| **v0.5.10 (latest)** | Desktop: **HOTFIX congelamento da área de Servidores** + APK mobile 0.3.1 |
| v0.5.9 | Desktop: **deploy projeto↔servidor + build elapsed + pt-BR amp** + APK mobile 0.3.1 |
| v0.5.8 | Desktop: **Português (Brasil) no app + chat do agente no Studio** + APK mobile 0.3.1 |
| v0.5.7 | Desktop: **correções do dono + community servers ao vivo + túnel no wizard** + APK mobile 0.3.1 |
| v0.5.6 | Desktop: **Custom Realm (dimensões nos servers)** + APK mobile 0.3.1 |
| v0.5.5 | Desktop: **snapshots automáticos + monument seed do dono** + APK mobile 0.3.1 |
| v0.5.4 | Desktop: **restauração guiada de snapshot + presets com módulos novos** + APK mobile 0.3.1 |
| v0.5.3 | Desktop: **Monuments (.nbt nos servidores) + Workspace Snapshots** + APK mobile 0.3.1 |
| v0.5.2 | Desktop: **Marketplace local + modpack editor + agent /place guidance** + APK mobile 0.3.1 |
| v0.5.1 | Desktop: **era 26.x (6º template E2E) + presets com módulos reais** + APK mobile 0.3.1 |
| v0.5.0 | Desktop: **SkyBlock + Factions + BedWars Lite** + APK mobile 0.3.1 |
| v0.4.5 | Desktop: **/mine real no Prison + command tables nos READMEs** + APK mobile 0.3.1 |
| v0.4.4 | Desktop: **self-documenting servers/modpacks/mods** + APK mobile 0.3.1 |
| v0.4.3 | Desktop: **dimensions 1.20.1-1.21.8 + Modpack Library** + APK mobile 0.3.1 |
| v0.4.2 | Desktop: **agent structures + World Studio (dimensões reais)** + APK mobile 0.3.1 |
| v0.4.1 | Desktop: **Structure Studio (.nbt real + preview iso) + polimento visual** + APK mobile 0.3.1 |
| v0.4.0 | Desktop: **era ModDevGradle (1.21.4-1.21.8) — 5º template E2E** + APK mobile 0.3.1 |
| v0.3.9 | Desktop: **dependency graph + block textures** + **APK mobile 0.3.1 (build notifications)** |
| v0.3.8 | Desktop: **Modrinth catalog (SHA-1-verified installs)** + APK mobile 0.3.0 |
| v0.3.7 | Desktop: **Asset Studio + Compatibility Score** + **APK mobile 0.3.0 (secure-store + biometria)** |
| v0.3.6 | Desktop: **sprites premium nos templates + Modpack Creator v1 (export/import)** + APK mobile 0.2.0 replicado |
| v0.3.5 | Desktop: **NeoForge moderno (1.20.2-1.21.1) + Model Router por fase + desktop notifications** + APK mobile 0.2.0 replicado |
| v0.3.4 | Desktop: templates Forge + NeoForge + wizard 3 loaders |
| v0.3.3 | Desktop: NIM, model picker, SRV, Launcher, temas, ~/Voxel, CSP, live preview, **Task force** |
| v0.3.2 | Bridge multimodal + PWA iOS + APK 0.2.0 |
| v0.3.1 / v0.3.0 / v0.2.0 / v0.1.x | histórico — desktop com Bridge, skin Next, rebrand, multi-OS original |

**Assets por release**: `.exe`+`.msi` (Win) · `.deb`+`.AppImage` (Linux) · `.dmg` arm64+x64 (macOS) · `VOXEL-mobile-0.2.0-android.apk` · iOS via **PWA servida pelo Bridge** (`http://seu-pc:3717` → Add to Home Screen) + xcarchive unsigned no CI.

### Workflows (todos verdes)
`ci.yml` (desktop+core, com --filter) · `release.yml` (multi-OS, tags v*) · `pages.yml` (site) · `mobile.yml` (typecheck) · `mobile-builds.yml` (APK no CI + xcarchive iOS, dispatch + tags `mobile-v*`)

### Comandos de verificação
```bash
cd ~/nexuscraft-studio
pnpm verify                         # typecheck + lint + vitest + vite build
cd src-tauri && cargo test          # 67 unit
cargo test -- --ignored --nocapture # 10 E2E (compilação ×6 templates, launcher, server, SLP, modrinth real) (compilação ×4 templates, launcher, server, SLP real)
pnpm --filter @voxel/mobile typecheck
gh run list --limit 4               # CI/Pages/Mobile/Release status
```

### Observabilidade / estado de runtime
- DB: `~/.config/dev.yuadevs.nexuscraft-studio/nexuscraft.db` (18 tabelas)
- Workspace default: **~/Voxel** (legacy ~/NexusCraft → migration one-click em Settings→Storage)
- Bridge: opt-in Settings→Mobile, token 8 chars, porta 3717, serve a PWA + API token-gated

## 9. Roadmap pós-MVP (priorizado — o que ainda pode ser construído)

1. ~~Forge & NeoForge templates~~ → **ENTREGUE (Sessões 22-23)**: os quatro templates compilam jar real (E2E), incluindo a era NeoGradle 7 (1.20.2-1.21.1). Próximo natural do braço Java: era ModDevGradle (1.21.4+) quando for a hora
2. ~~Model Router por fase~~ → **ENTREGUE (Sessão 23)**: phaseModels por fase, provider/key global (multi-key por provider = extensão futura honesta)
3. ~~Push notifications (desktop)~~ → **ENTREGUE (Sessão 23)**: build exit + fim da task force, com permissão honesta. Mobile push = ainda futuro (precisa Expo notifications + backend)
4. **Mobile polish** (§59) — secure-store do token, biometria, APK com keystore de release (Play Store), TestFlight quando houver conta Apple
5. **Modpack Creator** → v1 (S24: export/import) · v2 (S25: score) · v3 (S26: catálogo Modrinth SHA-1) · **v4 ENTREGUE (S27): grafo transitivo required**. Restam: CurseForge (precisa API key do dono) e um editor visual de modpack salvo
6. ~~Resource Pack / World / Structure Studios~~ → items (S25), blocks (S27), structures .nbt + preview iso (S29), **agent tool de structures + custom dimensions (S30)** entregues. Restam: schema de dimensions 1.21.2+, resource packs completos
7. **Módulos de servidor** → **8 entregues**: Economy/Prison/Token (S11) + SkyBlock/Factions/BedWars (S34) + Monuments (S37) + **Custom Realm (S40: dimensão real)**. Próximas fatias: módulos 2.0 combinados (realm+monuments), push externo
8. **Docker + Deployment Providers** (§44-45) — VPS/SSH/cloud (`DeploymentProvider` reservada)
9. **Marketplace** (§48) e **Cloud opcional (Supabase)** (§85) — arquiteturas preparadas
10. **Backlog de qualidade**: migrar warns `set-state-in-effect` (~20), auto-refresh de sessão MSA/GitHub, `@tauri-apps/api` mismatch (CLI de dev reescreve Cargo.toml com `features = []` — neutro; reverter após `tauri dev`)

### Entregues nesta era (não refazer!)
- ✅ Shader Studio (32 presets, gerador real, preview WebGL, editor, install) — Sessão 13
- ✅ Multi-agent Task force (Architect→Developer→Reviewer, read-only em código) — Sessão 21
- ✅ Launcher page (Play-first, mods/shaders por instância) + live preview de servidor no console — Sessão 21
- ✅ Mobile completo: @voxel/core + Bridge + Expo (APK 0.2.0 publicado) + PWA iOS instalável + xcarchive no CI — Sessões 18-20
- ✅ Visão no chat (desktop + mobile + bridge 3 dialetos) — Sessão 20
- ✅ NVIDIA NIM + model picker por seleção — Sessão 21
- ✅ SRV resolution no live import (bug do dono reproduzido e corrigido) — Sessão 21
- ✅ 7 accents + micro-motion + ~/Voxel + migration + CSP real — Sessão 21
- ✅ Site premium + GitHub Pages + repo público + releases multi-OS — Sessões 14/17
- ✅ Templates Forge + NeoForge (MDKs oficiais, E2E 3/3) — Sessão 22
- ✅ NeoForge Moderno NeoGradle 7 (repo oficial, E2E 4/4) + Model Router (§66) + Desktop notifications (§62) — Sessão 23
- ✅ Sprites premium nos templates (pixel art artesanal) + Modpack Creator v1 (export/import) — Sessão 24
- ✅ Asset Studio items + blocks (agent tool com asset_kind) + Compatibility Score (manifests dos jars) + mobile secure-store/biometria — Sessões 25+27
- ✅ Grafo de dependências Modrinth (required/optional/embedded/inclusive honesto) + mobile build notifications — Sessão 27
- ✅ Era ModDevGradle (5º template, data formats 1.21, injeção @Mod, ToolMaterial) — Sessão 28
- ✅ Structure Studio (.nbt vanilla real, 4 templates, preview iso) + brand-gradient titles + EmptyState art — Sessão 29
- ✅ Agent structures (tool generate_structure) + World Studio (dimensões custom datapack) — Sessão 30
- ✅ World Studio na era moderna (1.21.2-1.21.8, flatten provado) + Modpack Library (export→manage→install) — Sessão 31

## 10. Regras de operação com o dono

- Dono fala PT-BR; responder em PT-BR com relatório final estruturado (o que fez, provas, próximo passo).
- Verificação real após cada mudança: typecheck/build/testes/boot — nunca pular.
- Commits em unidades lógicas (conventional), inglês, explicando o porquê.
- **Prompt errado de outro projeto?** Desconsiderar, apagar artefatos, verificar zero contaminação (grep), seguir.
- **Adendos permanentes**: version catalog auto-update; Plan.md = memória pós-compactação (este arquivo).
- **Qualidade > velocidade**: E2E executado, bug reproduzido antes de fix, teste novo cobrindo o bug.
- Dono quer "algo que funciona, não apenas um esqueleto" — sempre provar com teste real.

## 11. Mapeamento de fases

| Fase | Conteúdo | Status |
|---|---|---|
| 0 | Shell + SQLite + Settings + Secrets + Palette | ✅ |
| 1 | Projects Core (template embedded, Monaco, snapshots) | ✅ |
| 2 | AI Creator + Version Catalog 2026 + streaming | ✅ |
| 3 | Nexus Agent (12 tools, policy 3 camadas, auditoria) | ✅ |
| 4 | Build System (E2E jar) + Error Center + Auto-Fix | ✅ |
| 5 | Launcher (E2E 718MB) + MSA device flow + Run | ✅ |
| 6 | Server Studio (E2E ciclo) + backups + console stdin | ✅ |
| 7 | GitHub publish + Dark Kingdom + Quality (ESLint/Vitest/CI) | ✅ **MVP COMPLETO** |
| Wave 1 | Módulos misturáveis + Token Chain SHA-256 + Túnel grátis + Release multi-OS | ✅ |
| Wave 2 | Shader Studio (32 presets, gerador GLSL real, preview WebGL, editor) | ✅ |
| Próximo | Modpack Creator / Forge+NeoForge templates / mais módulos / Resource Pack Studio | 🟡 |

## 12. Protocolo de Retomada (executar após ler este arquivo)

1. **`cd ~/nexuscraft-studio && git log --oneline | head -20 && git status --short`** — confirme estado limpo e commits.
2. **`pnpm typecheck && pnpm lint && pnpm test:unit`** e **`cd src-tauri && cargo test`** — tudo verde antes de qualquer mudança.
3. Leia `README.md` + `docs/architecture.md` + este arquivo de novo se necessário.
4. **NÃO reescrever sistemas existentes** — seguir princípios (§6) e o briefing original.
5. Se o dono pedir feature nova: planejar dentro das regras (§6), implementar incrementalmente, verificar (E2E quando couber), commitar, relatar.
6. Se o dono disser **"crie o arquivo Plan.md"**: atualizar ESTE documento com tudo que aconteceu desde a última versão (novas sessões em §5, novos bugs em §7, novos itens em §9) e commitar.
7. **Checklist antes de tocar código**: typecheck verde? cargo test verde? lint zero errors? git status limpo? Então pode.

---

## 13. Sessão 13 — Shader Studio (Pós-MVP Wave 2)

**Pedido do dono**: "Atualize a área de criação de Shaders para o Minecraft com os seguintes templates: [32 shaders icônicos: BSL, SEUS, Complementary Reimagined, Solas, Photon, Kappa, Astralex, Fantasy, Fantasy Unbound, Bliss, Spooklementary, EmanRux, Iteration T, Sundial, UShader, Verlixia, Moz, Nostalgia, CTR, Adistira, Hysteria, Shrimple, SuperDuperVanilla, Sildur's Vibrant, VTXS, N87, Vanilletix, Alpha Piscium, Derivative, Reverie, Ripple, E-Lite]"

**Decisão de compliance (crítica)**: esses 32 são shaderpacks REAIS da comunidade com licenças próprias. Seguindo §6.1 (no fake data) e §6.7 (nada redistribuído), o Shader Studio entrega **style presets** — GLSL 100% original do nosso engine, com ~14 params afinados para evocar cada look — + link de busca pública do original (crédito honesto). Nada baixado, nada copiado.

**Entregue** (detalhe funcional em §4.10):
- `shaderStyleCatalog.ts` — 32 presets, 5 categorias, ranges validados (+8 testes)
- `shaderPackGenerator.ts` — pack Iris/OptiFire-compat REAL (composite pass com bloom/fog/god rays/grading) + manifest + README honesto (+7 testes, incl. sanidade de parênteses que pegou bug REAL)
- `shaderPreviewSource.ts` + `ShaderPreviewCanvas.tsx` — preview WebGL vivo com o grading exato do pack
- `shaders.rs` (5 commands, guards + 5 testes Rust) + `shaderpacks/` no workspace
- `ShadersPage` + `ShaderPackEditor` (Monaco, Ctrl+S via workspace guard)
- Navegação completa (/shaders, sidebar, Ctrl+K, Topbar)

**Bugs caçados na sessão**: (1) race do ledger (flaky 1-in-5 → base por label, 10x verde); (2) bloomTaps gerava GLSL com parênteses faltando — o pack NÃO compilaria in-game; teste de paridade permanente agora. (3) `validated_path` com parent inexistente no create_pack → materializar pastas antes de validar o arquivo.

**Observação de ambiente**: `tauri dev` CLI reescreve `Cargo.toml` (`tauri = "2.12.0"` → `{ version = "2.12.0", features = [] }`, neutro) por causa do mismatch `@tauri-apps/api` 2.9 vs crate 2.12 — revertido, item no backlog §9.10.

**Verificação**: cargo 18/18 (+5x flaky-check) · vitest 28/28 · typecheck/lint 0 errors · vite build 1m50s · boot vivo sem crash.

---

## 14. Sessão 14 — Site oficial + Release público multi-OS

**Pedido do dono**: "crie e melhore o Site para algo extremamente bonito que diga o espaço do Projeto… também faça o arquivo executável para todos os Sistemas Operacionais (Windows - .EXE, LINUX, MAC OS, ETC) e publique no Site e no GitHub para download."

**Descoberta crítica — por que a release v0.1.0 NUNCA saiu**: o run da tag v0.1.0 (sessão 12) falhou silenciosamente em TODAS as plataformas. Causa raiz: `tauri build` **hard-erra** quando pacotes npm e crates divergem na minor (`@tauri-apps/api` 2.9 vs `tauri` 2.12; plugin-dialog 2.7.3 vs 2.8.0; plugin-sql 2.4.1 vs 2.5.0; plugin-http 2.7.0 vs 2.8.0). O "version mismatched" que aparecia como warning no `tauri dev` local era FATAL no build. Fix: todas as deps npm alinhadas (api 2.12, plugins same-minor, cli 2.12).

**Segundo bug de release (Windows)**: `"build": "NODE_OPTIONS=… vite build"` — sintaxe `VAR=value` é sh-only; o cmd.exe do runner Windows recusou (`'NODE_OPTIONS' is not recognized`) e o beforeBuildCommand morreu em 66s, antes do vite. Fix: `cross-env NODE_OPTIONS=…`. Log do runner foi a prova.

**Entregue**:
- **v0.1.1** em todos os lugares (tauri.conf, package.json, Cargo.toml, AboutDialog); bundle targets + `nsis` (setup.exe clássico no Windows) + `dmg` (macOS)
- **Site oficial artesanal** (`website/`: index.html 335l + styles.css 651l + main.js 185l + favicon.svg — zero frameworks): hero com logo animado + OS-detect no CTA, pipeline de 7 passos, 6 feature cards, mockup interativo do app (tabs Home/Shaders/Servers com mini-preview de shaders clicável), grid com os 32 swatches REAIS do catálogo (cores extraídas por script), cards de download por OS, stats, footer legal. Reveal-on-scroll com IntersectionObserver, prefers-reduced-motion, responsivo.
- **GitHub Pages**: workflow `pages.yml` (deploy automático em push de `website/**`) + Pages habilitado via API (`build_type=workflow`) → https://yuaberry.github.io/nexuscraft-studio/ (validado: 200 + DOM renderizado com 32 swatches e links)
- **Repo tornado PÚBLICO** (decisão implícita do pedido: downloads públicos; `gh repo edit --visibility public`) — description + homepage atualizadas
- **HomePage do app**: linha de stats reais do workspace (projetos/shaderpacks/servers/instâncias — dados vivos, tiles clicáveis)
- **README refresh**: badges CI/Release, links do site e downloads, tabela com Wave 1+2, números reais (46 testes)
- **Nomes REAIS dos assets** (o tauri sanitiza espaços do productName para PONTO): `VOXEL.Studio_0.1.1_{arch}…` — confirmado contra a release parcial e corrigido no main.js

**Re-tag**: a 1ª tentativa v0.1.1 publicou 6 assets (macOS aarch64/x64 .dmg+.app.tar.gz, Linux .deb/.AppImage) mas faltou Windows → release+tag deletadas e re-tagged no commit do cross-env para uma release íntegra de um único commit.

**URLs públicas**:
- Site: https://yuaberry.github.io/nexuscraft-studio/
- Repo: https://github.com/yuaberry/nexuscraft-studio (público)
- Downloads: https://github.com/yuaberry/nexuscraft-studio/releases/latest

**Verificação da sessão**: typecheck ✓ · lint 0 errors ✓ · vitest 28/28 ✓ · cargo 18/18 ✓ · vite build (cross-env) ✓ · CI main ✓ · Pages deploy ✓ · site validado por DOM dump ✓ · **Release v0.1.1: SUCCESS** — 4 jobs verdes (macOS arm64 7m45s, macOS x64 5m32s, Ubuntu 4m29s, Windows), **8 assets publicados e validados por HTTP 206**: `VOXEL.Studio_0.1.1_x64-setup.exe` (9.3MB) + `.msi` (11.9MB) · `.deb` (13.5MB) + `.AppImage` (87.4MB) · `.dmg` aarch64 (12.8MB) + x64 (13.3MB) + 2× `.app.tar.gz`.

---

## 15. Sessão 15 — Ícone premium + Server Styles + Import por link + Responsividade (Wave 3)

**Pedido do dono**: "crie uma imagem/logo para os executáveis… verifique se não tem nenhum erro… adicione mais funções e termine… responsividade total… importar Estilos de Servidores já prontos (oficiais e não oficiais)… o usuário coloca o LINK do servidor e a IA pega esses DADOS e trabalha em cima, como mockups pré-prontas… referências com link de servidores… nível profissional".

**Entregue**:

1. **Ícone premium v2** (`scripts/generate_icon_v2.py`, Pillow, 4x supersampling): mark 3D com gradientes por face, nós cyan neon, bloom ambiente, drop shadow, edge highlight — via `pnpm tauri icon` gerou as 51 variantes (ico/icns/pngs/ios/android). É o ícone de TODOS os executáveis v0.1.2+.

2. **Server List Ping REAL em Rust** (`serverping.rs`): protocolo SLP completo (VarInt framing, handshake status state, JSON payload) — o mesmo handshake de qualquer launcher, zero scraping. Resolve endereço + `connect_timeout` 5s; extrai version/protocol/players/MOTD/favicon/modinfo; chat components achatados + raw preservado. **E2E `#[ignore]` provado ao vivo contra mc.hypixel.net (20.023 players)**. 5 testes unit (varint roundtrip, wire format, parse full/legacy, garbage).

3. **10 Server Style Presets** (`serverPresets.ts`): official (Vanilla Survival, Paper Survival, Creative Workshop) + community (Hardcore Realm, SkyBlock Isles, Prison Break, Economy Town, PvP Arena, Family Craft, Token Tycoon). Cada preset = software + RAM + properties + módulos datapack. **Compliance**: são configurações NOSSAS que evocam estilos conhecidos — nada de plugins/lojas de terceiros redistribuído.

4. **Properties override no `server_create`** (servers.rs): parâmetro `properties` com merge validado (formato de keys, sem newline em values) — `curated_properties()` pura testada; **`online-mode` JAMAIS é overridável** (teste dedicado).

5. **Import por endereço/link** (`ImportServerPanel`): input aceita `host`, `host:porta`, `https://site…` → ping real → preview com **MOTD renderizado com as cores reais** (parser completo: § codes, §x hex, chat components com named colors/bold/italic/underline/strikethrough), favicon, players, latency, mods. Inferência determinística (`inferPresetFromPing`: keywords MOTD/versão → preset) com botão "Create local server in this style" que abre o wizard pré-preenchido (properties incluem o MOTD do servidor original como homenagem).

6. **IA design** (`designStyleWithAi`): manda os dados REAIS do ping pro provider configurado (via `streamChat`) → JSON validado (styleName, software, properties, modules com allowlist, rationale) → sanitizado (online-mode removido) → aplicável no wizard. Botão desabilitado com hint quando AI não está configurada (honesto).

7. **Referências públicas** (`publicServers.ts`): 6 entradas reais (Hypixel, CubeCraft, Minemen, Minehut, Aternos, exaroton) com os endereços que os próprios autores publicam + sites — pingáveis AO VIVO no painel (offline mostra offline, nunca mentira).

8. **Responsividade total**: sidebar colapsável para ícones (auto via `matchMedia(max-width: 1100px)` + toggle manual), window minimums 1280×720 → **1000×640**, wizard com grids `sm:grid-cols`, painel import `lg:grid-cols`.

**Bugs caçados** (5, ver §7): parser MOTD flush, keyword genérica, § não-ASCII, assertion wire-format, online-mode override.

**Testes**: cargo **27/27** (+4 properties, +5 SLP) + 2 E2E ignored novos (SLP real — provado) · vitest **44/44** (+16: MOTD/address/presets/referências/inferência/AI sanitize) · typecheck/lint 0 errors · boot vivo.

**Release v0.1.2**: tag com ícone novo + todas as features; site atualizado para os links v0.1.2.

---

*Última atualização: Sessão 44 — HOTFIX: commands síncronos bloqueavam a main thread (server_ping 8-10s em loop serial = congelamento total). server_ping/server_status/launcher_overview/modpack_list agora async+spawn_blocking; polling paralelo e pausado com janela oculta. 77/77 + 67/67. Release v0.5.10.*

---

## 16. Sessão 16 — REBRAND VOXEL (Wave 4) + Auditoria + Roadmap

**Pedido do dono**: briefing de 115 seções — o produto passa a se chamar oficialmente **VOXEL** ("AI-Powered Creation Platform", tagline "Imagine. Create. Build. Play."). §113: AUDITAR ANTES DE ALTERAR; §111: Fase 1 = rename + audit; §80: atualizar branding visível sem quebrar IDs internos; §104: nada de fake.

**Auditoria primeiro (docs novos)**:
- **`docs/PROJECT_AUDIT.md`** — arquitetura, stack, inventário do que funciona (com provas), placeholders honestos, dívidas P1-P7, plano incremental e riscos
- **`docs/VOXEL_ROADMAP.md`** — briefing §111 mapeado: cobertura de hoje (40+ seções já entregues) + Fases A-F (core extraction/mobile, creation breadth, server ops, multi-agent, platform)
- **`docs/OPENCODE.md`** — agentes (architect/builder/reviewer/debugger), gates de verificação, invariantes (§106-108)

**Rebrand executado (100 arquivos analisados, replacements cirúrgicos com proteções)**:
- UI completa: wordmark "VOXEL", splash, About, settings, agent "Nexus Agent"→"VOXEL Agent" (9 refs), legal §82, tagline/description oficiais
- `productName: "VOXEL"` (assets passam a `VOXEL_<v>_*`) · package.json `name: "voxel"` · default Java package `com.voxel.*` para novos projetos
- **`.voxel/` project memory** (§15-16): template bootstrapa os 8 arquivos (project-spec, ai-memory, style-bible, lore-bible, gameplay-bible, architecture, asset-index, decisions); contextService lê `.voxel` primeiro com **fallback `.nexus`** (projetos antigos como o Dark Kingdom sobrevivem); Reference Board → `.voxel/references/`; SpecPreview salva onde o spec vive (dual-path); system prompt carrega 6 contextos + menciona os outros 2
- Shaderpack manifest → `voxel.json` com read-fallback `nexuscraft.json` (packs antigos continuam listando e editáveis)
- Workspace default: `~/VOXEL` para novos; **`~/NexusCraft` existente é auto-detectado e mantido** (zero data loss)
- **Repo GitHub renomeado** → `yuaberry/voxel` (redirect ativo; Pages auto-mudou para `yuaberry.github.io/voxel/`)
- **IDs preservados por design** (audit P4 + briefing §80): identifier, DB filename, crate name, namespaces `nexus_*` (mundos existentes), migration 001 (append-only — o batch chegou a tocar um comentário; REVERTIDA)
- Site: URLs novas, tagline, nav, PKG corrigido pós-cascata ("VOXEL.Studio" → "VOXEL")

**Bugs caçados**: (1) migration 001 tocada pelo batch → revertida (append-only); (2) `com.nexuscraft` lowercase fora dos patterns do batch → varredura e fix global (tests fixtures + asserts de path); (3) teste do template quebrado com `.nexus/project-spec.json` → `.voxel/`; (4) PKG do site em cascata.

**Verificação**: typecheck ✓ · lint 0 errors ✓ · vitest 44/44 ✓ · cargo 27/27 ✓ (template .voxel + com.voxel validados) · vite build 5m04s ✓ · boot vivo 0 panics ✓ · CI verde · Pages SUCCESS no novo URL (DOM validado) · release v0.2.0 em andamento no fechamento desta sessão.

**Estado pós-sessão**: produto = **VOXEL 0.2.0**; todas as Waves 1-3 funcionando sob o novo nome; próximo passo natural = Fases B+ do VOXEL_ROADMAP (packages/core extraction quando mobile começar; Forge/NeoForge templates; multi-agent personas).

---

## 17. Sessão 17 — VOXEL "Next" skin (reskin completo do app + site)

**Pedido do dono**: "refaça o aplicativo com o nome Voxel sem desfazer nada, com um novo visual. o site também quero um novo visual." → **Reskin cirúrgico: pele nova, zero funcionalidade tocada** (briefing §8 VOXEL Design System).

**App — mudanças só visuais** (`src/index.css` reescrito + componentes-chave):
- Tokens: fundo quase-preto `#060709`, superfícies profundas, bordas mais frias, radius 0.75rem, primary violeta elétrico `#9155fff` (#9155ff), accents cyan/blue retunados
- **Voxel grid** novo (linhas finas + nós de vértice + mask radial) e **aurora dupla** (violeta + ciano) no `bg-radial-glow`
- Glass com profundidade real (blur 18px + saturate) e "light seam" interno nos cards
- Scrollbar/selection/focus elétricos; `:focus-visible` global
- Sidebar: **barra indicadora glow** no item ativo (render-prop do NavLink)
- Splash redesenhada (mark maior com glow duplo, wordmark extrabold, tagline em brand-gradient)
- Monaco: tema renomeado **`voxel-dark`** (5 refs atualizadas) com paleta do editor nova
- Botões gradient: hover `brightness-110` + bloom de sombra elétrica
- `NexusMark` (SVG) e **ícone v3** (`generate_icon_v3.py`) regenerados na paleta Next via `tauri icon` (51 variantes)

**Site**: mesmos seletores/conteúdo/JS, `styles.css` inteiro re-pelado — aurora de fundo, cards com hover-glow, CTA da nav com glow, tipografia display maior, mockup interno refinado, download cards com destaque "detected" brilhante.

**Nada desfeito (provas)**: vitest **44/44** ✓ · cargo **27/27** ✓ · typecheck/lint 0 errors ✓ · vite build ✓ · **boot vivo com o skin novo, 0 panics** ✓ · CI verde · Pages verde · DOM validado ao vivo (32 swatches + 6 links v0.3.0)

**Publicação**: v0.3.0 (package/tauri.conf/Cargo.toml/About/site) → tag **v0.3.0** → release multi-OS com o ícone Next. Site: screenshot de validação capturado.

**Decisão**: tema Monaco renomeável (interno); classes CSS mantidas por design (reskin sem tocar JSX do site); `generate_icon_v3.py` deriva do v2 (paleta Next).

---

## 18. Sessão 18 — MOBILE: VOXEL Bridge + Expo app (Roadmap Phase B)

**Pedido do dono**: "avançe com o mobile… mesma experiência de um de PC, com a mesma qualidade, com preferência de jogos mobile."

**Arquitetura escolhida (§7 do briefing: não forçar Tauri no mobile)**:
1. **`packages/core`** (pnpm workspace) — extração da camada PURA compartilhável: MOTD parser, address parsing + SLP types, 10 server presets, referências públicas, inferência de estilo (com AI sanitize), catálogo dos 32 shaders, constantes de marca. Testes movidos junto; desktop consome via **barrels** (zero churn em features); `vitest.config` na root cobre `packages/core` — CI continua num runner só.

2. **VOXEL Bridge (Rust/axum no desktop)** — a peça central: o celular controla a MESMA engine real do PC. Opt-in via Settings → Mobile, **token bearer de 8 chars** por sessão, rotas allowlisted, CORS p/ debug web. Endpoints: `/api/status` (stats reais do workspace), `/api/projects` (+ `POST /:slug/build` = o MESMO command allowlistado do botão Build), `/api/servers` (+ start/stop com o stop world-safe via stdin), `/api/servers/:slug/console/tail` (**ring buffer de 1000 linhas/slug** alimentado pelos eventos tauri — mobile faz polling pois o fetch do RN não faz streaming), `/api/ping` (SLP real pela rede do PC), `/api/ai/chat` (SSE) + `/api/ai/ask` (one-shot p/ mobile). **A API key NUNCA sai do PC** — o bridge lê do keyring e faz as chamadas (dialétos OpenAI-compat/Anthropic/Ollama).

3. **`apps/mobile`** (Expo SDK 51 + expo-router)** — bottom nav própria §10 (Home/Create/Projects/Servers/More), skin Next (bg #050609, violeta elétrico, glow). Telas: **Connect** (pairing verificado contra /status), **Home play-first** (stats ao vivo, servidores online, AI chip), **Create** (chat com a IA do PC — "AI working…"), **Projects** (linhas reais + Build on PC), **Servers** (start/stop + console live), **More** (conexão/about/legal). Metro config p/ workspace (`watchFolders` p/ packages/core). **SDK 51 por causa do Node 18** (SDK 52+ exige Node 20) — documentado; upgrade do SDK quando o Node subir.

4. **Settings → Mobile no desktop**: toggle bridge, endereço + token, status do relay AI.

**Decisões técnicas da sessão**: `expo/fetch` NÃO existe no SDK 51 (só 52+) → console vira **ring buffer + polling** e AI vira **ask one-shot** (igualmente reais; SSE chat fica p/ clients com streaming). `sceneStyle`/`sceneContainerStyle` não existem no bottom-tabs do SDK 51 → fundo vem do Stack root. Node 18 bloqueou create-expo-app novo → app criado à mão com deps pinadas.

**Workflows**: `mobile.yml` (typecheck mobile + core tests, paths-filtered); `ci.yml`/`release.yml` com `--filter voxel --filter @voxel/core` (runners desktop nunca baixam deps do mobile).

**Verificação**: typecheck desktop ✓ · lint 0 errors ✓ · **vitest 44/44** (incl. core movido) ✓ · **cargo 27/27** ✓ (bridge compila limpo) · **vite build** resolve @voxel/core via workspace ✓ · **boot vivo com o bridge dentro, 0 panics** ✓ · **mobile `tsc --noEmit` PASSA** ✓.

**Não feito nesta sessão (honesto)**: APK/AAB real (precisa EAS build ou Android SDK — documentado como próximo passo); push notifications (§62 → Phase F); biometrics (§59 → com o secure storage upgrade).

**Estado pós-sessão**: mobile arquitetura completa e funcional via pairing; próximo: EAS build do APK, secure-store do token, e o runtime test com device real.

---

## 19. Sessão 19 — EXECUTÁVEIS: Android APK real + pipeline iOS

**Pedido do dono**: "me crie o arquivo executável (aplicativo) para android, IOS e outros sistemas operacionos. que funcione."

**Android APK — REAL, instalável, publicado**:
- Android SDK + NDK 26.1 instalados localmente (cmdline-tools oficiais, licenças aceitas); `expo prebuild -p android` → Gradle `assembleRelease` → **BUILD SUCCESSFUL 17m19s (523 tasks)**
- **`VOXEL-mobile-0.1.0-android.apk` (64MB, debug-signed = sideload ok, minSdk 23/Android 6+, label VOXEL, `dev.yuadevs.voxel.mobile` v0.1.0)** — validado por `apksigner verify` + `aapt badging` e **publicado na release v0.3.1** (link HTTP 206)

**Guerra do build (5 bugs caçados, todos com causa raiz)**:
1. settings.gradle do template resolve `@react-native/*` do `rootDir` (android/, sem node_modules) e sem paths-trick → **`scripts/patch-android-gradle.cjs`** (sobrevive ao prebuild, chamado por `pnpm prebuild:android`)
2. pnpm 12 removeu `public-hoist-pattern` — `.npmrc` inócuo → settings do pnpm 12 vivem no **pnpm-workspace.yaml**: `nodeLinker: hoisted` (layout documentado da Expo p/ RN; desktop continua verde com o layout flat)
3. processos filhos morrendo com o fim do shell → **setsid** para o gradle
4. deps do template SDK 51 incompletas na minha lista manual → `npx expo install` (expo-asset@10, expo-font@12, expo-system-ui@3)
5. **Metro não lê subpath-exports** → `main: ./src/index.ts` no core + imports barrel no mobile (tsc/vite continuam nos subpaths; CI mobile segue verde)

**iOS — pipeline real, honesto**: `mobile-builds.yml` job macOS: prebuild (com pod install) → `xcodebuild archive` unsigned (`CODE_SIGNING_ALLOWED=NO`) → artifact `VOXEL-ios-unsigned.xcarchive.zip`. **Instalar em iPhone exige assinatura com certificado Apple Developer** — o xcarchive está pronto para o dono assinar (TestFlight/App Store); nota honesta no site.

**Site**: seção "VOXEL in your pocket" — card Android com link direto do APK, card iOS honesto (Actions + assinatura), hero detecta Android e aponta o APK.

**CI**: `mobile-builds.yml` (dispatch + tags `mobile-v*`: APK em artifact, attach automático em releases; iOS archive em artifact) + jobs desktop/mobile-typecheck todos verdes com o layout hoisted.

**Verificação**: desktop 44/44 + 27/27 ✓ · vite build com hoisted ✓ · mobile tsc ✓ · `expo export` (bundle JS completo) ✓ · **APK apksigner/aapt ✓ publicado** · workflows verdes.

**CI mobile-builds VERDE (ambos os jobs)**: `android-apk` 5m42s (APK artifact no CI — SDK auto-instalado pois as imagens hosted não trazem mais; alinhamento ANDROID_HOME/ANDROID_SDK_ROOT obrigatório) e `ios-archive` 11m47s (xcarchive unsigned). Bugs CI caçados: sdkmanager removido das imagens runner, conflito ANDROID_SDK_ROOT legado, xcworkspace nasce do pod install (não do prebuild), xcodebuild não expande globs.

**Estado pós-sessão**: Android FUNCIONA hoje (baixa o APK, instala, pareia com o PC); iOS compila de verdade no CI e espera a conta Apple para assinar. Próximo: emulador/device test real, keystore de release própria (assinar pra distribuição séria), TestFlight quando houver conta.

---

## 20. Sessão 20 — Imagem no chat de IA (todas as superfícies) + PWA instalável no iPhone

**Pedido do dono**: "faça o arquivo executável para os mobile… também quero que adicione a função de Imagem no Prompt do chat de IA ou do chat mesmo" → dois entregáveis.

**1. Imagem no chat de IA (visão, de verdade)**:
- **Desktop (AI Creator)**: botão "Attach image" no composer → file dialog (plugin-dialog) → imagem importada como referência do projeto (`.voxel/references/`, reuso do pipeline vision existente) → vai como ImagePart na próxima mensagem; `importReference` agora retorna o relPath.
- **Bridge multimodal**: `ChatContentIn` untagged (text | parts[{text}|{image: media_type+base64}]) e `build_provider_messages()` puro traduz para os 3 dialetos — OpenAI-compat `image_url` data-URI, Anthropic `source base64`, Ollama `images[]`. +6 testes unit (3 dialetos, pass-through, **PWA embutida**, content-types) → cargo **33/33**.
- **Mobile 0.2.0**: 📎 no composer do Create (expo-image-picker, até 3 imagens, chips), permissões ok, `AskContent` multimodal no bridge.ts.

**2. "Executável iOS" REAL sem App Store — a PWA**:
- `expo export -p web` (static, 14 páginas) + `scripts/prepare-web.cjs` (metas apple-mobile-web-app, manifest.webmanifest, apple-touch-icon; script `pnpm build:web`) → **dist-web commitado** (1.3MB — é o firmware do companion).
- **Bridge embute e serve a PWA** (`include_dir` crate): rota fallback pública na LAN; API continua token-gated (router split: layer de auth SÓ em /api). **No iPhone: `http://seu-pc:3717` no Safari → Add to Home Screen → app standalone completo.** Sem conta Apple. O xcarchive nativo continua disponível no CI para o dia em que houver conta.
- **Bug caçado (web)**: pnpm deixou cópias aninhadas de `react` (mesma 18.2.0, paths distintos) → Metro bundlava instâncias duplicadas e o SSR do expo-router explodia (`React.useEffect null`); fix: `extraNodeModules` pinando react/react-dom/jsx-runtime a um path único.

**3. Android APK 0.2.0**: rebuild (6m17s incremental após pnpm dedupe ter invalidado o build do composite plugin — clean + `pnpm install --force` + re-run) → **publicado na release v0.3.2** como `VOXEL-mobile-0.2.0-android.apk` (65MB, apksigner/aapt verificados, versionName 0.2.0).

**Publicações**: desktop **v0.3.2** (bridge multimodal + PWA embutida) + mobile **0.2.0**; site atualizado (card Android→APK 0.2.0, card iOS com o passo-a-passo PWA + xcarchive nativo).

**Verificação**: typecheck ✓ · lint 0 errors ✓ · vitest 44/44 ✓ · cargo **33/33** ✓ · mobile tsc ✓ · `expo export` web ✓ · APK 0.2.0 apksigner/aapt ✓ · CI/Mobile/Pages verdes no push.

**Estado pós-sessão**: todas as plataformas com executável real — Windows/Linux/macOS (.exe/.msi/.deb/.AppImage/.dmg), **Android (.apk 0.2.0)**, **iOS (PWA instalável hoje; xcarchive nativo quando houver conta Apple)**. Chat com imagem no desktop e no celular. Próximo natural: keystore release própria p/ Play Store, TestFlight, push notifications.

---

## 21. Sessão 21 — NIM + Model Picker + SRV fix + Launcher + Temas/Animações + ~/Voxel + CSP + Live Preview + Multi-Agent

**Pedidos do dono**: NIM como provider; seleção de modelo sem digitar; "live server" que não importava (verificar erro); mais temas; função de Launcher visível no app; workspace → Voxel; mais efeitos/animações; mais segurança; live preview de mods/servers; multi-agentes em tempo real sem inventar.

**Entregues**:
1. **NVIDIA NIM** first-class (provider layer, streaming, tool-call format, bridge dialects, /models). 
2. **Model picker**: auto-fetch da lista + dialog de busca (cmdk) — só selecionar; IDs manuais continuam possíveis. TDZ do ESLint corrigido (família sessão 9).
3. **Live server import — bug do dono REPRODUZIDO E CORRIGIDO**: minemen.club dava timeout de 49s porque DDoS shields só aceitam o alvo do SRV; implementado **SRV lookup** (hickory-resolver, sistema DNS) como o cliente vanilla faz. E2E real: Hypixel + CubeCraft + **Minemen 3.578 players em ~2s**. Timeouts 8/10s. Proxy Bungee com max=0 documentado (liveness é o assert).
4. **Launcher page** (sidebar): instâncias preparadas com mods/shaderpacks instalados, jar da última build do projeto, Play (LaunchDialog) e Reveal — `launcher_overview` command novo.
5. **Temas**: 7 accents (violet/blue/cyan + **emerald/amber/rose/teal**) com swatches glow.
6. **Animações**: card-rise staggered no grid de shaders, hover-lift+glow nos cards, press-scale em todos os botões.
7. **Workspace ~/Voxel**: default novo + migration one-click do legado (mesmo disco, recusa se destino existe) + banner no Storage.
8. **Segurança**: CSP real (tudo self-hosted — @fontsource, sem CDN; data: só para favicons do SLP; boot verificado com 0 violações) + throttle 400ms em tokens inválidos do bridge.
9. **Live preview do servidor**: no Console, header vivo com SLP self-ping (MOTD colorido real + players a cada 15s enquanto roda).
10. **Multi-Agent v1 (Task force)**: Architect (read-only; PLAN:/RISKS:) → Developer (aplica o plano; orçamentos/snapshot/confirm) → Reviewer (read-only; REVIEW: com verdict PASS/ISSUES). **Fases read-only são garantidas pelo loop, não pelo prompt**; mesmo sandbox/auditoria; nada fora do escopo pedido. Timeline com badges por agente + toggle (default ON). 3 testes novos (personas + pureza do toolset).

**Verificação**: typecheck ✓ · lint 0 errors ✓ · **vitest 47/47** ✓ · **cargo 33/33** ✓ (+E2E SLP 3 servidores reais) · vite build ✓ · **boot vivo com CSP e 0 violações** ✓. Release v0.3.3.

**Estado pós-sessão**: ver relatório feito/falta. Próximos: Forge/NeoForge templates (§22), push notifications (§62), keystore release Play Store, TestFlight, Model Router por fase (§66).

---

## 22. Sessão 22 — Forge & NeoForge Templates: a era dos três loaders

**Pedido do dono**: "Leia Plan.md e continue." → roadmap §9.1: "o Version Adapter já mapeia versões; faltam templates Java análogos ao fabric-1.20.1".

**Pesquisa empírica (nada inventado)**:
- **Forge 1.20.1 MDK** baixado do maven OFICIAL (`forge-1.20.1-47.4.10-mdk.zip`) e estudado: ForgeGradle 6, mappings official, wrapper Gradle 8.8 (igual ao fabric!), mods.toml com `${}` expand via processResources.
- **NeoForge 1.20.1**: o MDK deles NÃO existe como mdk.zip; descoberta empírica — a linha 1.20.1 é um **drop-in do Forge 47.x**: `net.neoforged:forge:1.20.1-47.1.104` com classifier `userdev` e `universal` resolve HTTP 200 no maven NeoForged (o `neoforge:47.1.104` NÃO existe), e o universal.jar real declara `modId="forge"` → dependency `[47,)` nos dois loaders. NeoForge 20.2+ (MC 1.20.2+) é outro MDK — honestamente fora do escopo deste template.

**Entregue**:
1. **`forge-1.20.1-mod`** (35 arquivos embedded): build.gradle FG6 completo (runs client/server/gameTestServer/data, reobfJar, publishing), settings.gradle com pluginManagement do maven do Forge + foojay, `@Mod` + `ModItems` com `DeferredRegister`/`ForgeRegistries`/`SwordItem Tiers.NETHERITE` + CreativeModeTab própria, mods.toml Maven ranges, pack.mcmeta factual, assets/data reusados (darksteel_sword), `.voxel/` completo sem fabric-api.
2. **`neoforge-1.20.1-mod`**: mesmo pipeline FG6 + `repositories { maven.neoforged.net/releases }` + `minecraft "net.neoforged:forge:${mc}-${loader}"`.
3. **Engine**: tokens `{{LOADER_ID}}` + `{{PACK_FORMAT}}`; payload `loader` + `packFormat`; **create_project recusa template↔loader inconsistente** (defense in depth p/ client stale) e packFormat=0.
4. **Catalog/wizard**: `resolveTemplateParams(version, loader)` — loaderVersion do braço certo, SemVer (fabric) vs Maven ranges (Java), pack formats factuais (15→34 p/ 1.20.1→1.21.1), `isLoaderAvailable` com honestidade (NeoForge só 1.20.1), templateId por loader; **wizard com chips Fabric/Forge/NeoForge** + badges loader/mappings/pack format + hint NeoForge 20.2+.
5. **E2E REAL executado**: os TRÊS loaders compilam `dark_kingdom-0.1.0.jar` de verdade — fabric 158s, **forge 339s** (decompile MC completo), **neoforge 170s** (artifact NeoForged resolvido). 6 E2E ignored no total.

**Bugs caçados** (4):
- Wrapper files do template na raiz (glob do cp mal direcionado) → `gradle-wrapper.properties` não encontrado no 1º run do Forge. Fix na origem + embed regenerado.
- `#` não é comentário em Groovy → settings.gradle não compilava ("Unexpected character '#'"). Fix `//`.
- **Operacional (3ª tentativa, causa raiz achada)**: `pkill -f "tauri dev"` faz **self-match do próprio shell** (o comando contém a string) → shell se mata → timeout aparente do tool. Fix: pattern com classe de caracteres (`"tauri de[v]"`). Aprendizado permanente.
- pnpm typecheck: ProjectLoader já existia em types (linha 64) — reuso, sem duplicar.

**Verificação**: typecheck ✓ · lint 0 errors (23 warns família) · **vitest 52/52** (+5: availability + maven ranges) · **cargo 35/35** (+2 renders) · **E2E 3/3 compilação real** ✓ · vite build 2m16s ✓ · boot vivo 0 panics ✓. Release v0.3.4.

**Estado pós-sessão**: criar mod para Fabric, Forge ou NeoForge 1.20.1-1.21.1 funciona de ponta a ponta (wizard → template → gradle → jar). Próximos naturais: Model Router por fase (§66), push notifications (§62), NeoForge 20.2+ MDK (NeoGradle), Quilt?, Modpack Creator (§9.5).

---

## 23. Sessão 23 — Model Router + Push Notifications + NeoForge Moderno

**Pedido do dono**: "sim continue com tudo. verifique erros e corrija." → os três próximos naturais do roadmap §9 em uma sessão, com bateria de erros.

**1. Model Router por fase (§66)**: `AiSettings.phaseModels {architect,developer,reviewer}` (persistido, default vazio p/ installs existentes) + `phaseModelFor()` no orchestrator (troca SÓ o model id — provider/key/sampling ficam globais; o app guarda uma key só, e multi-provider-per-fase ficaria desonesto sem keys múltiplas). UI: grid de 3 campos em Settings→AI com datalist da lista viva de modelos (o model principal ganhou o mesmo datalist).

**2. Push Notifications (§62)**: `tauri-plugin-notification` crate 2.6.0 = npm 2.6.0 (same-minor, lição sessão 14). Dois momentos honestos: build exit ("Build succeeded/failed" + exit code) e fim de run de agente/task force (writes ou preview). `notifyDesktop()` pede permissão uma vez e degrada para no-op silencioso se negada. Capability: `notification:default` (least privilege).

**3. NeoForge Moderno — o quarto template**: derivado da branch oficial `neoforged/MDK@1.20.2` (o repo `neoforged/NeoForgeMDKs` NÃO existe; o `neoforge-*-mdk.zip` NÃO existe no maven — a fonte real é o repo MDK). NeoGradle 7.0.116 userdev + artifact `net.neoforged:neoforge` (20.2.93 = a versão exata do MDK) + NeoForm pipeline + mods.toml com dependency `modId="neoforge"` + API `DeferredRegister.Items`. Wizard escolhe a era certa: 1.20.1→template drop-in; **1.20.2-1.21.1 (incluindo a LTS 21.1)→moderno**; 1.21.4+ honestamente fora até embedar o MDK da era.

**Bugs caçados (4)**:
- `notifications:default` NÃO existe — o permission é `notification:` (singular). O erro do build do Tauri listou os válidos; fix na capability.
- API 20.2: `DeferredRegister.Items.registerItem(String, Supplier)` não existe — a assinatura real é `(String, Function<Item.Properties, Item>)`. Pego pelo E2E (compileJava FAILED), corrigido no template, re-provado.
- API 20.2: `DeferredRegister.register(...)` retorna `DeferredHolder`, não `DeferredRegister<T>`. Idem — E2E pescou, fix, re-run.
- Teste de render usava `mc_version` do sample (1.20.1) mas esperava 1.20.2 — bug do teste, não do template.

**Verificação**: typecheck 0 ✓ · lint 0 errors (23 warns família) · **vitest 55/55** (+3: router + eras NeoForge + cobertura forge) · **cargo 36/36** (+1 render) · **E2E REAL: neoforge-modern dark_kingdom jar com neoforge:20.2.93 (854s, NeoForm decompile completo)** — 4/4 templates E2E (fabric 158s, forge 339s, neo-legacy 170s, neo-modern 854s) · vite build 1m56s ✓ · boot vivo 0 panics ✓. Release v0.3.5.

**Estado pós-sessão**: 4 templates de projeto, todos com prova de compilação real. Task force com model routing. Desktop notifications nos dois momentos que importam. Próximos naturais: Modpack Creator (§9.5), secure-store/biometria mobile (§59), ModDevGradle era (1.21.4+) quando for a hora, keys por provider no Router.

---

## 24. Sessão 24 — Assets premium + Modpack Creator v1

**Pedido do dono**: "sim continue, sempre focando em qualidade. e bons assets/sprites etc.."

**1. Sprite overhaul (a resposta direta ao "bons assets/sprites")**: os PNGs dos templates eram placeholders de **7 cores**. Agora são pixel art artesanal via `scripts/generate_mod_assets.py` (determinístico, mesmo padrão dos geradores de ícone; arte = char maps revisáveis em código; escrito nos 4 templates de uma vez):
- **darksteel_sword.png**: espada diagonal vanilla-style, paleta darksteel (aço azul-cinza + outline + glint cyan), cabo de madeira com pomo. Prova estrutural: massa por quadrante (cabo LB→lâmina RT).
- **example_item.png → Voxel Gem**: gema facetada nas cores da marca (violeta #9155ff + cyan), sparkle branco. O display name acompanhou a arte ("Voxel Gem" no lang + project-spec; o id didático `example_item` permanece — o Java continua ensinando).
- **icon.png**: logo 128x128 do mod — a espada 6x sobre painel escuro com voxel grid da marca, glow radial violeta e a linguagem de borda dos cards do app (234 cores).
- **Bug caçado no caminho**: o `en_us.json` faltava no template neoforge-1.20.2 (cp da sessão 23 que falhou silenciosamente com `{{MOD_ID}}` literal) — copiado e o rename aplicado nos 4.

**2. Modpack Creator v1 (§9.5, a fatia honesta)**:
- **Export**: valida cada fonte DENTRO do workspace (jar em `projects/<slug>/build/libs`, pack em `shaderpacks/`), escreve `modpack.json` (manifest camelCase com generator/createdAt — UTC math sem chrono, mesmo civil-from-days do git.rs) + `mods/*.jar` + árvores `shaderpacks/<pack>/` → `modpacks/<nome>-<versão>.zip`. **Fatos do manifest vêm dos records reais dos projetos** (MC version + loader), nunca inventados.
- **Import**: aceita SÓ zips com manifest VOXEL, recusa traversal/entradas inesperadas (zip-slip), instala em `instances/<slug>/mods` + `shaderpacks/`.
- **`modpack_exportable_assets`**: o catálogo verdadeiro para o wizard (jar mais novo por projeto que buildou de verdade, packs que existem).
- **ModpacksPage** (`/modpacks`, sidebar Package, Topbar, Ctrl+K): export com checkboxes + chips e badge de fatos do manifest; import com file dialog + picker de instância. Badge "v1 scope" honesto: resolução de dependências externas (Modrinth/CurseForge) e Compatibility Score são a próxima fatia — o manifest já carrega os fatos.

**Bugs caçados**: (1) syntax error de parede no teste (parêntese do vec!) — cargo pegou na hora; (2) `<name>-<version>` literal dentro de JSX (parser engoliu como tags) — escapado como string; (3) `openInFileManager` recebe 1 arg; (4) icon de lucide `Package` faltando no import do CommandPalette; (5) o manifesto "from-manifest/workspace" que eu mesmo escrevi era desonesto — substituído pelos fatos reais dos projetos ANTES de commitar.

**Verificação**: typecheck 0 ✓ · lint 0 errors (24 warns família) · **vitest 55/55** ✓ · **cargo 40/40** (+4 modpack) · vite build 2m06s ✓ · boot vivo 0 panics ✓. Release v0.3.6.

**Estado pós-sessão**: templates com arte de verdade; modpacks exportam/importam de ponta a ponta com manifest. Próximos naturais: dependências externas + Compatibility Score no Modpack Creator, Asset Studio (§9.6) com o mesmo pipeline de sprites, secure-store/biometria mobile (§59).

---

## 25. Sessão 25 — Asset Studio + Compatibility Score + Mobile Secure-Store

**Pedido do dono**: "sim continue com todos, sempre verificando erros antes de prosseguir" → bateria entre cada feature (todas as três com erros verificados e corrigidos no caminho).

**1. Asset Studio (§9.6) — arte REAL gerada no perímetro**:
- 7 receitas de item 16x16 (sword/gem transcrevem A GEOMETRIA PROVADA dos sprites do template via char maps; ingot/orb/apple/book/wand são formas programáticas com outline automático). Tons/outline/highlight derivam das 2 cores escolhidas — qualquer paleta ganha a linguagem de profundidade vanilla.
- `generate_item_texture` (Rust): raiz do projeto validada pelo workspace guard ANTES de qualquer mkdir; resto do path montado por componentes fixos + ids pré-validados (traversal inexpressível); preview_only → base64 sem tocar disco; PNG via crate png (já no tree, zero deps pesadas).
- **O AGENTE CRIA ARTE AGORA**: tool `generate_item_texture` (write-like: orçamento+snapshot) + princípio operacional "missing texture is never acceptable".
- `AssetStudioPage` (/studio, sidebar Brush, Ctrl+K): preview vivo com debounce (pixelated), 7 styles, pickers + 6 paletas, write com o path real.

**2. Compatibility Score (Modpack v2)**: lê os manifests DENTRO dos jars (fabric.mod.json / META-INF/mods.toml — local, sem rede) e roda 3 checks reais: mod ids únicos; ranges de MC com interseção (parser que entende AMBOS os formatos: Maven `[a,b)`, SemVer `>=`, `~`, exato, `*`); loader único (fabric.jar + forge.jar nunca bootam juntos). Score = passed/total; export recusa <100. **Bug real caçado pelo teste**: interseção em ponto de fronteira (lower-inclusive == upper-exclusive) retornava overlap — vazio é vazio; fix `lo_incl && hi_incl`.

**3. Mobile secure-store + biometria (§59)**: token de pairing vai para o keychain/keystore (expo-secure-store via adapter zustand; se indisponível, sessão morre com o app em vez de cair em storage inseguro); `useBiometricGate` honesto (dispositivo sem biometria = SEM gate fake); Home trava com overlay e unlock. Mobile 0.3.0.

**Bugs caçados (6, um por feature + mobile)**: (1) validated_path exige parent existente — ordem de guard corrigida (validar raiz primeiro, join depois); (2) `png::Decoder` exige Seek (Cursor) e wrote_path é Option<String> (2 fixes de teste); (3) assert do parser com padding do til `[1,21,0]` vs maven `[1,21]` — asserts fiéis ao comportamento real; (4) **interseção de ranges na fronteira** (bug de verdade, o teste pegou); (5) escape `\`` do python corrupto no TS do ModpacksPage (62 errors → edit cirúrgico); (6) prebuild do APK apagou `local.properties` → `sdk.dir` recriado.

**Verificação**: typecheck 0 ✓ · lint 0 errors (27 warns família) · vitest 55/55 ✓ · **cargo 46/46** (+3 compat) · vite build 2m02s ✓ · boot vivo 0 panics ✓ · mobile tsc ✓ · APK 0.3.0 rebuild (apksigner/aapt). Release v0.3.7.

**Estado pós-sessão**: o app gera arte real (e o agente também), modpacks têm score honesto lido dos manifests, o celular guarda o token como segredo. Próximos naturais: dep-res externa no Modpack Creator (Modrinth/CurseForge), Texture Studio ampliado (blocks/items 32x32), push mobile (Expo notifications), era ModDevGradle (1.21.4+).

---

## 26. Sessão 26 — Modpack v3: catálogo Modrinth (busca oficial + SHA-1)

**Pedido do dono**: "sim continue" → o próximo natural do Modpack Creator: dependências externas, começando pela plataforma oficial.

**Entregue**:
- **`modrinth_download` (Rust)**: perímetro como sempre — allowlist de host EXATO (`cdn.modrinth.com`, https sem porta; subdomínios-lookalike recusados), cap 256MB, e o **SHA-1 publicado pelo Modrinth tem que bater** com os bytes ou o write é recusado. Instância precisa estar preparada; nomes de arquivo guardados (versions Maven com `+` aceitos — caçado pelo E2E).
- **Service TS**: search/version resolution via API pública documentada (capability `https://api.modrinth.com/*`, User-Agent identificado como o guidelines deles pede). `pickModrinthFile` NUNCA instala arquivo sem SHA-1 publicado (honestidade > conveniência) — testes provam: prefere primary, pula versões sem hash, null quando nada é verificável.
- **UI**: card "Add from Modrinth" no Modpacks — busca com facets do MC version + loader REAIS do manifest, resultados com license badge + downloads compactos + autor, install one-click na instância escolhida com toast do path verificado. Badge de escopo v3 atualizado (o que ainda NÃO faz: grafo transitivo de deps, CurseForge).
- **E2E REAL**: `fabric-api-0.92.12+1.20.1.jar` baixado do CDN vivo com SHA-1 verificado (1.06s) — a primeira rodada pescou o guard recusando `+` no nome; fix e re-prova.

**Bugs caçados (3)**: (1) guard rejeitava versão Maven `+` no filename (bug REAL achado pelo E2E com o arquivo real do CDN); (2) React Compiler: `getState()` dentro de useMemo quebra a preservação — memo manual desfeita em favor do compiler (padrão novo); (3) import `useMemo` órfão.

**Verificação**: typecheck 0 ✓ · lint 0 errors (28 warns família) · vitest **59/59** ✓ · cargo **49/49** + E2E Modrinth REAL ✓ · vite build 1m44s ✓ · boot vivo 0 panics ✓. Release v0.3.8.

**Estado pós-sessão**: Modpack Creator v3 completo local (export/import/score) + catálogo externo oficial com checksum. Próximos naturais: grafo de dependências transitivo (a Modrinth API expõe `dependencies` por version), CurseForge paralelo, push mobile (Expo notifications), Texture Studio ampliado (blocks/32x32), era ModDevGradle.

---

## 27. Sessão 27 — Dependency Graph + Block Textures + Mobile Notifications

**Pedido do dono**: "sim faça tudo" → os três próximos naturais de uma vez (CurseForge fica de fora honestamente: a API deles exige key que o dono não deu).

**1. Modpack v4 — grafo transitivo de dependências**: `resolveModrinthTree` — BFS pelas edges `required` com visited set (ciclos terminam, duplicatas colapsam); **optional** volta como `skippedOptional` (escolha do usuário, nunca nossa); **embedded** nunca baixa duas vezes; **incompatible** contra algo sendo instalado FALHA o resolve; required sem versão SHA-1-instalável FALHA também — modpack quebrado nunca é montado em silêncio; cap 25 mods contra grafos patológicos. UI: instala o root + deps com progresso por arquivo ("Installing 2/5: …") e toast final com o resumo honesto (incl. optionals pulados). 6 testes cobrem a matriz toda.

**2. Asset Studio — block textures**: 4 recipes de face de cubo (bricks com fiapos alternados e tom por fileira; planks com 4 bandas + veios + pregos; ore com stone de variação determinística por pixel + clusters da secondary; panel com bisel de máquina e rebites) — todos tiles 16x16 FULLY OPAQUE como bloco de verdade. `asset_kind (item|block)` roteia `textures/item` vs `textures/block` e é **ENFORCED contra as recipes no Rust** (sword como block recusado; bricks como item recusado). Tool do agent ganha asset_kind → projetos de block ganham arte real. UI com seletor de tipo, grid de styles por kind e hint de path dinâmico. +2 cargo (opaquidade, matriz de consistência, ore com secondary).

**3. Mobile 0.3.1 — build notifications (§62)**: o celular que DISPAROU o build recebe ping quando termina — watcher de 5s/15min no `last_build_status` REAL (limpo no unmount, nunca zumbi), expo-notifications com permissão pedida uma vez (negada = no-op silencioso). Handler corrigido para o shape do SDK 51 (`shouldShowAlert`, não `shouldShowBanner`).

**Bugs caçados (3)**: aspas duplas cravadas DENTRO de strings JS por replace em python (2× — description e schema doc do tool; lição: usar aspas simples no conteúdo); handler do SDK 51 com campos do 52; imports órfãos (2×).

**Verificação**: typecheck 0 ✓ · lint 0 errors (28 warns família) · vitest **65/65** (+6 resolver) · cargo **51/51** (+2 blocks) · vite build 1m52s ✓ · boot vivo 0 panics ✓ · mobile tsc ✓ · APK 0.3.1 rebuild. Release v0.3.9.

**Estado pós-sessão**: Modpack Creator v4 completo (export/import/score/catálogo/grafo), Studio gera items E blocks, mobile notifica builds. Próximos naturais: CurseForge (precisa API key do dono), era ModDevGradle (1.21.4+), push externo (FCM/APNs — precisa backend), world/structure geradores.

---

## 28. Sessão 28 — A era ModDevGradle: 5º template (1.21.4-1.21.8)

**Pedido do dono**: "Sim continue" → o próximo natural: templates para o NeoForge moderno-alto.

**Pesquisa empírica (repo oficial `neoforged/MDK`, branch `archive/1.21.4-mdg`)**: pipeline **ModDevGradle 2.0.91** — DSL `neoForge {}` (version, runs com `client()`/`server()`, mods bindings), metadata gerada de **`src/main/templates/META-INF/neoforge.mods.toml`** via task `generateModMetadata` (ProcessResources → build/generated), dependencies com **`type="required"`** (não mais `mandatory`), **sem pack.mcmeta** (a era dispensa), wrapper Gradle 8.14.2, Java 21.

**Entregue — template `neoforge-1.21.4-mod` (30 arquivos)**: build.gradle MDG + settings + properties tokenizadas; Java com as APIs da era; **data formats da era** (recipe `result.id` — a mudança 1.20.5; advancement `icon.id` + `requirements` explícito; lang `itemGroup.` prefixo novo); catalog escolhe a era por versão (1.20.1 lineage / NG7 1.20.2-1.21.1 / **MDG 1.21.4-1.21.8**); 26.x continua desabilitado honestamente; wizard esconde o badge pack format nesta era (não há pack.mcmeta) e explica as 3 eras.

**Bugs caçados (4 — 2 de API pescados pelo E2E REAL)**:
1. **`FMLJavaModLoadingContext` não existe em 1.21.x** — `@Mod` construtor recebe `(IEventBus, ModContainer)` por injeção (confirmado contra o ExampleMod do próprio MDK).
2. **`Tiers` não existe** — o record vanilla virou `ToolMaterial.NETHERITE` (import + uso).
3. **O template 1.20.2 nunca teve data files** (recipes/advancements — mesma família do cp silencioso do lang da sessão 25): restaurados do fabric provado; o E2E do 1.20.2 compila mas o mod gerado tinha perdido a recipe.
4. NeoForm decompile falhou na 1ª rodada por OOM transitório (daemon Gradle+Kotlin comendo RAM junto) — re-run provou que era ambiente, não template.

**Verificação**: typecheck 0 ✓ · lint 0 errors (28 warns família) · vitest **65/65** (eras 3×) ✓ · cargo **52/52** (+1 render MDG) ✓ · **E2E REAL 5/5** (fabric 158s, forge 339s, neo-legacy 170s, neo-NG7 854s, **neo-MDG 63.72s** com cache NeoForm) ✓ · vite build ✓ · boot vivo 0 panics ✓. Release **v0.4.0** (minor: a era moderna completa).

**Nota de operação**: cargo test "pendurado" por contenção de RAM com o daemon Gradle do APK em background — nada de lock; após o build, tudo rápido. Bater não rodar builds pesados em paralelo.

**Estado pós-sessão**: **5 templates E2E-provados** cobrindo Fabric + Forge + NeoForge 1.20.1→1.21.8. Próximos naturais: era 26.x (MDG quando research), world/structure geradores (§9.6), editor visual de modpack salvo, CurseForge (precisa key do dono).

---

## 29. Sessão 29 — Structure Studio (.nbt reais + preview isométrico) + Polimento visual global

**Pedido do dono**: "sim continue com tudo, sempre dando o máximo de qualidade visual possível."

**1. Structure Studio (§9.6, a fatia world/structure)**:
- **`structure_generate` (Rust)**: 4 templates procedurais determinísticos (watchtower com postes de log/ameias/weathering musgo; cottage com telhado degrau de stairs/chaminé/pebbles; obelisk deepslate com coroa de amethyst/velas; ruin erodido com ar solitário) serializados no **formato vanilla REAL**: gzip NBT (writer NBT próprio — subset Compound/List/Int/String) com size/blocks/palette dedupe/entities/DataVersion. **DataVersions factuais** (3465→4440) e o **rename de pasta da era** (data/<ns>/structures/ antes de 1.21, structure/ depois) decididos pelo MC version REAL do projeto.
- **Preview isométrico (`IsoStructureCanvas`)**: cada bloco do resultado desenhado como cubo iso sombreado (top/left/right 1.12/0.72/0.5) sobre backdrop voxel-grid da marca, painter's order correto — **o que você vê é exatamente o que o .nbt contém**.
- **Asset Studio ganha a tab Structure**: chips de kind, seed + dice, preview grande com contador de blocos/dimensões, write .nbt com o path real. O id do campo segue a tab (watch_post vs darksteel_ingot).
- **Bugs caçados pelos testes (2, de novo o valor da bateria)**: chaminé do cottage estourando o size declarado (bound assert); cast `u32 as i32` virando coordenadas negativas no rubble do ruin. Fix + re-prova. cargo **55/55** (+3).

**2. Polimento visual (o "máximo de qualidade visual")**:
- **Títulos brand-gradient** em todas as páginas principais (Launcher, Projects, Server Studio, Shader Studio, Modpack Creator, Asset Studio — o `.text-brand-gradient` que a Home já usava).
- **EmptyState com arte própria**: ilustrações pixel-art SVG da marca (cubo isométrico com nós neon, spark, server rack) com glow — aplicadas nos painéis vazios dos Modpacks (jars/shaderpacks/instâncias) e no Launcher. `EmptyArt` exportado para reuso.
- O h1 do Studio usa a util compartilhada (sem duplicar o gradiente inline).

**React Compiler (lição da sessão 27 aplicada de novo)**: useCallback manual do preview desfeito em effect direto — 2 errors de "memoization could not be preserved" viraram 0.

**Verificação**: typecheck 0 ✓ · lint 0 errors (30 warns família) · vitest 65/65 ✓ · cargo **55/55** ✓ · vite build 2m40s ✓ · boot vivo 0 panics ✓. Release v0.4.1.

**Estado pós-sessão**: o Studio gera items, blocks E estruturas .nbt com preview isométrico; o app usa o gradiente da marca e arte própria nos estados vazios. Próximos naturais: o agent ganhar tool de structures, worldgen presets (a fatia "World"), editor visual de modpack, era 26.x.

---

## 30. Sessão 30 — Agent de structures + World Studio (dimensões reais)

**Pedido do dono**: "sim por favor continue com tudo" → os dois próximos naturais juntos.

**1. Agent tool `generate_structure`**: o AI Creator agora constrói estruturas de verdade no mesmo sandbox/auditoria (write-like: orçamento + snapshot). Princípio operacional atualizado: "quando o design pede um prédio ou monumento, torne REAL com generate_structure". O agente autoriza texturas de item, faces de bloco E estruturas .nbt carregáveis.

**2. World Studio v1 — dimensões custom no datapack do próprio mod**: dois JSONs (dimension_type = a física do reino; dimension = como gera) com **schemas factuais da era 1.20.1-1.21.1**:
- **4 presets**: eternal_realm (crepúsculo fixo 13:00, camas funcionam), depths (teto, meia-noite eterna), ember_wastes (ultrawarm estilo nether, âncoras de respawn, escala 8×), void_sanctum (canvas plano do void, 256 de altura)
- **1.21.2+ é RECUSADO com mensagem clara** — o schema mudou; não escrever algo que pode não carregar é mais honesto que fingir suporte. A UI mostra estado explicativo por versão.
- 4ª tab no Asset Studio com preview de traits do reino + path real + o comando /execute in-game no hint.

**Bugs caçados (2)**: `serde_json::json!` corrompido por replace (virou `serde_json!`); assert torto de effects escrito antes de compilar (limpo antes do primeiro build).

**Verificação**: typecheck 0 ✓ · lint 0 errors (30 warns família) · vitest 65/65 ✓ · cargo **57/57** (+2: pares válidos por preset com a física certa + guards de versão/id/traversal) ✓ · vite build 1m45s ✓ · boot vivo 0 panics ✓. Release v0.4.2.

**Estado pós-sessão**: o Studio tem 4 tabs (Item/Block/Structure/World); o agente gera arte e arquitetura. Próximos naturais: schema 1.21.2+ de dimensions, editor visual de modpack salvo, era 26.x, push externo.

---

## 31. Sessão 31 — Dimensions na era moderna + Modpack Library

**Pedido do dono**: "sim continue" → os dois próximos naturais.

**1. World Studio cobre 1.21.2-1.21.8**: a mudança factual da era (24w40a) — int providers achatados, `uniform` perdeu o wrapper `"value"` — aplicada por versão: 1.20.1-1.21.1 mantém o formato wrapped; 1.21.2+ emite o flattened. Cobertura = **toda a faixa dos templates (1.20.1-1.21.8)**; a rework 26.x continua um não-honesto. Testes provam os DOIS formatos byte-a-byte.

**2. Modpack Library**: os zips exportados deixam de sumir depois do toast. `modpack_list` lê o manifest de CADA zip (nome, versão, MC, loader, contagens, createdAt, tamanho) e a página mostra a biblioteca com 3 ações reais: **instalar na instância selecionada com um clique** (sem file dialog), reveal, delete (name-guarded, traversal recusado). Zips sem manifest VOXEL são pulados, nunca adivinhados.

**Bugs/operacional (3)**: (1) o bloco `monster_spawn_light_level` do replace python não cashou (o arquivo já usava `json!(` pós-fix da sessão 30) — o teste pegou que o schema não estava sendo aplicado de fato; edit cirúrgico corrigiu; (2) `&str` vs `String` nos asserts do delete (cargo test --no-run revelou após um hang); (3) **pkill self-match de novo** (agora com "GradleDaemon" — generalizar SEMPRE o bracket-trick `[x]` para qualquer pattern pkill); nota: `cargo test --quiet | grep` pode esconder erros de compilação em pipe — usar `--no-run` quando suspeitar.

**Verificação**: typecheck 0 ✓ · lint 0 errors (30 warns família) · vitest 65/65 ✓ · cargo **58/58** (+1) ✓ · vite build 1m54s ✓ · boot vivo 0 panics ✓. Release v0.4.3.

**Estado pós-sessão**: World Studio cobre 1.20.1-1.21.8; modpacks têm ciclo completo (export→library→install/delete). Próximos naturais: era 26.x (research), editor DENTRO do zip (editar manifest/re-pack), resource packs completos (pack.mcmeta + pasta), marketplace local.

---

## 32. Sessão 32 — Documentação viva nos três níveis + research da era 26.x

**Pedido do dono**: "continue com todos, também quero que na pasta dos servidores e mods ou modpacks, faça um arquivo com todas as informações, objetivos, como instalar" → documentação própria em TODOS os níveis de entrega.

**1. Servers — README.md na pasta do servidor**: escrito pelo `server_create` **ANTES do download do jar** (existe aconteça o que acontecer) com fatos lidos do `server.properties` REAL da pasta (port, MOTD, online-mode — nunca de memória): identidade, software/versão, RAM (com o comando java literal), como rodar (VOXEL + manual), backups, túnel playit.gg, nota legal. O **wizard reescreve com os módulos instalados**: para cada módulo, OBJETIVO fiel ao datapack gerado (economy: scoreboard nexus_coin + /trigger nexus_shop; prison: nexus_rank + warps + prestige; token: /trigger nexus_token set 1-5 → painel debita a SHA-256 chain) — **só documenta o que está instalado**.
- **Bug caçado (exótico)**: `#[test]` duplicado empilhado registrava o teste 2× no harness → duas execuções paralelas corriam o mesmo temp-dir (a race da sessão 12 disfarçada de flaky de lógica). O `--list` revelou; fix na macro.

**2. Modpacks — README.md dentro do zip**: identidade, conteúdo completo (mods com projeto de origem, shaders), **guia de instalação por loader** (links dos instaladores oficiais fabricmc.net/files.minecraftforge.net/neoforged.net, pastas mods/shaderpacks) + o caminho de 1 clique do VOXEL. O import passou a aceitar README.md como documentação do pack.

**3. Mods — os 5 templates ganham "How to install the compiled jar"** (caminho VOXEL + manual .minecraft/mods).

**4. Research da era 26.x (o "continue com todos")**: **descoberta — a organização `NeoForgeMDKs` publica mirrors por versão** (o repo neoforged/MDK agora aponta pra lá). MDK-26.3-ModDevGradle estudado: **ModDevGradle 2.0.148, Java 25, Gradle 9.2.1**, lang `itemGroup.` igual, estrutura de templates igual, `neo_version 26.3.0.69-beta`, range `[26.3]`. O template 26.x é a próxima sessão (a API de items mudou demais para enfiar sem estudo — E2E real obrigatório).

**Bugs da sessão**: #[test] duplicado (harness duplicando execução); import recusava README.md (pegado pelo round-trip); `push("\n")` char vs str; assert que não sobrevivia aos próprios `**` do markdown.

**Verificação**: typecheck 0 ✓ · lint 0 errors (30 warns) · vitest 65/65 ✓ · cargo **59/59** ✓ · vite build 2m59s ✓ · boot vivo 0 panics ✓. Release v0.4.4.

**Estado pós-sessão**: servers, modpacks e mods documentam a si mesmos com fatos reais. Próximo natural: **template neoforge-26.x** (MDK-26.3-ModDevGradle + API de items 26.x + Java 25 via toolchain + E2E real), depois marketplace local.

---

## 33. Sessão 33 — O comando /mine é REAL + tabelas de comandos nos READMEs

**Pedido do dono**: "atualize o arquivo de servidor… com os comandos dos servidores. Exemplo: (Prison) /mine ou /mineirar — da tela de loading personalizada e teleporta o jogador para as minas para minerar. Etc… faça a parte dos comandos também nos servidores que o usuário fizer."

**1. `/mine` implementado de verdade** (não documentação de desejo): o datapack Prison registra o trigger `nexus_mine` (qualquer player dispara sem OP):
- **Tela de loading personalizada**: title ⛏ MINAS + "Entrando nas minas…" + som de amethyst, depois DUAS barras de progresso agendadas (`[██████████░░░░░░░░░░] carregando` → `quase lá` → `████… completa!`) via `schedule function` — a experiência completa em datapack vanilla.
- **Teleporta para A MINA DO RANK ATUAL**: 0-9 → Mina A, 10-29 → Mina B, 30+ → Mina C, com som de level-up e mensagem-guia. Trigger consumido (`scoreboard players set @s nexus_mine 0`) — pode disparar de novo.
- *Nota honesta*: comandos com nome custom (`/mine` literal) exigem plugin; datapacks vanilla registram `/trigger` — documentado como tal no README.

**2. Tabelas de comandos nos READMEs de TODOS os servidores criados**: cada módulo instalado documenta seus comandos REAIS (fidelidade verificada contra as mcfunctions geradas — um `/function nexus_token:shop` que NÃO existia foi pego e corrigido para `:balance`): economy (deposit/balance/top/pay_nearest), prison (**nexus_mine com a descrição exata do dono**, status, warp_a/b/c, progressão automática), token (intents 1-5, saldo da chain, painel VOXEL). **Nova seção "Server commands (always available)"** com a tabela vanilla de administração (op/deop, gamemode, tp, time, whitelist, stop, /reload) + a nota de que /trigger dispensa OP.

**Bug caçado**: comentário mcfunction (`#`) cravado dentro do objeto JS pelo python-insert (syntax error esbuild pegou).

**Verificação**: typecheck 0 ✓ · lint 0 errors (30 warns) · **vitest 66/66** (+1: trigger registrado/consumido, barras agendadas, warps por rank) ✓ · **cargo 59/59** (README renderiza as tabelas, incluindo a linha do /mine com a descrição do dono) ✓ · vite build 1m36s ✓ · boot vivo 0 panics ✓. Release v0.4.5.

**Estado pós-sessão**: os módulos têm UX de gameplay de verdade e os servidores se documentam com comandos. Próximo natural: template neoforge-26.x (research pronta), mais módulos (SkyBlock/Factions/BedWars), marketplace local.

---

## 34. Sessão 34 — Três módulos de gameplay reais (SkyBlock/Factions/BedWars)

**Pedido do dono**: "sim quero todos" → os próximos naturais. **Decisão sênior sobre o 26.x**: a API de espadas/modelos de itens da era 26.x não é verificável offline com a certeza que a casa exige (o E2E de compilação NÃO valida render de modelos) — a research completa (MDK baixado, DeferredRegister 26.3 mapeado, wrapper 9.2.1, Java 25) está documentada e o template vira sessão dedicada com estudo empírico. Nada semi-feito. Em vez disso: os 3 módulos de gameplay do §9.7, 100% entregáveis com provas.

**1. SkyBlock Islands** — o load CONSTRÓI 16 ilhas reais num grid no céu (x = n×200, y=120): plataformas 5×5 de dirt, árvore inicial, e um baú de boas-vindas com kit NBT (machado, picareta, 6 pães, 2 brotos). `/trigger nexus_skyblock` reivindica o próximo slot livre (anúncio no servidor) e teleporta para casa para sempre — **coordenadas literais por slot, o padrão honesto de 1.20.1** (datapacks não têm tp dinâmico). Capacidade honesta: 16 ilhas; quando acabam, o comando AVISA em vez de inventar espaço.
**2. Factions War** — 3 times coloridos (Ember/Tide/Verdant) com friendly-fire off; join via `/trigger nexus_factions set 1-3` com anúncio; cada abate de jogador pontua pro time pelo **statistic REAL** (`custom:minecraft.player_kills`), com calls só pro time, e tabela da guerra sob demanda.
**3. BedWars Lite** — `/trigger nexus_bedwars` limpa o inventário, entrega kit (espada, 16 tábuas, 3 bifes), teleporta pra arena no céu com contagem 3-2-1 + LUTE!; cada cama vermelha minerada — pelo **statistic real** (`mined:minecraft.red_bed`) — anuncia o destruidor pro servidor INTEIRO com trovão e title.

READMEs documentam os 3 com tabelas de comandos; o wizard oferece os checkboxes automaticamente.

**Bugs caçados (2)**: o rascunho inicial do SkyBlock saiu semi-feito (comentário-explicação no lugar de código — INACEITÁVEL pela regra da casa): detectado na revisão antes de commitar e REFEITO com o design de grid real; replace python não casou com o dispatch real (param `moduleId`) — generators entraram só na 2ª tentativa.

**Verificação**: typecheck 0 ✓ · lint 0 errors (30 warns) · **vitest 69/69** (+3 módulos: setblock counts, chest NBT, warps por slot, cap message, teams/kills, kit/arena/cama) ✓ · **cargo 59/59** ✓ · vite build 6m53s ✓ · boot vivo 0 panics ✓. Release **v0.5.0** (minor: módulos de gameplay).

**Estado pós-sessão**: 6 módulos de gameplay (economy/prison/token/skyblock/factions/bedwars), todos com README e comandos reais. Próximos naturais: template neoforge-26.x (research pronta, sessão dedicada), marketplace local, editor de modpack, mais presets de servidor com os módulos novos.

---

## 35. Sessão 35 — A era 26.x: 6º template E2E-provado + presets com módulos reais

**Pedido do dono**: "sim faça tudo" → a sessão dedicada da era 26.x (decisão sênior da S34) + presets com os módulos novos.

**1. Template `neoforge-26.x-mod` (30 arquivos)** — derivado do mirror oficial **`NeoForgeMDKs/MDK-26.3-ModDevGradle`**: MDG **2.0.148**, wrapper **Gradle 9.2.1**, **Java 25** (o toolchain foojay baixa sob demanda), `loader_version_range [4,)`.
- **O E2E provou a maior verdade da era ANTES de qualquer usuário**: `SwordItem` NÃO EXISTE em 26.x — stats de arma viraram data components. O template registra a identidade da lâmina honestamente (épica, fire-immune, com NOTE apontando a era de components) + **item model definitions** (`assets/<ns>/items/*.json`, formato 1.21.4+) ligados aos models/textures/lang clássicos.
- **Sem data files no template da era** — recipes/advancements ficam a cargo do agent com a versão na mão; nada de chute.
- Catalog: disponibilidade NeoForge estendida a **26.1-26.3** (4 eras no templateId), `javaReleaseFor` mapeia 26.x→**25** (aceito no guard Rust). Wizard explica as 4 eras.
- **E2E REAL**: `dark_kingdom-0.1.0.jar` compilado com **neoforge:26.3.0.76** e toolchain Java 25 — 19 min na primeira (NeoForm decompile + download do JDK), **71s morno**. **6/6 templates E2E**.

**2. Presets com os módulos REAIS**: o preset `skyblock-isles` (S15) finalmente merece o nome — datapack constrói as 16 ilhas + `/trigger nexus_skyblock`; o `pvp-arena` embarca **Factions War + BedWars Lite**. Allowlist de módulos no teste segue.

**Verificação**: typecheck 0 ✓ · lint 0 errors (30 warns) · vitest **69/69** ✓ · cargo **60/60** (+1 render 26.x) ✓ · vite build 1m27s ✓ · boot vivo 0 panics ✓. Release v0.5.1.

**Estado pós-sessão**: **6 templates E2E** (Fabric, Forge, NeoForge ×4 eras até 26.3), 6 módulos de gameplay, 10+ presets reais. Próximos naturais: marketplace local, editor de modpack salvo, o agent usando as estruturas .nbt nos worlds, mais eras de módulos com estrutura+datapack combinados.

---

## 36. Sessão 36 — Marketplace local + Editor de modpack + guidance do agent

**Pedido do dono**: "sim continue, quero que faça tudo."

**1. Marketplace local (`/marketplace`, sidebar Store, Ctrl+K)** — hub de vitrine com TUDO real do workspace:
- **Modpacks**: cards com os fatos do manifest (versão, data, loader, MC, contagens, tamanho) + install 1-clique na primeira instância preparada + reveal.
- **Shaderpacks**: cards com **swatches de céu REAIS** — o gradiente é a paleta do próprio estilo (skyTop → horizonte misturado) com o sol da paleta brilhando no canto — + install 1-clique.
- **Your mods**: projetos buildados com o dot de status vivo e **Play** (LaunchDialog provado).
- Empty states com a arte da marca roteando pro lugar certo. Zero listagem falsa: tudo vem de commands reais.

**2. Editor de modpack salvo**: `modpack_update_manifest` reescreve o manifest DENTRO do zip (re-pack completo: README acompanha a nova identidade, **jars/shaders preservados byte a byte**, swap atômico via temp sibling + rename — falha nunca corrompe pack existente). A Library ganha o lápis → dialog de name/version. Testes: round-trip com byte-identical, guards (pack ausente, traversal, campos vazios).

**3. Agent**: guidance atualizada — estruturas geradas são carregáveis in-game com `/place template <mod_id>:<id>` (o datapack do mod).

**Bugs da sessão**: rascunho de validação inválido no update (linha perdida); `Read::read_to_end` da ZipFile pede buffer por referência (API std) — 3 erros de compilação corrigidos cirurgicamente; tipos Rgb vs number[] no swatch (spread resolveu).

**Verificação**: typecheck 0 ✓ · lint 0 errors (31 warns) · vitest 69/69 ✓ · cargo **61/61** (+1 editor) ✓ · vite build 12m24s (máquina carregada) ✓ · boot vivo 0 panics ✓. Release v0.5.2.

**Estado pós-sessão**: marketplace local + editor + agent guidance entregues. Próximos naturais: módulos estrutura+datapack (monuments para SERVIDORES), mais assets visuais (32x32? blocks com variação), publicação/backup do workspace inteiro, push externo.

---

## 37. Sessão 37 — Módulo Monuments (.nbt nos servidores) + Workspace Snapshots

**Pedido do dono**: "sim continue com tudo."

**1. Módulo Monuments — o Structure Studio encontra os Server Modules**: datapack com **estruturas .nbt REAIS** (as 4 receitas: watchtower/cottage/obelisk/ruin) escritas DENTRO do datapack do módulo pelo gerador Rust (`output_kind: "server_module"` → `world/datapacks/nexus_monuments/data/.../structures/`, com o DataVersion da era do servidor). `/trigger nexus_monument set 1-4` **ergue a estrutura onde o player está** (`/place template`, 1.19+) com title de build-up, beacon activate e rumble de wither. O wizard gera os 4 .nbt (seeds estáveis) logo após instalar os datapacks. README documenta cada monumento.

**2. Workspace Snapshots**: `workspace_export_snapshot` empacota **o trabalho de autoria** — projects (sources + .voxel), shaderpacks, modpacks — num zip timestampado em `backups/snapshots/`, **excluindo honestamente** build outputs, caches e instâncias baixadas (produtos recriáveis). O `SNAPSHOT.json` dentro declara includes/excludes e como restaurar. UI: Settings → Storage, export 1-clique com toast factual + reveal.

**Bugs caçados (3)**: guard de output_kind validado só no branch de escrita (preview passava com kind inválido — teste pegou, hoisted); imports duplicados (toast/openInFileManager já existiam); trait `std::io::Write` ausente no storage.rs (write_all não resolvia).

**Verificação**: typecheck 0 ✓ · lint 0 errors (31 warns) · vitest **70/70** (+1 monuments) ✓ · cargo **63/63** (+2) ✓ · vite build 2m12s ✓ · boot vivo 0 panics ✓. Release v0.5.3.

**Estado pós-sessão**: 7 módulos de gameplay (monuments é a ponte Studio↔Servers), snapshots protegem o trabalho. Próximos naturais: presets usando monuments, import de snapshot (restauração guiada), push externo (backend), curadoria/backup automático agendado.

---

## 38. Sessão 38 — Restauração guiada de snapshot + presets com os módulos novos

**Pedido do dono**: "continuar."

**1. Restauração guiada (`workspace_import_snapshot`)**: o caminho de volta SEGURO por construção:
- Só snapshots VOXEL (`SNAPSHOT.json` é o contrato); só as seções conhecidas voltam (qualquer outra entrada no zip é RECUSADA, zip-slip incluso)
- **NADA é sobrescrito jamais**: entradas que já existem são puladas E reportadas — restore só ADICIONA trabalho de autoria, nunca destrói mudanças locais (provado byte a byte no teste: trabalho local mais novo preservado)
- UI: Settings → Storage, "Restore snapshot…" com file dialog + toast factual (restaurados/pulados/data do snapshot)
- cargo **65/65** (+2: round-trip completo, never-overwrite byte-identical, zips estranhos/contrabando de seções recusados)

**2. Presets adotam os módulos novos**: **Creative Workshop + Monuments** (`/trigger nexus_monument` ergue estruturas reais no canvas criativo) e **Hardcore Realm + Factions War** (uma vida, um time — cada kill pontua pra Ember/Tide/Verdant).

**Bugs**: import duplicado do plugin-dialog (o `open` já existia — alias resolvido).

**Verificação**: typecheck 0 ✓ · lint 0 errors (31 warns) · vitest 70/70 ✓ · cargo **65/65** ✓ · vite build 2m52s ✓ · boot vivo 0 panics ✓. Release v0.5.4.

**Estado pós-sessão**: snapshot com ciclo completo (export→restore nunca destrutivo), 4 dos 10+ presets usando os 7 módulos. Próximos naturais: backup automático agendado, push externo (backend), mais estilos de módulo monument (custom seeds pelo painel), world presets.

---

## 39. Sessão 39 — Snapshots agendados + seed de monuments do dono

**Pedido do dono**: "sim quero que faça todos."

**1. Snapshots automáticos (`snapshot_auto_check`)**: o app aberto + cadência ligada (Off/Diário/Semanal em Settings→Storage) + último run stale → **snapshot completo dispara sozinho** com toast discreto. O timestamp do último run vive **ao lado dos snapshots** (`last-auto.json`) — sobrevive a resets do DB e viaja com o workspace. Boot hook pós-hydrate, silencioso quando off ou em dia. *Push externo (FCM/APNs) documentado como precisa de backend — não inventado.*

**2. Seed de monuments do dono**: com o módulo Monuments marcado, o wizard mostra o input de seed ("mesmo seed, mesmo skyline") — todos os .nbt daquele servidor nascem da seed escolhida em vez do default.

**Bugs**: off-by-one de horas restantes no teste (24h reais vs 23 do assert — o teste ensinou a matemática); `modules` é Set (`.has`, não `.includes`) e o state do seed não casou na 1ª tentativa.

**Verificação**: typecheck 0 ✓ · lint 0 errors (31 warns) · vitest 70/70 ✓ · cargo **66/66** (+1 auto) ✓ · vite build 2m19s ✓ · boot vivo 0 panics ✓. Release v0.5.5.

**Estado pós-sessão**: snapshot com ciclo completo E agendamento; monuments personalizados por servidor. Próximos naturais: push externo (backend quando o dono decidir), world presets para servidores, módulos 2.0 (estrutura+economia combinados), mais eras de research (26.4+ quando existirem).

---

## 40. Sessão 40 — Módulo Custom Realm: dimensões nos servidores

**Pedido do dono**: "continue" → o world preset para servidores.

**Módulo `realm` (o 8º)** — uma dimensão custom REAL no datapack do servidor: `dimension_type` (física: crepúsculo eterno 13:00, céu, camas, 384 alto) + `dimension` (noise generator com biomas overworld), o MESMO schema era-factual do World Studio para mods:
- A versão do servidor entra em `ModuleInstallOptions` e decide o formato do int provider (wrapped <1.21.2, flattened ≥1.21.2) — provado por testes que FAZEM PARSE do JSON real
- 26.x → nota UNSUPPORTED honesta em vez de dimensão que pode não carregar
- Pack com README próprio (o comando /execute in)
- **Preset Vanilla Survival adota o realm** — o clássico puro, mais um segundo mundo a um comando de distância
- README do servidor documenta o realm + comando de viagem

**Verificação**: typecheck 0 ✓ · lint 0 errors (31 warns) · vitest **72/72** (+2) ✓ · cargo **66/66** ✓ · vite build 1m53s ✓ · boot vivo 0 panics ✓. Release v0.5.6.

**Estado pós-sessão (40 sessões, 8 módulos)**: a plataforma cobre criação de mods (6 eras), 8 sistemas de gameplay para servidores (incluindo dimensões e estruturas .nbt), marketplace/snapshots com ciclo completo e agendamento, mobile completo. Próximos naturais: push externo (backend), módulos 2.0 combinados (realm+monuments: monumentos NA dimensão), QA pass geral dos 31 warns set-state-in-effect.

---

## 41. Sessão 41 — Correções do dono: criar/excluir + servidores ao vivo + online + nerdzone

**Bug report do dono**: não conseguia criar servidor; não conseguia excluir projetos; queria tempo real (app/servidores), criar servidor ONLINE e local, servidores existentes ao vivo, importar estilo (nerdzone.gg → prison com coin e chain), e melhorias (i18n/chat/asset studio ficam para a S42).

**Corrigido na raiz**:
1. **Criar servidor**: o botão ficava disabled silenciosamente (EULA/port/nome) — agora SEMPRE clicável e cada clique explica o que falta (toast do EULA diz onde o checkbox está). Erros de jar continuam propagando com detalhe.
2. **Excluir projetos**: o delete vivia escondido no menu ⋮ da lista — o header DO PROJETO agora tem o botão visível, com o mesmo confirm por slug (dialog extraído reutilizável), voltando pra lista com segurança.
3. **Tempo real**: a ServersPage já pollava status a cada 5s — agora também tem a seção **"Community servers — live"**: TODAS as referências públicas (nerdzone.gg inclusa) pingadas com SLP REAL a cada 45s, com players/versão nos cards e offline honesto.
4. **Criar ONLINE**: wizard ganha **"Make it public (playit.gg)"** — pós-criação sobe o túnel grátis e o endereço *.playit.gg aparece no console. LOCAL segue o default.
5. **nerdzone.gg → seu servidor de prison+chain**: na lista pública + heurísticas de inferência ricas (prison/cell/prestige/minerar/coin/crypto/chain/loja) + allowlist da IA com os 8 módulos + o card "Use this style" que **pinga o servidor REAL e pré-preenche o preset com os módulos certos** (prison-break carrega prison+economy+token — exatamente o fluxo pedido). **E2E REAL: nerdzone.gg respondeu com 1220 players.**

**Testes**: vitest **74/74** (+2: inferência prison/coin-chain com módulos reais) · cargo 66/66 · E2E SLP com nerdzone vivo ✓.

**Ficam para a S42 (documentado)**: i18n PT-BR completo do app, chat de alterações no Asset Studio (reuso do agente), UX do build (progresso), conexão projeto↔servidor (deploy).

**Verificação**: typecheck 0 ✓ · lint 0 errors (31 warns) · vite build 2m07s ✓ · boot vivo 0 panics ✓. Release v0.5.7.

---

## 42. Sessão 42 — Português (Brasil) no app inteiro + chat do agente no Studio

**Pedido do dono** (da S41, documentado): tradução PT-BR do app inteiro + chat para pedir alterações no Asset Studio.

**1. i18n honesto por construção**: `t("English text")` consulta o dicionário ativo (pt-BR completo) e **cai de volta no próprio inglês** quando uma string ainda não tem tradução — a UI nunca mostra key quebrada e a cobertura cresce incrementalmente. Setting em Settings→General (Auto/English/Português), aplicado no hydrate e nas trocas (sem restart). Detector de idioma do SO para o Auto.
- **Superfícies traduzidas**: navegação completa (sidebar, breadcrumb, command palette), títulos, seção Community servers ao vivo, seções de modpacks/marketplace/studio, header do workspace, ações comuns (criar/excluir/cancelar/jogar/instalar), labels do Studio.
- Strings residuais migram por incremento (o sistema aceita crescer sem quebrar nada).

**2. Chat de alterações no Asset Studio**: o box "Want a change, improvement or something new?" — descreva ("add a ruby sword with red glow") e o pedido **vai para o AI Creator com ESTE projeto pré-selecionado e o prompt pré-carregado** (nunca auto-envia: o usuário revisa e dispara — nada roda às cegas). Handoff via uiStore (`aiHandoff`), consumido no mount e limpo.

**Bugs**: replace de uiStore que não casou com o real (edit direto corrigiu); togglePalette mudou de assinatura num refactor antigo (0-arg) — teste de atalho pescou.

**Verificação**: typecheck 0 ✓ · lint 0 errors (33 warns família) · **vitest 77/77** (+3 i18n: dicionário são, tradução real, fallback) ✓ · vite build 1m39s ✓ · boot vivo 0 panics ✓. Release v0.5.8.

**Estado pós-sessão**: app bilíngue (EN/PT-BR com detector de SO), Studio fala com o agente. Próximos naturais: ampliar a cobertura de strings do pt-BR para os diálogos profundos (wizard completo, toasts), UX do build (progresso), conexão projeto↔servidor (deploy de datapack/estrutura no servidor alvo).

---

## 43. Sessão 43 — Deploy projeto↔servidor + tempo real do build + pt-BR amp

**Pedido do dono**: "continue" (os próximos naturais da S42).

**1. A conexão projeto↔servidor (o "servidores conectados com os projetos em tempo real")**: **`project_deploy_datapack`** — copia o datapack do projeto (estruturas .nbt, dimensões, advancements — tudo sob `data/`) para `world/datapacks/project_<slug>/` do servidor escolhido: o que o agente constrói no mod fica **carregável in-game no SEU servidor**.
- pack.mcmeta com o formato lido do **próprio pack de módulo do servidor** (manifest real, nunca adivinhado)
- Re-deploy do mesmo projeto **substitui atomicamente** (staging + rename; antigo pro lixo) — outros packs **nunca tocados** (teste prova o módulo sobrevivendo intacto)
- Botão **Deploy** no header do workspace com picker de servers **da MESMA versão** (formatos são era-bound; incompatíveis explicam o porquê)
- Toast factual: nº de arquivos + o que detectou (structures/dimensions) + como carregar (restart ou /reload)

**2. UX do build**: tempo decorrido no drawer — **contador vivo enquanto builda** (tick state: `Date.now()` fora do render — o React Compiler pegou a chamada impura e eu refatorei pro padrão certo) + segundos finais ao lado do badge de status.

**3. pt-BR amp**: wizard de servidor (nome/porta/RAM/módulos/CTA), dialog de deploy, box do agent no Studio, hints de import.

**Bugs**: mcmeta com escapes quebrados (reescrito com serde_json::json!); anchor de teste com nome antigo; `Date.now()` impuro no render (compiler); `building` usado antes da declaração (reordenado).

**Verificação**: typecheck 0 ✓ · lint 0 errors (33 warns) · vitest 77/77 ✓ · cargo **67/67** (+1 deploy) ✓ · vite build 1m26s ✓ · boot vivo 0 panics ✓. Release v0.5.9.

**Estado pós-sessão**: o ciclo completo existe: criar mod → agent constrói (texturas/estruturas/dimensões) → **deploy no seu servidor** → jogar. Próximos naturais: auto-deploy pós-build (setting), mais strings pt-BR nos diálogos profundos, monitor de servidor no workspace (console embutido no projeto com deploy alvo).

---

## 44. Sessão 44 — HOTFIX: a área de Servidores congelava o app (corrigido na raiz)

**Bug report do dono**: "estou tendo problemas com a área de Servidores, está deixando meu computador muito lento e não responde."

**Causa raiz (arquitetural)**: Tauri 2 executa commands **síncronos na MAIN THREAD** — e os nossos faziam rede/disco lá:
- `server_ping` (DNS + SRV + TCP, timeouts 8-10s) em **loop serial** × 8 públicos a cada 45s + self-ping do console = até ~80s de main thread bloqueada por ciclo → **UI inteira congelava**
- `server_status` (5s × servidor), `launcher_overview` (I/O de disco por instância), `modpack_list` (leitura+parse de cada zip) — todos no fio principal

**Fix (4 commands → async com spawn_blocking, impls síncronas preservadas para os testes)**: server_ping, server_status, launcher_overview, modpack_list. O ping do bridge (mobile) também awaits. **Main thread nunca mais bloqueia com rede/disco.**

**Frontend (ServersPage)**: status checks em **paralelo** (era 1 await por servidor em série), pings públicos em **paralelo via allSettled**, e **ambos os loops pausam 100% com a janela oculta** (visibilitychange) — zero custo em background quando você sai da aba.

**Verificação**: cargo 67/67 ✓ · vitest 77/77 ✓ · typecheck 0 ✓ · lint 0 errors (33) ✓ · vite build ✓ · **boot vivo 0 panics** ✓. Release **v0.5.10** (hotfix).

**Lição permanente registrada**: commands Tauri com rede/disco/zip são SEMPRE `async` + `spawn_blocking` (impl síncrona separada para testes). Os outros commands pesados (server_backup, e2e de compilação) já rodam sob demanda do usuário, não em polling — revisão futura se algum entrar em loop.
