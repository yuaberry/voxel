# VOXEL Advanced Roadmap — Fases do Super Prompt 02 sobre a base real

> Ordem do Super Prompt §41 adaptada ao estado real (ver VOXEL_ADVANCED_AUDIT.md). Cada fase termina com bateria completa + release + relatório.

## FASE A — Fundação (fechada na Sessão 52, exceto warns rastreados)
- [x] Auditoria real executada (E2E build + render smoke + bateria) → `VOXEL_ADVANCED_AUDIT.md`
- [x] **Correção de diagnóstico**: Error Center aprende a categoria `environment` (Java ausente/versão, download/rede, disco) com fix acionável por card — resposta direta ao "Build deu erro" do dono
- [x] Render smoke permanente dos 5 dialogs críticos (suite jsdom — guarda contra "overlay morto")
- [ ] Migrar warns `set-state-in-effect` (~35) — único item aberto da Fase A, rastreado para a próxima passada
- [x] Search Engine textual unificado (Ctrl+K → 'Workspace results'; projects+files+servers+shaderpacks+modpacks; testado)
- [x] Project Timeline (builds + agent audit + snapshots + sessions; filtros; botão no workspace)

## FASE B — Criação avançada (COMPLETA: Visual Logic ✓ Gameplay Designer ✓ Asset Lab ✓ Style Memory ✓ Compatibility Lab ✓)
- [x] Visual Logic Studio (/logic — React Flow, 19 kinds, compilador real com chains/predicates, validador, AI designer, 6 testes)
- [x] Gameplay Designer (/designer — scanner nos 3 estilos de loader, status de implementação por item, criação coerente java+model+lang+textura, receitas shaped/shapeless reais, 6 testes)
- [x] Asset Lab (/assets — biblioteca real com previews, busca e filtros; consistency checker com referências quebradas/ausências/órfãs/duplicatas por byte-hash; importação validada de PNG; 3 testes)
- [x] Style Memory (painel no workspace: 5 bibles editáveis + fallback .nexus; verificação de contradições por IA onde todo achado cita as passagens; 3 testes)
- [x] Compatibility Lab (/compat: 4 checks com evidência+fix — loader×versão, Java da era vs máquina, era experimental, gradle.properties real; matriz versão×loader; 6 testes)

## FASE C — IA (COMPLETA: Command Center ✓ Workflow v1 ✓ Model Router v2 ✓ Knowledge Center ✓ QA Lab ✓)

## FASE D — Servidores
- [x] Economy Simulator (Customize → Currency: tabela de ranks, prestígio composto ×5, exploits e gargalo — disclaimer SIMULATION; 6 testes)
- [x] Security Center (Customize → Security: RCON plain-text/sem senha, online-mode do DISCO, whitelist, EULA, idade de backups, origem de plugins — nunca "totalmente seguro"; 7 testes)
- [x] Player Management (Customize → Players: usercache/whitelist/banned-ips/ops.json reais, ações via console stdin, histórico de punições migration 004; ban sem motivo é recusado) + Moderation Assistant (heurística local de floods/spam + IA cuja sugestão só sobrevive citando evidência LITERAL do log; ban da IA vira 'watch', aplicar é sempre clique do dono; 15 TS + 4 Rust)
- Backup Pro por servidor (retenção, integridade, teste de restauração)
- [x] Server Automation (Customize → Automation: allowlist NO perímetro (2 triggers, 3 ações revisadas), motor de TRANSIÇÕES com baseline sem disparo, cooldown 5min anti-thrash, run log migration 005 — nada silencioso; 2 Rust + 10 TS)

## FASE E — Colaboração (DEPENDÊNCIAS DOCUMENTADAS — o que falta é infra externa, não código local)
- Workspace Sync (Git/config já existe para projetos; conflitos explícitos) — FATIA LOCAL POSSÍVEL no futuro: export/import de workspace
- Team Collaboration — **dependência: backend de identidade** (o roadmap original §85 menciona Supabase/cloud opcional; nenhuma infra própria existe). Sem isso, NÃO há team features locais honestas — recusado inventar.
- Plugin SDK · Template Market local · Release Center — aguardam prioridade do dono; Template Market local é a fatia naturalmente local (o marketplace de modpacks/shaders já existe como padrão)

## FASE F — Mobile (o local máximo está ENTREGUE)
- [x] Remote Build (POST /api/projects/{slug}/build pelo Bridge token-gated, o mesmo command do botão desktop; a tab Projects do mobile dispara, assiste o status ao vivo e notifica no fim)
- Notifications push — **dependência: backend de push (Expo notifications + servidor)** · Server Control via Bridge ✓
- Publicação em lojas — **dependências: keystore de release (Play Store) e conta Apple Developer (TestFlight)** — nenhuma das duas pode ser gerada por código

## FASE G — Polimento
- [x] Analytics local (S64: página /insights — builds com sucesso/mediana/barras de 14 dias, IA com runs/latência/fallbacks por modelo, moderação e automação dos históricos reais, contagens e DISCO MEDIDO de verdade pelo Rust; 0 telemetria; 8 TS + 2 Rust)
- [x] Accessibility (S65: interface scale 85%–125% com clamp puro testado; reduce-motion ✓ desde a v0.21; teclado completo = fatia futura) · Localization structure (pt-BR ✓/en ✓)
- Performance Lab (só métricas medidas) · Regression testing (render-smoke ✓, E2E cargo ✓)

## Regras permanentes (herdadas + Super Prompt)
1. Sempre async+spawn_blocking para commands com I/O (S44-50 — classe congelamento extinta).
2. Nunca fake data; nunca "concluído" sem teste; nunca custo/métrica inventada.
3. Rust = perímetro de segurança; tokens no keyring; downloads oficiais com checksum.
4. Releases multi-OS verificadas 7/7 (206) + tree limpa.
