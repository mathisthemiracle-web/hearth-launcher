//! Bridge to the official Minecraft Launcher.
//!
//! Until Mojang approves Hearth's own client ID, the player can still use
//! Hearth's instances: Hearth installs the Fabric version profile into
//! `.minecraft/versions` and adds an installation to the official launcher that
//! points at the Hearth instance folder, with Hearth's memory and JVM flags.
//! The official launcher handles sign-in, vanilla files and Java.

use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::Engine;
use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::{config, game, models::Instance, storage::instance_dir};

const ICON_PNG: &[u8] = include_bytes!("../icons/icon.png");

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialLinkResult {
    pub profile_name: String,
    pub version_id: String,
    pub minecraft_dir: String,
    pub launcher_found: bool,
}

fn minecraft_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    let base = dirs::data_dir().map(|d| d.join("minecraft"));
    #[cfg(not(target_os = "macos"))]
    let base = dirs::data_dir().map(|d| d.join(".minecraft"));
    base.ok_or_else(|| "Could not locate the .minecraft folder.".into())
}

pub(crate) fn iso_now() -> String {
    // RFC 3339 in UTC without pulling in a date crate.
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // Civil-from-days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.000Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

fn launcher_installed() -> bool {
    #[cfg(windows)]
    {
        let legacy = [
            r"C:\Program Files (x86)\Minecraft Launcher\MinecraftLauncher.exe",
            r"C:\Program Files\Minecraft Launcher\MinecraftLauncher.exe",
        ];
        if legacy.iter().any(|p| Path::new(p).exists()) {
            return true;
        }
        if let Some(local) = dirs::data_local_dir() {
            if local.join("Packages").join("Microsoft.4297127D64EC6_8wekyb3d8bbwe").exists() {
                return true;
            }
        }
        false
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn update_profiles_file(path: &Path, key: &str, profile: &Value) -> Result<(), String> {
    let mut root: Value = match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text)
            .map_err(|e| format!("{} is not valid JSON: {e}", path.display()))?,
        Err(_) => json!({ "profiles": {}, "settings": {}, "version": 3 }),
    };
    if path.exists() {
        let backup = path.with_extension("json.hearth-backup");
        if !backup.exists() {
            let _ = fs::copy(path, &backup);
        }
    }
    if !root.is_object() {
        root = json!({});
    }
    let object = root.as_object_mut().expect("object");
    let profiles = object
        .entry("profiles")
        .or_insert_with(|| Value::Object(Map::new()));
    if !profiles.is_object() {
        *profiles = Value::Object(Map::new());
    }
    let profiles = profiles.as_object_mut().expect("object");
    let mut entry = profile.clone();
    if let Some(created) = profiles.get(key).and_then(|p| p.get("created")).cloned() {
        entry["created"] = created;
    }
    profiles.insert(key.to_string(), entry);
    let text = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| format!("Could not update {}: {e}", path.display()))
}

pub async fn link_instance(instance: &Instance) -> Result<OfficialLinkResult, String> {
    if !game::launchable(&instance.loader) {
        return Err("The official-launcher bridge supports Fabric and Quilt instances.".into());
    }
    config::apply_game_config(instance)?;

    let (fabric, _loader) = game::loader_profile(&instance.version, &instance.loader).await?;
    let version_id = fabric["id"]
        .as_str()
        .ok_or("The loader returned a profile without an ID.")?
        .to_string();
    let base = game::version_json(&instance.version).await?;
    let java_major = base["javaVersion"]["majorVersion"].as_u64().unwrap_or(21);

    let mc = minecraft_dir()?;
    let version_dir = mc.join("versions").join(&version_id);
    fs::create_dir_all(&version_dir).map_err(|e| format!("Could not create {}: {e}", version_dir.display()))?;
    let profile_text = serde_json::to_string_pretty(&fabric).map_err(|e| e.to_string())?;
    fs::write(version_dir.join(format!("{version_id}.json")), profile_text)
        .map_err(|e| format!("Could not install the Fabric profile: {e}"))?;
    let jar = version_dir.join(format!("{version_id}.jar"));
    if !jar.exists() {
        // The launcher expects a jar next to the JSON; Fabric's is intentionally empty.
        let _ = fs::write(&jar, []);
    }

    let game_dir = instance_dir(&instance.id)?;
    let java_args = game::performance_jvm_args(instance.memory_gb, java_major, instance.gc.as_deref())
        .into_iter()
        .filter(|arg| arg != "-Dfile.encoding=UTF-8")
        .collect::<Vec<_>>()
        .join(" ");
    let profile_name = format!("Hearth · {}", instance.name);
    let now = iso_now();
    let icon = format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(ICON_PNG)
    );
    let profile = json!({
        "name": profile_name,
        "type": "custom",
        "created": now,
        "lastUsed": now,
        "icon": icon,
        "lastVersionId": version_id,
        "gameDir": game_dir.to_string_lossy(),
        "javaArgs": java_args,
    });

    let key = format!("hearth-{}", instance.id);
    let mut written = false;
    for name in ["launcher_profiles.json", "launcher_profiles_microsoft_store.json"] {
        let path = mc.join(name);
        if path.exists() {
            update_profiles_file(&path, &key, &profile)?;
            written = true;
        }
    }
    if !written {
        fs::create_dir_all(&mc).map_err(|e| e.to_string())?;
        update_profiles_file(&mc.join("launcher_profiles.json"), &key, &profile)?;
    }

    Ok(OfficialLinkResult {
        profile_name,
        version_id,
        minecraft_dir: mc.to_string_lossy().to_string(),
        launcher_found: launcher_installed(),
    })
}

pub fn open_launcher() -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::process::Command;
        for exe in [
            r"C:\Program Files (x86)\Minecraft Launcher\MinecraftLauncher.exe",
            r"C:\Program Files\Minecraft Launcher\MinecraftLauncher.exe",
        ] {
            if Path::new(exe).exists() {
                return Command::new(exe)
                    .spawn()
                    .map(|_| ())
                    .map_err(|e| format!("Could not open the Minecraft Launcher: {e}"));
            }
        }
        Command::new("explorer.exe")
            .arg(r"shell:AppsFolder\Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft")
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Could not open the Minecraft Launcher: {e}"))
    }
    #[cfg(not(windows))]
    {
        Err("Opening the official launcher is available on Windows.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_now_has_expected_shape() {
        let value = iso_now();
        assert_eq!(value.len(), 24);
        assert!(value.ends_with('Z'));
        assert!(value.starts_with("20"));
    }

    #[test]
    fn profiles_file_keeps_other_entries() {
        let dir = std::env::temp_dir().join(format!("hearth-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("launcher_profiles.json");
        fs::write(&path, r#"{"profiles":{"abc":{"name":"Latest"}},"settings":{"x":1},"version":3}"#).unwrap();
        update_profiles_file(&path, "hearth-1", &json!({"name":"Hearth · A","created":"new"})).unwrap();
        update_profiles_file(&path, "hearth-1", &json!({"name":"Hearth · B","created":"newer"})).unwrap();
        let root: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(root["profiles"]["abc"]["name"], "Latest");
        assert_eq!(root["settings"]["x"], 1);
        assert_eq!(root["profiles"]["hearth-1"]["name"], "Hearth · B");
        assert_eq!(root["profiles"]["hearth-1"]["created"], "new");
        assert!(dir.join("launcher_profiles.json.hearth-backup").exists());
        let _ = fs::remove_dir_all(dir);
    }
}
