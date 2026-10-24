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

### 3.1 Superfícies novas (Fases A–D do Super Prompt 02, S51–59)
```
Rotas/páginas: /logic (Visual Logic Studio) · /designer (Gameplay Designer) ·
  /assets (Asset Lab + consistency checker + import validado) · /compat (Compatibility Lab) ·
  /command (AI Command Center) · /knowledge (Knowledge Center, ligado aos erros do Error Center) ·
  /qa (QA Lab — a matriz de vereditos honesta)
Services novos: services/logic/logicGraph(+Service) · services/gameplay/gameplayDesigner ·
  services/assets/assetLab · services/compat/compatService · services/projects/timelineService +
  memoryService (bibles + contradições por IA) · services/ai/taskEngine(+test/Runners/Boot) +
  aiMetrics (fallbackModel nas settings) · services/qa/qaLab · services/knowledge/knowledgeBase ·
  services/servers/{customCommands, currencyService(+FX), aiServerStudio, economySimulator,
  securityCenter, dossier via Rust} · services/documents/documentsService (txt/md/pdf/docx)
Rust novo (desde v0.5): documents.rs (extração real 4 formatos) · dossier.rs (30+ páginas × 6
  formatos: PDF writer próprio, DOCX/ODT reais) · fx.rs (BCE ao vivo, cache 1h) · diagnostics.rs ·
  server_import_world/structure/update_metadata + servers_scan_disk (self-heal disco↔DB) ·
  search_workspace (busca unificada) · modrinth server_plugins · pdf-extract crate
Migrations: 001 + 002 + 003 (tasks + ai_metrics)
Testes: vitest 154 · cargo 89 (+11 E2E) · render-smoke jsdom dos 5 dialogs críticos
```

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

