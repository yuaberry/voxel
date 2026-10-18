# VOXEL Advanced Architecture — a base real e onde as fases se encaixam

## Stack vigente (provada em produção — não trocar sem justificativa técnica)
- **Frontend**: React 18 + TypeScript strict + Vite 5 + Tailwind (dark-first, tokens próprios), zustand, react-router (HashRouter), Monaco local, sonner, cmdk, Radix (dialogs/tabs/selects)
- **Backend**: Tauri 2 (Rust) — reqwest com rustls, zip, flate2, sha1/sha2, flate2/gzip NBT próprio, pdf-extract, keyring
- **Banco**: SQLite (plugin-sql) migrations append-only; **o disco é a fonte da verdade** para servidores (voxel-server.json + scan/reconcile)
- **Testes**: vitest (99: unit + render-smoke jsdom) · cargo (88 unit + 11 E2E `#[ignore]`) · CI GitHub Actions · releases multi-OS
- **Mobile**: @voxel/core compartilhado + VOXEL Bridge (axum, token-gated, PWA servida) + Expo (APK publicado)

## Camadas e responsabilidades (existentes)
```
UI (features/)                     dialogs, páginas, drawers
  └─ services/ (TS)                regras de aplicação; invocam Rust via invoke()
      └─ commands/ (Rust)          PERÍMETRO: path guards, allowlists, checksums
          ├─ fs/process/launcher/servers/ledger/structures/dossier/fx/documents…
          └─ async + spawn_blocking para TODO I/O (regra S44-50)
```

## Regras arquiteturais que as novas fases devem seguir
1. **Command Rust com I/O = async + spawn_blocking + impl separada (testável)**.
2. **Serialização camelCase** (`rename_all`), tipos TS espelhados.
3. **Sem fake data**: nova feature sem backend = interface com estado honesto "not implemented" ou roadmap.
4. **Onde os módulos do Super Prompt se encaixam**:
   - Visual Logic Studio → gera `CustomCommand[]`/mcfunctions pelos geradores existentes (`customCommands.ts`) — o grafo é FRONTEIRA, a semântica é dos geradores testados.
   - Gameplay Designer → escreve via `writeProjectFile` + agent tools (o mecanismo de sync já existe: agent edit_file).
   - AI Command Center → em volta do `orchestrator` (hoje síncrono por sessão): fila em Rust (registry de tasks) ou TS store persistido; limites no orquestrador.
   - Workflow Engine → JSON persistido em `.voxel/workflows/` + executor que chama o orchestrator por etapa com checkpoint.
   - Economy Simulator → puro TS determinístico sobre os FATOS dos módulos (preços/ranks reais dos datapacks) — rótulo de simulação obrigatório.
   - Search Engine → `search_project` (Rust) generalizado + índice SQLite FTS (nova migration) — respeitar guard.
   - Knowledge Center → arquivos markdown locais versionados no app (docs/  + FAQ) + links oficiais; nada de API não oficial.
   - Backup Pro por servidor → extensão do `server_backup_impl` com retenção/verificação (zip CRC já implícito no formato).
   - Remote Build → Bridge (axum) ganha endpoint de fila autenticado; o desktop é o worker autorizado (nunca infra compartilhada).
5. **UI**: Radix primeiro (já em uso); React Flow é a única lib visual nova prevista (Fase B), bundled local como o Monaco.

## Dependências externas documentadas (bloqueios honestos)
- Play Store keystore / TestFlight → contas do dono.
- Push externo / Collaboration sync → backend (não existe; nada simulado).
- CurseForge → API key do dono.
- GitHub Actions → CI/release apenas, jamais hospedagem de servidor (regra do Super Prompt §18).
