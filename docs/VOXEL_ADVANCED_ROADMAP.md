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
- Player Management + Moderation Assistant (logs reais do servidor; IA nunca bane sem regra configurada)
- Backup Pro por servidor (retenção, integridade, teste de restauração)
- Server Automation (gatilho/condição/ação com limites; nada destrutivo silencioso)

## FASE E — Colaboração (bloqueada por infra)
- Workspace Sync (Git/config já existe para projetos; conflitos explícitos)
- Team Collaboration (exige backend de identidade — documentado como dependência)
- Plugin SDK · Template Market local · Release Center

## FASE F — Mobile
- Remote Build (Bridge → fila autorizada no desktop conectado)
- Notifications push (exige backend) · Server Control já parcial via Bridge

## FASE G — Polimento
- Analytics local (builds/servidores — sem telemetria pessoal)
- Accessibility (teclado/contraste/escala) · Localization structure (pt-BR ✓/en ✓)
- Performance Lab (só métricas medidas) · Regression testing

## Regras permanentes (herdadas + Super Prompt)
1. Sempre async+spawn_blocking para commands com I/O (S44-50 — classe congelamento extinta).
2. Nunca fake data; nunca "concluído" sem teste; nunca custo/métrica inventada.
3. Rust = perímetro de segurança; tokens no keyring; downloads oficiais com checksum.
4. Releases multi-OS verificadas 7/7 (206) + tree limpa.
