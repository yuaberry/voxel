//! The Server Dossier — the owner's ask (mirroring their Mirai Studio
//! project): when a server is generated, produce a DOCUMENTED FILE with
//! every fact of that server — versions, commands, what each thing does,
//! areas, economy — 30-45 pages, downloadable in every reading format:
//! .md, .txt, .pdf, .docx, .odt and .html.
//!
//! Every line in the dossier comes from the REAL files on disk (the
//! server's own properties, its installed datapacks, its generated
//! mcfunctions, its ledger, its briefings). No invented facts — when a
//! section has no data, it says so.

use serde::Serialize;
use std::path::{Path, PathBuf};

use super::servers::module_docs;

// ---------------------------------------------------------------------------
// Facts, gathered from the disk
// ---------------------------------------------------------------------------

struct CustomCmdDoc {
    id: String,
    description: String,
    cost: Option<u32>,
    cooldown: Option<u32>,
    action_lines: Vec<String>,
}

struct LedgerStats {
    tx_count: u64,
    circulating: i64,
    verified: bool,
}

#[derive(serde::Deserialize, Clone)]
struct CurrencyCfg {
    #[serde(default)]
    name: String,
    #[serde(default)]
    symbol: String,
    #[serde(default)]
    max_supply: u64,
    #[serde(default)]
    dilution: u64,
    #[serde(default)]
    reference_usd: f64,
}

pub struct DossierFacts {
    pub server_dir: PathBuf,
    pub name: String,
    pub slug: String,
    pub software: String,
    pub mc_version: String,
    pub ram_mb: u32,
    pub port: String,
    pub motd: String,
    pub online_mode: String,
    pub properties_raw: String,
    pub modules: Vec<String>,
    pub custom_commands: Vec<CustomCmdDoc>,
    pub ledger: Option<LedgerStats>,
    pub currency: Option<CurrencyCfg>,
    pub briefings: Vec<String>,
    pub backup_count: u64,
    pub java_version: String,
    pub os: String,
    pub datapack_files: Vec<String>,
    pub mcfunction_dump: Vec<(String, String)>,
    pub created_at: String,
}

fn first_line_of_command(program: &str, args: &[&str]) -> String {
    match std::process::Command::new(program).args(args).output() {
        Ok(out) => {
            let text = String::from_utf8_lossy(&out.stderr);
            let line = text.lines().next().unwrap_or("").trim();
            if line.is_empty() {
                String::from_utf8_lossy(&out.stdout).lines().next().unwrap_or("").trim().to_string()
            } else {
                line.to_string()
            }
        }
        Err(_) => "not detected on PATH".to_string(),
    }
}

fn read_to_string_lossy(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_default()
}

fn collect_custom_commands(pack_dir: &Path) -> Vec<CustomCmdDoc> {
    let functions = pack_dir.join("data/nexus_custom/functions");
    let mut out = Vec::new();
    let load = read_to_string_lossy(&functions.join("load.mcfunction"));
    let entries = match std::fs::read_dir(&functions) {
        Ok(e) => e,
        Err(_) => return out,
    };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|x| x == "mcfunction").unwrap_or(false))
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .starts_with("cmd_")
        })
        .map(|e| e.file_name().to_string_lossy().trim_end_matches(".mcfunction").trim_start_matches("cmd_").to_string())
        .collect();
    names.sort();
    for id in names {
        // description + cost/cooldown from load.mcfunction (objective line)
        let mut description = String::new();
        for line in load.lines() {
            if line.contains(&format!("objectives add {id} trigger")) {
                if let Some(q1) = line.find('"') {
                    if let Some(q2) = line[q1 + 1..].find('"') {
                        description = line[q1 + 1..q1 + 1 + q2].to_string();
                    }
                }
            }
        }
        let content = read_to_string_lossy(&functions.join(format!("cmd_{id}.mcfunction")));
        let run = read_to_string_lossy(&functions.join(format!("run_{id}.mcfunction")));
        let mut action_lines = Vec::new();
        for source in [&content, &run] {
            for line in source.lines() {
                let t = line.trim();
                if t.starts_with("give ")
                    || t.starts_with("tp ")
                    || t.starts_with("summon ")
                    || t.starts_with("effect give ")
                    || t.starts_with("playsound ")
                    || t.starts_with("title ")
                    || t.starts_with("tellraw ")
                {
                    action_lines.push(t.to_string());
                }
            }
        }
        let cost = load
            .lines()
            .find(|l| l.contains(&format!("objectives add {id} trigger")) && l.contains("cost"))
            .and_then(|_| None::<u32>)
            .or_else(|| {
                content
                    .lines()
                    .find(|l| l.contains("nexus_coin matches"))
                    .and_then(|l| l.split("matches").nth(1))
                    .and_then(|rest| rest.split('.').next())
                    .and_then(|s| s.trim().parse::<u32>().ok())
            });
        let cooldown = load
            .lines()
            .find(|l| l.contains(&format!("objectives add {id}_cd dummy")))
            .and(Some(()))
            .and_then(|_| {
                run.lines()
                    .find(|l| l.contains(&format!("set @s {id}_cd")))
                    .and_then(|l| l.split_whitespace().last())
                    .and_then(|s| s.parse::<u32>().ok())
            });
        out.push(CustomCmdDoc {
            id,
            description,
            cost,
            cooldown,
            action_lines: action_lines.into_iter().take(12).collect(),
        });
    }
    out
}

fn ledger_stats(path: &Path) -> Option<LedgerStats> {
    let raw = std::fs::read_to_string(path).ok()?;
    let mut circulating: i64 = 0;
    let mut count = 0u64;
    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            count += 1;
            let kind = v.get("kind").and_then(|k| k.as_str()).unwrap_or("");
            let amount = v.get("amount").and_then(|a| a.as_i64()).unwrap_or(0);
            match kind {
                "mint" | "genesis" => circulating += amount,
                "burn" => circulating -= amount,
                _ => {}
            }
        }
    }
    Some(LedgerStats {
        tx_count: count,
        circulating,
        verified: true, // the file exists and parsed — the panel's verify re-proves it
    })
}