## 5. Histórico de sessões (60 sessões)

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
| 60 | Fase D: Players + Moderation | **Player Management** (5 arquivos vanilla reais via server_players_read; ações pelo console stdin; ban exige motivo; histórico migration 004) + **Moderation Assistant** (heurística local + IA cuja sugestão exige evidence LITERAL do log; ban da IA vira watch; aplicar é sempre clique) + 15 TS + 4 Rust + v0.17.0 | replace vazou no lib.rs; helper morto; assert antes do write; .settings.ai |
| 59 | Fase D: Simulator + Security | **Economy Simulator** (progressão Prison REAL com prestígio composto, exploits e gargalo; disclaimer SIMULATION) + **Security Center** (RCON plain-text/sem senha, online-mode do DISCO, backups com idade, plugins com caveat de origem; nunca "totalmente seguro") + 13 testes + v0.16.0 | evidence sem "plain text"; var morta; dup ptBR |
| 58 | Fase C COMPLETA | **Knowledge Center** (8 artigos com PROVA+fontes oficiais, busca ranking, link do Error Center por categoria, +5 testes) + **QA Lab** (matriz 4 níveis: runtime nunca fingido, limitação REGISTRADA, Fix Build no veredito, +6 testes) + v0.15.0 | patch degradou BuildDrawer (restaurado); import duplo |
| 57 | Fase C: Task Engine + Command Center | **Engine de fila real** (storage injetável, cancel cooperativo, retry, limites 1/20, +7 testes) · **runners**: agent headless (política autônoma) + workflow Fix Build 6 etapas checkpointadas · **Model Router v2** (fallback 1× pré-delta; métricas reais em ai_metrics) · **/command** (fila viva + métricas honestas) + v0.14.0 | template string no bash; icons regex 3ª vez; queue privada |
| 56 | Fase B COMPLETA | **Compatibility Lab** (4 checks com evidência+fix, Java da era vs máquina, gradle.properties real, matriz versão×loader, +6 testes) + **Style Memory** (bibles editáveis com fallback .nexus; contradições por IA onde todo achado cita as passagens — parser descarta inventados, +3 testes) + v0.13.0 | regra Java severa demais (teste reprovou); title no Lucide |
| 55 | Fase B: Asset Lab | **Biblioteca real** (previews de pixel, busca/filtros) + **consistency checker** (referências quebradas/ausências/lang órfã/duplicatas por hash de bytes) + **import validado** (header PNG real, rejeitado é removido) + rota /assets + v0.12.0 | — |
| 54 | Fase B: Gameplay Designer | **Editor nos arquivos REAIS do mod**: scanner nos 3 estilos de loader, status de implementação por item (java/model/lang/texture/recipe), criar item escreve tudo coerente (lang MERGEADO), receitas shaped/shapeless reais + 6 testes + rota /designer + v0.11.0 | tupla de rows; vírgula dupla; 3 dups ptBR |
| 53 | Fase B: Visual Logic Studio | **Grafo de nós → mcfunctions REAIS** (19 kinds mapeados em padrões vanilla provados; compilador com chains Token-Chain + predicates; validador que compila nada com erro; 6 testes) + canvas React Flow com Preview real, AI designer estrito, Save/Install + rota /logic + v0.10.0 | typo });; compilador misturado; var morta |
| 52 | Fase A fechada | **Search Engine unificado** (Ctrl+K vivo: projetos+arquivos+servidores+shaderpacks+modpacks, walker guardado, +1 teste) · **Project Timeline** (builds+auditoria do agent+snapshots+sessões, filtros, botão no workspace) · componente Skeleton aplicado + v0.9.0 | budget u32 vs usize; campo preview inexistente |
| 51 | Fase A: auditoria + 2 reports | **Build provado são (E2E 306s)** + Error Center categoria `environment` (Java/rede/disco com FIX, +4 testes) · **dialogs provados vivos** (render-smoke jsdom 5/5 suite permanente) · 3 docs de auditoria (classificação honesta por sistema, Fases A-G) + v0.8.1 | jsdom 27 ESM conflito (→@24) |
| 50 | Delete fix + AI Studio + rename | **Causa raiz do delete no Windows** (daemon do Gradle segura a pasta → project_delete: stop + retries + erro que nomeia o item) · **AI Studio** (prompt → plano validado → previews reais → install) · kinds **mine/prison** procedurais (o caso Prison com veios de minério) · renomear servidor + v0.8.0 | newline em key de properties; torre torta; chars de heredoc |
| 49 | Dossiê profissional + classe trava final | **PDF reconstruído**: capa, TOC com páginas reais (2 passadas), footer Page N of M, tabelas com banda roxa+zebra, código em caixas, WinAnsi-safe; DOCX com w:tbl reais; curadoria do conteúdo. **14 commands pesados → async** (create_project, server_delete, git push/commit, snapshots, search, modpack trio, structure, ledger×5). Testes pescaram: wrap quebrava por palavra (67→31 páginas honestas), TOC page 0, footer duplicado, em-dash WinAnsi + v0.7.1 | — |
| 48 | Dossiê + Moeda + Comandos de mod | **Dossiê do servidor 30+ páginas em 6 formatos reais** (PDF writer próprio, DOCX/ODT válidos, HTML, TXT, MD; gerado no create + salvo onde quiser); **moeda própria com economia REAL** (BCE ao vivo USD→BRL/EUR, diluição mais-tokens-menos-valor, supply do ledger, compliance in-game honesto); **comandos custom que viajam DENTRO do jar** (datapack do mod remapeado, editor compartilhado) + v0.7.0 | entidades decodificadas 2×; nexus_ strip; tags do mod no lugar errado; stub de appendix |
| 47 | Autonomia total | **Briefing docs** (.txt/.md/.pdf/.docx reais: docx unzipped, pdf-extract) lidos pelo agente; **Customize Server** (import world .zip atômico, estruturas .nbt com /place, **comandos customizados com mobs NBT + /convert → wallet chain**, plugins Paper do Modrinth); world setup no wizard; defaults de servidor nas settings; v0.6.0 | entidades decodificadas pelo pipeline (code points); routing do convert fora do gate; extensão antes do conteúdo |
| 46 | Make it unbreakable | **Causa raiz do 2º "nada funciona"**: downloads podiam pendurar PARA SEMPRE (sem timeout total/retry) + app mudo com DB travado + servidor invisível se o row falhasse. Fixes: timeout 5min+retry+erros acionáveis; **diagnósticos reais** (Settings→Advanced, cada falha com o fix); **self-heal disco↔DB** (voxel-server.json + scan + reconcile); catálogo nunca-vazio; banner de emergência. **E2E do caminho async REAL** (download vivo ~10s) + v0.5.12 | ternário inexistente em Rust; expect_err exige Debug |
| 45 | Classe async + sprites animados | **13 commands de ação → async+spawn_blocking** (server_create/launcher_prepare/túnel/snapshots/backups/modpacks/shaders/modrinth/create_project — a classe inteira fora da main thread) + **sprites ANIMADOS** (strip 16×16×N + .mcmeta, preview CSS steps, agent frames) + v0.5.11 | overflow u8; slices do strip; frame_at de 1 linha; Reader sem height; nota sem newline |
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

