# VOXEL Advanced Audit — Estado real por sistema (Sessão 51, v0.8.1)

> Classificação honesta conforme o Super Prompt §2: **implementada e testada** / **parcial** / **interface sem backend** / **não implementada** / **bloqueada por dependência externa**. Nada é "concluído" só porque existe um botão.

## Verificação executada nesta auditoria (comandos reais)

| Prova | Resultado |
|---|---|
| E2E build fabric (jar real compilado) | ✅ 306s, `dark_kingdom-0.1.0.jar` |
| Render smoke dos 5 dialogs críticos (jsdom) | ✅ 95/95 (suite nova) |
| typecheck / lint | ✅ 0 errors / 0 errors (35 warns família conhecida) |
| vitest / cargo | ✅ 99/99 · 88/88 (+ 11 E2E `#[ignore]`) |
| vite build · boot smoke | ✅ 1m40s · vivo, 0 panics |
| 6 releases consecutivas multi-OS | ✅ 7/7 assets HTTP 206 |

## Sistemas — classificação

### Núcleo do produto
| Sistema | Estado | Evidência |
|---|---|---|
| Projects Core (6 templates, wizard, Monaco, snapshots git) | **Implementada e testada** | E2E ×6 compila jar real |
| Build System (gradlew ao vivo, Error Center, Auto-Fix ≤5) | **Implementada e testada** | E2E + errorParser 8 testes (agora com categoria environment) |
| Delete de projetos (daemon Gradle stop + retries + erro acionável) | **Implementada e testada** | 2 testes (idempotência, gradlew real) |
| Launcher (downloads SHA-1 718MB, instâncias, MSA device flow) | **Implementada e testada** | E2E launcher |
| Server Studio (create vanilla/Paper, console stdin, backups zip-slip-guarded, túnel playit.gg) | **Implementada e testada** | E2E lifecycle + async-command-path |
| Self-heal disco↔DB (scan + reconcile) | **Implementada e testada** | unit + wiring |
| Diagnósticos reais (storage/db/java/Mojang/PaperMC/Modrinth + fix por falha) | **Implementada e testada** | 3 testes + banner de emergência |
| Dossiê do servidor (30+ páginas × 6 formatos: md/txt/html/pdf/docx/odt) | **Implementada e testada** | capa/TOC/footer provados no teste |
| i18n PT-BR (fallback inglês) | **Implementada e testada** | i18n.test |
| Mobile (Bridge axum + Expo APK 0.3.1 + PWA iOS) | **Parcial** — push externo, Play Store keystore = bloqueado por contas/infra |
| GitHub (device flow, create repo, push header transitório) | **Implementada e testada** (usada em produção) |

### IA
| Sistema | Estado | Evidência |
|---|---|---|
| Chat/streaming 5 providers (OpenRouter/OpenAI/Anthropic/Ollama/NIM) | **Implementada** | produção |
| Agent (12 tools sandboxadas, auditoria, snapshots) | **Implementada e testada** | policies testadas |
| Task force (Architect→Developer→Reviewer, read-only por fase) | **Implementada e testada** | taskForce.test |
| Tools de arte (texturas estáticas/animadas, estruturas 6 kinds, dimensões) | **Implementada e testada** | cargo 88 |
| AI Server Studio (prompt → plano validado → previews reais → install) | **Implementada e testada** | planner 3 testes |
| Model Router por fase (phaseModels) | **Implementada** | — |
| AI Command Center (fila de agentes, pausar/cancelar) | **Não implementada** (o agent é síncrono por sessão) |
| Workflow Engine persistido com recuperação | **Não implementada** |

### Autonomia do servidor
| Sistema | Estado | Evidência |
|---|---|---|
| Customize: World (properties edit + import zip atômico) | **Implementada e testada** | 2 testes |
| Customize: Structures (.nbt → /place template) | **Implementada e testada** | content-first validation testada |
| Customize: Commands (custom com mobs NBT, custo, cooldown, /convert) | **Implementada e testada** | 9 testes + 3 mod-remap |
| Customize: Plugins (Modrinth→paper SHA-1) | **Implementada e testada** | reuso do E2E modrinth |
| Customize: Currency (moeda própria, diluição, FX BCE USD/BRL/EUR) | **Implementada e testada** | fx 3 testes + ledger 4 |
| Rename de servidor | **Implementada e testada** | metadata test |
| Comandos dentro do MOD (datapack do jar) | **Implementada e testada** | mod remap test |
| Briefing docs (.txt/.md/.pdf/.docx) no prompt do agente | **Implementada e testada** | 5 testes incl. docx/pdf reais |

### Novos módulos pedidos no Super Prompt (status inicial)
| Sistema | Estado |
|---|---|
| Visual Logic Studio (nodes) | **Não implementada** (Fase B) |
| Gameplay Designer (editor de entidades/receitas/quests) | **Parcial via Agent + Asset Studio** (não é editor de formulários) |
| World Lab (regiões, gerador de cidades/vilas/dungeons) | **Parcial** — 6 geradores procedurais reais; regiões/preview 2D não existem |
| Asset Lab Pro (library com tags/versões/checker) | **Parcial** — Studio gera/gerencia assets do projeto; library global não existe |
| Style Memory (bibles/decisões) | **Implementada** (5 bibles no prompt; versionamento de memória não) |
| Knowledge Center / Compatibility Lab / QA Lab / Performance Lab | **Não implementada** (Fases C/B) — Compatibility Score parcial via modpacks |
| Economy Simulator / Security Center / Player Management / Backup Pro agendado por servidor / Server Automation | **Não implementada** (Fase D) — backups agendados de WORKSPACE existem; economia REAL de jogo existe |
| Collaboration / Workspace Sync / Plugin SDK / Template Market / Release Center | **Não implementada** (Fase E) |
| Remote Build mobile | **Não implementada** (Fase F) — Bridge já controla servidores remotos |
| Analytics / Notification Center / Search Engine unificado / Resource Center | **Não implementada** (Fase G) — notifications desktop existem (build/task force) |

## Bugs em aberto conhecidos
1. **Warns ESLint `set-state-in-effect`** (~35, família conhecida, zero errors) — migração pendente (Fase A).
2. **`@tauri-apps/api` mismatch CLI dev** (Cosmetic em dev; build alinhado nas releases).
3. Reporte do dono **"Build deu erro"**: build provado verde localmente (E2E acima). As causas de ambiente (Java ausente/versão/rede/disco) agora viram cards com FIX no Error Center; **pende a confirmação da versão do app e do texto do erro do dono**.
4. Reporte do dono **"só a barra de rolagem e nada acontece"**: dialogs da v0.8.0 renderizam provadamente (smoke 95/95). O sintoma bate com a main-thread congelada das versões **pré-v0.5.10** — pende a versão do app do dono (About dialog).