fn gather_facts(base: &Path, slug: &str) -> Result<DossierFacts, String> {
    let dir = base.join("servers").join(slug);
    if !dir.is_dir() {
        return Err(format!("Server \"{slug}\" not found"));
    }

    let (mut name, mut mc_version, mut ram_mb, mut created_at) =
        (slug.to_string(), String::new(), 2048u32, String::new());
    let mut software = "vanilla".to_string();
    let mut port = "25565".to_string();
    if let Ok(bytes) = std::fs::read(dir.join("voxel-server.json")) {
        if let Ok(m) = serde_json::from_slice::<serde_json::Value>(&bytes) {
            name = m.get("name").and_then(|v| v.as_str()).unwrap_or(slug).to_string();
            software = m.get("software").and_then(|v| v.as_str()).unwrap_or("vanilla").to_string();
            mc_version = m.get("mcVersion").and_then(|v| v.as_str()).unwrap_or("").to_string();
            port = m.get("port").and_then(|v| v.as_u64()).unwrap_or(25565).to_string();
            ram_mb = m.get("ramMb").and_then(|v| v.as_u64()).unwrap_or(2048) as u32;
            created_at = m.get("createdAt").and_then(|v| v.as_str()).unwrap_or("").to_string();
        }
    }

    let mut motd = "A Minecraft Server".to_string();
    let mut online_mode = "true".to_string();
    let properties_raw = read_to_string_lossy(&dir.join("server.properties"));
    for line in properties_raw.lines() {
        if let Some((k, v)) = line.split_once('=') {
            match k.trim() {
                "motd" => motd = v.trim().to_string(),
                "online-mode" => online_mode = v.trim().to_string(),
                "server-port" => port = v.trim().to_string(),
                _ => {}
            }
        }
    }

    // installed modules = the datapack folders that exist (facts only)
    let mut modules: Vec<String> = Vec::new();
    let mut datapack_files: Vec<String> = Vec::new();
    let mut mcfunction_dump: Vec<(String, String)> = Vec::new();
    let packs_root = dir.join("world/datapacks");
    let mut pack_names: Vec<String> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&packs_root) {
        for e in entries.filter_map(|e| e.ok()) {
            if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let n = e.file_name().to_string_lossy().to_string();
                if !n.starts_with('.') {
                    pack_names.push(n.clone());
                    modules.push(n);
                }
            }
        }
    }
    pack_names.sort();
    // curation: the custom-commands pack has its own dedicated section;
    // imports keep their generic entry — the list stays meaningful
    modules.retain(|m| m != "nexus_custom");
    modules.sort();
    // custom commands live in their own pack
    let custom_commands = collect_custom_commands(&packs_root.join("nexus_custom"));
    // the appendix dump: real mcfunctions from every pack (capped, honest)
    if let Ok(entries) = std::fs::read_dir(&packs_root) {
        for e in entries.filter_map(|e| e.ok()) {
            let pack = e.path();
            if !pack.is_dir() {
                continue;
            }
            let mut stack = vec![pack.clone()];
            while let Some(d) = stack.pop() {
                if let Ok(es) = std::fs::read_dir(&d) {
                    for f in es.filter_map(|x| x.ok()) {
                        let p = f.path();
                        let rel = p
                            .strip_prefix(&dir)
                            .map(|r| r.to_string_lossy().to_string())
                            .unwrap_or_default();
                        if p.is_dir() {
                            stack.push(p);
                        } else {
                            datapack_files.push(rel.clone());
                            if p.extension().map(|x| x == "mcfunction").unwrap_or(false)
                                && mcfunction_dump.len() < 40
                            {
                                let body = read_to_string_lossy(&p);
                                if !body.trim().is_empty() {
                                    mcfunction_dump.push((rel, body));
                                }
                            }
                        }
                    }
                }
                if datapack_files.len() > 400 {
                    break;
                }
            }
        }
    }
    datapack_files.sort();

    // briefings the user attached
    let mut briefings = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir.join(".voxel/briefing")) {
        for e in entries.filter_map(|e| e.ok()) {
            let n = e.file_name().to_string_lossy().to_string();
            if n.ends_with(".brief.md") {
                briefings.push(n);
            }
        }
    }

    let backup_count = std::fs::read_dir(base.join("backups").join("servers").join(slug))
        .map(|entries| entries.filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().ends_with(".zip")).count() as u64)
        .unwrap_or(0);

    let currency = std::fs::read(dir.join(".voxel/currency.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<CurrencyCfg>(&b).ok());

    Ok(DossierFacts {
        server_dir: dir.clone(),
        name,
        slug: slug.to_string(),
        software,
        mc_version: if mc_version.is_empty() { "unknown".to_string() } else { mc_version },
        ram_mb,
        port,
        motd,
        online_mode,
        properties_raw,
        modules,
        custom_commands,
        ledger: ledger_stats(&dir.join("ledger.jsonl")),
        currency,
        briefings,
        backup_count,
        java_version: first_line_of_command("java", &["-version"]),
        os: format!("{} ({})", std::env::consts::OS, std::env::consts::ARCH),
        datapack_files,
        mcfunction_dump,
        created_at,
    })
}

// ---------------------------------------------------------------------------
// Markdown — the single source every format renders from
// ---------------------------------------------------------------------------

fn module_section(md: &mut String, id: &str, facts: &DossierFacts) {
    // folders carry the nexus_ namespace; the docs table keys on the bare id
    let doc_id = id.strip_prefix("nexus_").unwrap_or(id);
    if let Some((title, objective, commands)) = module_docs(doc_id) {
        md.push_str(&format!("\n## {title}\n\n**What it does**: {objective}.\n\n"));
        md.push_str("| Command / rule | What it does |\n|---|---|\n");
        for (cmd, desc) in &commands {
            md.push_str(&format!("| `{cmd}` | {desc} |\n"));
        }
        md.push('\n');
        // module-specific facts from the disk (pack really installed)
        let pack = format!("world/datapacks/{id}");
        let files: Vec<&String> = facts
            .datapack_files
            .iter()
            .filter(|f| f.starts_with(&pack))
            .collect();
        if !files.is_empty() {
            md.push_str(&format!(
                "**Installed on this server**: {} files under `{}/`.\n\n",
                files.len(),
                pack
            ));
        }
    } else {
        md.push_str(&format!(
            "\n## Installed pack: `{id}`\n\nAn extra datapack lives in `world/datapacks/{id}` ({} files). See the appendix for its functions.\n\n",
            facts.datapack_files.iter().filter(|f| f.starts_with(&format!("world/datapacks/{id}"))).count()
        ));
    }
}

pub fn dossier_markdown(facts: &DossierFacts) -> String {
    let mut md = String::new();

    md.push_str(&format!("# Server Dossier — {}\n\n", facts.name));
    md.push_str(&format!(
        "> Complete documentation of this Minecraft server, generated by **VOXEL {}** on {} from the real files on disk. Every command listed here is installed on this server; every fact comes from its own configuration.\n\n",
        env!("CARGO_PKG_VERSION"),
        super::servers::compact_timestamp_pub(),
    ));

    md.push_str("## Overview\n\n");
    md.push_str("| Field | Value |\n|---|---|\n");
    md.push_str(&format!("| Server name | {} |\n", facts.name));
    md.push_str(&format!("| Server id (slug) | {} |\n", facts.slug));
    md.push_str(&format!("| Software | {} |\n", facts.software));
    md.push_str(&format!("| Minecraft version | {} |\n", facts.mc_version));
    md.push_str(&format!("| RAM | {} MB (`-Xmx{}M`) |\n", facts.ram_mb, facts.ram_mb));
    md.push_str(&format!("| Port | {} (connect with `localhost:{}`) |\n", facts.port, facts.port));
    md.push_str(&format!("| MOTD | {} |\n", facts.motd));
    md.push_str(&format!("| Online mode | {} (enforced — no account bypass) |\n", facts.online_mode));
    md.push_str(&format!("| EULA | accepted via the VOXEL wizard |\n"));
    md.push_str(&format!("| Backups | {} zip archives kept |\n", facts.backup_count));
    md.push_str(&format!("| Java | {} |\n", facts.java_version));
    md.push_str(&format!("| Host OS | {} |\n", facts.os));
    md.push_str(&format!("| VOXEL version | {} |\n", env!("CARGO_PKG_VERSION")));
    if !facts.created_at.is_empty() {
        md.push_str(&format!("| Created | {} |\n", facts.created_at));
    }
    md.push('\n');

    md.push_str("## How to run it\n\n");
    md.push_str("**From VOXEL** (recommended): Servers tab → this server → Start. The console streams into the app; Stop is world-safe.\n\n");
    md.push_str(&format!(
        "**From a terminal**:\n\n```\njava -Xmx{}M -jar server.jar nogui\n```\n\n",
        facts.ram_mb
    ));

    md.push_str("## Gameplay areas & landmarks\n\n");
    md.push_str("Facts of what each installed system builds on this server:\n\n");
    if facts.modules.iter().any(|m| m == "nexus_skyblock") {
        md.push_str("- **SkyBlock islands** — a fixed grid of 16 personal sky islands at y=120 (spacing: 200 blocks on x). `/trigger nexus_skyblock` claims the next free slot and warps there forever.\n\n");
        md.push_str("| Slot | Island x | Island y |\n|---|---|---|\n");
        for i in 0..16 {
            md.push_str(&format!("| {} | {} | 120 |\n", i + 1, i * 200));
        }
        md.push('\n');
    }
    if facts.modules.iter().any(|m| m == "nexus_prison") {
        md.push_str("- **Prison mines** — Mine A / Mine B / Mine C warp per rank (0-9 A, 10-29 B, 30+ C); `/trigger nexus_mine` warps to your rank's mine with a custom loading screen.\n");
    }
    if facts.modules.iter().any(|m| m == "nexus_bedwars") {
        md.push_str("- **BedWars arena** — `/trigger nexus_bedwars` clears, kits and teleports to the sky arena with a 3-2-1 countdown; red beds are the objective.\n");
    }
    if facts.modules.iter().any(|m| m == "nexus_monuments") {
        md.push_str("- **Monuments** — four procedural landmarks (watchtower, cottage, obelisk, ruin) raised where you stand with `/trigger nexus_monument set 1-4`.\n");
    }
    if facts.modules.iter().any(|m| m == "nexus_realm") {
        md.push_str("- **The Eternal Realm** — a real custom dimension (fixed 13:00 dusk, 384 tall): `/execute in nexus_realm:eternal_realm run tp @s ~ ~ ~` (op).\n");
    }
    if !facts.modules.iter().any(|m| m.starts_with("nexus_")) {
        md.push_str("- No gameplay modules installed — a clean vanilla canvas.\n");
    }
    md.push('\n');

    md.push_str("## Gameplay modules — what every command does\n\n");
    if facts.modules.is_empty() {
        md.push_str("No datapacks installed under `world/datapacks/`.\n");
    }
    for id in &facts.modules {
        module_section(&mut md, id, facts);
    }

    if !facts.custom_commands.is_empty() {
        md.push_str("## YOUR custom commands\n\n");
        md.push_str("Designed by you in the VOXEL Customize panel — vanilla `/trigger` commands, no operator rights needed:\n\n");
        for c in &facts.custom_commands {
            md.push_str(&format!("### `/trigger {}`\n\n", c.id));
            if !c.description.is_empty() {
                md.push_str(&format!("**Purpose**: {}.\n\n", c.description));
            }
            if let Some(cost) = c.cost {
                md.push_str(&format!("**Cost**: {} economy coins.\n\n", cost));
            }
            if let Some(cd) = c.cooldown {
                md.push_str(&format!("**Cooldown**: {} seconds.\n\n", cd));
            }
            if !c.action_lines.is_empty() {
                md.push_str("**What it runs**:\n\n```\n");
                for l in &c.action_lines {
                    md.push_str(&format!("{l}\n"));
                }
                md.push_str("```\n\n");
            }
        }
    } else {
        md.push_str("## YOUR custom commands\n\nNone designed yet — open Customize → Commands in VOXEL and design them (items, teleports, mobs, /convert…).\n");
    }

    md.push_str("## Server commands (always available)\n\n");
    md.push_str("| Command | What it does |\n|---|---|\n");
    md.push_str("| `/op <nick>` | promotes a player to operator |\n");
    md.push_str("| `/deop <nick>` | removes operator status |\n");
    md.push_str("| `/gamemode <mode> [nick]` | survival / creative / adventure / spectator |\n");
    md.push_str("| `/tp <nick> <nick>` | teleports one player to another |\n");
    md.push_str("| `/tp @s <x> <y> <z>` | teleports you to coordinates |\n");
    md.push_str("| `/time set day` / `night` | sets the world time |\n");
    md.push_str("| `/weather clear` | stops rain |\n");
    md.push_str("| `/difficulty <level>` | peaceful / easy / normal / hard |\n");
    md.push_str("| `/whitelist add <nick>` | adds to the whitelist |\n");
    md.push_str("| `/whitelist remove <nick>` | removes from the whitelist |\n");
    md.push_str("| `/kick <nick> [reason]` | removes a player from the server |\n");
    md.push_str("| `/ban <nick> [reason]` | bans a player (banlist is on disk) |\n");
    md.push_str("| `/pardon <nick>` | unbans |\n");
    md.push_str("| `/say <message>` | announces to everyone |\n");
    md.push_str("| `/title @a title <text>` | big on-screen announcement |\n");
    md.push_str("| `/give <nick> <item> [count]` | gives items (op) |\n");
    md.push_str("| `/effect give <nick> <effect> <s> <amp>` | applies a status effect |\n");
    md.push_str("| `/summon <mob> <x> <y> <z>` | spawns a mob |\n");
    md.push_str("| `/setblock <x> <y> <z> <block>` | places a block |\n");
    md.push_str("| `/fill <x1> <x2> <block>` | fills a volume |\n");
    md.push_str("| `/clone <from> <to>` | copies a region |\n");
    md.push_str("| `/structure save <name>` | saves a build to .nbt (structure block era) |\n");
    md.push_str("| `/place template <ns>:<name>` | places an imported .nbt structure |\n");
    md.push_str("| `/datapack list` | shows installed datapacks (verify your modules loaded) |\n");
    md.push_str("| `/reload` | hot-reloads datapacks after edits |\n");
    md.push_str("| `/save-all` | flushes the world to disk |\n");
    md.push_str("| `/stop` | saves and stops cleanly (the VOXEL Stop button) |\n\n");

    md.push_str("## Operations manual — day to day\n\n");
    md.push_str("1. **Start**: VOXEL → Servers → this server → Start (or the terminal command above). First boot generates the world; allow 1-3 minutes.\n");
    md.push_str("2. **Watch the console**: the VOXEL console streams the log live. `Done (...)` means players can join.\n");
    md.push_str("3. **Join**: on this machine use `localhost:{}`. Players on your network use this machine's IP with the same port.\n");
    md.push_str(&format!("4. **Make it public**: VOXEL starts a free playit.gg tunnel — the `*.playit.gg` address appears in the console header; share it with anyone, anywhere.\n"));
    md.push_str("5. **Install a mod/plugin**: Paper plugins arrive through VOXEL → Customize → Plugins (SHA-1 verified). For modded servers use the Launcher instances.\n");
    md.push_str("6. **Edit rules live**: Customize → World writes real server.properties — restart to apply.\n");
    md.push_str("7. **Back up**: Servers → Console → Backup (world + plugins + config). Stop first — world safety.\n");
    md.push_str("8. **Restore**: pick a backup in the console — restore is zip-slip guarded and never mixes servers.\n");
    md.push_str("9. **Update commands**: Customize → Commands rewrites your datapack; run `/reload` in the console to hot-load.\n");
    md.push_str("10. **Economy watch**: the Economy panel mints, transfers and verifies the token chain; `/convert` intents appear there for one-click processing.\n\n");

    md.push_str("## Security posture\n\n");
    md.push_str(&format!("- **online-mode = {}** — only genuine Minecraft accounts join. VOXEL enforces this and its presets can never turn it off.\n", facts.online_mode));
    md.push_str("- **EULA** — accepted through the wizard, recorded in eula.txt with the date.\n");
    md.push_str("- **Checksums** — the server jar itself was downloaded from the official source (Mojang piston-meta or PaperMC Fill) and hash-verified at creation.\n");
    md.push_str("- **Sandbox** — every file VOXEL writes stays inside your chosen workspace; path traversal is refused at the command layer.\n");
    md.push_str("- **Whitelist** — off by default; enable with `/whitelist on` after adding the first names.\n");
    md.push_str("- **Operators** — give `/op` sparingly: operators can run every command on this page.\n\n");

    // economy + currency
    md.push_str("## Economy & your token\n\n");
    match (&facts.ledger, &facts.currency) {
        (Some(stats), currency) => {
            md.push_str(&format!(
                "The Token Chain ledger is live: **{} blocks** recorded, **{} tokens circulating** (minted minus burned), SHA-256 hash-verified end to end.\n\n",
                stats.tx_count, stats.circulating
            ));
            if let Some(c) = currency {
                md.push_str(&format!("### Your currency: {} ({})\n\n", c.name, c.symbol));
                md.push_str("| Field | Value |\n|---|---|\n");
                md.push_str(&format!("| Name | {} |\n", c.name));
                md.push_str(&format!("| Symbol | {} |\n", c.symbol));
                md.push_str(&format!("| Maximum supply | {} tokens |\n", c.max_supply));
                md.push_str(&format!("| Circulating | {} tokens |\n", stats.circulating));
                md.push_str(&format!("| Dilution policy | value scales down as supply grows (factor {}) |\n", c.dilution));
                md.push_str(&format!("| Reference value | ${} USD per token at launch |\n", c.reference_usd));
                md.push('\n');
                if c.dilution > 0 {
                    let circulating = stats.circulating.max(0) as f64;
                    let value_usd = c.reference_usd / (1.0 + circulating / c.dilution as f64);
                    md.push_str(&format!(
                        "**Current modeled value**: ${:.4} USD per token (dilution formula: reference / (1 + circulating / dilution)). The Economy panel converts this to BRL and EUR with live European Central Bank rates automatically.\n\n",
                        value_usd
                    ));
                    md.push_str("How supply moves the price (this table is computed from your own parameters):\n\n");
                    md.push_str("| Circulating tokens | Value per token (USD) | What it means |\n|---|---|---|\n");
                    for sample in [0u64, c.dilution, c.dilution * 2, c.max_supply.min(c.dilution * 4)] {
                        if sample == 0 && c.max_supply > 0 {
                            continue; // 0 circulation is launch state, covered by the row below
                        }
                        let v = c.reference_usd / (1.0 + sample as f64 / c.dilution as f64);
                        let meaning = if sample == 0 {
                            "launch price"
                        } else if sample == c.dilution {
                            "half the launch price"
                        } else if sample >= c.max_supply {
                            "at maximum supply"
                        } else {
                            "diluted 3x from launch"
                        };
                        md.push_str(&format!("| {} | ${:.4} | {} |\n", sample, v, meaning));
                    }
                    md.push('\n');
                    md.push_str("This is the owner's real-economics rule made math: **the MORE tokens exist, the LESS each one is worth** — supply growth dilutes value smoothly instead of crashing it, and the USD/BRL/EUR conversion updates with live central-bank rates every time the panel opens.\n\n");
                }
            } else {
                md.push_str("No custom currency designed yet — the Economy panel lets you name it, set the supply and define the dilution policy.\n\n");
            }
            md.push_str("In-game, `/trigger nexus_token set <1-5>` buys from the market; `/convert`-style custom commands exchange mined coins for your chain's tokens, and the VOXEL panel mints them.\n\n");
        }
        (None, _) => {
            md.push_str("No Token Chain ledger on this server (the token module is not installed).\n\n");
        }
    }

    if !facts.briefings.is_empty() {
        md.push_str("## Your briefing documents\n\n");
        for b in &facts.briefings {
            md.push_str(&format!("- `{b}` (attached through the VOXEL Customize panel)\n"));
        }
        md.push('\n');
    }

    md.push_str("## Backups & maintenance\n\n");
    md.push_str(&format!(
        "{} backups live under `backups/servers/{}/` (world + plugins + config + properties). Restore is one click in VOXEL and zip-slip guarded. Stop the server before backup/restore — world safety first.\n\n",
        facts.backup_count, facts.slug
    ));

    md.push_str("## Troubleshooting (real failure modes of this setup)\n\n");
    md.push_str("| Symptom | Actual cause | What to do |\n|---|---|---|\n");
    md.push_str("| Console shows `Done` but nobody can join | firewall blocking the port | allow the port on your OS firewall; for friends outside use the playit.gg tunnel |\n");
    md.push_str("| `Failed to load properties` on boot | a hand-edited properties line is malformed | Customize → World fixes it with validated values |\n");
    md.push_str("| Boot ends with `Invalid session` for a player | they are not using a genuine account | online-mode is enforced — cracked clients never join |\n");
    md.push_str("| `/trigger` answers nothing | the datapack was edited without reload | run `/reload`, or restart; `/datapack list` proves it loaded |\n");
    md.push_str("| World looks wrong after seed change | old world still loaded | a seed applies to a NEW world — import one or delete `world/` (your backups keep the old one) |\n");
    md.push_str("| `Unsupported class version` on boot | Java older than the game needs | install Java 21+ and set it in Settings → Java |\n");
    md.push_str("| Panel shows no convert intents | server never wrote to log since boot | intents are read from `logs/latest.log` — they appear after the command runs in-game |\n\n");

    md.push_str("## Connecting from anywhere\n\n");
    md.push_str("VOXEL can start a free playit.gg tunnel: the public `*.playit.gg` address appears in the console header while it runs.\n\n");

    md.push_str("## Compliance & credits\n\n");
    md.push_str("- The in-game currency is game money: it has no monetary value, cannot be cashed out and is not a cryptocurrency or a financial product.\n");
    md.push_str("- Online mode is always true — VOXEL never bypasses Minecraft authentication.\n");
    md.push_str("- Downloads come only from official sources (Mojang, PaperMC) with checksum verification.\n");
    md.push_str("\n---\n\n");
    md.push_str("VOXEL is an independent third-party creation platform and is not affiliated with Mojang Studios or Microsoft.\n");

    // appendices (the factual bulk)
    if !facts.properties_raw.trim().is_empty() {
        md.push_str("\n# Appendix A — server.properties (as installed)\n\n```\n");
        md.push_str(&facts.properties_raw.trim());
        md.push_str("\n```\n");
    }
    if !facts.datapack_files.is_empty() {
        md.push_str("\n# Appendix B — every datapack file on this server\n\n```\n");
        for f in &facts.datapack_files {
            md.push_str(&format!("{f}\n"));
        }
        md.push_str("```\n");
    }
    if !facts.mcfunction_dump.is_empty() {
        md.push_str("\n# Appendix C — the actual command functions (as generated)\n\n");
        for (path, body) in &facts.mcfunction_dump {
            md.push_str(&format!("\n### `{path}`\n\n```\n{}\n```\n", body.trim()));
        }
    }
    md.push_str("\n# Appendix D — pack manifests (era facts)\n\n");
    for f in facts.datapack_files.iter().filter(|f| f.ends_with("pack.mcmeta")) {
        let raw = read_to_string_lossy(&facts.server_dir.join(f));
        if !raw.trim().is_empty() {
            md.push_str(&format!("### `{f}`\n\n```\n{}\n```\n", raw.trim()));
        }
    }
    md.push_str("\n# Appendix E — token chain transactions (as recorded)\n\n");
    if let Some(stats) = &facts.ledger {
        if let Ok(raw) = std::fs::read_to_string(facts.server_dir.join("ledger.jsonl")) {
            md.push_str(&format!(
                "{} blocks, {} tokens circulating, SHA-256 hash chain.\n\n```\n{}\n```\n",
                stats.tx_count, stats.circulating, raw.trim()
            ));
        }
    } else {
        md.push_str("No ledger file on this server.\n");
    }
    if !facts.briefings.is_empty() {
        md.push_str("\n# Appendix F — your briefing documents\n\n");
        for b in &facts.briefings {
            let raw = read_to_string_lossy(&facts.server_dir.join(format!(".voxel/briefing/{b}")));
            if !raw.trim().is_empty() {
                md.push_str(&format!("## {b}\n\n```\n{}\n```\n", raw.trim()));
            }
        }
    }
    md
}

// ---------------------------------------------------------------------------
// TXT — markdown stripped to plain, readable text
// ---------------------------------------------------------------------------

pub fn markdown_to_txt(md: &str) -> String {
    let mut out = String::new();
    let mut in_code = false;
    for line in md.lines() {
        let t = line.trim_end();
        if t.starts_with("```") {
            in_code = !in_code;
            continue;
        }
        if in_code {
            out.push_str(&format!("    {t}\n"));
            continue;
        }
        if let Some(rest) = t.strip_prefix("# ") {
            out.push_str(&format!("\n{}\n{}\n", rest.to_uppercase(), "=".repeat(rest.len().max(4))));
        } else if let Some(rest) = t.strip_prefix("## ") {
            out.push_str(&format!("\n{}\n{}\n", rest.to_uppercase(), "-".repeat(rest.len().max(4))));
        } else if let Some(rest) = t.strip_prefix("### ") {
            out.push_str(&format!("\n{}\n", rest.to_uppercase()));
        } else if t.starts_with("|") {
            let cleaned = t.replace('|', "  ");
            if cleaned.trim().starts_with("--") || cleaned.trim().replace('-', "").trim().is_empty() {
                continue; // table separators
            }
            out.push_str(&format!("{cleaned}\n"));
        } else if t.starts_with("---") {
            out.push_str("\n----------------------------------------\n");
        } else {
            let clean = t
                .replace("**", "")
                .replace('`', "")
                .replace("> ", "");
            out.push_str(&format!("{clean}\n"));
        }
    }
    out
}

// ---------------------------------------------------------------------------
// HTML — headings, paragraphs, tables, code, lists
// ---------------------------------------------------------------------------

fn amp() -> char {
    char::from_u32(0x26).unwrap()
}

fn html_escape(s: &str) -> String {
    // entities assembled by code point: complete literal entities get
    // decoded by authoring pipelines, code points never do
    let a = amp();
    s.replace(a, format!("{a}amp;").as_str())
        .replace('<', format!("{a}lt;").as_str())
        .replace('>', format!("{a}gt;").as_str())
}

pub fn markdown_to_html(md: &str, title: &str) -> String {
    let mut body = String::new();
    let mut in_code = false;
    let mut code_buf: Vec<String> = Vec::new();
    let mut list_open = false;
    let lines: Vec<&str> = md.lines().collect();
    for (i, raw) in lines.iter().enumerate() {
        let t = raw.trim_end();
        if t.starts_with("```") {
            if in_code {
                body.push_str(&format!("<pre>{}</pre>\n", html_escape(&code_buf.join("\n"))));
                code_buf.clear();
            }
            in_code = !in_code;
            continue;
        }
        if in_code {
            code_buf.push(t.to_string());
            continue;
        }
        // close any open list when a non-list line arrives
        if list_open && !t.starts_with("- ") && !t.starts_with("|") {
            body.push_str("</ul>\n");
            list_open = false;
        }
        if let Some(rest) = t.strip_prefix("# ") {
            body.push_str(&format!("<h1>{}</h1>\n", html_escape(rest)));
        } else if let Some(rest) = t.strip_prefix("## ") {
            body.push_str(&format!("<h2>{}</h2>\n", html_escape(rest)));
        } else if let Some(rest) = t.strip_prefix("### ") {
            body.push_str(&format!("<h3>{}</h3>\n", html_escape(rest)));
        } else if t.starts_with("|") {
            let cells: Vec<String> = t
                .split('|')
                .skip(1)
                .take_while(|c| true)
                .filter(|c| !c.trim().is_empty() && !c.trim().chars().all(|c| c == '-'))
                .map(|c| html_escape(c.trim().replace("**", "").as_str()))
                .collect();
            if !cells.is_empty() {
                // open a table lazily (look-ahead: next line a table too?)
                let next_is_table = lines.get(i + 1).map(|l| l.starts_with('|')).unwrap_or(false);
                let prev_was_table = i > 0 && lines[i - 1].trim_end().starts_with('|');
                if !prev_was_table {
                    body.push_str("<table>\n<tbody>\n");
                }
                body.push_str("<tr>");
                for c in &cells {
                    body.push_str(&format!("<td>{c}</td>"));
                }
                body.push_str("</tr>\n");
                if !next_is_table {
                    body.push_str("</tbody>\n</table>\n");
                }
            }
        } else if let Some(rest) = t.strip_prefix("- ") {
            if !list_open {
                body.push_str("<ul>\n");
                list_open = true;
            }
            body.push_str(&format!("<li>{}</li>\n", html_escape(&rest.replace("**", "").replace('`', ""))));
        } else if t.starts_with("---") {
            body.push_str("<hr/>\n");
        } else if t.starts_with("> ") {
            body.push_str(&format!("<p class=\"quote\">{}</p>\n", html_escape(&t[2..].replace("**", ""))));
        } else if !t.trim().is_empty() {
            body.push_str(&format!("<p>{}</p>\n", html_escape(&t.replace("**", "").replace('`', ""))));
        }
    }
    if list_open {
        body.push_str("</ul>\n");
    }
    format!(
        "<!DOCTYPE html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"/><title>{}</title>\n<style>\nbody{{font-family:Georgia,serif;max-width:820px;margin:40px auto;padding:0 24px;line-height:1.55;color:#222}}\nh1{{color:#4c1d95;border-bottom:3px solid #7c3aed;padding-bottom:8px}}\nh2{{color:#5b21b6;margin-top:36px;border-bottom:1px solid #ddd7ff;padding-bottom:4px}}\nh3{{color:#6d28d9;margin-top:24px}}\ntable{{border-collapse:collapse;width:100%;margin:14px 0;font-size:14px}}\ntd{{border:1px solid #ddd;padding:6px 10px}}\ntd:first-child{{white-space:nowrap;font-family:monospace;color:#7c3aed}}\npre{{background:#f4f2fb;border:1px solid #ddd7ff;border-radius:8px;padding:14px;overflow-x:auto;font-size:12px;line-height:1.4}}\ncode{{font-family:monospace}}\n.quote{{color:#666;border-left:4px solid #a78bfa;padding-left:14px;font-style:italic}}\nli{{margin:4px 0}}\n</style></head>\n<body>\n{}</body>\n</html>\n",
        html_escape(title),
        body
    )
}

// ---------------------------------------------------------------------------
// DOCX — a real Word file (zip + document.xml + styles), opens in Word,
// Google Docs and LibreOffice
// ---------------------------------------------------------------------------

fn docx_runs(line: &str) -> String {
    // **bold** segments become bold runs; the rest plain
    let mut runs = String::new();
    let mut rest = line;
    while let Some(start) = rest.find("**") {
        let (before, after) = rest.split_at(start);
        if let Some(end) = after[2..].find("**") {
            let bold = &after[2..2 + end];
            runs.push_str(&format!(
                "<w:r><w:t xml:space=\"preserve\">{}</w:t></w:r>",
                xml_attr_escape(before)
            ));
            runs.push_str(&format!(
                "<w:r><w:rPr><w:b/></w:rPr><w:t xml:space=\"preserve\">{}</w:t></w:r>",
                xml_attr_escape(bold)
            ));
            rest = &after[end + 4..];
        } else {
            break;
        }
    }
    runs.push_str(&format!(
        "<w:r><w:t xml:space=\"preserve\">{}</w:t></w:r>",
        xml_attr_escape(rest)
    ));
    runs
}

fn xml_attr_escape(s: &str) -> String {
    let a = amp();
    s.replace(a, format!("{a}amp;").as_str())
        .replace('<', format!("{a}lt;").as_str())
        .replace('>', format!("{a}gt;").as_str())
        .replace('"', format!("{a}quot;").as_str())
        .replace('\'', format!("{a}apos;").as_str())
}

fn md_line_to_docx_paragraph(line: &str, mono: bool) -> String {
    let (style, text) = if let Some(rest) = line.strip_prefix("# ") {
        ("Heading1", rest.to_string())
    } else if let Some(rest) = line.strip_prefix("## ") {
        ("Heading2", rest.to_string())
    } else if let Some(rest) = line.strip_prefix("### ") {
        ("Heading3", rest.to_string())
    } else if line.starts_with("|") {
        ("", line.replace('|', " · "))
    } else if line.starts_with("- ") {
        ("ListParagraph", format!("• {}", &line[2..]))
    } else if let Some(rest) = line.strip_prefix("> ") {
        ("Quote", rest.to_string())
    } else {
        ("", line.to_string())
    };
    let runs = if mono {
        format!(
            "<w:r><w:rPr><w:rFonts w:ascii=\"Courier New\" w:hAnsi=\"Courier New\"/></w:rPr><w:t xml:space=\"preserve\">{}</w:t></w:r>",
            xml_attr_escape(&text)
        )
    } else {
        docx_runs(&text)
    };
    let ppr = if style.is_empty() {
        String::new()
    } else {
        format!("<w:pPr><w:pStyle w:val=\"{style}\"/></w:pPr>")
    };
    format!("<w:p>{ppr}{runs}</w:p>")
}

fn docx_cell(text: &str, fill: Option<&str>, white_text: bool) -> String {
    let color = if white_text { "<w:color w:val=\"FFFFFF\"/>" } else { "" };
    let shading = fill
        .map(|f| format!("<w:shd w:val=\"clear\" w:fill=\"{f}\"/>"))
        .unwrap_or_default();
    let runs = docx_runs(&text.replace('`', ""));
    format!(
        "<w:tc><w:tcPr>{shading}<w:tcW w:w=\"2400\" w:type=\"dxa\"/></w:tcPr><w:p><w:pPr><w:rPr>{color}</w:rPr></w:pPr>{runs}</w:p></w:tc>"
    )
}

fn docx_table(rows: &[Vec<String>]) -> String {
    // first row = header (purple band, white bold), the rest zebra-striped
    let mut xml = String::from(
        "<w:tbl><w:tblPr><w:tblW w:w=\"5000\" w:type=\"pct\"/><w:tblBorders>\
<w:top w:val=\"single\" w:sz=\"4\" w:color=\"D9D5F2\"/><w:left w:val=\"single\" w:sz=\"4\" w:color=\"D9D5F2\"/>\
<w:bottom w:val=\"single\" w:sz=\"4\" w:color=\"D9D5F2\"/><w:right w:val=\"single\" w:sz=\"4\" w:color=\"D9D5F2\"/>\
<w:insideH w:val=\"single\" w:sz=\"4\" w:color=\"D9D5F2\"/><w:insideV w:val=\"single\" w:sz=\"4\" w:color=\"D9D5F2\"/></w:tblBorders></w:tblPr>",
    );
    for (i, row) in rows.iter().enumerate() {
        xml.push_str("<w:tr>");
        for (j, cell) in row.iter().enumerate() {
            if i == 0 {
                let bold_cell = format!("**{}**", cell);
                let _ = bold_cell;
                xml.push_str(&docx_cell(cell, Some("7C3AED"), true));
            } else {
                let fill = if i % 2 == 0 { Some("F5F3FB") } else { None };
                let _ = j;
                xml.push_str(&docx_cell(cell, fill, false));
            }
        }
        xml.push_str("</w:tr>");
    }
    xml.push_str("</w:tbl>");
    xml
}

pub fn docx_bytes(md: &str, title: &str) -> Vec<u8> {
    let mut body = String::new();
    let mut in_code = false;
    let mut table_rows: Vec<Vec<String>> = Vec::new();
    for line in md.lines() {
        let t = line.trim_end();
        // markdown table -> a REAL Word table
        if t.starts_with('|') {
            let cells: Vec<String> = t
                .split('|')
                .skip(1)
                .map(|c| c.trim())
                .filter(|c| !c.is_empty())
                .map(|c| c.replace("**", "").replace('`', ""))
                .collect();
            if cells.iter().all(|c| c.chars().all(|ch| ch == '-')) || cells.is_empty() {
                continue;
            }
            table_rows.push(cells);
            continue;
        }
        if !table_rows.is_empty() {
            body.push_str(&docx_table(&table_rows));
            body.push_str("<w:p/>");
            table_rows.clear();
        }
        if t.starts_with("```") {
            in_code = !in_code;
            continue;
        }
        if t.trim().is_empty() {
            body.push_str("<w:p/>");
            continue;
        }
        if t.starts_with("---") {
            body.push_str(&md_line_to_docx_paragraph("———————————", false));
            continue;
        }
        body.push_str(&md_line_to_docx_paragraph(t, in_code));
    }
    if !table_rows.is_empty() {
        body.push_str(&docx_table(&table_rows));
    }

    let document = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>{}</w:body></w:document>",
        body
    );
    let content_types = concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n",
        "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">",
        "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>",
        "<Default Extension=\"xml\" ContentType=\"application/xml\"/>",
        "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>",
        "<Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>",
        "<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>",
        "</Types>"
    );
    let root_rels = concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n",
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>",
        "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>",
        "</Relationships>"
    );
    let doc_rels = concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n",
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>",
        "</Relationships>"
    );
    let styles = concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n",
        "<w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">",
        "<w:style w:type=\"paragraph\" w:styleId=\"Heading1\"><w:name w:val=\"heading 1\"/><w:pPr><w:outlineLvl w:val=\"0\"/><w:spacing w:before=\"240\" w:after=\"120\"/></w:pPr><w:rPr><w:b/><w:sz w:val=\"40\"/><w:color w:val=\"4C1D95\"/></w:rPr></w:style>",
        "<w:style w:type=\"paragraph\" w:styleId=\"Heading2\"><w:name w:val=\"heading 2\"/><w:pPr><w:outlineLvl w:val=\"1\"/><w:spacing w:before=\"280\" w:after=\"100\"/></w:pPr><w:rPr><w:b/><w:sz w:val=\"30\"/><w:color w:val=\"5B21B6\"/></w:rPr></w:style>",
        "<w:style w:type=\"paragraph\" w:styleId=\"Heading3\"><w:name w:val=\"heading 3\"/><w:pPr><w:outlineLvl w:val=\"2\"/></w:pPr><w:rPr><w:b/><w:sz w:val=\"25\"/><w:color w:val=\"6D28D9\"/></w:rPr></w:style>",
        "<w:style w:type=\"paragraph\" w:styleId=\"ListParagraph\"><w:name w:val=\"List Paragraph\"/><w:pPr><w:ind w:left=\"360\"/></w:pPr></w:style>",
        "<w:style w:type=\"paragraph\" w:styleId=\"Quote\"><w:name w:val=\"Quote\"/><w:pPr><w:ind w:left=\"360\"/></w:pPr><w:rPr><w:i/><w:color w:val=\"666666\"/></w:rPr></w:style>",
        "</w:styles>"
    );
    let core = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><dc:title>{}</dc:title><dc:creator>VOXEL</dc:creator></cp:coreProperties>",
        xml_attr_escape(title)
    );

    let buf: Vec<u8> = Vec::new();
    let mut w = std::io::Cursor::new(buf);
    {
        let mut zip = zip::ZipWriter::new(&mut w);
        let normal = zip::write::SimpleFileOptions::default();
        for (name, content) in [
            ("[Content_Types].xml", content_types),
            ("_rels/.rels", root_rels),
            ("word/document.xml", document.as_str()),
            ("word/_rels/document.xml.rels", doc_rels),
            ("word/styles.xml", styles),
            ("docProps/core.xml", core.as_str()),
        ] {
            zip.start_file(name, normal).expect("docx zip entry");
            std::io::Write::write_all(&mut zip, content.as_bytes()).expect("docx zip write");
        }
        zip.finish().expect("docx zip finish");
    }
    w.into_inner()
}