## 8. Estado atual (verificado — Sessão 60, v0.17.0)

### Testes (TODOS verdes)
| Suíte | Resultado |
|---|---|
| Rust unit (89) | ✅ template×3 loaders (render+consistência), ledger+tamper, shaderpack, SLP parse, **bridge multimodal/PWA/dialects**, server presets merge |
| Vitest (105) | ✅ 32 shaders, gerador GLSL, errorParser, serverModules, **task-force personas + read-only toolset**, **loader availability + maven ranges** |
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
| **v0.17.0 (latest)** | Desktop: **Fase D — Player Management + Moderation Assistant** (Players tab, histórico de punições, IA grounded) + APK mobile 0.3.1 |
| v0.16.0 | Desktop: **Fase D abre — Economy Simulator (progressão Prison com exploits) + Security Center (RCON/online-mode/backups)** + APK mobile 0.3.1 |
| v0.15.0 | Desktop: **Fase C completa — Knowledge Center (docs verificadas ligadas aos erros) + QA Lab (a matriz de vereditos honesta)** + APK mobile 0.3.1 |
| v0.14.0 | Desktop: **AI Command Center** (fila de tarefas autônomas com checkpoints + Fix Build workflow + fallback de modelo + métricas reais) + APK mobile 0.3.1 |
| v0.13.0 | Desktop: **Fase B completa — Compatibility Lab (vereditos com evidência) + Style Memory (bibles + contradições por IA)** + APK mobile 0.3.1 |
| v0.12.0 | Desktop: **Asset Lab** (biblioteca de assets + verificador de consistência + import validado) + APK mobile 0.3.1 |
| v0.11.0 | Desktop: **Gameplay Designer** (registro real do mod, status por item, criação coerente, receitas reais) + APK mobile 0.3.1 |
| v0.10.0 | Desktop: **Visual Logic Studio** (grafo de nós → datapack real, com validador, preview das mcfunctions e AI designer) + APK mobile 0.3.1 |
| v0.9.0 | Desktop: **Fase A do Super Prompt fechada — Search Engine unificado (Ctrl+K) + Project Timeline + Skeletons** + APK mobile 0.3.1 |
| v0.8.1 | Desktop: **Error Center com diagnóstico de ambiente (Java/rede/disco) + auditoria profunda documentada** + APK mobile 0.3.1 |
| v0.8.0 | Desktop: **delete de projetos corrigido (daemon Gradle) + AI Studio (prompt gera tudo com preview) + kinds mine/prison + renomear servidor** + APK mobile 0.3.1 |
| v0.7.1 | Desktop: **Dossiê profissional (capa, sumário com páginas, rodapé, tabelas diagramadas) + 14 commands pesados agora async — nada trava** + APK mobile 0.3.1 |
| v0.7.0 | Desktop: **Dossiê 30+ páginas × 6 formatos + moeda própria com FX real (USD/BRL/EUR) + comandos dentro dos mods** + APK mobile 0.3.1 |
| v0.6.0 | Desktop: **era de autonomia** — briefing docs próprios que o agente lê + Customize Server (worlds .zip, estruturas .nbt, comandos custom com mobs e /convert, plugins Paper) + defaults nas settings + APK mobile 0.3.1 |
| v0.5.12 | Desktop: **downloads à prova de travamento (timeout+retry) + diagnósticos reais + self-heal disco↔DB + banner de emergência** + APK mobile 0.3.1 |
| v0.5.11 | Desktop: **classe async completa (ações nunca congelam) + sprites animados** + APK mobile 0.3.1 |
| v0.5.10 | Desktop: **HOTFIX congelamento da área de Servidores** + APK mobile 0.3.1 |
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
cd src-tauri && cargo test          # 89 unit
cargo test --lib -- --ignored --nocapture # 11 E2E (compilação ×6 templates, launcher, server, SLP, modrinth real) (compilação ×4 templates, launcher, server, SLP real)
pnpm --filter @voxel/mobile typecheck
gh run list --limit 4               # CI/Pages/Mobile/Release status
```

### Observabilidade / estado de runtime
- DB: `~/.config/dev.yuadevs.nexuscraft-studio/nexuscraft.db` (18 tabelas)
- Workspace default: **~/Voxel** (legacy ~/NexusCraft → migration one-click em Settings→Storage)
- Bridge: opt-in Settings→Mobile, token 8 chars, porta 3717, serve a PWA + API token-gated

## 8.9 MAPA DAS FASES do Super Prompt 02 (estado na Sessão 59 — detalhes vivos em docs/VOXEL_ADVANCED_ROADMAP.md)

| Fase | Estado | Entregues |
|---|---|---|
| **A — Fundação** | ✅ COMPLETA | Auditoria real (3 docs em docs/VOXEL_ADVANCED_*) · Error Center categoria `environment` (Java/rede/disco com fix) · Search Engine unificado (Ctrl+K) · Project Timeline · Skeletons · render-smoke permanente |
| **B — Criação avançada** | ✅ COMPLETA | Visual Logic Studio (grafo→mcfunctions reais, 6 kinds events/conds/actions, AI designer) · Gameplay Designer (scanner 3 estilos de loader, criação coerente, receitas shaped/shapeless) · Asset Lab (library + checker de referências/duplicatas + import validado) · Style Memory (bibles editáveis + contradições por IA) · Compatibility Lab (vereditos com evidência) |
| **C — IA** | ✅ COMPLETA | AI Command Center (/command: fila DB-backed, cancel/retry, limites 1/20) · Workflow Fix Build (6 etapas checkpointadas) · Model Router v2 (fallbackModel pré-delta + métricas reais) · Knowledge Center (8 artigos VERIFICADOS ligados aos erros) · QA Lab (matriz 4 níveis, runtime nunca fingido) |
| **D — Servidores** | 🟡 EM ANDAMENTO (4/5) | ✅ Economy Simulator · ✅ Security Center · ✅ Player Management (arquivos vanilla reais + console stdin + histórico 004) · ✅ Moderation Assistant (heurística + IA grounded, nunca bane sozinha) — restam Backup Pro (§21), Server Automation (§22) |
| **E — Colaboração** | ⬜ não iniciada | (bloqueada por backend: documentado como dependência) |
| **F — Mobile** | ⬜ não iniciada | (Bridge já existe; Remote Build é a fatia principal) |
| **G — Polimento** | ⬜ não iniciada | (migration dos ~51 warns set-state-in-effect é o item A pendente) |

**NEXT MOVE (pós-compactação) — continuar a Fase D**, nesta ordem:
1. ~~Player Management (§19) + Moderation Assistant (§20)~~ → **ENTREGUES (S60)**. Próximo: **Backup Pro (§21)** — retenção configurável por servidor (cap N, purge por idade), verificação de integridade (restauro de teste em staging + diff do level.dat), agendamento por servidor, alertas de falha.
2. **Backup Pro (§21)**: retenção configurável por servidor (cap N, purge por idade), **verificação de integridade** (teste de restauração em pasta staging + diff do level.dat), agendamento por servidor, alertas de falha.
3. **Server Automation (§22)**: gatilho→condição→ação com limites (alerta offline via polling existente, backup pré-update, restart por política); nada destrutivo silencioso.
4. Depois: fechar Fase G migrando os warns `set-state-in-effect`, e só então F/E conforme infra.

**Regras que atravessam as fases (relembre sempre)**: async+spawn_blocking para TODO I/O; sem fake data; vereditos com evidência; limitações registradas; releases 7/7 (206) com tree limpa; responder ao dono em PT-BR.

## 9. Roadmap pós-MVP (priorizado — o que ainda pode ser construído)

1. ~~Forge & NeoForge templates~~ → **ENTREGUE (Sessões 22-23)**: os quatro templates compilam jar real (E2E), incluindo a era NeoGradle 7 (1.20.2-1.21.1). Próximo natural do braço Java: era ModDevGradle (1.21.4+) quando for a hora
2. ~~Model Router por fase~~ → **ENTREGUE (Sessão 23)**: phaseModels por fase, provider/key global (multi-key por provider = extensão futura honesta)
3. ~~Push notifications (desktop)~~ → **ENTREGUE (Sessão 23)**: build exit + fim da task force, com permissão honesta. Mobile push = ainda futuro (precisa Expo notifications + backend)
4. **Mobile polish** (§59) — ~~secure-store + biometria + build notifications~~ **ENTREGUES (S25/S27: APK 0.3.1)**. Restam: keystore de release (Play Store), TestFlight (conta Apple), push externo (backend)
5. **Modpack Creator** → v1 (S24: export/import+README) · v2 (S25: score) · v3 (S26: Modrinth SHA-1) · v4 (S27: grafo required) · **Marketplace local + Library + editor de manifest re-pack atômico (S36)** entregues. Restam: CurseForge (precisa API key do dono)
6. ~~Resource Pack / World / Structure Studios~~ → items (S25) · blocks (S27) · **sprites ANIMADOS (S45: strip+mcmeta, preview animado, agent frames)** · structures .nbt + preview iso (S29) · agent structures + custom dimensions (S30) · dimensions 1.20.1-1.21.8 (S31) entregues. Restam: resource packs completos, módulos estrutura+datapack 2.0
7. **Módulos de servidor** → **8 entregues**: Economy/Prison/Token (S11) + SkyBlock/Factions/BedWars (S34) + Monuments (S37) + **Custom Realm (S40: dimensão real)**. Próximas fatias: módulos 2.0 combinados (realm+monuments), push externo
8. **Docker + Deployment Providers** (§44-45) — VPS/SSH/cloud (`DeploymentProvider` reservada)
9. **Marketplace** (§48) e **Cloud opcional (Supabase)** (§85) — arquiteturas preparadas
10. **Backlog de qualidade**: migrar warns `set-state-in-effect` (~33, família conhecida, nunca errors), auto-refresh de sessão MSA/GitHub. ~~Commands bloqueando a main thread~~ **EXTINTO como classe (S44-45: regra permanente = async+spawn_blocking para qualquer rede/disco)**

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
- ✅ Era 26.x (6º template, MDG 2.0.148, Java 25, SwordItem→components pescado pelo E2E) + presets com módulos reais — Sessão 35
- ✅ Marketplace local (modpacks/shaders com swatch real/mods com Play) + editor de modpack (manifest in-zip atômico) — Sessão 36
- ✅ Módulo Monuments (.nbt nos servidores, /place via trigger, seed do dono) + Workspace Snapshots (autoria zipada) + agendamento + restore nunca-destrutivo — Sessões 37-39
- ✅ Módulo Custom Realm (dimensão real no server, era-factual) — Sessão 40
- ✅ Correções do dono: botão criar nunca-morto, delete dentro do projeto, Community servers AO VIVO (nerdzone.gg pingado com 1220 players), túnel no wizard, inferência prison/coin/chain — Sessão 41
- ✅ Português (Brasil) no app (t() com fallback inglês, Auto/EN/PT-BR) + chat do agente no Studio (handoff, nunca auto-envia) — Sessão 42
- ✅ Deploy projeto↔servidor (datapack do mod no world/datapacks, formato lido do próprio servidor, replace atômico) + elapsed no build — Sessão 43
- ✅ Classe async completa (S44-45: 13 commands de ação + 4 de polling fora da main thread — congelamento extinto) + **sprites ANIMADOS** (strip+mcmeta, o jogo anima nativamente, preview CSS steps, agent frames) — Sessões 44-45

## 10. Regras de operação com o dono

- **REGRA DE PERFORMANCE (permanente)**: command Tauri com rede/disco/zip = SEMPRE `async` + `spawn_blocking` (impl síncrona separada para os testes). Commands síncronos rodam na MAIN THREAD e congelam a UI — a classe custou 2 bug reports do dono (S44-45).
- **REGRA DE REPLACES PYTHON**: anchors exatos com contexto; depois de qualquer batch, `grep` de verificação no alvo; notas com `\n` explícito; `#[test]` único por fn (duplicado = teste duplicado no harness = race).
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

