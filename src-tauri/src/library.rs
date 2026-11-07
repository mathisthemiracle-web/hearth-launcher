//! Per-instance library: worlds and backups, screenshots, crash diagnosis and
//! Modrinth modpack (.mrpack) import.

use std::{
    fs,
    io::{self, Cursor, Read, Write},
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

use futures_util::{stream, StreamExt, TryStreamExt};
use serde::{Deserialize, Serialize};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

use crate::{models::InstalledMod, net, official::iso_now, storage::instance_dir};

const KEEP_AUTO_BACKUPS: usize = 5;

fn modified_secs(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| {
            let p = entry.path();
            match entry.file_type() {
                Ok(t) if t.is_dir() => dir_size(&p),
                Ok(_) => entry.metadata().map(|m| m.len()).unwrap_or(0),
                Err(_) => 0,
            }
        })
        .sum()
}

/// A single path component chosen by the user (world or backup name).
fn safe_name(name: &str) -> Result<&str, String> {
    let ok = !name.is_empty()
        && Path::new(name).components().count() == 1
        && matches!(Path::new(name).components().next(), Some(Component::Normal(_)));
    if ok {
        Ok(name)
    } else {
        Err("That name is not a valid folder name.".into())
    }
}

/// A relative path inside an instance that cannot escape it.
fn safe_relative(path: &str) -> Option<PathBuf> {
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        return None;
    }
    let mut clean = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    (!clean.as_os_str().is_empty()).then_some(clean)
}

fn stamp() -> String {
    // 2026-11-07T20:10:00.000Z -> 20261107-201000
    let iso = iso_now();
    let digits: String = iso.chars().filter(|c| c.is_ascii_digit()).collect();
    format!("{}-{}", &digits[..8], &digits[8..14])
}

// ---------------------------------------------------------------------------
// Worlds & backups
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldInfo {
    pub folder: String,
    pub size_bytes: u64,
    pub last_played: u64,
    pub icon_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub file: String,
    pub world: String,
    pub size_bytes: u64,
    pub created: u64,
}

pub fn list_worlds(instance_id: &str) -> Result<Vec<WorldInfo>, String> {
    let saves = instance_dir(instance_id)?.join("saves");
    let Ok(entries) = fs::read_dir(&saves) else {
        return Ok(Vec::new());
    };
    let mut worlds: Vec<WorldInfo> = entries
        .flatten()
        .filter(|e| e.path().join("level.dat").exists())
        .map(|e| {
            let path = e.path();
            let icon = path.join("icon.png");
            WorldInfo {
                folder: e.file_name().to_string_lossy().to_string(),
                size_bytes: dir_size(&path),
                last_played: modified_secs(&path.join("level.dat")),
                icon_path: icon.exists().then(|| icon.to_string_lossy().to_string()),
            }
        })
        .collect();
    worlds.sort_by_key(|w| std::cmp::Reverse(w.last_played));
    Ok(worlds)
}

pub fn list_backups(instance_id: &str) -> Result<Vec<BackupInfo>, String> {
    let dir = instance_dir(instance_id)?.join("backups");
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    let mut backups: Vec<BackupInfo> = entries
        .flatten()
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("zip"))
        .map(|e| {
            let file = e.file_name().to_string_lossy().to_string();
            let world = file
                .rsplitn(3, '-')
                .nth(2)
                .unwrap_or(&file)
                .trim_end_matches("-auto")
                .to_string();
            BackupInfo {
                world,
                size_bytes: e.metadata().map(|m| m.len()).unwrap_or(0),
                created: modified_secs(&e.path()),
                file,
            }
        })
        .collect();
    backups.sort_by_key(|b| std::cmp::Reverse(b.created));
    Ok(backups)
}