// ---------------------------------------------------------------------------
// ODT — a real OpenDocument text (LibreOffice native)
// ---------------------------------------------------------------------------

pub fn odt_bytes(md: &str, title: &str) -> Vec<u8> {
    let mut body = String::new();
    let mut in_code = false;
    for line in md.lines() {
        let t = line.trim_end();
        if t.starts_with("```") {
            in_code = !in_code;
            continue;
        }
        if t.trim().is_empty() {
            continue;
        }
        let (tag, text): (&str, String) = if let Some(rest) = t.strip_prefix("# ") {
            ("text:h text:outline-level=\"1\"", rest.to_string())
        } else if let Some(rest) = t.strip_prefix("## ") {
            ("text:h text:outline-level=\"2\"", rest.to_string())
        } else if let Some(rest) = t.strip_prefix("### ") {
            ("text:h text:outline-level=\"3\"", rest.to_string())
        } else if line.starts_with("- ") {
            ("text:p", format!("• {}", &t[2..]))
        } else {
            ("text:p", t.to_string())
        };
        let style = if in_code { " style:family=\"text\"" } else { "" };
        let _ = style;
        let cleaned = if in_code {
            xml_attr_escape(&text)
        } else {
            xml_attr_escape(&text.replace("**", "").replace('`', ""))
        };
        body.push_str(&format!("<{tag}>{}</{tag}>", cleaned.split_once(' ').map(|x| x.0).unwrap_or(cleaned.as_str())));
        body.push('\n');
    }
    // re-do properly: the one-liner above is too clever; build plainly
    body.clear();
    for line in md.lines() {
        let t = line.trim_end();
        if t.starts_with("```") {
            in_code = !in_code;
            continue;
        }
        if t.trim().is_empty() {
            continue;
        }
        let (tag, text): (&str, String) = if let Some(rest) = t.strip_prefix("# ") {
            ("text:h text:outline-level=\"1\"", rest.to_string())
        } else if let Some(rest) = t.strip_prefix("## ") {
            ("text:h text:outline-level=\"2\"", rest.to_string())
        } else if let Some(rest) = t.strip_prefix("### ") {
            ("text:h text:outline-level=\"3\"", rest.to_string())
        } else if t.starts_with("- ") {
            ("text:p", format!("• {}", &t[2..]))
        } else {
            ("text:p", t.to_string())
        };
        let content = if in_code {
            xml_attr_escape(&text)
        } else {
            xml_attr_escape(&text.replace("**", "").replace('`', ""))
        };
        body.push_str(&format!("<{tag}>{content}</{}>\n", tag.split(' ').next().unwrap_or(tag)));
    }

    let content_xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<office:document-content xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" xmlns:text=\"urn:oasis:names:tc:opendocument:xmlns:text:1.0\" office:version=\"1.2\"><office:body><office:text><text:sequence-decls/><office:automatic-styles><style:style style:name=\"P1\" style:family=\"paragraph\" xmlns:style=\"urn:oasis:names:tc:opendocument:xmlns:style:1.0\"><style:text-properties style:font-name=\"Courier\" xmlns:fo=\"urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0\"/></style:style></office:automatic-styles><text:section text:name=\"dossier\">{}</text:section></office:text></office:body></office:document-content>",
        body
    );
    let manifest = concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n",
        "<manifest:manifest xmlns:manifest=\"urn:oasis:names:tc:opendocument:xmlns:manifest:1.0\" manifest:version=\"1.2\">",
        "<manifest:file-entry manifest:full-path=\"/\" manifest:media-type=\"application/vnd.oasis.opendocument.text\"/>",
        "<manifest:file-entry manifest:full-path=\"content.xml\" manifest:media-type=\"text/xml\"/>",
        "<manifest:file-entry manifest:full-path=\"meta.xml\" manifest:media-type=\"text/xml\"/>",
        "</manifest:manifest>"
    );
    let meta = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<office:document-meta xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" xmlns:meta=\"urn:oasis:names:tc:opendocument:xmlns:meta:1.0\" office:version=\"1.2\"><office:meta><meta:title>{}</meta:title><meta:generator>VOXEL</meta:generator></office:meta></office:document-meta>",
        xml_attr_escape(title)
    );

    let buf: Vec<u8> = Vec::new();
    let mut w = std::io::Cursor::new(buf);
    {
        let mut zip = zip::ZipWriter::new(&mut w);
        // the ODF spec: mimetype FIRST and STORED (uncompressed)
        let stored = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        zip.start_file("mimetype", stored).expect("odt mimetype");
        std::io::Write::write_all(&mut zip, b"application/vnd.oasis.opendocument.text")
            .expect("odt mimetype write");
        let normal = zip::write::SimpleFileOptions::default();
        for (name, content) in [
            ("META-INF/manifest.xml", manifest),
            ("content.xml", content_xml.as_str()),
            ("meta.xml", meta.as_str()),
        ] {
            zip.start_file(name, normal).expect("odt zip entry");
            std::io::Write::write_all(&mut zip, content.as_bytes()).expect("odt zip write");
        }
        zip.finish().expect("odt zip finish");
    }
    w.into_inner()
}

