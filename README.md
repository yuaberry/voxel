# VOXEL

[![CI](https://github.com/yuaberry/voxel/actions/workflows/ci.yml/badge.svg)](https://github.com/yuaberry/voxel/actions/workflows/ci.yml)
[![Release](https://github.com/yuaberry/voxel/actions/workflows/release.yml/badge.svg)](https://github.com/yuaberry/voxel/releases)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-8b5cf6)

> **Imagine. Create. Build. Play.**
> AI-Powered Creation Platform

**[🌐 Site oficial](https://yuaberry.github.io/voxel/)** ·
**[⬇️ Downloads (v0.5.11)](https://github.com/yuaberry/voxel/releases/latest)** —
Windows `.exe`/`.msi` · Linux `.deb`/`.AppImage` · macOS `.dmg` (Apple Silicon + Intel)

VOXEL é uma plataforma desktop de criação assistida por IA para Minecraft Java Edition. **O MVP está completo e provado de ponta a ponta**: descreva um mod em linguagem natural, compile-o de verdade com Gradle, corrija erros com um agente sandboxado, rode o Minecraft com o seu jar instalado, monte servidores com economia própria e publique o projeto no GitHub.

```
NO FAKE DATA — cada tela mostra apenas o que funciona.
Prova real: 18 testes unitários Rust + 28 Vitest + 3 E2E executados
(mod compilado, launcher de 718MB oficiais com SHA-1, servidor
boot/stop/backup) — tudo verde, na CI e local.
```

---

## ✅ Status — MVP completo (Fases 0–7) + Pós-MVP Wave 1 & 2

| Sistema | Estado |
|---|---|
| App shell premium (Tauri 2, dark-first, glassmorphism, Ctrl+K palette) | ✅ |
| SQLite com schema versionado (18 tabelas, migrations idempotentes) | ✅ |
| AI Provider Layer — OpenRouter/OpenAI-compat/Anthropic/Ollama/**NVIDIA NIM**, streaming + vision, model picker por seleção | ✅ |
| Credentials no OS keyring (nunca no banco, nunca em logs) | ✅ |
| Version Catalog auto-atualizável — Mojang + Fabric + Forge + NeoForge + Paper (TTL 12h), esquemas 1.x e 26.x | ✅ |
| Projects Core — wizard com versão selecionável (esquemas 1.x e 26.x), Monaco, snapshots git | ✅ |
| VOXEL Agent — sandbox Rust, auditoria em `ai_tool_calls`, auto-snapshot, task force multi-agente (Architect→Developer→Reviewer) e tools de arte (texturas/blocos/estruturas .nbt/dimensões) | ✅ |
| Build System — `./gradlew build` ao vivo, Error Center, Auto-Fix ≤5 tentativas | ✅ |
| Launcher — instâncias isoladas, downloads oficiais SHA-1 (718MB provados), MS device flow | ✅ |
| Server Studio — vanilla/Paper oficiais, console stdin, backups/restore, properties | ✅ |
| Server Modules misturáveis — 8 sistemas: Economy/Prison/Token Chain, SkyBlock Islands, Factions War, BedWars Lite, Monuments (.nbt reais com /place) e Custom Realm (dimensão real) — cada um com comandos documentados no README do servidor | ✅ |
| Token Chain — ledger SHA-256 real (mint/transfer/burn/verify, tamper-evidente) | ✅ Wave 1 |
| Túnel público grátis — playit.gg (servidor acessível de qualquer lugar) | ✅ Wave 1 |
| Shader Studio — 32 looks icônicos como presets → shaderpacks GLSL originais; Asset Studio — sprites pixel-art (estáticos E animados com .mcmeta), faces de bloco, estruturas .nbt com preview isométrico e dimensões custom | ✅ |inais Iris/OptiFire-compat, preview WebGL vivo, editor Monaco, install na instância | ✅ Wave 2 |
| GitHub — device flow, create repo, push com header transitório (token nunca persistido) | ✅ |
| **Asset Studio** — sprites pixel-art **estáticos e ANIMADOS** (strip + .mcmeta — o jogo anima nativamente), faces de bloco, estruturas .nbt (preview isométrico) e dimensões custom — o agent gera tudo | ✅ |
| **Marketplace local** — modpacks/shaderpacks (swatch de céu real)/seus mods com status vivo e Play, install 1-clique; Modpacks com grafo de dependências Modrinth (SHA-1) e editor de manifest | ✅ |
| **PT-BR** — o app inteiro fala Português (Brasil): Auto (SO)/English/Português em Settings | ✅ |
| **Deploy projeto↔servidor** — o datapack do seu mod vai para world/datapacks do seu servidor (formato da era, replace atômico) | ✅ |
| **Workspace Snapshots** — export/restore guiado (nunca sobrescreve) + agendamento diário/semanal | ✅ |
| **Mobile** — VOXEL Bridge (token no keyring, biometria), APK Android 0.3.1, PWA iOS instalável, build notifications | ✅ |
| Dark Kingdom — projeto-exemplo criado automaticamente (espada, receita, advancement) | ✅ |
| Release multi-OS + site oficial no GitHub Pages | ✅ |
| Qualidade — ErrorBoundary, ESLint, Vitest, CI (GitHub Actions), **145 testes verdes**; toda ação fora da main thread (async + spawn_blocking — congelamento extinto como classe) | ✅ |

## 🚀 Como rodar (desenvolvimento)

```bash
pnpm install
pnpm tauri dev        # abre o app completo
pnpm verify           # typecheck + lint + testes + build
```

Fluxo completo em 4 passos (primeira vez):

1. **Settings → AI** — configure provider, key (vai para o keyring) e modelo; **Settings → Storage** — escolha a pasta do workspace (`~/VOXEL`)
2. O **Dark Kingdom** nasce automaticamente como exemplo — abra o workspace e pressione **Build** (cache Gradle compartilhado; primeira build baixa dependências)
3. **AI Creator (Agent mode)** — *"add a Voidcutter sword: item, model, lang and recipe"* — o agente edita os arquivos com auditoria e snapshot
4. **Run** — instância isolada preparada com arquivos oficiais → Minecraft abre com o seu mod (requer Microsoft sign-in uma vez: Settings → Launcher)

Para **estilos visuais**: aba **Shaders** — escolha entre 32 presets (BSL, SEUS, Complementary Reimagined, Solas…) com preview WebGL ao vivo → Create → Install na instância → ative no Iris/OptiFire. Cada preset gera GLSL 100% original; nada é copiado dos originais.

Para **jogadores de servidor**: aba **Servers** → wizard (vanilla/Paper, versão do catálogo ao vivo) → módulos misturáveis (Economia/Prison/Token Chain) → console em tempo real, VoxelCoin com ledger verificável, backups, túnel público e restore.

Para **publicar**: workspace → **Publish** → commit + repo GitHub + push.

## Arquitetura em uma página

```
Frontend (React 18 + TS + Vite + Tailwind)
  features/ home · projects · ai-creator · shaders · servers · settings
  services/ ai (providers/streaming/agent) · build · launcher · servers
            shaders · github · db · minecraft (version catalog)
        │ invoke (Tauri IPC, tipado)
Rust core — perímetro de segurança
  commands/ fs (path guard) · process (allowlist + stdin) · git · launcher
  templates (embedded) · servers (checksums) · ledger (SHA-256) · shaders
  tunnel (playit.gg) · secrets (keyring)
        │
SQLite (18 tabelas) · Gradle 8.8 · git · java · endpoints oficiais Mojang/Fabric/Paper
```

Decisões-chave no [`docs/architecture.md`](docs/architecture.md) (AD-1..AD-11 + revisões). Memória de continuidade do projeto: [`Plan.md`](Plan.md).

## Segurança & Legal

- Nenhum bypass de autenticação, DRM ou conta — Microsoft e GitHub via **device flow** legítimo, com client_id configurável
- Arquivos do Minecraft obtidos em runtime dos endpoints oficiais, para uso local — **nada é redistribuído**
- Tokens: OS keyring; push GitHub usa header transitório que nunca toca o disco
- Sandbox: toda operação de arquivos passa pelo path guard Rust; shell arbitrário é proibido por design
- Shader style presets evocam looks da comunidade com **GLSL 100% original** — nada copiado, creditos e busca pelo original dentro do app
- **VOXEL is an independent third-party creation platform and is not affiliated with Mojang Studios or Microsoft.**

## Testes (todos executados)

| Suíte | Escopo |
|---|---|
| `cargo test` | 68 unit (templates ×6 eras, ledger+tamper, shaderpacks, SLP+SRV, bridge multimodal, modpacks, snapshots, deploy, structures NBT, assets animados) |
| `cargo test -- --ignored` | 10 E2E: **compilação REAL de 6 templates** (fabric/forge/neoforge ×4 eras até 26.3), launcher 718MB SHA-1, server ciclo, SLP de servidores públicos (hypixel/nerdzone…), Modrinth com checksum |
| `pnpm test:unit` | 77 Vitest (shaders + gerador GLSL, error parser, 6+8 módulos de servidor com comandos, inferência de estilo, task force, model routing, i18n pt-BR, manifestos, parser de MOTD) |
| CI (`.github/workflows/ci.yml`) | typecheck + lint + vitest + vite build + cargo test |
| Release (`.github/workflows/release.yml`) | tag `v*` → .exe/.msi/.deb/.AppImage/.dmg (Windows, Linux, macOS arm64+x64) |

## 📱 Mobile

O **VOXEL mobile** (Expo, este repositório: `apps/mobile`) emparelha com o
seu PC via **Settings → Mobile**: o celular controla a MESMA engine real —
projetos com build status (Gradle de verdade), servidores com start/stop e
console ao vivo, ping SLP de qualquer endereço e chat com a IA configurada
no PC (a key nunca sai da máquina). Lógica compartilhada em `packages/core`.

## Roadmap pós-MVP (próximas waves)

- **Modpack Creator** — seleção, resolução de dependências, Compatibility Score
- **Resource Pack / World / Structure Studios** — texture workspace, geradores
- **Forge & NeoForge templates** — o Version Adapter já mapeia as versões
- **Mais módulos de servidor** — SkyBlock, Factions, BedWars
- **Marketplace** — mods/plugins/assets com licenciamento (author/license/source/version)
- **Docker + Deployment Providers** — VPS/SSH/cloud para servidores
- **Cloud opcional (Supabase)** — sync e colaboração (`.env` já preparado)

---

**Legal:** This is an independent tool. Minecraft is a trademark of Mojang Studios/Microsoft — no affiliation, no redistribution of proprietary assets.
