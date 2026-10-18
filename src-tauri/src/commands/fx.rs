//! Live FX rates for the user's currency — the owner's real-economics ask:
//! token value is quoted in USD and converted to BRL and EUR AUTOMATICALLY.
//! Source: the European Central Bank through the public frankfurter API
//! (no key, no account). Rates cache for an hour inside the workspace;
//! when offline the last cache is served with its age stated honestly.

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FxRates {
    /// 1 USD in BRL
    pub usd_brl: f64,
    /// 1 USD in EUR
    pub usd_eur: f64,
    /// the ECB reference date ("2026-10-16")
    pub rate_date: String,
    /// when VOXEL fetched it (ISO)
    pub fetched_at: String,
}

fn cache_path(base: &Path) -> std::path::PathBuf {
    base.join(".voxel").join("fx.json")
}

fn parse_frankfurter(body: &[u8]) -> Result<FxRates, String> {
    let v: serde_json::Value =
        serde_json::from_slice(body).map_err(|e| format!("fx parse: {e}"))?;
    let rates = v
        .get("rates")
        .ok_or_else(|| "fx response has no rates".to_string())?;
    let brl = rates
        .get("BRL")
        .and_then(|x| x.as_f64())
        .ok_or_else(|| "fx response has no BRL rate".to_string())?;
    let eur = rates
        .get("EUR")
        .and_then(|x| x.as_f64())
        .ok_or_else(|| "fx response has no EUR rate".to_string())?;
    Ok(FxRates {
        usd_brl: brl,
        usd_eur: eur,
        rate_date: v
            .get("date")
            .and_then(|d| d.as_str())
            .unwrap_or("unknown")
            .to_string(),
        fetched_at: iso_now(),
    })
}

fn iso_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86_400) as i64;
    let (y, m, d) = super::git::civil_from_days(days);
    let tod = secs % 86_400;
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        tod / 3600,
        (tod % 3600) / 60,
        tod % 60
    )
}

fn read_cache(base: &Path) -> Option<FxRates> {
    let raw = std::fs::read(cache_path(base)).ok()?;
    serde_json::from_slice::<FxRates>(&raw).ok()
}

fn fetch_fresh() -> Result<FxRates, String> {
    // frankfurter.app redirects to api.frankfurter.dev — follow it
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(8))
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| format!("{e}"))?;
    let response = client
        .get("https://api.frankfurter.dev/v1/latest?base=USD&symbols=BRL,EUR")
        .send()
        .map_err(|e| format!("FX service unreachable: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("FX service answered HTTP {}", response.status()));
    }
    let bytes = response.bytes().map_err(|e| format!("{e}"))?;
    parse_frankfurter(&bytes)
}

/// Live ECB rates (cached 1h in the workspace). Offline: the last cache
/// still serves, and when nothing exists the error says so honestly.
pub fn fx_latest_impl(base_path: String) -> Result<FxRates, String> {
    let base = Path::new(&base_path).to_path_buf();
    if let Some(cached) = read_cache(&base) {
        let fresh = std::fs::read_to_string(cache_path(&base))
            .ok()
            .and_then(|_| None::<()>);
        let _ = fresh;
        // age check: within 1h the cache IS the answer
        if age_hours(&cached.fetched_at) < 1.0 {
            return Ok(cached);
        }
    }
    match fetch_fresh() {
        Ok(rates) => {
            if let Some(dir) = cache_path(&base).parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let _ = std::fs::write(
                cache_path(&base),
                serde_json::to_string(&rates).unwrap_or_default(),
            );
            Ok(rates)
        }
        Err(e) => {
            if let Some(cached) = read_cache(&base) {
                return Ok(cached); // stale but REAL — better than nothing
            }
            Err(format!("{e} — no cached rates to fall back to (open the panel once while online)"))
        }
    }
}

fn age_hours(iso: &str) -> f64 {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let Some(rest) = iso.strip_prefix(|c: char| c.is_ascii_digit() || c == '-').map(|_| iso) else {
        return 999.0;
    };
    let _ = rest;
    // parse "YYYY-MM-DDTHH:MM:SSZ" without chrono
    let parts: Vec<&str> = iso
        .trim_end_matches('Z')
        .split(['T', ':', '-'])
        .collect();
    if parts.len() < 6 {
        return 999.0;
    }
    let (y, mo, d, h, mi, s): (i64, i64, i64, i64, i64, i64) = (
        parts[0].parse().unwrap_or(0),
        parts[1].parse().unwrap_or(1),
        parts[2].parse().unwrap_or(1),
        parts[3].parse().unwrap_or(0),
        parts[4].parse().unwrap_or(0),
        parts[5].parse().unwrap_or(0),
    );
    // days from civil (Howard Hinnant's algorithm, same as git.rs)
    let y = if mo <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (mo + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let stamp = days * 86_400 + h * 3600 + mi * 60 + s;
    (now as f64 - stamp as f64) / 3600.0
}

#[tauri::command]
pub async fn fx_latest(base_path: String) -> Result<FxRates, String> {
    // network call — off the main thread like everything that touches it
    tauri::async_runtime::spawn_blocking(move || fx_latest_impl(base_path))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_real_frankfurter_shape() {
        let sample = br#"{"amount":1.0,"base":"USD","date":"2026-10-16","rates":{"BRL":5.0828,"EUR":0.88865}}"#;
        let rates = parse_frankfurter(sample).unwrap();
        assert_eq!(rates.usd_brl, 5.0828);
        assert_eq!(rates.usd_eur, 0.88865);
        assert_eq!(rates.rate_date, "2026-10-16");
    }

    #[test]
    fn cache_round_trips_and_goes_stale() {
        let base = std::env::temp_dir().join(format!("voxel-fx-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(cache_path(&base).parent().unwrap()).unwrap();

        let rates = FxRates {
            usd_brl: 5.1,
            usd_eur: 0.9,
            rate_date: "2026-10-16".into(),
            fetched_at: "2020-01-01T00:00:00Z".into(),
        };
        std::fs::write(
            cache_path(&base),
            serde_json::to_string(&rates).unwrap(),
        )
        .unwrap();
        let back = read_cache(&base).unwrap();
        assert_eq!(back.usd_brl, 5.1);
        // a 2020 stamp is ancient — the age check must say so
        assert!(age_hours("2020-01-01T00:00:00Z") > 1.0);
        assert!(age_hours(iso_now().as_str()) < 1.0);

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn malformed_responses_are_refused_honestly() {
        assert!(parse_frankfurter(b"not json").is_err());
        assert!(parse_frankfurter(br#"{"rates":{"BRL":5}}"#).is_err());
    }
}