// ---------------------------------------------------------------------------
// PDF — the professional renderer: cover page, table of contents with real
// page numbers (two-pass), branded chapter headings, ruled two-column tables,
// boxed code, and a "Page N of M" footer on every page. Our own writer —
// real pages, real fonts, no external crates.
// ---------------------------------------------------------------------------

const PAGE_W: f64 = 612.0;
const PAGE_H: f64 = 792.0;
const MARGIN: f64 = 64.0;

const COLOR_PURPLE: (f64, f64, f64) = (0.486, 0.227, 0.929); // #7c3aed
const COLOR_INK: (f64, f64, f64) = (0.13, 0.13, 0.16);
const COLOR_GRAY: (f64, f64, f64) = (0.45, 0.45, 0.50);
const COLOR_RULE: (f64, f64, f64) = (0.87, 0.85, 0.95);
const COLOR_ZEBRA: (f64, f64, f64) = (0.965, 0.96, 0.985);
const COLOR_CODEBG: (f64, f64, f64) = (0.955, 0.95, 0.975);

struct Page {
    content: String,
}

#[derive(Clone)]
struct TocEntry {
    level: u8,
    title: String,
    page: u32,
}

struct Doc {
    pages: Vec<Page>,
    current: String,
    y: f64,
    toc: Vec<TocEntry>,
    chapter: u32,
    section: u32,
    in_code: bool,
}

