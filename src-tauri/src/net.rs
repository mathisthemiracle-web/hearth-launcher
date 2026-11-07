//! Shared HTTP client and verified, atomic file downloads.
//!
//! One pooled client is reused for every request so TLS sessions and
//! connections stay warm between Modrinth, Mojang, Fabric and Microsoft calls.

use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        OnceLock,
    },
    time::Duration,
};

use reqwest::Client;
use serde_json::Value;
use sha1::{Digest, Sha1};

static CLIENT: OnceLock<Client> = OnceLock::new();
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn client() -> Client {
    CLIENT
        .get_or_init(|| {
            Client::builder()
                .user_agent(concat!(
                    "HearthLauncher/",
                    env!("CARGO_PKG_VERSION"),
                    " (desktop Minecraft launcher)"
                ))
                .connect_timeout(Duration::from_secs(10))
                .read_timeout(Duration::from_secs(30))
                .pool_max_idle_per_host(32)
                .tcp_nodelay(true)
                .build()
                .unwrap_or_else(|_| Client::new())
        })
        .clone()
}

pub async fn get_json(url: &str) -> Result<Value, String> {
    let response = client()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Could not download metadata: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Metadata request failed ({status}): {url}"));
    }
    response
        .json()
        .await
        .map_err(|e| format!("Invalid metadata from {url}: {e}"))
}

/// A unique sibling path used while a download is in flight, so a crash or a
/// parallel download can never leave a half-written file under the real name.
pub fn temp_path(path: &Path) -> PathBuf {
    let n = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "download".into());
    path.with_file_name(format!(".{name}.{}.{n}.part", std::process::id()))
}

pub async fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Could not create {}: {e}", parent.display()))?;
    }
    let temp = temp_path(path);
    tokio::fs::write(&temp, bytes)
        .await
        .map_err(|e| format!("Could not save {}: {e}", path.display()))?;
    if let Err(e) = tokio::fs::rename(&temp, path).await {
        let _ = tokio::fs::remove_file(&temp).await;
        return Err(format!("Could not save {}: {e}", path.display()));
    }
    Ok(())
}

async fn sha1_of_file(path: &Path) -> Option<String> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let bytes = std::fs::read(path).ok()?;
        Some(hex::encode(Sha1::digest(&bytes)))
    })
    .await
    .ok()
    .flatten()
}

/// Fast check used on every launch: a file is trusted when its size matches the
/// size Mojang published. Hashing only happens when no size is known, which keeps
/// relaunches nearly instant instead of re-reading gigabytes of assets.
pub async fn is_present(path: &Path, sha1: Option<&str>, size: Option<u64>) -> bool {
    let Ok(meta) = tokio::fs::metadata(path).await else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    match (size, sha1) {
        (Some(expected), _) => meta.len() == expected,
        (None, Some(expected)) => sha1_of_file(path).await.as_deref() == Some(expected),
        (None, None) => meta.len() > 0,
    }
}

/// Downloads `url` to `path` unless a matching file already exists.
/// Retries transient failures and verifies SHA-1 when one is known.
pub async fn ensure_file(
    url: &str,
    path: &Path,
    sha1: Option<&str>,
    size: Option<u64>,
) -> Result<(), String> {
    if is_present(path, sha1, size).await {
        return Ok(());
    }
    let mut last_error = String::new();
    for attempt in 0..3u64 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(400 * attempt)).await;
        }
        let response = match client().get(url).send().await {
            Ok(response) => response,
            Err(e) => {
                last_error = format!("Download failed: {url}: {e}");
                continue;
            }
        };
        let status = response.status();
        if !status.is_success() {
            last_error = format!("Download failed ({status}): {url}");
            if status.is_client_error() {
                break;
            }
            continue;
        }
        let bytes = match response.bytes().await {
            Ok(bytes) => bytes,
            Err(e) => {
                last_error = format!("Could not read the download from {url}: {e}");
                continue;
            }
        };
        if let Some(expected) = sha1 {
            let data = bytes.clone();
            let actual = tokio::task::spawn_blocking(move || hex::encode(Sha1::digest(&data)))
                .await
                .map_err(|e| e.to_string())?;
            if actual != expected {
                last_error = format!("Checksum mismatch for {url}. The file was not installed.");
                continue;
            }
        }
        return write_atomic(path, &bytes).await;
    }
    Err(last_error)
}