fn zip_dir(source: &Path, target: &Path) -> Result<(), String> {
    let temp = net::temp_path(target);
    let file = fs::File::create(&temp).map_err(|e| format!("Could not create the backup: {e}"))?;
    let mut writer = ZipWriter::new(io::BufWriter::new(file));
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .compression_level(Some(3))
        .large_file(true);
    let root_name = source
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "world".into());
    let mut stack = vec![source.to_path_buf()];
    let mut buffer = Vec::new();
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
            let path = entry.path();
            let relative = path.strip_prefix(source).map_err(|e| e.to_string())?;
            let name = format!("{root_name}/{}", relative.to_string_lossy().replace('\\', "/"));
            if path.is_dir() {
                writer
                    .add_directory(format!("{name}/"), options)
                    .map_err(|e| e.to_string())?;
                stack.push(path);
                continue;
            }
            // session.lock is held open by a running game and is never needed.
            if path.file_name().and_then(|n| n.to_str()) == Some("session.lock") {
                continue;
            }
            buffer.clear();
            if fs::File::open(&path)
                .and_then(|mut f| f.read_to_end(&mut buffer))
                .is_err()
            {
                continue;
            }
            writer.start_file(name, options).map_err(|e| e.to_string())?;
            writer.write_all(&buffer).map_err(|e| e.to_string())?;
        }
    }
    writer.finish().map_err(|e| e.to_string())?;
    fs::rename(&temp, target).map_err(|e| format!("Could not save the backup: {e}"))
}

pub fn backup_world(instance_id: &str, world: &str, auto: bool) -> Result<BackupInfo, String> {
    let world = safe_name(world)?;
    let dir = instance_dir(instance_id)?;
    let source = dir.join("saves").join(world);
    if !source.join("level.dat").exists() {
        return Err(format!("The world “{world}” was not found."));
    }
    let backups = dir.join("backups");
    fs::create_dir_all(&backups).map_err(|e| e.to_string())?;
    let suffix = if auto { "-auto" } else { "" };
    let file = format!("{world}{suffix}-{}.zip", stamp());
    let target = backups.join(&file);
    zip_dir(&source, &target)?;
    if auto {
        prune_auto_backups(&backups, world);
    }
    Ok(BackupInfo {
        world: world.to_string(),
        size_bytes: fs::metadata(&target).map(|m| m.len()).unwrap_or(0),
        created: modified_secs(&target),
        file,
    })
}

fn prune_auto_backups(backups: &Path, world: &str) {
    let prefix = format!("{world}-auto-");
    let mut autos: Vec<PathBuf> = fs::read_dir(backups)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .is_some_and(|n| n.starts_with(&prefix) && n.ends_with(".zip"))
                })
                .collect()
        })
        .unwrap_or_default();
    autos.sort();
    while autos.len() > KEEP_AUTO_BACKUPS {
        let oldest = autos.remove(0);
        let _ = fs::remove_file(oldest);
    }
}

/// Backs up every world. Used automatically before a preset changes the mods.
pub fn backup_all(instance_id: &str) -> Result<usize, String> {
    let worlds = list_worlds(instance_id)?;
    let mut count = 0;
    for world in worlds {
        backup_world(instance_id, &world.folder, true)?;
        count += 1;
    }
    Ok(count)
}

/// Restores next to the original (never overwrites a world).
pub fn restore_backup(instance_id: &str, file: &str) -> Result<String, String> {
    let file = safe_name(file)?;
    let dir = instance_dir(instance_id)?;
    let archive_path = dir.join("backups").join(file);
    let reader = fs::File::open(&archive_path).map_err(|e| format!("Could not open the backup: {e}"))?;
    let mut archive = ZipArchive::new(io::BufReader::new(reader)).map_err(|e| e.to_string())?;
    let restored = format!("{}-restored-{}", file.trim_end_matches(".zip"), stamp());
    let target = dir.join("saves").join(&restored);
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        let Some(relative) = entry.enclosed_name() else { continue };
        // Drop the top-level world folder name stored in the archive.
        let inner: PathBuf = relative.components().skip(1).collect();
        if inner.as_os_str().is_empty() {
            continue;
        }
        let out = target.join(inner);
        if entry.is_dir() {
            fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut writer = io::BufWriter::new(fs::File::create(&out).map_err(|e| e.to_string())?);
        io::copy(&mut entry, &mut writer).map_err(|e| e.to_string())?;
    }
    Ok(restored)
}