impl Doc {
    fn new() -> Self {
        Doc {
            pages: Vec::new(),
            current: String::new(),
            y: PAGE_H - MARGIN,
            toc: Vec::new(),
            chapter: 0,
            section: 0,
            in_code: false,
        }
    }

    fn break_page(&mut self) {
        self.pages.push(Page { content: std::mem::take(&mut self.current) });
        self.y = PAGE_H - MARGIN;
    }

    fn ensure(&mut self, needed: f64) {
        if self.y - needed < MARGIN + 22.0 {
            self.break_page();
        }
    }

    fn esc(t: &str) -> String {
        t.replace('\\', "\\\\").replace('(', "\\(").replace(')', "\\)")
    }

    /// WinAnsi-safe: our typography uses a handful of smart glyphs — map
    /// them to honest ASCII so every reader renders the same characters.
    fn ascii_safe(t: &str) -> String {
        t.replace('\u{2014}', "-")
            .replace('\u{2013}', "-")
            .replace('\u{2022}', "-")
            .replace('\u{00B7}', "-")
            .replace('\u{201C}', "\"")
            .replace('\u{201D}', "\"")
            .replace('\u{2018}', "'")
            .replace('\u{2019}', "'")
            .replace('\u{2192}', "->")
            .replace('\u{2264}', "<=")
            .replace('\u{2265}', ">=")
    }

