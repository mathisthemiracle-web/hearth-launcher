use std::{
    collections::{HashMap, HashSet},
    fs, io,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};

use futures_util::{stream, StreamExt, TryStreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::process::Command;

use crate::{
    auth::AuthSession,
    models::{GameVersion, Instance, LaunchCheck, LaunchReport},
    net,
    storage::{hearth_dir, instance_dir},
};

const VERSION_MANIFEST: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const PARALLEL_DOWNLOADS: usize = 32;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LaunchProgress {
    message: String,
    detail: String,
    /// 0-100 when the stage can be measured.
    percent: Option<u8>,
}

fn progress(app: &AppHandle, message: impl Into<String>, detail: impl Into<String>, percent: Option<u8>) {
    let _ = app.emit(
        "launch-progress",
        LaunchProgress {
            message: message.into(),
            detail: detail.into(),
            percent,
        },
    );
}

// ---------------------------------------------------------------------------
// Metadata (cached so relaunches and offline play skip the network)
// ---------------------------------------------------------------------------

async fn read_cached_json(path: &Path) -> Option<Value> {
    let text = tokio::fs::read_to_string(path).await.ok()?;
    serde_json::from_str(&text).ok()
}

async fn version_manifest() -> Result<Value, String> {
    let cache = hearth_dir()?.join("version_manifest_v2.json");
    match net::get_json(VERSION_MANIFEST).await {
        Ok(value) => {
            let _ = net::write_atomic(&cache, value.to_string().as_bytes()).await;
            Ok(value)
        }
        Err(error) => read_cached_json(&cache).await.ok_or(error),
    }
}

pub async fn list_versions() -> Result<Vec<GameVersion>, String> {
    let manifest = version_manifest().await?;
    let versions = manifest["versions"]
        .as_array()
        .ok_or("Mojang’s version list is empty.")?
        .iter()
        .filter(|entry| entry["type"].as_str() == Some("release"))
        .filter_map(|entry| {
            Some(GameVersion {
                id: entry["id"].as_str()?.to_string(),
                release_time: entry["releaseTime"].as_str().unwrap_or_default().to_string(),
            })
        })
        // Fabric and the curated optimisation mods start at 1.20.
        .take_while(|v| v.id != "1.19.4")
        .collect();
    Ok(versions)
}

pub async fn version_json(version: &str) -> Result<Value, String> {
    let path = hearth_dir()?
        .join("versions")
        .join(version)
        .join(format!("{version}.json"));
    if let Some(value) = read_cached_json(&path).await {
        return Ok(value);
    }
    let manifest = version_manifest().await?;
    let entry = manifest["versions"]
        .as_array()
        .and_then(|versions| {
            versions
                .iter()
                .find(|entry| entry["id"].as_str() == Some(version))
        })
        .ok_or_else(|| format!("Minecraft {version} was not found in Mojang’s version manifest."))?;
    let url = entry["url"]
        .as_str()
        .ok_or("The Minecraft version has no metadata URL.")?;
    net::ensure_file(url, &path, entry["sha1"].as_str(), None).await?;
    read_cached_json(&path)
        .await
        .ok_or_else(|| format!("The metadata for Minecraft {version} is invalid."))
}

fn loader_meta(loader: &str) -> Result<(&'static str, &'static str), String> {
    match loader {
        "fabric" => Ok(("https://meta.fabricmc.net/v2/versions/loader", "Fabric")),
        "quilt" => Ok(("https://meta.quiltmc.org/v3/versions/loader", "Quilt")),
        other => Err(format!("Hearth cannot launch {other} instances yet.")),
    }
}

/// Latest stable Fabric/Quilt loader profile, cached for offline launches.
pub async fn loader_profile(version: &str, loader: &str) -> Result<(Value, String), String> {
    let (root, label) = loader_meta(loader)?;
    let cache = hearth_dir()?
        .join("versions")
        .join(version)
        .join(format!("{loader}-profile.json"));
    let online = async {
        let loaders = net::get_json(&format!("{root}/{version}")).await?;
        let pick = loaders.as_array().and_then(|items| {
            items
                .iter()
                .find(|item| item["loader"]["stable"].as_bool() == Some(true))
                .or_else(|| {
                    items.iter().find(|item| {
                        let v = item["loader"]["version"].as_str().unwrap_or_default();
                        !v.contains("beta") && !v.contains("pre") && !v.contains("rc")
                    })
                })
                .or_else(|| items.first())
        });
        let loader_entry = pick
            .ok_or_else(|| format!("{label} does not provide a loader for Minecraft {version} yet."))?;
        let loader_version = loader_entry["loader"]["version"]
            .as_str()
            .ok_or_else(|| format!("{label} did not provide a loader version."))?
            .to_string();
        let profile =
            net::get_json(&format!("{root}/{version}/{loader_version}/profile/json")).await?;
        Ok::<_, String>((profile, loader_version))
    };
    match online.await {
        Ok((profile, loader_version)) => {
            let cached = json!({ "loader": loader_version, "profile": profile });
            let _ = net::write_atomic(&cache, cached.to_string().as_bytes()).await;
            Ok((profile, loader_version))
        }
        Err(error) => {
            let cached = read_cached_json(&cache).await.ok_or(error)?;
            Ok((
                cached["profile"].clone(),
                cached["loader"].as_str().unwrap_or("cached").to_string(),
            ))
        }
    }
}

// ---------------------------------------------------------------------------
// Library rules
// ---------------------------------------------------------------------------

fn rule_matches(rule: &Value) -> bool {
    if let Some(os) = rule.get("os") {
        if let Some(name) = os.get("name").and_then(Value::as_str) {
            let current = if cfg!(windows) {
                "windows"
            } else if cfg!(target_os = "macos") {
                "osx"
            } else {
                "linux"
            };
            if name != current {
                return false;
            }
        }
        if let Some(arch) = os.get("arch").and_then(Value::as_str) {
            if arch == "x86" && cfg!(target_arch = "x86_64") {
                return false;
            }
        }
    }
    if let Some(features) = rule.get("features").and_then(Value::as_object) {
        if features.values().any(|value| value.as_bool() == Some(true)) {
            return false;
        }
    }
    true
}

fn rules_allow(rules: Option<&Value>) -> bool {
    let Some(items) = rules.and_then(Value::as_array) else {
        return true;
    };
    if items.is_empty() {
        return true;
    }
    let mut allowed = false;
    for rule in items {
        if rule_matches(rule) {
            allowed = rule["action"].as_str() == Some("allow");
        }
    }
    allowed
}

fn maven_path(name: &str) -> Result<String, String> {
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() < 3 {
        return Err(format!("Invalid Maven library name: {name}"));
    }
    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    let classifier = if parts.len() > 3 {
        format!("-{}", parts[3])
    } else {
        String::new()
    };
    Ok(format!(
        "{group}/{artifact}/{version}/{artifact}-{version}{classifier}.jar"
    ))
}

/// `group:artifact[:classifier]`, used to stop Fabric and vanilla from putting
/// two versions of the same library on the classpath.
fn library_key(name: &str) -> String {
    let parts: Vec<&str> = name.split(':').collect();
    match parts.len() {
        0..=2 => name.to_string(),
        3 => format!("{}:{}", parts[0], parts[1]),
        _ => format!("{}:{}:{}", parts[0], parts[1], parts[3]),
    }
}

fn native_classifier(library: &Value) -> Option<String> {
    let template = library.get("natives")?.get("windows")?.as_str()?;
    Some(template.replace("${arch}", "64"))
}

struct Download {
    url: String,
    path: PathBuf,
    sha1: Option<String>,
    size: Option<u64>,
}

async fn download_all(
    app: &AppHandle,
    jobs: Vec<Download>,
    stage: &'static str,
) -> Result<(), String> {
    let total = jobs.len().max(1);
    let done = Arc::new(AtomicUsize::new(0));
    let step = (total / 40).max(1);
    stream::iter(jobs.into_iter().map(|job| {
        let done = done.clone();
        let app = app.clone();
        async move {
            net::ensure_file(&job.url, &job.path, job.sha1.as_deref(), job.size).await?;
            let finished = done.fetch_add(1, Ordering::Relaxed) + 1;
            if finished % step == 0 || finished == total {
                progress(
                    &app,
                    stage,
                    format!("{finished} / {total} files"),
                    Some(((finished * 100) / total) as u8),
                );
            }
            Ok::<(), String>(())
        }
    }))
    .buffer_unordered(PARALLEL_DOWNLOADS)
    .try_collect::<Vec<()>>()
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Archives & Java
// ---------------------------------------------------------------------------

fn extract_zip_blocking(
    archive_path: PathBuf,
    destination: PathBuf,
    dll_only: bool,
) -> Result<(), String> {
    let file = fs::File::open(&archive_path)
        .map_err(|e| format!("Could not open {}: {e}", archive_path.display()))?;
    let mut archive = zip::ZipArchive::new(io::BufReader::new(file))
        .map_err(|e| format!("Invalid ZIP archive {}: {e}", archive_path.display()))?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        let Some(relative) = entry.enclosed_name() else {
            continue;
        };
        if entry.is_dir() {
            continue;
        }
        if dll_only && relative.extension().and_then(|v| v.to_str()) != Some("dll") {
            continue;
        }
        let output = if dll_only {
            // Old LWJGL natives sometimes nest DLLs; Java expects them flat.
            match relative.file_name() {
                Some(name) => destination.join(name),
                None => continue,
            }
        } else {
            destination.join(relative)
        };
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut target = io::BufWriter::new(
            fs::File::create(&output)
                .map_err(|e| format!("Could not extract {}: {e}", output.display()))?,
        );
        io::copy(&mut entry, &mut target)
            .map_err(|e| format!("Could not extract {}: {e}", output.display()))?;
    }
    Ok(())
}

async fn extract_zip(archive: &Path, destination: &Path, dll_only: bool) -> Result<(), String> {
    let archive = archive.to_path_buf();
    let destination = destination.to_path_buf();
    tokio::task::spawn_blocking(move || extract_zip_blocking(archive, destination, dll_only))
        .await
        .map_err(|e| format!("Archive extraction stopped: {e}"))?
}

#[cfg(windows)]
const JAVA_BINARY: &str = "javaw.exe";
#[cfg(not(windows))]
const JAVA_BINARY: &str = "java";

fn find_java(root: &Path) -> Option<PathBuf> {
    let direct = root.join("bin").join(JAVA_BINARY);
    if direct.exists() {
        return Some(direct);
    }
    for entry in fs::read_dir(root).ok()?.flatten() {
        let candidate = entry.path().join("bin").join(JAVA_BINARY);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(windows)]
async fn install_java(major: u64) -> Result<PathBuf, String> {
    let root = hearth_dir()?.join("runtimes").join(format!("java-{major}"));
    if let Some(executable) = find_java(&root) {
        return Ok(executable);
    }
    let archive = hearth_dir()?
        .join("downloads")
        .join(format!("adoptium-jre-{major}-windows-x64.zip"));
    let url = format!("https://api.adoptium.net/v3/binary/latest/{major}/ga/windows/x64/jre/hotspot/normal/eclipse");
    net::ensure_file(&url, &archive, None, None).await?;
    // Extract into a temporary folder and move it into place only when complete,
    // so an interrupted extraction is never mistaken for a working Java.
    let staging = root.with_extension("partial");
    let _ = tokio::fs::remove_dir_all(&staging).await;
    tokio::fs::create_dir_all(&staging)
        .await
        .map_err(|e| e.to_string())?;
    if let Err(error) = extract_zip(&archive, &staging, false).await {
        let _ = tokio::fs::remove_file(&archive).await;
        return Err(error);
    }
    let _ = tokio::fs::remove_dir_all(&root).await;
    tokio::fs::rename(&staging, &root)
        .await
        .map_err(|e| format!("Could not install Java {major}: {e}"))?;
    let executable = find_java(&root)
        .ok_or("The Java archive was extracted, but bin/javaw.exe was not found.")?;
    let _ = tokio::fs::remove_file(archive).await;
    Ok(executable)
}

#[cfg(not(windows))]
async fn install_java(major: u64) -> Result<PathBuf, String> {
    let root = hearth_dir()?.join("runtimes").join(format!("java-{major}"));
    find_java(&root)
        .ok_or_else(|| "Automatic Java installation is currently available in the Windows build.".into())
}

async fn install_assets(app: &AppHandle, version: &Value) -> Result<(PathBuf, String), String> {
    let index = version
        .get("assetIndex")
        .ok_or("This Minecraft version has no asset index.")?;
    let id = index["id"]
        .as_str()
        .ok_or("The asset index has no ID.")?
        .to_string();
    let url = index["url"].as_str().ok_or("The asset index has no URL.")?;
    let root = hearth_dir()?.join("assets");
    let index_path = root.join("indexes").join(format!("{id}.json"));
    net::ensure_file(url, &index_path, index["sha1"].as_str(), index["size"].as_u64()).await?;
    let index_json = read_cached_json(&index_path)
        .await
        .ok_or("The asset index is invalid.")?;
    let objects = index_json["objects"]
        .as_object()
        .ok_or("The asset index contains no objects.")?;

    // Skip the per-file check entirely when this index was already completed.
    let marker = root.join("indexes").join(format!("{id}.complete"));
    if tokio::fs::metadata(&marker).await.is_ok() {
        return Ok((root, id));
    }

    let object_root = root.join("objects");
    let mut seen = HashSet::new();
    let jobs: Vec<Download> = objects
        .values()
        .filter_map(|object| {
            let hash = object["hash"].as_str()?;
            if hash.len() < 2 || !seen.insert(hash.to_string()) {
                return None;
            }
            Some(Download {
                url: format!(
                    "https://resources.download.minecraft.net/{}/{hash}",
                    &hash[..2]
                ),
                path: object_root.join(&hash[..2]).join(hash),
                sha1: Some(hash.to_string()),
                size: object["size"].as_u64(),
            })
        })
        .collect();
    download_all(app, jobs, "Preparing world resources").await?;
    let _ = tokio::fs::write(&marker, b"ok").await;
    Ok((root, id))
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

fn argument_values(arguments: Option<&Value>) -> Vec<String> {
    let Some(items) = arguments.and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut result = Vec::new();
    for item in items {
        if let Some(value) = item.as_str() {
            result.push(value.to_string());
            continue;
        }
        if rules_allow(item.get("rules")) {
            match item.get("value") {
                Some(Value::String(value)) => result.push(value.clone()),
                Some(Value::Array(values)) => {
                    result.extend(values.iter().filter_map(Value::as_str).map(str::to_string))
                }
                _ => {}
            }
        }
    }
    result
}

fn resolve_arguments(values: Vec<String>, replacements: &HashMap<String, String>) -> Vec<String> {
    values
        .into_iter()
        .map(|mut value| {
            if value.contains("${") {
                for (key, replacement) in replacements {
                    value = value.replace(&format!("${{{key}}}"), replacement);
                }
            }
            value
        })
        .collect()
}

/// JVM flags. The G1 values are the ones Mojang's own launcher uses, plus
/// widely used low-risk additions. ZGC (Java 21+) trades a little throughput
/// for the smallest garbage-collection pauses, which reduces stutter.
pub fn performance_jvm_args(memory_gb: u16, java_major: u64, gc: Option<&str>) -> Vec<String> {
    let memory = memory_gb.clamp(2, 64);
    let mut args = vec![
        format!("-Xmx{memory}G"),
        format!("-Xms{memory}G"),
        "-XX:+UnlockExperimentalVMOptions".into(),
        "-XX:+DisableExplicitGC".into(),
        "-XX:+PerfDisableSharedMem".into(),
        "-XX:+UseStringDeduplication".into(),
        "-Dfile.encoding=UTF-8".into(),
    ];
    if gc == Some("zgc") && java_major >= 21 {
        args.push("-XX:+UseZGC".into());
        if java_major < 23 {
            args.push("-XX:+ZGenerational".into());
        }
    } else {
        args.extend([
            "-XX:+UseG1GC".into(),
            "-XX:+ParallelRefProcEnabled".into(),
            "-XX:MaxGCPauseMillis=50".into(),
            "-XX:G1NewSizePercent=20".into(),
            "-XX:G1ReservePercent=20".into(),
            "-XX:G1HeapRegionSize=32M".into(),
        ]);
    }
    args
}

fn log_tail(path: &Path, lines: usize) -> String {
    let text = fs::read_to_string(path).unwrap_or_default();
    let all: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    all[all.len().saturating_sub(lines)..].join("\n")
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

pub fn launchable(loader: &str) -> bool {
    matches!(loader, "fabric" | "quilt")
}

/// Everything needed to start the game, already on disk.
pub struct Prepared {
    base: Value,
    profile: Value,
    loader_version: String,
    classpath: Vec<PathBuf>,
    natives: PathBuf,
    assets_root: PathBuf,
    assets_id: String,
    java: PathBuf,
    java_major: u64,
}

/// Downloads and verifies game files, libraries, assets and Java. Used by Play
/// and by the background warm-up that runs after a preset is applied, so the
/// first Play only has to start Java.
pub async fn prepare(app: &AppHandle, instance: &Instance) -> Result<Prepared, String> {
    let shared = hearth_dir()?;
    progress(app, "Finding Minecraft", format!("Minecraft {} with {}", instance.version, instance.loader), None);
    let (base, loader) = tokio::try_join!(
        version_json(&instance.version),
        loader_profile(&instance.version, &instance.loader)
    )?;
    let (profile, loader_version) = loader;

    let version_root = shared.join("versions").join(&instance.version);
    let client_jar = version_root.join(format!("{}.jar", instance.version));
    let client_download = &base["downloads"]["client"];
    let mut jobs = vec![Download {
        url: client_download["url"]
            .as_str()
            .ok_or("The Minecraft client has no download URL.")?
            .to_string(),
        path: client_jar.clone(),
        sha1: client_download["sha1"].as_str().map(str::to_string),
        size: client_download["size"].as_u64(),
    }];

    // Loader libraries first, so their newer copies win over vanilla duplicates.
    let mut libraries = profile["libraries"].as_array().cloned().unwrap_or_default();
    libraries.extend(base["libraries"].as_array().cloned().unwrap_or_default());
    let mut classpath = Vec::new();
    let mut native_archives = Vec::new();
    let mut seen_keys = HashSet::new();
    for library in &libraries {
        if !rules_allow(library.get("rules")) {
            continue;
        }
        let name = library["name"].as_str().unwrap_or_default();
        if let Some(artifact) = library.get("downloads").and_then(|d| d.get("artifact")) {
            if !name.is_empty() && !seen_keys.insert(library_key(name)) {
                continue;
            }
            let relative = artifact["path"]
                .as_str()
                .ok_or("A Minecraft library has no path.")?;
            let path = shared.join("libraries").join(relative);
            jobs.push(Download {
                url: artifact["url"]
                    .as_str()
                    .ok_or("A Minecraft library has no URL.")?
                    .to_string(),
                path: path.clone(),
                sha1: artifact["sha1"].as_str().map(str::to_string),
                size: artifact["size"].as_u64(),
            });
            if !classpath.contains(&path) {
                classpath.push(path);
            }
        } else if !name.is_empty() && library.get("natives").is_none() {
            if !seen_keys.insert(library_key(name)) {
                continue;
            }
            let relative = maven_path(name)?;
            let path = shared.join("libraries").join(&relative);
            let base_url = library["url"]
                .as_str()
                .unwrap_or("https://libraries.minecraft.net/");
            jobs.push(Download {
                url: format!("{}/{relative}", base_url.trim_end_matches('/')),
                path: path.clone(),
                sha1: library["sha1"].as_str().map(str::to_string),
                size: library["size"].as_u64(),
            });
            classpath.push(path);
        }
        if let Some(classifier) = native_classifier(library) {
            if let Some(artifact) = library
                .get("downloads")
                .and_then(|d| d.get("classifiers"))
                .and_then(|d| d.get(&classifier))
            {
                let relative = artifact["path"]
                    .as_str()
                    .ok_or("A native library has no path.")?;
                let path = shared.join("libraries").join(relative);
                jobs.push(Download {
                    url: artifact["url"]
                        .as_str()
                        .ok_or("A native library has no URL.")?
                        .to_string(),
                    path: path.clone(),
                    sha1: artifact["sha1"].as_str().map(str::to_string),
                    size: artifact["size"].as_u64(),
                });
                native_archives.push(path);
            }
        }
    }

    let java_major = base["javaVersion"]["majorVersion"].as_u64().unwrap_or(21);
    progress(
        app,
        "Gathering game files",
        format!("Libraries, sounds, textures and Java {java_major}, all at once"),
        None,
    );

    // Libraries, assets and Java are independent: fetch them in parallel.
    let (_, assets, java) = tokio::try_join!(
        download_all(app, jobs, "Downloading game files"),
        install_assets(app, &base),
        install_java(java_major),
    )?;
    let (assets_root, assets_id) = assets;

    let natives = version_root.join("natives");
    let natives_marker = natives.join(".hearth-extracted");
    let natives_signature = native_archives
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("\n");
    let already = tokio::fs::read_to_string(&natives_marker)
        .await
        .map(|text| text == natives_signature)
        .unwrap_or(false);
    if !already {
        tokio::fs::create_dir_all(&natives)
            .await
            .map_err(|e| e.to_string())?;
        for archive in &native_archives {
            extract_zip(archive, &natives, true).await?;
        }
        let _ = tokio::fs::write(&natives_marker, &natives_signature).await;
    }
    classpath.push(client_jar);

    Ok(Prepared { base, profile, loader_version, classpath, natives, assets_root, assets_id, java, java_major })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GameExited {
    instance_id: String,
    code: Option<i32>,
    seconds: u64,
}

/// Windows remembers a per-app GPU choice (Settings → System → Display →
/// Graphics). Marking Java as "High performance" stops laptops from running
/// Minecraft on the integrated GPU.
#[cfg(windows)]
fn prefer_high_performance_gpu(java: &Path) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let java = java.to_string_lossy().to_string();
    let _ = std::process::Command::new("reg")
        .args([
            "add",
            r"HKCU\Software\Microsoft\DirectX\UserGpuPreferences",
            "/v",
            java.as_str(),
            "/t",
            "REG_SZ",
            "/d",
            "GpuPreference=2;",
            "/f",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

#[cfg(not(windows))]
fn prefer_high_performance_gpu(_java: &Path) {}

pub async fn launch(
    app: AppHandle,
    instance: Instance,
    session: AuthSession,
    boost_priority: bool,
    gpu_high_performance: bool,
) -> Result<LaunchReport, String> {
    if !launchable(&instance.loader) {
        return Ok(LaunchReport {
            can_launch: false,
            checks: vec![LaunchCheck { label: "Loader support".into(), ready: false, detail: "Hearth starts Fabric and Quilt instances. Forge and NeoForge stay available for configuration and mod searches.".into() }],
            message: "Choose a Fabric or Quilt instance to start Minecraft from Hearth.".into(),
        });
    }
    if instance.mods.iter().any(|item| item.status != "installed") {
        return Err("Some mods are not downloaded yet. Hearth will fetch them on the next Play.".into());
    }

    let game_dir = instance_dir(&instance.id)?;
    let shared = hearth_dir()?;
    let prepared = prepare(&app, &instance).await?;
    let Prepared { base, profile, loader_version, classpath, natives, assets_root, assets_id, java, java_major } = prepared;

    if gpu_high_performance {
        prefer_high_performance_gpu(&java);
    }

    let separator = if cfg!(windows) { ";" } else { ":" };
    let classpath_string = classpath
        .iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(separator);

    let main_class = profile["mainClass"]
        .as_str()
        .or_else(|| base["mainClass"].as_str())
        .ok_or("The launch profile has no main class.")?;
    let mut jvm = argument_values(base.get("arguments").and_then(|a| a.get("jvm")));
    jvm.extend(argument_values(
        profile.get("arguments").and_then(|a| a.get("jvm")),
    ));
    if jvm.is_empty() {
        jvm = vec![
            "-Djava.library.path=${natives_directory}".into(),
            "-cp".into(),
            "${classpath}".into(),
        ];
    }
    let mut game_arguments = argument_values(base.get("arguments").and_then(|a| a.get("game")));
    game_arguments.extend(argument_values(
        profile.get("arguments").and_then(|a| a.get("game")),
    ));
    if game_arguments.is_empty() {
        if let Some(arguments) = base["minecraftArguments"].as_str() {
            game_arguments = arguments.split_whitespace().map(str::to_string).collect();
        }
    }

    let mut replacements = HashMap::new();
    replacements.insert("auth_player_name".into(), session.account.username.clone());
    replacements.insert(
        "version_name".into(),
        format!("{}-{}-{}", instance.version, instance.loader, loader_version),
    );
    replacements.insert("game_directory".into(), game_dir.to_string_lossy().to_string());
    replacements.insert("assets_root".into(), assets_root.to_string_lossy().to_string());
    replacements.insert("game_assets".into(), assets_root.to_string_lossy().to_string());
    replacements.insert("assets_index_name".into(), assets_id);
    replacements.insert("auth_uuid".into(), session.account.uuid.clone());
    replacements.insert("auth_access_token".into(), session.access_token.clone());
    replacements.insert("auth_session".into(), session.access_token.clone());
    replacements.insert("clientid".into(), "Hearth".into());
    replacements.insert("auth_xuid".into(), "0".into());
    replacements.insert("user_properties".into(), "{}".into());
    replacements.insert("user_type".into(), "msa".into());
    replacements.insert(
        "version_type".into(),
        base["type"].as_str().unwrap_or("release").into(),
    );
    replacements.insert("natives_directory".into(), natives.to_string_lossy().to_string());
    replacements.insert(
        "library_directory".into(),
        shared.join("libraries").to_string_lossy().to_string(),
    );
    replacements.insert("classpath_separator".into(), separator.into());
    replacements.insert("launcher_name".into(), "Hearth".into());
    replacements.insert("launcher_version".into(), env!("CARGO_PKG_VERSION").into());
    replacements.insert("classpath".into(), classpath_string);

    let logs = game_dir.join("logs");
    tokio::fs::create_dir_all(&logs)
        .await
        .map_err(|e| e.to_string())?;
    let log_path = logs.join("hearth-launch.log");
    let log_file = fs::File::create(&log_path)
        .map_err(|e| format!("Could not create the launch log: {e}"))?;
    let log_err = log_file
        .try_clone()
        .map_err(|e| format!("Could not create the launch log: {e}"))?;

    let mut command = Command::new(&java);
    command
        .current_dir(&game_dir)
        .args(performance_jvm_args(instance.memory_gb, java_major, instance.gc.as_deref()))
        .args(resolve_arguments(jvm, &replacements))
        .arg(main_class)
        .args(resolve_arguments(game_arguments, &replacements))
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_err));
    #[cfg(windows)]
    {
        const ABOVE_NORMAL_PRIORITY_CLASS: u32 = 0x0000_8000;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut flags = CREATE_NO_WINDOW;
        if boost_priority {
            flags |= ABOVE_NORMAL_PRIORITY_CLASS;
        }
        command.creation_flags(flags);
    }
    #[cfg(not(windows))]
    let _ = boost_priority;

    progress(
        &app,
        "Starting Minecraft",
        format!(
            "{} · Java {java_major} · {} GB memory",
            session.account.username, instance.memory_gb
        ),
        Some(100),
    );
    let started = std::time::Instant::now();
    let mut child = command
        .spawn()
        .map_err(|e| format!("Minecraft could not start: {e}"))?;

    // Catch the classic "it closed instantly" failures (bad Java, broken mod)
    // and show the real reason instead of claiming success.
    match tokio::time::timeout(Duration::from_secs(4), child.wait()).await {
        Ok(Ok(status)) => {
            let tail = log_tail(&log_path, 14);
            return Err(format!(
                "Minecraft closed right after starting (exit code {}).{}",
                status.code().unwrap_or(-1),
                if tail.is_empty() { String::new() } else { format!("\n\nLast lines of logs/hearth-launch.log:\n{tail}") }
            ));
        }
        Ok(Err(error)) => return Err(format!("Could not watch the Minecraft process: {error}")),
        Err(_) => {
            let app_handle = app.clone();
            let instance_id = instance.id.clone();
            tokio::spawn(async move {
                let code = child.wait().await.ok().and_then(|s| s.code());
                let _ = app_handle.emit(
                    "game-exited",
                    GameExited { instance_id, code, seconds: started.elapsed().as_secs() },
                );
            });
        }
    }

    Ok(LaunchReport {
        can_launch: true,
        checks: vec![
            LaunchCheck { label: "Microsoft account".into(), ready: true, detail: format!("Signed in as {}. Java Edition ownership verified.", session.account.username) },
            LaunchCheck { label: "Minecraft runtime".into(), ready: true, detail: format!("Minecraft {} · {} {} · Java {}", instance.version, instance.loader, loader_version, java_major) },
            LaunchCheck { label: "Game process".into(), ready: true, detail: "Running in this instance’s own folder. Log: logs/hearth-launch.log".into() },
        ],
        message: format!("Minecraft is starting as {}. The first launch with new mods can take a minute.", session.account.username),
    })
}