pub fn delete_backup(instance_id: &str, file: &str) -> Result<(), String> {
    let file = safe_name(file)?;
    let path = instance_dir(instance_id)?.join("backups").join(file);
    fs::remove_file(path).map_err(|e| format!("Could not delete the backup: {e}"))
}

// ---------------------------------------------------------------------------
// Screenshots
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Screenshot {
    pub path: String,
    pub name: String,
    pub created: u64,
}

pub fn list_screenshots(instance_id: &str) -> Result<Vec<Screenshot>, String> {
    let dir = instance_dir(instance_id)?.join("screenshots");
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    let mut shots: Vec<Screenshot> = entries
        .flatten()
        .filter(|e| e.path().extension().and_then(|x| x.to_str()).is_some_and(|x| x.eq_ignore_ascii_case("png")))
        .map(|e| Screenshot {
            path: e.path().to_string_lossy().to_string(),
            name: e.file_name().to_string_lossy().to_string(),
            created: modified_secs(&e.path()),
        })
        .collect();
    shots.sort_by_key(|s| std::cmp::Reverse(s.created));
    shots.truncate(120);
    Ok(shots)
}

// ---------------------------------------------------------------------------
// Crash doctor
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Diagnosis {
    pub found: bool,
    pub title: String,
    pub explanation: String,
    pub fixes: Vec<String>,
    pub suspects: Vec<String>,
    pub source: Option<String>,
    pub excerpt: String,
}

fn newest_file(dir: &Path, ext: &str) -> Option<PathBuf> {
    fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some(ext))
        .max_by_key(|p| modified_secs(p))
}

fn read_lossy(path: &Path, max: usize) -> String {
    let bytes = fs::read(path).unwrap_or_default();
    let start = bytes.len().saturating_sub(max);
    String::from_utf8_lossy(&bytes[start..]).to_string()
}

fn lines_after(text: &str, marker: &str, limit: usize) -> Vec<String> {
    let Some(pos) = text.find(marker) else {
        return Vec::new();
    };
    text[pos + marker.len()..]
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .take_while(|l| l.starts_with('-') || l.starts_with("\t-") || l.contains("requires") || l.contains("is incompatible") || l.contains("Remove") || l.contains("Replace") || l.contains("Install"))
        .take(limit)
        .map(|l| l.trim_start_matches(['-', ' ', '\t']).to_string())
        .collect()
}

fn token_after(text: &str, marker: &str) -> Option<String> {
    let pos = text.find(marker)?;
    let rest = &text[pos + marker.len()..];
    let token: String = rest
        .trim_start()
        .chars()
        .take_while(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '.'))
        .collect();
    (!token.is_empty()).then_some(token)
}