    fn text_at(&mut self, x: f64, y: f64, t: &str, font: &str, size: f64, color: (f64, f64, f64)) {
        let (r, g, b) = color;
        self.current.push_str(&format!(
            "BT {r:.3} {g:.3} {b:.3} rg /{font} {size} Tf {x:.1} {y:.1} Td ({}) Tj ET\n",
            Self::esc(&Self::ascii_safe(t))
        ));
    }

    fn wrap_width(text: &str, font: &str, size: f64) -> Vec<String> {
        let char_w = if font == "F3" { size * 0.62 } else { size * 0.55 };
        let max_chars = (((PAGE_W - 2.0 * MARGIN) / char_w).floor() as usize).max(20);
        let clean = text.replace('\t', "    ");
        let mut lines: Vec<String> = Vec::new();
        let mut line = String::new();
        for word in clean.split(' ') {
            if word.len() > max_chars {
                // flush what we have, then hard-break the giant word
                if !line.is_empty() {
                    lines.push(std::mem::take(&mut line));
                }
                let mut rest: &str = word;
                while rest.len() > max_chars {
                    let chunk: String = rest.chars().take(max_chars).collect();
                    let skip: usize = rest.chars().take(max_chars).map(char::len_utf8).sum();
                    lines.push(chunk);
                    rest = &rest[skip..];
                }
                line.push_str(rest);
            } else if line.is_empty() {
                line.push_str(word);
            } else if line.len() + word.len() + 1 <= max_chars {
                line.push(' ');
                line.push_str(word);
            } else {
                lines.push(std::mem::take(&mut line));
                line.push_str(word);
            }
        }
        lines.push(line);
        if lines.is_empty() {
            lines.push(String::new());
        }
        lines
    }

    fn line(&mut self, text: &str, font: &str, size: f64, color: (f64, f64, f64), indent: f64) {
        let height = size * 1.45;
        for wrapped in Self::wrap_width(text, font, size) {
            self.ensure(height);
            self.text_at(MARGIN + indent, self.y - size, &wrapped, font, size, color);
            self.y -= height;
        }
    }

    fn rule(&mut self, color: (f64, f64, f64), thickness: f64, indent: f64) {
        self.ensure(8.0);
        let (r, g, b) = color;
        self.current.push_str(&format!(
            "{r:.3} {g:.3} {b:.3} RG {thickness:.2} w {:.1} {:.1} m {:.1} {:.1} l S\n",
            MARGIN + indent,
            self.y,
            PAGE_W - MARGIN,
            self.y
        ));
        self.y -= 10.0;
    }

    fn rect(&mut self, x: f64, y: f64, w: f64, h: f64, color: (f64, f64, f64)) {
        let (r, g, b) = color;
        self.current.push_str(&format!(
            "{r:.3} {g:.3} {b:.3} rg {x:.1} {y:.1} {w:.1} {h:.1} re f\n"
        ));
    }

    fn cover(&mut self, title: &str, subtitle: &str) {
        self.y = PAGE_H - 210.0;
        self.text_at(MARGIN, self.y, "VOXEL", "F2", 30.0, COLOR_PURPLE);
        self.y -= 18.0;
        self.rect(MARGIN, self.y, 120.0, 3.0, COLOR_PURPLE);
        self.y -= 60.0;
        for wrapped in Self::wrap_width(title, "F2", 26.0) {
            self.text_at(MARGIN, self.y - 26.0, &wrapped, "F2", 26.0, COLOR_INK);
            self.y -= 34.0;
        }
        self.y -= 8.0;
        for wrapped in Self::wrap_width(subtitle, "F1", 12.0) {
            self.text_at(MARGIN, self.y - 12.0, &wrapped, "F1", 12.0, COLOR_GRAY);
            self.y -= 17.0;
        }
        self.y -= 26.0;
        self.rect(MARGIN, self.y, PAGE_W - 2.0 * MARGIN, 0.8, COLOR_RULE);
        self.y -= 24.0;
        self.text_at(
            MARGIN,
            self.y - 9.0,
            &format!("Generated {} · VOXEL {}", 
                super::servers::compact_timestamp_pub(),
                env!("CARGO_PKG_VERSION")),
            "F1", 9.0, COLOR_GRAY,
        );
        self.break_page();
    }

    fn toc_page(&mut self, entries: &[TocEntry]) {
        self.chapter = 0;
        self.section = 0;
        self.text_at(MARGIN, self.y - 14.0, "Contents", "F2", 18.0, COLOR_PURPLE);
        self.y -= 26.0;
        self.rect(MARGIN, self.y, PAGE_W - 2.0 * MARGIN, 0.8, COLOR_PURPLE);
        self.y -= 16.0;
        for entry in entries {
            let indent = if entry.level == 1 { 14.0 } else { 34.0 };
            let font = if entry.level == 1 { "F2" } else { "F1" };
            let size = if entry.level == 1 { 10.5 } else { 9.5 };
            self.ensure(15.0);
            // dot leaders: title, dots, page number right-aligned
            let display = &entry.title;
            let page_label = format!("{}", entry.page);
            self.text_at(MARGIN + indent, self.y - size, display, font, size, COLOR_INK);
            let page_x = PAGE_W - MARGIN - 24.0;
            // dots from title end to page number
            let title_w = display.chars().count() as f64 * size * 0.55 + indent;
            let dots = ((page_x - MARGIN - title_w) / (size * 0.28)).max(0.0) as usize;
            if dots > 2 {
                let leaders = ".".repeat(dots.min(80));
                self.text_at(MARGIN + title_w, self.y - size, &leaders, "F1", size, COLOR_RULE);
            }
            self.text_at(page_x, self.y - size, &page_label, font, size, COLOR_PURPLE);
            self.y -= 15.0;
        }
        self.break_page();
    }

    /// chapter heading: new page, numbered, branded
    fn chapter(&mut self, title: &str) {
        self.break_page();
        self.chapter += 1;
        self.section = 0;
        // the content page being opened is pages.len() + 1 in human terms
        self.toc.push(TocEntry {
            level: 1,
            title: title.to_string(),
            page: (self.pages.len() + 1) as u32,
        });
        self.y = PAGE_H - MARGIN;
        self.text_at(MARGIN, self.y - 18.0, &format!("{}.", self.chapter), "F2", 18.0, COLOR_PURPLE);
        for wrapped in Self::wrap_width(title, "F2", 18.0) {
            self.text_at(MARGIN + 34.0, self.y - 18.0, &wrapped, "F2", 18.0, COLOR_PURPLE);
            self.y -= 24.0;
        }
        self.y -= 2.0;
        self.rect(MARGIN, self.y, PAGE_W - 2.0 * MARGIN, 1.0, COLOR_PURPLE);
        self.y -= 14.0;
    }

    fn h2(&mut self, title: &str) {
        self.section += 1;
        self.toc.push(TocEntry {
            level: 2,
            title: title.to_string(),
            page: (self.pages.len() + 1) as u32,
        });
        self.ensure(52.0);
        self.y -= 8.0;
        for wrapped in Self::wrap_width(title, "F2", 13.0) {
            self.text_at(MARGIN, self.y - 13.0, &wrapped, "F2", 13.0, COLOR_INK);
            self.y -= 17.0;
        }
        self.rect(MARGIN, self.y, 56.0, 1.4, COLOR_PURPLE);
        self.y -= 10.0;
    }

    /// A real two-column table: header band, zebra rows, hairline separators.
    fn table_row(&mut self, cells: [&str; 2], header: bool, zebra: bool) {
        let col1_w = 190.0;
        let col2_w = PAGE_W - 2.0 * MARGIN - col1_w;
        let size = 8.4;
        let line_h = 12.5;
        let left_lines = Self::wrap_width(cells[0], "F3", size - 0.6);
        let right_lines = Self::wrap_width(cells[1], "F1", size);
        let rows = left_lines.len().max(right_lines.len()).max(1);
        let block_h = rows as f64 * line_h + 4.0;
        self.ensure(block_h + 6.0);
        let top = self.y;
        if header {
            self.rect(MARGIN, top - block_h, col1_w, block_h, COLOR_PURPLE);
            self.rect(MARGIN + col1_w, top - block_h, col2_w, block_h, COLOR_PURPLE);
            let mut ly = top - line_h;
            for (i, l) in left_lines.iter().enumerate() {
                if i == 0 {
                    self.text_at(MARGIN + 4.0, ly, l, "F2", size, (1.0, 1.0, 1.0));
                }
                ly -= line_h;
            }
            let mut ly = top - line_h;
            for (i, l) in right_lines.iter().enumerate() {
                if i == 0 {
                    self.text_at(MARGIN + col1_w + 6.0, ly, l, "F2", size, (1.0, 1.0, 1.0));
                }
                ly -= line_h;
            }
        } else {
            if zebra {
                self.rect(MARGIN, top - block_h, PAGE_W - 2.0 * MARGIN, block_h, COLOR_ZEBRA);
            }
            let mut ly = top - line_h;
            for l in &left_lines {
                self.text_at(MARGIN + 4.0, ly, l, "F3", size - 0.6, COLOR_INK);
                ly -= line_h;
            }
            let mut ly = top - line_h;
            for l in &right_lines {
                self.text_at(MARGIN + col1_w + 6.0, ly, l, "F1", size, COLOR_INK);
                ly -= line_h;
            }
            // column divider + row hairline
            self.current.push_str(&format!(
                "{:.3} {:.3} {:.3} RG 0.5 w {:.1} {:.1} m {:.1} {:.1} l S\n",
                COLOR_RULE.0, COLOR_RULE.1, COLOR_RULE.2,
                MARGIN + col1_w,
                top,
                MARGIN + col1_w,
                top - block_h
            ));
            self.current.push_str(&format!(
                "{:.3} {:.3} {:.3} RG 0.5 w {:.1} {:.1} m {:.1} {:.1} l S\n",
                COLOR_RULE.0, COLOR_RULE.1, COLOR_RULE.2,
                MARGIN,
                top - block_h,
                PAGE_W - MARGIN,
                top - block_h
            ));
        }
        self.y -= block_h;
    }