*Última atualização: Sessão 60 — Fases A/B/C COMPLETAS e Fase D em andamento (4/5: Simulator, Security, Players+Moderation entregues; restam Backup Pro §21 e Server Automation §22). 60 releases até a v0.16.0. Testes: vitest 169 · cargo 93 (+11 E2E) · render-smoke 5 dialogs. Migration 004 (server_punishments). Superfícies novas: /logic /designer /assets /compat /command /knowledge /qa + Customize com AI Studio/Currency/Security/Dossier. NEXT MOVE detalhado no §8.9.*

---

## 60. Sessão 60 — Fase D: Player Management + Moderation Assistant

**Pedido do dono**: "leia o Plan.md e continue de onde parou" (Next Move do §8.9: §19 + §20).

**Player Management (§19)** (Customize → **Players**): os arquivos vanilla REAIS lidos do disco pelo novo command async `server_players_read` (usercache.json/whitelist.json/banned-players.json/banned-ips.json/ops.json; path-guarded; entry corrompida é pulada, não fatal). Merge por uuid-first (nomes do usercache são os mais frescos) com badges W/B/OP/never-joined. Ações (whitelist/op/kick/ban/pardon) vão pelo **console stdin** (`server_send_command`) — o app NUNCA edita os arquivos vanilla às costas do servidor (ele cacheia em memória e sobrescreveria); servidor parado = banner honesto em vez de botões quebrados. **Ban sem motivo é recusado no service** — punição tem que ser auditável. Cada ban/pardon/kick cai no **histórico de punições** (migration 004 `server_punishments`, com o source: user ou sugestão aprovada).