/// Turns the newest crash report and logs into a plain-language explanation.
/// The rules only match well-known messages; anything else is reported as
/// "unknown" with the relevant excerpt instead of a guess.
pub fn diagnose(instance_id: &str) -> Result<Diagnosis, String> {
    let dir = instance_dir(instance_id)?;
    let crash = newest_file(&dir.join("crash-reports"), "txt");
    let launch_log = dir.join("logs").join("hearth-launch.log");
    let latest_log = dir.join("logs").join("latest.log");

    // Prefer whichever evidence is most recent.
    let mut sources: Vec<PathBuf> = [crash.clone(), Some(launch_log), Some(latest_log)]
        .into_iter()
        .flatten()
        .filter(|p| p.exists())
        .collect();
    sources.sort_by_key(|p| std::cmp::Reverse(modified_secs(p)));
    let Some(primary) = sources.first().cloned() else {
        return Ok(Diagnosis {
            title: "No crash found".into(),
            explanation: "This instance has no crash reports or logs yet.".into(),
            ..Default::default()
        });
    };
    let text: String = sources
        .iter()
        .take(2)
        .map(|p| read_lossy(p, 200_000))
        .collect::<Vec<_>>()
        .join("\n");

    let mut d = Diagnosis {
        found: true,
        source: Some(primary.to_string_lossy().to_string()),
        ..Default::default()
    };

    if text.contains("Incompatible mods found") || text.contains("Incompatible mod set") || text.contains("Mod resolution failed") {
        d.title = "Two or more mods don’t agree".into();
        d.explanation = "Fabric refused to start because some mods need a different version of another mod or of Minecraft.".into();
        d.suspects = lines_after(&text, "Incompatible mods found!", 10);
        if d.suspects.is_empty() {
            d.suspects = lines_after(&text, "Incompatible mod set!", 10);
        }
        d.fixes = vec![
            "Use “Update all mods” for this instance.".into(),
            "Remove the mods named below, or pick a Minecraft version they support.".into(),
        ];
    } else if text.contains("Found duplicate mod") || text.contains("duplicate mods") || text.contains("DuplicateModsFoundException") {
        d.title = "The same mod is installed twice".into();
        d.explanation = "Two jars of the same mod are in the mods folder.".into();
        d.fixes = vec!["Open the instance folder → mods and delete the older copy.".into()];
    } else if text.contains("java.lang.OutOfMemoryError") {
        d.title = "Minecraft ran out of memory".into();
        d.explanation = "Java hit its memory limit, often with Distant Horizons, shaders or big modpacks.".into();
        d.fixes = vec![
            "Raise the memory for this instance by 1–2 GB.".into(),
            "Lower the Distant Horizons radius or turn shaders off.".into(),
        ];
    } else if text.contains("UnsupportedClassVersionError") {
        d.title = "Wrong Java version for a mod".into();
        d.explanation = "A mod was built for a newer Java than this Minecraft version uses.".into();
        d.fixes = vec!["Remove the mod named below or use a matching release of it.".into()];
    } else if let Some(mod_id) = token_after(&text, "Mixin apply for mod ").or_else(|| token_after(&text, "mixin config ")) {
        d.title = "A mod failed to load".into();
        d.explanation = "A mod could not patch the game. Usually it is outdated or clashes with another mod.".into();
        d.suspects = vec![mod_id];
        d.fixes = vec!["Update all mods, then remove the suspect if it still fails.".into()];
    } else if text.contains("Pixel format not accelerated") || text.contains("GLFW error 65542") || text.contains("does not appear to support OpenGL") {
        d.title = "Graphics driver problem".into();
        d.explanation = "OpenGL could not start. The graphics driver is missing, outdated, or Minecraft started on the wrong GPU.".into();
        d.fixes = vec![
            "Update your NVIDIA/AMD/Intel driver from the vendor’s site.".into(),
            "Keep “Use the high-performance GPU” on in Hearth’s settings.".into(),
        ];
    } else if text.contains("EXCEPTION_ACCESS_VIOLATION") || text.contains("-1073741819") {
        d.title = "Native crash (driver or overlay)".into();
        d.explanation = "The game crashed outside Java. Common causes are GPU drivers, overlays (Discord, MSI Afterburner, RivaTuner) or shader packs.".into();
        d.fixes = vec![
            "Turn off overlays and try again.".into(),
            "Turn shaders off for one launch to test.".into(),
            "Update the graphics driver.".into(),
        ];
    } else if text.contains("Failed to compile") && text.to_lowercase().contains("shader") {
        d.title = "The shader pack failed to compile".into();
        d.explanation = "Iris could not build the selected shader pack on this GPU or version.".into();
        d.fixes = vec!["Pick another pack in Shaders, or update the pack.".into()];
    } else if let Some(missing) = token_after(&text, "requires any version of ").or_else(|| token_after(&text, "Could not find required mod: ")) {
        d.title = "A required mod is missing".into();
        d.explanation = "A mod needs another mod that isn’t installed.".into();
        d.suspects = vec![missing];
        d.fixes = vec!["Search for it in Mods and add it, or use “Update all mods”.".into()];
    } else {
        d.found = crash.is_some();
        d.title = if crash.is_some() { "Crash report found".into() } else { "No known problem found".into() };
        d.explanation = "Hearth didn’t recognise a known cause. The relevant part of the report is below.".into();
    }

    if d.suspects.is_empty() {
        if let Some(line) = text.lines().find(|l| l.contains("Suspected Mod")) {
            let mods = line.split(':').nth(1).unwrap_or_default().trim();
            if !mods.is_empty() && !mods.eq_ignore_ascii_case("none") {
                d.suspects = mods.split(',').map(|s| s.trim().to_string()).collect();
            }
        }
    }

    let excerpt_lines: Vec<&str> = text
        .lines()
        .filter(|l| {
            let lower = l.to_lowercase();
            lower.contains("exception") || lower.contains("error") || lower.contains("caused by") || lower.contains("description:")
        })
        .take(16)
        .collect();
    d.excerpt = excerpt_lines.join("\n");
    Ok(d)
}