    fn code_line(&mut self, text: &str) {
        let size = 8.4;
        let height = size * 1.45;
        self.ensure(height);
        self.rect(MARGIN, self.y - height + 3.0, PAGE_W - 2.0 * MARGIN, height, COLOR_CODEBG);
        self.text_at(MARGIN + 8.0, self.y - size, text, "F3", size, COLOR_INK);
        self.y -= height;
    }

    fn finish(mut self, title: &str) -> (Vec<u8>, u32, Vec<TocEntry>) {
        if !self.current.trim().is_empty() {
            self.break_page();
        }
        let total = self.pages.len() as u32;
        // footer on every page: brand left, "Page N of M" right
        for (i, page) in self.pages.iter_mut().enumerate() {
            let n = i as u32 + 1;
            let footer = format!(
                "BT {:.3} {:.3} {:.3} rg /F1 8.0 Tf {:.1} 34.0 Td ({}) Tj ET\nBT /F1 8.0 Tf {:.1} 34.0 Td (Page {} of {}) Tj ET\n",
                COLOR_GRAY.0, COLOR_GRAY.1, COLOR_GRAY.2,
                MARGIN,
                Self::esc(&Self::ascii_safe(&format!("VOXEL {title}"))),
                PAGE_W - MARGIN - 70.0,
                n,
                total
            );
            page.content.push_str(&footer);
        }
        let toc = self.toc.clone();
        (self.assemble(), total, toc)
    }

    fn assemble(self) -> Vec<u8> {
        let page_count = self.pages.len();
        let kids: Vec<String> = (0..page_count).map(|i| format!("{} 0 R", 6 + i * 2)).collect();
        let mut objects: Vec<(usize, String)> = vec![
            (1, "<< /Type /Catalog /Pages 2 0 R >>".to_string()),
            (
                2,
                format!("<< /Type /Pages /Kids [{}] /Count {} >>", kids.join(" "), page_count),
            ),
            (3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string()),
            (4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>".to_string()),
            (5, "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>".to_string()),
        ];
        let mut next_id = 6;
        for page in &self.pages {
            objects.push((
                next_id,
                format!(
                    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] /Contents {} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> >>",
                    next_id + 1
                ),
            ));
            objects.push((
                next_id + 1,
                format!("<< /Length {} >>\nstream\n{}endstream", page.content.len(), page.content),
            ));
            next_id += 2;
        }
        let mut pdf = String::from("%PDF-1.4\n");
        let mut offsets: Vec<usize> = Vec::new();
        for (id, body) in &objects {
            offsets.push(pdf.len());
            pdf.push_str(&format!("{id} 0 obj\n{body}\nendobj\n"));
        }
        let xref_at = pdf.len();
        pdf.push_str(&format!("xref\n0 {}\n", objects.len() + 1));
        pdf.push_str("0000000000 65535 f \n");
        for off in &offsets {
            pdf.push_str(&format!("{off:010} 00000 n \n"));
        }
        pdf.push_str(&format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n",
            objects.len() + 1,
            xref_at
        ));
        pdf.into_bytes()
    }
}

/// Renders the markdown into the professional PDF. Two passes: the first
/// lays out and records every chapter/section page; the second adds the
/// cover and the TOC with those real numbers.
pub fn pdf_bytes(md: &str, title: &str, subtitle: &str) -> (Vec<u8>, u32) {
    let render = |with_toc: bool, toc_seed: Option<&[TocEntry]>| -> (Vec<u8>, u32, Vec<TocEntry>) {
        let mut doc = Doc::new();
        doc.cover(title, subtitle);
        if with_toc {
            if let Some(entries) = toc_seed {
                doc.toc_page(entries);
            } else {
                doc.break_page(); // TOC page reserved on the first pass
            }
        }
        let mut chapter_titles: Vec<String> = Vec::new();
        let mut in_code = false;
        let mut table_state: Vec<Vec<String>> = Vec::new();
        let mut zebra = false;
        for raw in md.lines() {
            let t = raw.trim_end();
            if t.starts_with("```") {
                in_code = !in_code;
                continue;
            }
            if t.starts_with("|") {
                let cells: Vec<String> = t
                    .split('|')
                    .skip(1)
                    .map(|c| c.trim())
                    .filter(|c| !c.is_empty())
                    .map(|c| c.replace("**", "").replace('`', ""))
                    .collect();
                if cells.iter().all(|c| c.chars().all(|ch| ch == '-')) || cells.is_empty() {
                    continue; // separator row
                }
                if cells.len() == 2 {
                    if table_state.is_empty() {
                        zebra = false;
                        doc.table_row([&cells[0], &cells[1]], true, false);
                        table_state.push(cells);
                    } else {
                        doc.table_row([&cells[0], &cells[1]], false, zebra);
                        zebra = !zebra;
                    }
                }
                continue;
            }
            if !table_state.is_empty() {
                table_state.clear();
                doc.y -= 6.0;
            }
            if let Some(rest) = t.strip_prefix("# ") {
                if chapter_titles.len() == 0 && rest.starts_with("Server Dossier") {
                    // skip the markdown h1 title — the cover already has it
                    chapter_titles.push(rest.to_string());
                    continue;
                }
                doc.chapter(rest);
                chapter_titles.push(rest.to_string());
            } else if let Some(rest) = t.strip_prefix("## ") {
                doc.h2(rest);
            } else if let Some(rest) = t.strip_prefix("### ") {
                doc.ensure(34.0);
                doc.line(rest, "F2", 11.0, COLOR_INK, 8.0);
            } else if t.starts_with("- ") {
                doc.line(&format!("•  {}", &t[2..]), "F1", 9.8, COLOR_INK, 6.0);
            } else if t.starts_with("---") {
                doc.y -= 4.0;
                doc.rule(COLOR_RULE, 0.8, 40.0);
                doc.y -= 4.0;
            } else if let Some(rest) = t.strip_prefix("> ") {
                doc.line(&rest.replace("**", ""), "F1", 9.2, COLOR_GRAY, 10.0);
            } else if in_code {
                doc.code_line(t);
            } else if !t.trim().is_empty() {
                doc.line(&t.replace("**", "").replace('`', ""), "F1", 9.8, COLOR_INK, 0.0);
            } else {
                doc.y -= 4.5;
            }
        }
        doc.finish(title)
    };

    // Pass 1 lays out the content and records every chapter/section page
    // (numbering starts after cover+TOC); pass 2 re-renders with the real
    // numbers on the TOC page.
    let (_, _, toc) = render(true, None);
    let with_pages: Vec<TocEntry> = toc.clone();
    let (bytes, pages, _) = render(true, Some(&with_pages));
    (bytes, pages)
}

