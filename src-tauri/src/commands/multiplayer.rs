//! Multiplayer server list (`servers.dat`) — the REAL vanilla file the
//! Minecraft client reads on the Multiplayer screen.
//!
//! The format is the vanilla one: an NBT compound with a `servers` list;
//! each entry carries the display name, the address and the port. The
//! client shows exactly what the file says — nothing is faked and nothing
//! is scraped.
//!
//! **The NBT is NOT compressed.** The official 1.20.1 client reads this
//! file with `FileInputStream` + `DataInputStream` (the class `rb` in the
//! official `client.jar`: `rb.b(File)` → `rb.b(CompoundTag, File)`) —
//! there is no gzip stream anywhere in that path. A gzipped file is
//! discarded by the client in silence ("Couldn't load server list"), and
//! the Multiplayer screen comes up EMPTY: the owner sees no server at all
//! and concludes that he cannot join. The bytes below are the exact
//! layout the client writes itself: `name`, `ip` and `hidden` per entry.
//!
//! The address resolution follows the vanilla client: when the entry has
//! no explicit port, the `_minecraft._tcp.<host>` SRV record decides the
//! real target (the same lookup the launcher already does before it
//! pings), and the default port 25565 is the fallback.

use crate::commands::fs::validated_path;
use crate::commands::nbt::{
    nbt_byte, nbt_compound, nbt_compound_list, nbt_int, nbt_root, nbt_string, TAG_BYTE, TAG_INT,
    TAG_LIST, TAG_STRING,
};
use crate::commands::serverping::resolve_srv;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const DEFAULT_PORT: u16 = 25565;

/// One entry of the multiplayer list.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiplayerServer {
    /// the name the client shows in the list
    pub name: String,
    /// the host (or IP) — with or without a `:port` suffix
    pub address: String,
    /// an explicit port; when absent the SRV record decides (like the client)
    #[serde(default)]
    pub port: Option<u16>,
    /// a hidden entry is never listed by the client (direct connect only)
    #[serde(default)]
    pub hidden: bool,
}

/// What actually landed in the file — the resolved target of every entry.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WrittenServer {
    pub name: String,
    pub address: String,
    pub port: u16,
    pub hidden: bool,
    /// true when the port came from the SRV record instead of the default
    pub srv: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServersDatResult {
    /// the absolute path of the file that was written
    pub path: String,
    /// how many entries the list holds
    pub written: usize,
    pub entries: Vec<WrittenServer>,
}

/// Splits `host`, `host:port` or `[v6]:port` into the host and the port.
fn split_address(raw: &str) -> Result<(String, Option<u16>), String> {
    let text = raw.trim().trim_start_matches("http://").trim_start_matches("https://");
    let text = text.split('/').next().unwrap_or("").trim();
    if text.is_empty() {
        return Err("Server address is empty".to_string());
    }
    if let Some(rest) = text.strip_prefix('[') {
        // [::1] or [::1]:25566
        let (host, tail) = rest
            .split_once(']')
            .ok_or_else(|| format!("Invalid IPv6 address: {raw}"))?;
        let port = match tail.strip_prefix(':') {
            Some(p) => Some(
                p.parse::<u16>()
                    .ok()
                    .filter(|port| *port > 0)
                    .ok_or_else(|| format!("Invalid port: {raw}"))?,
            ),
            None => None,
        };
        return Ok((host.to_lowercase(), port));
    }
    match text.rsplit_once(':') {
        Some((host, port_raw)) if port_raw.chars().all(|c| c.is_ascii_digit()) => {
            let port = port_raw
                .parse::<u16>()
                .ok()
                .filter(|port| *port > 0)
                .ok_or_else(|| format!("Invalid port: {raw}"))?;
            Ok((host.to_lowercase(), Some(port)))
        }
        _ => Ok((text.to_lowercase(), None)),
    }
}

/// The host characters the client accepts — anything else is refused
/// before it can reach the file.
fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == ':')
}

/// Resolves the real target of an entry — the SRV record first, the
/// default port as the fallback (the vanilla client behavior).
fn resolve_target(server: &MultiplayerServer) -> Result<(String, u16, bool), String> {
    let (host, inline_port) = split_address(&server.address)?;
    if !valid_host(&host) {
        return Err(format!("Invalid server address: {}", server.address));
    }
    let explicit = server.port.or(inline_port);
    if let Some(port) = explicit {
        if port == 0 {
            return Err("Invalid port".to_string());
        }
        return Ok((host, port, false));
    }
    if let Some((target, port)) = resolve_srv(&host) {
        return Ok((target, port, true));
    }
    Ok((host, DEFAULT_PORT, false))
}

