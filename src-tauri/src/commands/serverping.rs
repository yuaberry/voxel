//! Minecraft Server List Ping (SLP) — real protocol, no scraping.
//!
//! The same handshake every launcher performs: TCP to the server,
//! handshake packet (next state = status), status request, and the
//! server answers with version, players, MOTD and favicon. Works with
//! any public Java server (query is not required). Used by Server
//! Studio's "import from server" flow — the data is live, never faked.

use serde::Serialize;
use serde_json::Value;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
const IO_TIMEOUT: Duration = Duration::from_secs(10);

/// Minecraft clients resolve `_minecraft._tcp.<host>` SRV records before
/// falling back to `<host>:25565`. DDoS shields/proxies often only accept
/// connections on the SRV target — without this, importing such servers
/// pings a black hole (verified live: minemen.club).
fn resolve_srv(host: &str) -> Option<(String, u16)> {
    if host.parse::<std::net::IpAddr>().is_ok() {
        return None; // raw IP — nothing to resolve
    }
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .ok()?;
    runtime.block_on(async {
        let (config, _opts) = hickory_resolver::system_conf::read_system_conf().ok()?;
        let resolver = hickory_resolver::TokioResolver::builder_with_config(
            config,
            hickory_resolver::name_server::TokioConnectionProvider::default(),
        )
        .build();
        let name = hickory_resolver::Name::from_utf8(format!("_minecraft._tcp.{host}")).ok()?;
        let response = resolver
            .lookup(name, hickory_resolver::proto::rr::RecordType::SRV)
            .await
            .ok()?;
        for record in response.records() {
            if let Some(srv) = record.data().as_srv() {
                let target = srv.target().to_string();
                let target = target.trim_end_matches('.').to_string();
                if !target.is_empty() {
                    return Some((target, srv.port()));
                }
            }
        }
        None
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ServerPing {
    pub host: String,
    pub port: u16,
    pub latency_ms: u128,
    pub version: String,
    pub protocol: i64,
    pub players_online: i64,
    pub players_max: i64,
    /// Plain text of the MOTD (chat components flattened)
    pub motd: String,
    /// The raw description field (legacy string or chat component JSON)
    pub motd_raw: String,
    /// data:image/png;base64,... exactly as the server sent it
    pub favicon: Option<String>,
    /// Mod list JSON (Forge/Fabric servers), when present
    pub mods_json: Option<String>,
}

// ---------------------------------------------------------------------------
// VarInt (Minecraft's little variable-length int)
// ---------------------------------------------------------------------------

fn write_varint(buf: &mut Vec<u8>, mut value: u32) {
    loop {
        let mut byte = (value & 0x7F) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        buf.push(byte);
        if value == 0 {
            break;
        }
    }
}

fn read_varint(reader: &mut impl Read) -> Result<u32, String> {
    let mut value: u32 = 0;
    let mut shift = 0;
    loop {
        let mut byte = [0u8; 1];
        reader.read_exact(&mut byte).map_err(|e| format!("read varint: {e}"))?;
        value |= ((byte[0] & 0x7F) as u32) << shift;
        if byte[0] & 0x80 == 0 {
            return Ok(value);
        }
        shift += 7;
        if shift > 35 {
            return Err("varint too long".to_string());
        }
    }
}

// ---------------------------------------------------------------------------
// Packet assembly / parsing (pure — unit tested)
// ---------------------------------------------------------------------------

/// Builds the handshake packet (protocol -1 = unspecified, status state).
fn build_handshake(host: &str, port: u16) -> Vec<u8> {
    let mut inner = Vec::new();
    write_varint(&mut inner, 0x00); // packet id: handshake
    write_varint(&mut inner, 0xFF_FF_FF_FF); // protocol version: -1 (unspecified)
    let host_bytes = host.as_bytes();
    write_varint(&mut inner, host_bytes.len() as u32);
    inner.extend_from_slice(host_bytes);
    inner.extend_from_slice(&port.to_be_bytes());
    write_varint(&mut inner, 1); // next state: status

    let mut packet = Vec::new();
    write_varint(&mut packet, inner.len() as u32);
    packet.extend_from_slice(&inner);
    packet
}

/// Builds the status request packet (id 0x00, no payload).
fn build_status_request() -> Vec<u8> {
    let mut packet = Vec::new();
    write_varint(&mut packet, 1);
    packet.push(0x00);
    packet
}

/// Parses a status payload (JSON bytes) into the ping summary.
fn parse_status(host: &str, port: u16, latency_ms: u128, raw: &[u8]) -> Result<ServerPing, String> {
    let value: Value =
        serde_json::from_slice(raw).map_err(|e| format!("status is not valid JSON: {e}"))?;

    let version = value
        .get("version")
        .and_then(|v| v.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let protocol = value
        .get("version")
        .and_then(|v| v.get("protocol"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let players_online = value
        .get("players")
        .and_then(|p| p.get("online"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let players_max = value
        .get("players")
        .and_then(|p| p.get("max"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let favicon = value
        .get("favicon")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let mods_json = value.get("modinfo").map(|m| m.to_string());

    let description = value.get("description").cloned().unwrap_or(Value::Null);
    let motd = flatten_chat(&description);
    let motd_raw = match &description {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };

    Ok(ServerPing {
        host: host.to_string(),
        port,
        latency_ms,
        version,
        protocol,
        players_online,
        players_max,
        motd,
        motd_raw,
        favicon,
        mods_json,
    })
}

/// ASYNC command: sync commands run on the MAIN THREAD in Tauri 2, and an
/// 8-10s network ping froze the whole app (the owner's report). The impl is
/// moved to the blocking pool — the UI stays responsive while pings run.
#[tauri::command]
pub async fn server_ping(host: String, port: Option<u16>) -> Result<ServerPing, String> {
    tauri::async_runtime::spawn_blocking(move || server_ping_impl(host, port))
        .await
        .map_err(|e| format!("ping worker failed: {e}"))?
}

/// Flattens a legacy string or a chat component tree into plain text.
fn flatten_chat(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Object(map) => {
            let mut out = String::new();
            if let Some(text) = map.get("text").and_then(|t| t.as_str()) {
                out.push_str(text);
            }
            if let Some(extra) = map.get("extra").and_then(|e| e.as_array()) {
                for part in extra {
                    out.push_str(&flatten_chat(part));
                }
            }
            out
        }
        _ => String::new(),
    }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

/// Sync impl (network: DNS + SRV + TCP with up-to-10s timeouts) — called by
/// tests directly; the COMMAND below wraps it off the main thread.
fn server_ping_impl(host: String, port: Option<u16>) -> Result<ServerPing, String> {
    let host = host.trim().trim_start_matches("http://").trim_start_matches("https://");
    let host = host.split('/').next().unwrap_or("").trim();
    if host.is_empty() {
        return Err("Server address is empty".to_string());
    }
    let port = port.unwrap_or(25565);
    if port == 0 {
        return Err("Invalid port".to_string());
    }
    // Vanilla client behavior: SRV lookup before the default-port fallback.
    // The display host stays as the user typed it; the connection goes to
    // the SRV target when one exists.
    let mut connect_host = host.to_string();
    let mut port = port;
    if port == 25565 {
        if let Some((target, srv_port)) = resolve_srv(host) {
            connect_host = target;
            port = srv_port;
        }
    }

    let started = Instant::now();
    // Resolve first (accepts hostnames and IPs), then connect with a hard
    // timeout so dead addresses fail in seconds instead of hanging.
    let addrs = (connect_host.as_str(), port)
        .to_socket_addrs()
        .map_err(|e| format!("Could not resolve {connect_host}:{port}: {e}"))?;
    let mut last_err: Option<std::io::Error> = None;
    let mut stream: Option<TcpStream> = None;
    for addr in addrs {
        match TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT) {
            Ok(s) => {
                stream = Some(s);
                break;
            }
            Err(e) => last_err = Some(e),
        }
    }
    let mut stream = stream.ok_or_else(|| {
        format!(
            "Could not reach {connect_host}:{port} — {} (is the address right and the server online?)",
            last_err.map(|e| e.to_string()).unwrap_or_default()
        )
    })?;
    stream.set_read_timeout(Some(IO_TIMEOUT)).ok();
    stream.set_write_timeout(Some(IO_TIMEOUT)).ok();

    stream
        .write_all(&build_handshake(&connect_host, port))
        .map_err(|e| format!("send handshake: {e}"))?;
    stream.write_all(&build_status_request()).map_err(|e| format!("send status request: {e}"))?;
    stream.flush().map_err(|e| format!("flush: {e}"))?;

    let payload = read_status_payload(&mut stream)?;
    let latency = started.elapsed().as_millis();
    parse_status(host, port, latency, &payload)
}

/// Reads `length + packet id + string length + string` status response.
fn read_status_payload(stream: &mut TcpStream) -> Result<Vec<u8>, String> {
    let total = read_varint(stream)?;
    if total == 0 || total > 4 * 1024 * 1024 {
        return Err(format!("implausible status length: {total}"));
    }
    let packet_id = read_varint(stream)?;
    if packet_id != 0x00 {
        return Err(format!("unexpected packet id: {packet_id}"));
    }
    let json_len = read_varint(stream)? as usize;
    if json_len == 0 || json_len > 4 * 1024 * 1024 {
        return Err(format!("implausible JSON length: {json_len}"));
    }
    let mut payload = vec![0u8; json_len];
    stream.read_exact(&mut payload).map_err(|e| format!("read status: {e}"))?;
    Ok(payload)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip_varint(value: u32) {
        let mut buf = Vec::new();
        write_varint(&mut buf, value);
        let mut cursor = std::io::Cursor::new(buf);
        assert_eq!(read_varint(&mut cursor).unwrap(), value);
    }

    #[test]
    fn varint_roundtrips() {
        for v in [0, 1, 127, 128, 255, 25565, 0xFF_FF_FF, u32::MAX] {
            roundtrip_varint(v);
        }
    }

    #[test]
    fn handshake_wire_format_is_stable() {
        let packet = build_handshake("mc.hypixel.net", 25565);
        // length prefix covers everything after it (id+version+host+port+state)
        let mut cursor = std::io::Cursor::new(packet.clone());
        let len = read_varint(&mut cursor).unwrap() as usize;
        assert_eq!(packet.len() - cursor.position() as usize, len);
        // -1 (unspecified protocol) encodes as the classic 0xFF×4 + 0x0F
        assert!(packet.windows(5).any(|w| w == [0xFF, 0xFF, 0xFF, 0xFF, 0x0F]));
        // port 25565 big-endian (0x63DD) appears in the packet
        assert!(packet.windows(2).any(|w| w == [0x63, 0xDD]));
        // hostname bytes are carried verbatim
        assert!(packet.windows(14).any(|w| w == b"mc.hypixel.net".windows(14).next().unwrap()));
    }

    #[test]
    fn parses_full_status_payload() {
        let json = br#"{
            "version": {"name": "Paper 1.20.1", "protocol": 763},
            "players": {"max": 100, "online": 42},
            "description": {"text": "A ", "extra": [{"text": "SkyBlock", "color": "aqua"}]},
            "favicon": "data:image/png;base64,AAAA"
        }"#;
        let ping = parse_status("play.example.net", 25565, 31, json).unwrap();
        assert_eq!(ping.version, "Paper 1.20.1");
        assert_eq!(ping.protocol, 763);
        assert_eq!(ping.players_online, 42);
        assert_eq!(ping.players_max, 100);
        assert_eq!(ping.motd, "A SkyBlock");
        assert_eq!(ping.favicon.as_deref(), Some("data:image/png;base64,AAAA"));
    }

    #[test]
    fn parses_legacy_string_motd() {
        let json = r#"{
            "version": {"name": "Vanilla", "protocol": 763},
            "players": {"max": 20, "online": 3},
            "description": "§bAqua §lBold§r server"
        }"#;
        let ping = parse_status("example.net", 25565, 12, json.as_bytes()).unwrap();
        assert_eq!(ping.motd, "§bAqua §lBold§r server");
        assert_eq!(ping.motd_raw, "§bAqua §lBold§r server");
        assert!(ping.favicon.is_none());
    }

    #[test]
    fn rejects_garbage_json() {
        assert!(parse_status("x", 1, 5, b"not json").is_err());
    }

    #[ignore = "e2e: pings real public servers (network)"]
    #[test]
    fn e2e_ping_public_server() {
        // nerdzone.gg: the owner's reference for the prison/chain style —
        // offline results are honest per-host (liveness is the assertion)
        for host in ["mc.hypixel.net", "play.cubecraft.net", "minemen.club", "nerdzone.gg"] {
            let ping = server_ping_impl(host.into(), None)
                .unwrap_or_else(|e| panic!("{host} failed: {e}"));
            println!(
                "{} → {} players v{} [{}]",
                host, ping.players_online, ping.version, ping.motd
            );
            // Some proxies (BungeeCord) report max=0 while online is live —
            // capacity is best-effort, liveness is the real assertion.
            assert!(
                !ping.version.is_empty() || ping.players_online > 0,
                "{host} must answer with version or players"
            );
        }
    }
}