**Moderation Assistant (§20)**: camada determinística (floods de join-leave ≥4/3 e chat idêntico repetido ≥4 com evidence literal do `server_log_tail`, cap 1000 linhas) + camada de IA que SÓ sugere — e cuja sugestão **só sobrevive se a evidence citada existir LITERALMENTE no log** (`filterAiFindings` descarta alucinação em silêncio); **ban proposto pela IA é rebaixado a 'watch'**; todo finding carrega "owner decides"; **nada é aplicado sem clique do dono** — as heurísticas locais também nunca sugerem ban (decisão humana).

**13 testes novos** (15 TS + 4 Rust): merge por uuid com nome stale, formatos de comando vanilla, ban-sem-motivo recusado, nome com newline rejeitado (smuggling de comando), histórico audita perdão também, whitelist NÃO é punição, servidor parado recusa, floods/spam/limpo, filtro da IA, downgrade de ban, lixo de IA sobrevivido; fixtures vanilla nos 5 arquivos, missing = vazio honesto, path traversal, cap do tail.

**Bugs caçados (4)**: meu python replace vazou delimitador no lib.rs (migration v3 quebrou — restaurada à mão); helper morto no teste; script abortado por assert antes do write (arquivo em disco ficou no estado antigo); `.settings.ai` (store) em vez de `.ai`.

**Verificação**: typecheck 0 ✓ · lint 0 errors (52) ✓ · vitest **169/169** (+15) ✓ · cargo **93/93** (+4) ✓ · vite build 1m37s ✓ · boot vivo 0 panics ✓. Release **v0.17.0**.

**Fase D status (4/5)**: Economy Simulator ✓ · Security Center ✓ · Player Management + Moderation ✓ — restam: **Backup Pro (§21)**, **Server Automation (§22)**.