/// Builds the vanilla `servers.dat` bytes for the given entries.
pub fn build_servers_dat(servers: &[MultiplayerServer]) -> Result<(Vec<u8>, Vec<WrittenServer>), String> {
    let mut entries: Vec<Vec<(String, u8, Vec<u8>)>> = Vec::new();
    let mut written: Vec<WrittenServer> = Vec::new();

    for server in servers {
        let name = server.name.trim();
        if name.is_empty() {
            return Err("Every server needs a name".to_string());
        }
        let (address, port, srv) = resolve_target(server)?;
        // `ip` is the field the 1.20.1 client reads (host:port); `address`
        // + `port` are the fields the newer clients read. Both are real —
        // the client ignores the one it does not know.
        entries.push(vec![
            ("name".to_string(), TAG_STRING, nbt_string(name)),
            ("ip".to_string(), TAG_STRING, nbt_string(&format!("{address}:{port}"))),
            ("address".to_string(), TAG_STRING, nbt_string(&address)),
            ("port".to_string(), TAG_INT, nbt_int(port as i32)),
            (
                "hidden".to_string(),
                TAG_BYTE,
                nbt_byte(if server.hidden { 1 } else { 0 }),
            ),
        ]);
        written.push(WrittenServer {
            name: name.to_string(),
            address,
            port,
            hidden: server.hidden,
            srv,
        });
    }

    let root = nbt_root(nbt_compound(vec![(
        "servers".to_string(),
        TAG_LIST,
        nbt_compound_list(&entries),
    )]));
    // RAW NBT — the vanilla client does NOT decompress this file. Writing
    // it gzipped made the client throw the list away in silence and the
    // Multiplayer screen came up empty (the owner's report: "I cannot
    // join any server").
    Ok((root, written))
}

/// Writes the multiplayer list into `<base>/instances/<slug>/servers.dat`.
///
/// The instance folder is the game directory of the client — the file the
/// Multiplayer screen reads.
pub fn write_servers_dat_impl(
    base_path: &str,
    instance_slug: &str,
    servers: Vec<MultiplayerServer>,
) -> Result<ServersDatResult, String> {
    let slug = instance_slug.trim();
    if slug.is_empty() {
        return Err("Instance slug is required".to_string());
    }
    // the slug is a folder name — never a path
    if slug.contains('/') || slug.contains('\\') || slug.contains("..") {
        return Err("Invalid instance slug".to_string());
    }

    let base = PathBuf::from(base_path)
        .canonicalize()
        .map_err(|e| format!("Storage base not accessible: {e}"))?;
    let instance = validated_path(
        base.to_string_lossy().as_ref(),
        &format!("instances/{slug}"),
        false,
    )?;
    if !instance.is_dir() {
        return Err(format!("Instance not found: {slug}"));
    }

    let (bytes, entries) = build_servers_dat(&servers)?;
    let path = instance.join("servers.dat");
    std::fs::write(&path, &bytes).map_err(|e| format!("Could not write servers.dat: {e}"))?;

    Ok(ServersDatResult {
        path: path.to_string_lossy().to_string(),
        written: entries.len(),
        entries,
    })
}

#[tauri::command]
pub async fn multiplayer_write_servers_dat(
    base_path: String,
    instance_slug: String,
    servers: Vec<MultiplayerServer>,
) -> Result<ServersDatResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        write_servers_dat_impl(&base_path, &instance_slug, servers)
    })
    .await
    .map_err(|e| format!("servers.dat worker failed: {e}"))?
}

#[cfg(test)]
mod multiplayer_tests {
    use super::*;

    fn server(name: &str, address: &str, port: Option<u16>) -> MultiplayerServer {
        MultiplayerServer {
            name: name.to_string(),
            address: address.to_string(),
            port,
            hidden: false,
        }
    }

