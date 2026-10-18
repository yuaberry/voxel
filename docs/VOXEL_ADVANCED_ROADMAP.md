# VOXEL Advanced Roadmap — Fases do Super Prompt 02 sobre a base real

> Ordem do Super Prompt §41 adaptada ao estado real (ver VOXEL_ADVANCED_AUDIT.md). Cada fase termina com bateria completa + release + relatório.

## FASE A — Fundação (CORRENTE — Sessão 51)
- [x] Auditoria real executada (E2E build + render smoke + bateria) → `VOXEL_ADVANCED_AUDIT.md`
- [x] **Correção de diagnóstico**: Error Center aprende a categoria `environment` (Java ausente/versão, download/rede, disco) com fix acionável por card — resposta direta ao "Build deu erro" do dono
- [x] Render smoke permanente dos 5 dialogs críticos (suite jsdom — guarda contra "overlay morto")
- [ ] Migrar warns `set-state-in-effect` (~35)
- [ ] Search Engine textual unificado (projetos/arquivos/assets/logs — Rust `search_project` já existe como base)
- [ ] Project Timeline (hoje disperso em snapshots/logs/DB)

## FASE B — Criação avançada
- Visual Logic Studio (React Flow; o grafo gera datapack/mcfunction REAL — semântica validada, não mock)
- Gameplay Designer (formulários → arquivos reais via agent tools, sync sem sobrescrever)
- Asset Lab Pro (library com tags/versões/consistency checker)
- Style Memory versionada (bibles editáveis + detecção de contradição)
- Compatibility Lab (matriz por versão com evidências)

## FASE C — IA
- AI Command Center (filas, estados, pausar/cancelar, limites de consumo)
- Workflow Engine persistido (recovery, aprovação em etapas críticas)
- Model Router v2 (fallback, orçamento, relatórios de consumo/latência — só métricas reais)
- Knowledge Center (índice local + fontes oficiais, versão-sensível)
- QA Lab (unit/build/compat por projeto; "runtime test passed" ≠ "build succeeded")

## FASE D — Servidores
- Economy Simulator (simulações de progressão Prison — valores rotulados como simulação)
- Security Center (checklist + relatórios de risco; nada invasivo)
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