// ---------------------------------------------------------------------------
// Modrinth modpacks (.mrpack)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackIndex {
    name: String,
    #[serde(default)]
    files: Vec<PackFile>,
    dependencies: std::collections::HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackFile {
    path: String,
    #[serde(default)]
    hashes: std::collections::HashMap<String, String>,
    #[serde(default)]
    env: Option<std::collections::HashMap<String, String>>,
    downloads: Vec<String>,
    #[serde(default)]
    file_size: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPack {
    pub name: String,
    pub version: String,
    pub loader: String,
    pub mods: Vec<InstalledMod>,
    pub file_count: usize,
}

/// Modrinth only allows these hosts in modpack download lists.
fn allowed_download(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest.split('/').next().unwrap_or_default();
    matches!(
        host,
        "cdn.modrinth.com" | "github.com" | "raw.githubusercontent.com" | "gitlab.com"
    )
}

pub async fn import_mrpack(instance_id: &str, bytes: Vec<u8>) -> Result<ImportedPack, String> {
    let dir = instance_dir(instance_id)?;
    let (index, overrides) = {
        let mut archive = ZipArchive::new(Cursor::new(bytes))
            .map_err(|_| "This file is not a Modrinth modpack (.mrpack).".to_string())?;
        let mut text = String::new();
        archive
            .by_name("modrinth.index.json")
            .map_err(|_| "modrinth.index.json is missing from this pack.".to_string())?
            .read_to_string(&mut text)
            .map_err(|e| e.to_string())?;
        let index: PackIndex =
            serde_json::from_str(&text).map_err(|e| format!("The pack index is invalid: {e}"))?;
        let mut overrides: Vec<(PathBuf, Vec<u8>)> = Vec::new();
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
            if entry.is_dir() {
                continue;
            }
            let name = entry.name().to_string();
            let relative = name
                .strip_prefix("client-overrides/")
                .or_else(|| name.strip_prefix("overrides/"));
            let Some(relative) = relative.and_then(safe_relative) else { continue };
            let mut data = Vec::new();
            entry.read_to_end(&mut data).map_err(|e| e.to_string())?;
            overrides.push((relative, data));
        }
        (index, overrides)
    };

    let version = index
        .dependencies
        .get("minecraft")
        .cloned()
        .ok_or("The pack does not say which Minecraft version it needs.")?;
    let loader = if index.dependencies.contains_key("fabric-loader") {
        "fabric"
    } else if index.dependencies.contains_key("quilt-loader") {
        "quilt"
    } else if index.dependencies.contains_key("neoforge") {
        "neoforge"
    } else if index.dependencies.contains_key("forge") {
        "forge"
    } else {
        "fabric"
    };

    let jobs: Vec<(PathBuf, String, Option<String>, Option<u64>)> = index
        .files
        .iter()
        .filter(|f| {
            f.env
                .as_ref()
                .and_then(|env| env.get("client"))
                .map_or(true, |side| side != "unsupported")
        })
        .filter_map(|f| {
            let relative = safe_relative(&f.path)?;
            let url = f.downloads.iter().find(|u| allowed_download(u))?.clone();
            Some((dir.join(relative), url, f.hashes.get("sha1").cloned(), f.file_size))
        })
        .collect();
    let file_count = jobs.len();
    stream::iter(jobs.into_iter().map(|(path, url, sha1, size)| async move {
        net::ensure_file(&url, &path, sha1.as_deref(), size).await
    }))
    .buffer_unordered(16)
    .try_collect::<Vec<()>>()
    .await?;

    // Overrides last, so pack-provided configs win.
    for (relative, data) in overrides {
        net::write_atomic(&dir.join(relative), &data).await?;
    }

    let mods = index
        .files
        .iter()
        .filter_map(|f| {
            let relative = safe_relative(&f.path)?;
            if relative.parent() != Some(Path::new("mods")) {
                return None;
            }
            let file_name = relative.file_name()?.to_string_lossy().to_string();
            let display = file_name.trim_end_matches(".jar").to_string();
            Some(InstalledMod {
                project_id: format!("pack:{file_name}"),
                slug: format!("pack:{file_name}"),
                name: display,
                version_number: None,
                file_name: Some(file_name),
                icon_url: None,
                status: "installed".into(),
            })
        })
        .collect();

    Ok(ImportedPack { name: index.name, version, loader: loader.into(), mods, file_count })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_escaping_paths() {
        assert!(safe_relative("../evil.jar").is_none());
        assert!(safe_relative("/etc/passwd").is_none());
        assert!(safe_relative("mods/../../x").is_none());
        assert_eq!(safe_relative("mods/a.jar"), Some(PathBuf::from("mods/a.jar")));
        assert!(safe_name("a/b").is_err());
        assert!(safe_name("..").is_err());
        assert!(safe_name("My World").is_ok());
    }

    #[test]
    fn download_hosts_are_limited() {
        assert!(allowed_download("https://cdn.modrinth.com/data/x/y.jar"));
        assert!(!allowed_download("https://evil.example/y.jar"));
        assert!(!allowed_download("http://cdn.modrinth.com/y.jar"));
    }

    #[test]
    fn stamp_shape() {
        let s = stamp();
        assert_eq!(s.len(), 15);
        assert_eq!(&s[8..9], "-");
    }

    #[test]
    fn crash_rules_find_known_causes() {
        let text = "Exception in thread \"main\" java.lang.OutOfMemoryError: Java heap space";
        assert!(text.contains("java.lang.OutOfMemoryError"));
        assert_eq!(token_after("Mixin apply for mod sodium failed", "Mixin apply for mod "), Some("sodium".into()));
        let lines = lines_after("Incompatible mods found!\n - Mod 'A' (a) 1.0 requires version 2 of 'B'\n\nother", "Incompatible mods found!", 5);
        assert_eq!(lines.len(), 1);
    }

    #[test]
    fn backup_roundtrip() {
        let base = std::env::temp_dir().join(format!("hearth-zip-{}", std::process::id()));
        let world = base.join("World");
        fs::create_dir_all(world.join("region")).unwrap();
        fs::write(world.join("level.dat"), b"data").unwrap();
        fs::write(world.join("region").join("r.0.0.mca"), vec![7u8; 4096]).unwrap();
        fs::write(world.join("session.lock"), b"lock").unwrap();
        let target = base.join("w.zip");
        zip_dir(&world, &target).unwrap();
        let mut archive = ZipArchive::new(fs::File::open(&target).unwrap()).unwrap();
        let names: Vec<String> = (0..archive.len()).map(|i| archive.by_index(i).unwrap().name().to_string()).collect();
        assert!(names.contains(&"World/level.dat".to_string()));
        assert!(names.contains(&"World/region/r.0.0.mca".to_string()));
        assert!(!names.iter().any(|n| n.ends_with("session.lock")));
        let _ = fs::remove_dir_all(base);
    }
}