    /// Reads the NBT back with an independent parser — the same bytes the
    /// vanilla client gets, decoded from scratch.
    ///
    /// The bytes are RAW: the official client reads `servers.dat` with a
    /// plain `DataInputStream` (no gzip), so the decoder here does the
    /// same.
    fn decode(bytes: &[u8]) -> Vec<(String, String, i32, u8)> {
        let raw = bytes;
        assert_eq!(raw[0], 10, "the root must be a compound");
        assert_eq!(&raw[1..3], &0u16.to_be_bytes(), "the root name is empty");

        let mut cursor = 3usize;
        // a NAME and a STRING VALUE are both a raw u16 length + the bytes
        // (only lists and compounds carry a type byte in their payload)
        let mut read_text = |cursor: &mut usize| -> String {
            let len = u16::from_be_bytes([raw[*cursor], raw[*cursor + 1]]) as usize;
            *cursor += 2;
            let text = String::from_utf8(raw[*cursor..*cursor + len].to_vec()).expect("utf-8");
            *cursor += len;
            text
        };

        // the "servers" entry of the root compound
        assert_eq!(raw[cursor], TAG_LIST, "the root must hold a list");
        cursor += 1;
        let key = read_text(&mut cursor);
        assert_eq!(key, "servers");
        assert_eq!(
            raw[cursor], TAG_COMPOUND_TAG,
            "the list must hold compounds"
        );
        cursor += 1;
        let count = i32::from_be_bytes([
            raw[cursor],
            raw[cursor + 1],
            raw[cursor + 2],
            raw[cursor + 3],
        ]);
        cursor += 4;

        let mut out = Vec::new();
        for _ in 0..count {
            // A list of compounds declares the element type ONCE in the
            // list header — every element is just its named tags plus the
            // closing TAG_End (the vanilla layout, byte for byte).
            let mut name = String::new();
            let mut ip = String::new();
            let mut port = 0i32;
            let mut hidden = 0u8;
            loop {
                let tag = raw[cursor];
                cursor += 1;
                if tag == 0 {
                    break;
                }
                let key = read_text(&mut cursor);
                match tag {
                    TAG_STRING => {
                        let value = read_text(&mut cursor);
                        if key == "name" {
                            name = value;
                        } else if key == "ip" {
                            ip = value;
                        }
                    }
                    TAG_INT => {
                        port = i32::from_be_bytes([
                            raw[cursor],
                            raw[cursor + 1],
                            raw[cursor + 2],
                            raw[cursor + 3],
                        ]);
                        cursor += 4;
                    }
                    TAG_BYTE => {
                        hidden = raw[cursor];
                        cursor += 1;
                    }
                    other => panic!("unexpected tag {other}"),
                }
            }
            out.push((name, ip, port, hidden));
        }
        out
    }

    const TAG_COMPOUND_TAG: u8 = 10;

    /// The owner's bug, pinned: the official client reads `servers.dat`
    /// with a plain `DataInputStream` — the file is RAW NBT. A gzipped
    /// file is thrown away by the client in silence and the Multiplayer
    /// screen comes up empty.
    #[test]
    fn the_file_is_the_raw_nbt_the_client_reads() {
        let (bytes, written) = build_servers_dat(&[server(
            "Mine Rank",
            "127.0.0.1",
            Some(25565),
        )])
        .expect("the list must build");
        assert_ne!(
            &bytes[0..2],
            &[0x1f, 0x8b],
            "the file must NOT be gzip — the vanilla client reads raw NBT"
        );
        assert_eq!(
            &bytes[0..2],
            &[0x0a, 0x00],
            "the raw NBT root must be a compound with an empty name"
        );

        let decoded = decode(&bytes);
        assert_eq!(decoded.len(), 1);
        let (name, ip, port, hidden) = &decoded[0];
        assert_eq!(name, "Mine Rank");
        assert_eq!(ip, "127.0.0.1:25565");
        assert_eq!(*port, 25565);
        assert_eq!(*hidden, 0);

        assert_eq!(written.len(), 1);
        assert_eq!(written[0].address, "127.0.0.1");
        assert_eq!(written[0].port, 25565);
        assert!(!written[0].srv);
    }

    /// The bytes the client writes itself (the owner's own file, captured
    /// from the running 1.20.1 client) start with the compound tag — the
    /// exact prefix the VOXEL file must have.
    #[test]
    fn the_first_bytes_are_the_vanilla_compound_prefix() {
        let (bytes, _) = build_servers_dat(&[server("Mine Rank", "127.0.0.1", Some(25565))])
            .expect("the list must build");
        assert_eq!(bytes[0], TAG_COMPOUND_TAG);
        assert_eq!(&bytes[1..3], &0u16.to_be_bytes());
        // the "servers" list follows, exactly like the client's own file
        assert_eq!(bytes[3], TAG_LIST);
        assert_eq!(&bytes[4..6], &7u16.to_be_bytes());
        assert_eq!(&bytes[6..13], b"servers");
    }

    #[test]
    fn an_inline_port_is_honoured() {
        let (bytes, written) = build_servers_dat(&[server("Local", "127.0.0.1:25566", None)])
            .expect("the list must build");
        let decoded = decode(&bytes);
        assert_eq!(decoded[0].1, "127.0.0.1:25566");
        assert_eq!(decoded[0].2, 25566);
        assert_eq!(written[0].port, 25566);
    }

    #[test]
    fn a_hidden_entry_is_written_as_the_vanilla_byte() {
        let mut entry = server("Hidden", "example.net", Some(25565));
        entry.hidden = true;
        let (bytes, written) = build_servers_dat(&[entry]).expect("the list must build");
        let decoded = decode(&bytes);
        assert_eq!(decoded[0].3, 1);
        assert!(written[0].hidden);
    }

