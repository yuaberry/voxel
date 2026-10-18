//! Token Chain ledger — the server's own currency with a REAL hash chain.
//!
//! Every operation (mint / transfer / burn) is appended as a block whose
//! hash covers the previous block's hash: `sha256(index|time|tx|from|to|amount|prev)`.
//! Tampering with any historical block invalidates every block after it —
//! `ledger_verify` replays and re-hashes the whole chain.
//!
//! Storage: `servers/<slug>/ledger.jsonl` (one block per line, append-only).
//! In-game purchases are detected from the server log (`[VoxelCoin] BUY …`)
//! and processed through this ledger by the panel (debit via transfer, item
//! delivered via console).
//!
//! Compliance note: this is an in-game, server-owned virtual currency with
//! no monetary value. Integration with external blockchains/NFT markets is
//! deliberately behind a reserved interface (`ChainProvider`) until the
//! owner completes the Monetization Compliance Checklist (briefing §28).

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::path::Path;


fn ledger_path(base: &Path, slug: &str) -> std::path::PathBuf {
    base.join("servers").join(slug).join("ledger.jsonl")
}

fn offset_path(base: &Path, slug: &str) -> std::path::PathBuf {
    base.join("servers").join(slug).join("ledger.offset")
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub index: u64,
    pub timestamp: String,
    pub tx: String, // mint | transfer | burn
    pub from: String,
    pub to: String,
    pub amount: i64,
    pub prev: String,
    pub hash: String,
}

pub fn compute_hash(
    index: u64,
    timestamp: &str,
    tx: &str,
    from: &str,
    to: &str,
    amount: i64,
    prev: &str,
) -> String {
    let canonical = format!("{index}|{timestamp}|{tx}|{from}|{to}|{amount}|{prev}");
    let digest = Sha256::digest(canonical.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn now_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (y, m, d) = super::git::civil_from_days((secs / 86_400) as i64);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", (secs / 3600) % 24, (secs / 60) % 60, secs % 60)
}

fn read_blocks(path: &Path) -> Result<Vec<Block>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(path).map_err(|e| format!("read ledger: {e}"))?;
    let mut blocks = Vec::new();
    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let block: Block =
            serde_json::from_str(line).map_err(|e| format!("corrupt ledger line: {e}"))?;
        blocks.push(block);
    }
    Ok(blocks)
}

fn append_block(path: &Path, block: &Block) -> Result<(), String> {
    use std::io::Write as _;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("open ledger: {e}"))?;
    let line = serde_json::to_string(block).map_err(|e| format!("{e}"))?;
    writeln!(file, "{line}").map_err(|e| format!("append ledger: {e}"))?;
    Ok(())
}

/// Balances derived by replaying the chain — the chain is the only truth.
pub fn compute_balances(blocks: &[Block]) -> std::collections::HashMap<String, i64> {
    let mut balances = std::collections::HashMap::new();
    for block in blocks {
        match block.tx.as_str() {
            "mint" => {
                *balances.entry(block.to.clone()).or_insert(0) += block.amount;
            }
            "burn" => {
                *balances.entry(block.from.clone()).or_insert(0) -= block.amount;
            }
            "transfer" => {
                *balances.entry(block.from.clone()).or_insert(0) -= block.amount;
                *balances.entry(block.to.clone()).or_insert(0) += block.amount;
            }
            _ => {}
        }
    }
    balances
}

