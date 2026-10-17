//! Real self-diagnostics — the owner's "nothing works" report deserves a way
//! to SEE what is broken on their machine, from inside the app. Every check
//! here executes for real and returns an actionable verdict. No fake data:
//! a check that didn't run says so.
//!
//! The checks: storage writable, Mojang reachable (server jars, launcher),
//! PaperMC reachable (paper jars), Modrinth reachable (modpack catalog),
//! Java usable (server + game runtime), plus the SQLite probe the frontend
//! runs itself (the database belongs to the JS layer).

use serde::Serialize;
use std::path::Path;
use std::time::Duration;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticCheck {
    pub id: String,
    pub title: String,
    pub ok: bool,
    /// What the check found, in one line — phrased for action when failing.
    pub detail: String,
    /// What to DO about it when it fails (empty when ok).
    pub fix: String,
}

fn check_network(id: &str, title: &str, url: &str) -> DiagnosticCheck {
    // Dedicated short-timeout client: a diagnosis must answer in seconds,
    // not inherit the 5-minute download budget.
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(12))
        .build();
    let fix = format!(
        "VOXEL needs this site to download official files. Check your internet, firewall, antivirus or VPN — if this stays red, ask your network (or provider) to allow it."
    );
    match client {
        Ok(client) => match client.get(url).send() {
            Ok(response) => {
                let status = response.status().as_u16();
                if (200..300).contains(&status) {
                    DiagnosticCheck {
                        id: id.into(),
                        title: title.into(),
                        ok: true,
                        detail: format!("reachable (HTTP {status})"),
                        fix: String::new(),
                    }
                } else {
                    DiagnosticCheck {
                        id: id.into(),
                        title: title.into(),
                        ok: false,
                        detail: format!("answered HTTP {status}"),
                        fix,
                    }
                }
            }
            Err(e) => DiagnosticCheck {
                id: id.into(),
                title: title.into(),
                ok: false,
                detail: if e.is_timeout() {
                    "timed out after 12s".to_string()
                } else if e.is_connect() {
                    "could not connect".to_string()
                } else {
                    format!("{e}")
                },
                fix,
            },
        },
        Err(e) => DiagnosticCheck {
            id: id.into(),
            title: title.into(),
            ok: false,
            detail: format!("client build failed: {e}"),
            fix: fix.clone(),
        },
    }
}

fn check_storage(base: &Path) -> DiagnosticCheck {
    let probe = base.join(".voxel-diagnostic-probe");
    let payload = format!("voxel diagnostic {}", std::process::id());
    let fix = "Your storage location must be a folder VOXEL can write to. Settings → Storage → pick a folder you own (like your home directory) and try again.".into();
    match std::fs::create_dir_all(base) {
        Ok(()) => {}
        Err(e) => {
            return DiagnosticCheck {
                id: "storage".into(),
                title: "Storage folder".into(),
                ok: false,
                detail: format!("cannot create it: {e}"),
                fix,
            }
        }
    }
    match std::fs::write(&probe, &payload)
        .and_then(|_| std::fs::read_to_string(&probe))
        .and_then(|readback| {
            if readback == payload {
                std::fs::remove_file(&probe)
            } else {
                Err(std::io::Error::other("readback mismatch"))
            }
        }) {
        Ok(()) => DiagnosticCheck {
            id: "storage".into(),
            title: "Storage folder".into(),
            ok: true,
            detail: format!("read/write verified at {}", base.display()),
            fix: String::new(),
        },
        Err(e) => DiagnosticCheck {
            id: "storage".into(),
            title: "Storage folder".into(),
            ok: false,
            detail: format!("write probe failed: {e}"),
            fix,
        },
    }
}

fn check_java() -> DiagnosticCheck {
    let fix = "Servers and the game need Java. Install Java 21+ (e.g. from adoptium.net) or set a custom path in Settings → Java.".into();
    match std::process::Command::new("java").arg("-version").output() {
        Ok(output) => {
            let text = String::from_utf8_lossy(&output.stderr);
            let first = text.lines().next().unwrap_or("").to_string();
            if output.status.success() {
                DiagnosticCheck {
                    id: "java".into(),
                    title: "Java runtime".into(),
                    ok: true,
                    detail: first,
                    fix: String::new(),
                }
            } else {
                DiagnosticCheck {
                    id: "java".into(),
                    title: "Java runtime".into(),
                    ok: false,
                    detail: if first.is_empty() { "java -version failed".to_string() } else { first },
                    fix,
                }
            }
        }
        Err(e) => DiagnosticCheck {
            id: "java".into(),
            title: "Java runtime".into(),
            ok: false,
            detail: format!("java not found on PATH: {e}"),
            fix,
        },
    }
}

#[tauri::command]
pub async fn diagnostics_run(base_path: String) -> Result<Vec<DiagnosticCheck>, String> {
    // Real work (network probes, disk probes, a java spawn) — off the main
    // thread like every command that touches the outside world.
    tauri::async_runtime::spawn_blocking(move || {
        let base = Path::new(&base_path).to_path_buf();
        let mut checks = vec![check_storage(&base), check_java()];
        checks.extend(vec![
            check_network(
                "mojang",
                "Mojang servers (jars & launcher)",
                "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
            ),
            check_network(
                "papermc",
                "PaperMC (paper server jars)",
                "https://fill.papermc.io/v3/projects/paper",
            ),
            check_network(
                "modrinth",
                "Modrinth (modpack catalog)",
                "https://api.modrinth.com/v2/project/fabric-api",
            ),
        ]);
        Ok(checks)
    })
    .await
    .map_err(|e| format!("worker failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_check_reports_real_writability() {
        let base = std::env::temp_dir().join(format!("voxel-diag-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let check = check_storage(&base);
        assert!(check.ok, "temp dir must be writable: {}", check.detail);
        assert!(check.detail.contains("read/write verified"));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn storage_check_fails_on_an_unwritable_target() {
        // /proc is readable but never writable on Linux — a real failure probe
        let check = check_storage(Path::new("/proc/voxel-diag-probe"));
        assert!(!check.ok);
        assert!(!check.fix.is_empty(), "a failing check must tell the user what to do");
    }

    #[test]
    fn failing_network_check_carries_a_fix() {
        // RFC 2606 reserved TLD — guaranteed to fail, exercising the error path
        let check = check_network("probe", "Unreachable", "https://diagnostics.invalid");
        assert!(!check.ok);
        assert!(!check.fix.is_empty());
    }
}