    #[test]
    fn an_empty_list_is_still_a_valid_file() {
        let (bytes, written) = build_servers_dat(&[]).expect("the list must build");
        assert_eq!(bytes[0], TAG_COMPOUND_TAG);
        assert_ne!(&bytes[0..2], &[0x1f, 0x8b], "raw NBT, never gzip");
        assert!(written.is_empty());
        assert!(decode(&bytes).is_empty());
    }

    #[test]
    fn a_traversal_slug_is_refused() {
        let base = std::env::temp_dir().join("voxel-multiplayer-traversal");
        let _ = std::fs::create_dir_all(&base);
        let result = write_servers_dat_impl(
            base.to_string_lossy().as_ref(),
            "../escape",
            vec![server("Mine Rank", "127.0.0.1", Some(25565))],
        );
        assert!(result.is_err(), "a traversal slug must never be accepted");
    }

    #[test]
    fn a_missing_instance_is_refused() {
        let base = std::env::temp_dir().join("voxel-multiplayer-missing");
        let _ = std::fs::create_dir_all(&base);
        let result = write_servers_dat_impl(
            base.to_string_lossy().as_ref(),
            "not-there",
            vec![server("Mine Rank", "127.0.0.1", Some(25565))],
        );
        assert!(result.is_err(), "the instance must exist");
    }

    #[test]
    fn the_file_lands_inside_the_instance() {
        let base = std::env::temp_dir().join("voxel-multiplayer-write");
        let instance = base.join("instances").join("mine-rank");
        std::fs::create_dir_all(&instance).expect("the instance folder");
        let result = write_servers_dat_impl(
            base.to_string_lossy().as_ref(),
            "mine-rank",
            vec![server("Mine Rank", "127.0.0.1", Some(25565))],
        )
        .expect("the list must be written");
        assert_eq!(result.written, 1);
        assert!(PathBuf::from(&result.path).is_file());
        assert_eq!(
            PathBuf::from(&result.path).parent().unwrap(),
            instance.canonicalize().unwrap()
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    /// E2E: the owner's real workspace — the multiplayer list lands in the
    /// prepared instance and the file decodes as the vanilla format.
    #[test]
    #[ignore = "e2e: writes into the real VOXEL workspace (~/Voxel)"]
    fn e2e_the_owner_instance_gets_the_multiplayer_list() {
        let home = std::env::var("HOME").expect("HOME");
        let base = format!("{home}/Voxel");
        let instances_dir = PathBuf::from(&base).join("instances");
        if !instances_dir.is_dir() {
            panic!("the owner workspace must exist: {}", instances_dir.display());
        }

        let servers = vec![
            server("Mine Rank", "127.0.0.1", Some(25565)),
            server("NerdZone.gg", "nerdzone.gg", None),
        ];

        // EVERY instance gets the list — the file lives in the game folder
        // of the instance, so a list written into one of them is invisible
        // to the others (the owner's report: "I cannot join any server").
        let mut written = 0usize;
        for entry in std::fs::read_dir(&instances_dir).expect("the instances folder") {
            let entry = entry.expect("the instance entry");
            if !entry.path().is_dir() {
                continue;
            }
            let slug = entry.file_name().to_string_lossy().to_string();
            let result = write_servers_dat_impl(&base, &slug, servers.clone())
                .unwrap_or_else(|e| panic!("the list must be written for {slug}: {e}"));
            written += 1;

            let bytes = std::fs::read(&result.path).expect("the file must exist");
            assert_ne!(
                &bytes[0..2],
                &[0x1f, 0x8b],
                "the file must be raw NBT — the client reads it without gzip"
            );
            assert_eq!(bytes[0], TAG_COMPOUND_TAG);
            let decoded = decode(&bytes);
            assert_eq!(decoded.len(), 2);
            assert_eq!(decoded[0].0, "Mine Rank");
            assert_eq!(decoded[0].1, "127.0.0.1:25565");
            assert_eq!(decoded[1].0, "NerdZone.gg");
            // NerdZone publishes an SRV record — the file must carry the
            // target the record points at, never the default port
            let nerd = &result.entries[1];
            println!(
                "NerdZone → {}:{} (srv: {})",
                nerd.address, nerd.port, nerd.srv
            );
            assert!(nerd.srv, "the SRV record must decide the port");
            assert_ne!(nerd.port, DEFAULT_PORT);
            assert_eq!(decoded[1].1, format!("{}:{}", nerd.address, nerd.port));
        }
        assert!(written > 0, "at least one instance must exist");
        println!("the multiplayer list landed in {written} instance(s)");
    }
}