fn validate_tx(blocks: &[Block], tx: &str, from: &str, amount: i64) -> Result<(), String> {
    match tx {
        "mint" => {
            if amount <= 0 {
                return Err("Mint amount must be positive".to_string());
            }
            Ok(())
        }
        "burn" | "transfer" => {
            if amount <= 0 {
                return Err("Amount must be positive".to_string());
            }
            let balances = compute_balances(blocks);
            let balance = balances.get(from).copied().unwrap_or(0);
            if balance < amount {
                return Err(format!(
                    "Insufficient balance: {from} has {balance}, needs {amount}"
                ));
            }
            Ok(())
        }
        other => Err(format!("Unknown transaction type \"{other}\"")),
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ledger_init(base_path: String, slug: String, currency: String) -> Result<Block, String> {
    tauri::async_runtime::spawn_blocking(move || ledger_init_impl(base_path, slug, currency))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

pub fn ledger_init_impl(base_path: String, slug: String, currency: String) -> Result<Block, String> {
    let base = Path::new(&base_path);
    let path = ledger_path(base, &slug);
    if path.exists() {
        return Err("Ledger already initialized for this server".to_string());
    }
    let timestamp = now_iso();
    let genesis = Block {
        index: 0,
        timestamp: timestamp.clone(),
        tx: "genesis".into(),
        from: String::new(),
        to: currency.clone(),
        amount: 0,
        prev: "GENESIS".into(),
        hash: String::new(),
    };
    let hash = compute_hash(0, &timestamp, "genesis", "", &currency, 0, "GENESIS");
    let genesis = Block { hash, ..genesis };
    append_block(&path, &genesis)?;
    Ok(genesis)
}

#[tauri::command]
pub async fn ledger_apply(
    base_path: String,
    slug: String,
    tx: String,
    from: String,
    to: String,
    amount: i64,
) -> Result<Block, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ledger_apply_impl(base_path, slug, tx, from, to, amount)
    })
    .await
    .map_err(|e| format!("worker failed: {e}"))?
}

pub fn ledger_apply_impl(
    base_path: String,
    slug: String,
    tx: String,
    from: String,
    to: String,
    amount: i64,
) -> Result<Block, String> {
    let base = Path::new(&base_path);
    let path = ledger_path(base, &slug);
    let blocks = read_blocks(&path)?;
    if blocks.is_empty() {
        return Err("Ledger not initialized (call ledger_init first)".to_string());
    }

    validate_tx(&blocks, &tx, &from, amount)?;

    let last = blocks.last().expect("non-empty");
    let index = last.index + 1;
    let timestamp = now_iso();
    let hash = compute_hash(index, &timestamp, &tx, &from, &to, amount, &last.hash);
    let block = Block {
        index,
        timestamp,
        tx,
        from,
        to,
        amount,
        prev: last.hash.clone(),
        hash,
    };
    append_block(&path, &block)?;
    Ok(block)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerSnapshot {
    pub blocks: Vec<Block>,
    pub balances: std::collections::HashMap<String, i64>,
    pub length: u64,
}

#[tauri::command]
pub async fn ledger_list(base_path: String, slug: String) -> Result<LedgerSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || ledger_list_impl(base_path, slug))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