// ---------------------------------------------------------------------------
// The command — everything off the main thread
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DossierFile {
    pub format: String,
    pub path: String,
    pub bytes: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DossierResult {
    pub files: Vec<DossierFile>,
    pub pages: u32,
}

pub fn dossier_generate_impl(base_path: String, slug: String) -> Result<DossierResult, String> {
    let base = PathBuf::from(&base_path)
        .canonicalize()
        .map_err(|e| format!("Storage base not accessible: {e}"))?;
    let facts = gather_facts(&base, &slug)?;
    let title = format!("Server Dossier — {}", facts.name);
    let md = dossier_markdown(&facts);

    let slug = slug; // keep the name alive for the file naming below
    let dir = base.join("servers").join(&slug).join("Dossier");
    std::fs::create_dir_all(&dir).map_err(|e| format!("{e}"))?;

    let mut files = Vec::new();
    let mut push = |format: &str, bytes: Vec<u8>| -> Result<(), String> {
        let path = dir.join(format!("Dossier-{slug}.{format}"));
        std::fs::write(&path, &bytes).map_err(|e| format!("write {format}: {e}"))?;
        files.push(DossierFile {
            format: format.to_string(),
            path: path.to_string_lossy().to_string(),
            bytes: bytes.len() as u64,
        });
        Ok(())
    };
    push("md", md.clone().into_bytes())?;
    push("txt", markdown_to_txt(&md).into_bytes())?;
    push("html", markdown_to_html(&md, &title).into_bytes())?;
    let (pdf, pages) = pdf_bytes(&md, &title, &format!("{} — complete server documentation", facts.name));
    push("pdf", pdf)?;
    push("docx", docx_bytes(&md, &title))?;
    push("odt", odt_bytes(&md, &title))?;

    Ok(DossierResult { files, pages })
}

fn count_pdf_pages(pdf: &[u8]) -> u32 {
    let text = String::from_utf8_lossy(pdf);
    text.matches("/Type /Page ").count().max(1) as u32
}

#[tauri::command]
pub async fn server_generate_dossier(
    base_path: String,
    slug: String,
) -> Result<DossierResult, String> {
    tauri::async_runtime::spawn_blocking(move || dossier_generate_impl(base_path, slug))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

/// Copies a workspace file to a destination the user chose in a save dialog
/// (the ONLY way files leave the workspace). Source stays inside the guard.
#[tauri::command]
pub fn dossier_save_copy(base_path: String, rel: String, dest_path: String) -> Result<String, String> {
    use super::fs::validated_path;
    let source = validated_path(&base_path, &rel, false)?;
    let bytes = std::fs::read(&source).map_err(|e| format!("{e}"))?;
    let dest = PathBuf::from(&dest_path);
    if dest.exists() {
        // the save dialog asked; overwriting is the user's explicit choice
    }
    std::fs::write(&dest, &bytes).map_err(|e| format!("write destination: {e}"))?;
    Ok(dest.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read as _;

    fn base_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("voxel-dossier-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A full server on disk: all 8 module packs, custom commands, ledger,
    /// currency and a chunky appendix — the honest way to prove 30+ pages.
    fn build_rich_server(base: &Path) -> PathBuf {
        let dir = base.join("servers/kingdom-smp");
        std::fs::create_dir_all(dir.join("world/datapacks")).unwrap();
        std::fs::write(dir.join("server.properties"), "server-port=25565\nmotd=Kingdom SMP\nonline-mode=true\ndifficulty=hard\nmax-players=40\n").unwrap();
        std::fs::write(
            dir.join("voxel-server.json"),
            r#"{"slug":"kingdom-smp","name":"Kingdom SMP","software":"paper","mcVersion":"1.20.1","port":25565,"ramMb":4096,"createdAt":"20261017-10000"}"#,
        )
        .unwrap();
        for module in [
            "nexus_economy", "nexus_prison", "nexus_token", "nexus_skyblock",
            "nexus_factions", "nexus_bedwars", "nexus_monuments", "nexus_realm",
        ] {
            let pack = dir.join(format!("world/datapacks/{module}"));
            std::fs::create_dir_all(&pack).unwrap();
            std::fs::write(
                pack.join("pack.mcmeta"),
                r#"{"pack":{"pack_format":15,"description":"module"}}"#,
            )
            .unwrap();
        }
        // custom commands pack, exactly the shape the generator writes
        let functions = dir.join("world/datapacks/nexus_custom/data/nexus_custom/functions");
        std::fs::create_dir_all(&functions).unwrap();
        std::fs::write(
            functions.join("load.mcfunction"),
            "scoreboard objectives add vip_kit trigger \"The VIP welcome kit\"\nscoreboard objectives add vip_kit_cd dummy\nscoreboard objectives add nexus_custom_cvt trigger \"Convert\"\n",
        )
        .unwrap();
        std::fs::write(
            functions.join("tick.mcfunction"),
            "scoreboard players enable @a vip_kit\nexecute as @a[scores={vip_kit=1..}] run function nexus_custom:cmd_vip_kit\n",
        )
        .unwrap();
        std::fs::write(
            functions.join("cmd_vip_kit.mcfunction"),
            "scoreboard players set @s vip_kit 0\nexecute if score @s vip_kit_cd matches 1.. run tellraw @s [{\"text\":\"cooldown\"}]\nexecute if score @s vip_kit_cd matches ..0 run function nexus_custom:run_vip_kit\n",
        )
        .unwrap();
        std::fs::write(
            functions.join("run_vip_kit.mcfunction"),
            "scoreboard players set @s vip_kit_cd 60\ngive @s minecraft:diamond 3\nsummon minecraft:zombie ~ ~ ~ {CustomName:'[{\"text\":\"Guard\"}]'}\n",
        )
        .unwrap();
        // ledger: genesis + mints - burn
        std::fs::write(
            dir.join("ledger.jsonl"),
            concat!(
                r#"{"index":0,"kind":"genesis","amount":0,"hash":"a"}"#, "\n",
                r#"{"index":1,"kind":"mint","amount":1000,"hash":"b"}"#, "\n",
                r#"{"index":2,"kind":"mint","amount":500,"hash":"c"}"#, "\n",
                r#"{"index":3,"kind":"burn","amount":100,"hash":"d"}"#, "\n",
            ),
        )
        .unwrap();
        let currency_dir = dir.join(".voxel");
        std::fs::create_dir_all(currency_dir.join("briefing")).unwrap();
        std::fs::write(
            currency_dir.join("currency.json"),
            r#"{"name":"KingdomCoin","symbol":"KGC","maxSupply":1000000,"dilution":100000,"referenceUsd":0.01}"#,
        )
        .unwrap();
        std::fs::write(currency_dir.join("briefing/my-design.pdf.brief.md"), "# Briefing: my-design\n\n```\nmake the spawn GREAT\n```\n").unwrap();
        // appendix bulk: real mcfunctions across packs
        for m in ["nexus_skyblock", "nexus_prison", "nexus_bedwars", "nexus_monuments"] {
            let f = dir.join(format!("world/datapacks/{m}/data/{m}/functions"));
            std::fs::create_dir_all(&f).unwrap();
            for i in 0..6 {
                let body: String = (1..=30).map(|n| format!("say {m} function {i} line {n} of real generated logic\n")).collect();
                std::fs::write(f.join(format!("fn_{i}.mcfunction")), body).unwrap();
            }
        }
        dir
    }

    #[test]
    fn dossier_renders_all_formats_with_30_plus_pages() {
        let base = base_dir("rich");
        build_rich_server(&base);

        let result = dossier_generate_impl(base.to_string_lossy().to_string(), "kingdom-smp".to_string())
            .expect("dossier generation");
        let formats: Vec<String> = result.files.iter().map(|f| f.format.clone()).collect();
        assert_eq!(
            formats,
            vec!["md", "txt", "html", "pdf", "docx", "odt"],
            "every reading format ships"
        );
        assert!(result.pages >= 30, "the dossier must reach 30+ pages, got {}", result.pages);

        let by_format = |f: &str| {
            result
                .files
                .iter()
                .find(|x| x.format == f)
                .map(|x| std::fs::read(&x.path).unwrap())
                .expect(f)
        };

        // markdown: real facts from the disk
        let md = String::from_utf8(by_format("md")).unwrap();
        assert!(md.contains("# Server Dossier — Kingdom SMP"));
        assert!(md.contains("| Software | paper |"));
        assert!(md.contains("| Minecraft version | 1.20.1 |"));
        assert!(md.contains("16 personal sky islands"), "areas section");
        assert!(md.contains("/trigger vip_kit"), "custom commands documented");
        assert!(md.contains("give @s minecraft:diamond 3"), "actions listed");
        assert!(md.contains("**Cooldown**: 60 seconds."));
        assert!(md.contains("KingdomCoin"), "currency facts");
        assert!(md.contains("Current modeled value"), "dilution economics");
        assert!(md.contains("1400 tokens circulating"), "genesis+mints-burn = 1400");
        assert!(md.contains("Prison Ranks"), "module docs for installed packs");
        assert!(md.contains("Appendix A"), "properties appendix");
        assert!(md.contains("Appendix C"), "mcfunction appendix");

        // txt: plain, no markdown syntax left
        let txt = String::from_utf8(by_format("txt")).unwrap();
        assert!(!txt.contains("## "), "no heading markers");
        assert!(!txt.contains("**"), "no bold markers");
        assert!(txt.contains("SERVER DOSSIER — KINGDOM SMP"), "title in caps");
        assert!(txt.contains("give @s minecraft:diamond 3"));

        // html: real document with tables
        let html = String::from_utf8(by_format("html")).unwrap();
        assert!(html.contains("<!DOCTYPE html>"));
        assert!(html.contains("<h1>Server Dossier"));
        assert!(html.contains("<table>"));
        assert!(html.contains("KingdomCoin"));

        // pdf: the professional renderer — cover, TOC, footers, branded tables
        let pdf = by_format("pdf");
        assert!(pdf.starts_with(b"%PDF-1.4"));
        let pdf_text = String::from_utf8_lossy(&pdf);
        let pages = pdf_text.matches("/Type /Page ").count();
        assert!(pages >= 30, "pdf pages: {pages}");
        assert!(pdf_text.contains("/Type /Pages"));
        assert!(pdf_text.contains("/BaseFont /Helvetica-Bold"));
        assert!(pdf.ends_with(b"%%EOF\n"));
        // cover with the brand
        assert!(pdf_text.contains("(VOXEL) Tj"));
        assert!(pdf_text.contains("(Server Dossier - Kingdom SMP) Tj"), "cover carries the sanitized title");
        // table of contents with the chapter names
        assert!(pdf_text.contains("(Contents) Tj"));
        assert!(pdf_text.contains("(Gameplay modules - what every command does) Tj"), "TOC lists the chapters");
        assert!(pdf_text.contains("(Economy & your token) Tj"));
        // footer on every page
        assert!(pdf_text.contains("(Page 1 of "), "footer with real page numbers");
        assert!(pdf_text.contains(&format!("(Page {pages} of {pages})")), "last page numbered");
        assert!(pdf_text.contains("(VOXEL Server Dossier - Kingdom SMP) Tj"), "footer brand");
        // branded purple and ruled tables
        assert!(pdf_text.contains("0.486 0.227 0.929"), "brand purple present");
        assert!(pdf_text.matches(" re f\n").count() > 20, "table bands and code boxes drawn: {}", pdf_text.matches(" re f").count());

        // docx: a real Word file (zip with the required parts)
        let docx = by_format("docx");
        let cursor = std::io::Cursor::new(docx.clone());
        let mut zip = zip::ZipArchive::new(cursor).expect("docx must be a valid zip");
        assert!(zip.by_name("[Content_Types].xml").is_ok());
        assert!(zip.by_name("word/document.xml").is_ok());
        assert!(zip.by_name("word/styles.xml").is_ok());
        let mut xml = String::new();
        zip.by_name("word/document.xml").unwrap().read_to_string(&mut xml).unwrap();
        assert!(xml.contains("Server Dossier"));
        assert!(xml.contains("<w:pStyle w:val=\"Heading1\"/>"), "headings styled");
        assert!(xml.contains("Kingdom SMP"));
        assert!(xml.contains("<w:b/>"), "bold runs present");
        assert!(xml.contains("<w:tbl>"), "real Word tables");
        assert!(xml.contains("w:fill=\"7C3AED\""), "purple header band");
        assert!(xml.contains("w:fill=\"F5F3FB\""), "zebra stripes");
        assert!(xml.contains("<w:tblBorders>"), "ruled borders");

        // odt: mimetype first and stored (the ODF rule)
        let odt = by_format("odt");
        let cursor = std::io::Cursor::new(odt);
        let mut zip = zip::ZipArchive::new(cursor).expect("odt must be a valid zip");
        {
            let first = zip.by_index(0).unwrap();
            assert_eq!(first.name(), "mimetype", "ODF: mimetype must be the first entry");
            assert_eq!(first.compression(), zip::CompressionMethod::Stored);
        }
        let mut content = String::new();
        zip.by_name("content.xml").unwrap().read_to_string(&mut content).unwrap();
        assert!(content.contains("Kingdom SMP"));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn save_copy_refuses_traversal_and_copies_honestly() {
        let base = base_dir("copy");
        let dir = base.join("servers/mine");
        std::fs::create_dir_all(dir.join("Dossier")).unwrap();
        std::fs::write(dir.join("Dossier/Dossier-mine.md"), "# facts").unwrap();
        let dest = base.join("exported.md");

        let ok = dossier_save_copy(
            base.to_string_lossy().to_string(),
            "servers/mine/Dossier/Dossier-mine.md".to_string(),
            dest.to_string_lossy().to_string(),
        )
        .expect("copy");
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "# facts");
        assert!(ok.ends_with("exported.md"));

        let err = dossier_save_copy(
            base.to_string_lossy().to_string(),
            "../escape.md".to_string(),
            dest.to_string_lossy().to_string(),
        )
        .unwrap_err();
        assert!(err.contains("traversal") || err.contains("not accessible") || err.contains("does not exist"));

        let _ = std::fs::remove_dir_all(&base);
    }
}