pub fn ledger_list_impl(base_path: String, slug: String) -> Result<LedgerSnapshot, String> {
    let blocks = read_blocks(&ledger_path(Path::new(&base_path), &slug))?;
    let length = blocks.len() as u64;
    let balances = compute_balances(&blocks);
    Ok(LedgerSnapshot { blocks, balances, length })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyResult {
    pub valid: bool,
    pub checked: u64,
    pub first_bad_index: Option<u64>,
}

#[tauri::command]
pub async fn ledger_verify(base_path: String, slug: String) -> Result<VerifyResult, String> {
    tauri::async_runtime::spawn_blocking(move || ledger_verify_impl(base_path, slug))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

pub fn ledger_verify_impl(base_path: String, slug: String) -> Result<VerifyResult, String> {
    let blocks = read_blocks(&ledger_path(Path::new(&base_path), &slug))?;
    let mut prev_hash = "GENESIS".to_string();
    for (position, block) in blocks.iter().enumerate() {
        if block.prev != prev_hash {
            return Ok(VerifyResult {
                valid: false,
                checked: position as u64,
                first_bad_index: Some(block.index),
            });
        }
        let expected = compute_hash(
            block.index,
            &block.timestamp,
            &block.tx,
            &block.from,
            &block.to,
            block.amount,
            &block.prev,
        );
        if expected != block.hash {
            return Ok(VerifyResult {
                valid: false,
                checked: position as u64,
                first_bad_index: Some(block.index),
            });
        }
        prev_hash = block.hash.clone();
    }
    Ok(VerifyResult {
        valid: true,
        checked: blocks.len() as u64,
        first_bad_index: None,
    })
}

// ---------------------------------------------------------------------------
// In-game purchase intents — incremental tail of the server log
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseIntent {
    pub player: String,
    pub item_id: u32,
    /// "buy" (classic market) or "convert" (mined coins -> chain tokens,
    /// the /convert flow the owner designed)
    #[serde(default)]
    pub kind: String,
}

/// Returns new purchase intents since the last call (offset persisted next to
/// the ledger). Lines look like:
/// `[19:20:01] [Server thread/INFO]: [VoxelCoin] BUY Alice 3`
#[tauri::command]
pub async fn ledger_tail_intents(
    base_path: String,
    slug: String,
) -> Result<Vec<PurchaseIntent>, String> {
    tauri::async_runtime::spawn_blocking(move || ledger_tail_intents_impl(base_path, slug))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

pub fn ledger_tail_intents_impl(
    base_path: String,
    slug: String,
) -> Result<Vec<PurchaseIntent>, String> {
    let base = Path::new(&base_path);
    let log = base.join("servers").join(&slug).join("logs").join("latest.log");
    if !log.is_file() {
        return Ok(Vec::new()); // server never booted yet
    }
    let raw = std::fs::read_to_string(&log).map_err(|e| format!("read log: {e}"))?;

    let offset = std::fs::read_to_string(offset_path(base, &slug))
        .ok()
        .and_then(|s| s.trim().parse::<usize>().ok())
        .unwrap_or(0);

    // The log rotates per boot: if it shrank, reset the offset
    let bytes = raw.len();
    let start = if offset > bytes { 0 } else { offset };
    let consumed: Vec<&str> = raw[start..].split('\n').collect();

    let mut intents = Vec::new();
    for line in consumed.iter() {
        // The custom-commands /convert flow writes CONVERT intents: mined
        // coins exchanged for chain tokens, processed by the panel.
        if let Some(rest) = line.split_once("[VoxelCoin] CONVERT ") {
            let mut parts = rest.1.split_whitespace();
            if let (Some(player), Some(amount)) = (parts.next(), parts.next()) {
                if let Ok(value) = amount.parse::<u32>() {
                    intents.push(PurchaseIntent {
                        player: player.to_string(),
                        item_id: value,
                        kind: "convert".to_string(),
                    });
                }
            }
        }
        if let Some(rest) = line.split_once("[VoxelCoin] BUY ") {
            let mut parts = rest.1.split_whitespace();
            if let (Some(player), Some(item)) = (parts.next(), parts.next()) {
                if let Ok(item_id) = item.parse::<u32>() {
                    intents.push(PurchaseIntent {
                        player: player.to_string(),
                        item_id,
                        kind: "buy".to_string(),
                    });
                }
            }
        }
    }

    // Persist the new offset (never re-read the same lines)
    std::fs::write(offset_path(base, &slug), format!("{bytes}"))
        .map_err(|e| format!("save offset: {e}"))?;
    Ok(intents)
}

// ---------------------------------------------------------------------------
// Unit tests — the chain is pure logic, fully covered
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Each test gets its own base directory (same pattern as the agent
    /// tool tests in `fs.rs`). Tests run on parallel threads — a shared
    /// base with a trailing `remove_dir_all` deletes another test's
    /// ledger mid-flight and makes the suite flaky.
    fn base_dir(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "nexuscraft-ledger-{}-{label}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn tail_intents_parse_buy_and_convert_with_offset() {
        let base = base_dir("tail");
        let slug = "shop";
        let logs = base.join("servers").join(slug).join("logs");
        std::fs::create_dir_all(&logs).unwrap();
        let log = logs.join("latest.log");
        std::fs::write(
            &log,
            "[19:20:01] [Server thread/INFO]: [VoxelCoin] BUY Alice 3\n[19:20:02] [Server thread/INFO]: [VoxelCoin] CONVERT Bob 250\n",
        )
        .unwrap();

        let first = ledger_tail_intents_impl(base.to_string_lossy().to_string(), slug.to_string()).unwrap();
        assert_eq!(first.len(), 2);
        assert_eq!(first[0].player, "Alice");
        assert_eq!(first[0].item_id, 3);
        assert_eq!(first[0].kind, "buy");
        assert_eq!(first[1].player, "Bob");
        assert_eq!(first[1].item_id, 250, "convert carries the AMOUNT in item_id");
        assert_eq!(first[1].kind, "convert");

        // the offset guarantees nothing is re-read
        let second = ledger_tail_intents_impl(base.to_string_lossy().to_string(), slug.to_string()).unwrap();
        assert!(second.is_empty(), "no duplicates");

        // a rotated (shrunk) log resets honestly
        std::fs::write(&log, "[20:00:00] [Server thread/INFO]: [VoxelCoin] BUY Carol 1\n").unwrap();
        let third = ledger_tail_intents_impl(base.to_string_lossy().to_string(), slug.to_string()).unwrap();
        assert_eq!(third.len(), 1);
        assert_eq!(third[0].player, "Carol");

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn hash_is_deterministic_and_sensitive() {
        let a = compute_hash(1, "T", "mint", "x", "y", 5, "P");
        let b = compute_hash(1, "T", "mint", "x", "y", 5, "P");
        let c = compute_hash(1, "T", "mint", "x", "y", 6, "P");
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a.len(), 64);
    }

    #[test]
    fn chain_mint_transfer_burn_and_verify() {
        let base = base_dir("chain");
        let slug = format!("test-{}", std::process::id());
        std::fs::create_dir_all(base.join("servers").join(&slug)).unwrap();

        ledger_init_impl(base.to_string_lossy().to_string(), slug.clone(), "VoxelCoin".into())
            .unwrap();

        let tx = |tx: &str, from: &str, to: &str, amount: i64| {
            ledger_apply_impl(
                base.to_string_lossy().to_string(),
                slug.clone(),
                tx.to_string(),
                from.to_string(),
                to.to_string(),
                amount,
            )
            .unwrap()
        };

        tx("mint", "bank", "alice", 100);
        tx("transfer", "alice", "bob", 30);
        tx("burn", "bob", "", 5);

        let snapshot =
            ledger_list_impl(base.to_string_lossy().to_string(), slug.clone()).unwrap();
        assert_eq!(snapshot.length, 4); // genesis + 3
        assert_eq!(snapshot.balances.get("alice"), Some(&70));
        assert_eq!(snapshot.balances.get("bob"), Some(&25));

        let verify =
            ledger_verify_impl(base.to_string_lossy().to_string(), slug.clone()).unwrap();
        assert!(verify.valid, "chain must verify");
        assert_eq!(verify.checked, 4);

        // Insufficient funds are refused
        let err = ledger_apply_impl(
            base.to_string_lossy().to_string(),
            slug.clone(),
            "transfer".into(),
            "alice".into(),
            "bob".into(),
            10_000,
        );
        assert!(err.is_err());

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn tampering_is_detected() {
        let base = base_dir("tamper");
        let slug = format!("tamper-{}", std::process::id());
        std::fs::create_dir_all(base.join("servers").join(&slug)).unwrap();
        ledger_init_impl(base.to_string_lossy().to_string(), slug.clone(), "C".into()).unwrap();
        ledger_apply_impl(
            base.to_string_lossy().to_string(),
            slug.clone(),
            "mint".into(),
            "bank".into(),
            "carol".into(),
            50,
        )
        .unwrap();

        // Corrupt the minted amount in place
        let path = ledger_path(&base, &slug);
        let raw = std::fs::read_to_string(&path).unwrap();
        let corrupted = raw.replace("\"amount\":50", "\"amount\":500");
        std::fs::write(&path, corrupted).unwrap();

        let verify = ledger_verify_impl(base.to_string_lossy().to_string(), slug.clone()).unwrap();
        assert!(!verify.valid, "tamper must be detected");
        assert_eq!(verify.first_bad_index, Some(1));

        let _ = std::fs::remove_dir_all(&base);
    }
}
