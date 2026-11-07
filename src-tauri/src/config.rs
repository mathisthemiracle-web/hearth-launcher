//! Writes an instance's choices into the files Minecraft and its mods read:
//! `options.txt`, Iris' `iris.properties` and Distant Horizons' TOML.
//! Existing lines the player changed in-game are preserved.

use std::{fs, path::Path};

use crate::{models::Instance, storage::instance_dir};

/// Starting values for a brand-new instance only. After the first launch the
/// player's own in-game choices win, except for the two distance sliders that
/// Hearth exposes directly.
const FRESH_OPTIONS: &[(&str, &str)] = &[
    ("maxFps", "260"),        // 260 = "Unlimited" in the video settings
    ("enableVsync", "false"),
    ("biomeBlendRadius", "1"),
    ("mipmapLevels", "4"),
    ("prioritizeChunkUpdates", "0"),
    ("entityDistanceScaling", "1.0"),
    ("onboardAccessibility", "false"),
    ("skipMultiplayerWarning", "true"),
];

/// "FPS boost" trades a few visual extras for frame rate. Applied on every
/// launch while the switch is on; turning it off leaves the values as they are
/// so the player can restore what they like in-game.
const FPS_BOOST: &[(&str, &str)] = &[
    ("graphicsMode", "0"),
    ("particles", "2"),
    ("entityShadows", "false"),
    ("renderClouds", "\"false\""),
    ("ao", "false"),
    ("biomeBlendRadius", "0"),
    ("mipmapLevels", "0"),
    ("entityDistanceScaling", "0.75"),
];

fn json_string_list(items: &[String]) -> String {
    serde_json::to_string(items).unwrap_or_else(|_| "[]".into())
}

fn upsert(text: &str, separator: &str, pairs: &[(&str, String)]) -> String {
    let mut lines: Vec<String> = text
        .lines()
        .filter(|line| {
            !pairs
                .iter()
                .any(|(key, _)| line.trim_start().starts_with(&format!("{key}{separator}")))
        })
        .map(str::to_string)
        .collect();
    for (key, value) in pairs {
        lines.push(format!("{key}{separator}{value}"));
    }
    lines.join("\n") + "\n"
}

fn write_options(dir: &Path, instance: &Instance) -> Result<(), String> {
    let path = dir.join("options.txt");
    let existing = fs::read_to_string(&path).ok();
    let mut pairs: Vec<(&str, String)> = Vec::new();
    if existing.is_none() {
        pairs.extend(FRESH_OPTIONS.iter().map(|(k, v)| (*k, v.to_string())));
    }
    pairs.push(("renderDistance", instance.render_distance.clamp(2, 32).to_string()));
    pairs.push((
        "simulationDistance",
        instance.simulation_distance.clamp(5, 32).to_string(),
    ));
    if instance.fps_boost {
        pairs.extend(FPS_BOOST.iter().map(|(k, v)| (*k, v.to_string())));
    }
    // Minecraft lists packs bottom-to-top; Hearth stores them top-first.
    let packs_dir = dir.join("resourcepacks");
    let mut packs: Vec<String> = instance
        .resource_packs
        .iter()
        .filter(|name| !name.contains('/') && !name.contains('\\') && packs_dir.join(name.as_str()).exists())
        .rev()
        .map(|name| format!("file/{name}"))
        .collect();
    if !instance.resource_packs.is_empty() || existing.as_deref().is_some_and(|t| t.contains("file/")) {
        let mut list = vec!["vanilla".to_string()];
        if instance.mods.iter().any(|m| m.slug == "fabric-api") {
            list.push("fabric".to_string());
        }
        list.append(&mut packs);
        pairs.push(("resourcePacks", json_string_list(&list)));
    }
    let text = upsert(existing.as_deref().unwrap_or_default(), ":", &pairs);
    fs::write(&path, text).map_err(|error| format!("Could not save options.txt: {error}"))
}

fn normalise(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase()
}

/// Older Hearth builds stored the pack's display title instead of its file
/// name, which Iris cannot use. Map either form to a real file in shaderpacks/.
fn resolve_shader_file(dir: &Path, wanted: &str) -> Option<String> {
    let folder = dir.join("shaderpacks");
    if folder.join(wanted).is_file() {
        return Some(wanted.to_string());
    }
    let first_word = normalise(wanted.split_whitespace().next().unwrap_or(wanted));
    if first_word.is_empty() {
        return None;
    }
    fs::read_dir(folder)
        .ok()?
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| !name.starts_with('.'))
        .find(|name| normalise(name).contains(&first_word))
}

fn write_iris(dir: &Path, instance: &Instance) -> Result<(), String> {
    let has_iris = instance.mods.iter().any(|m| m.slug == "iris");
    if !has_iris {
        return Ok(());
    }
    let config = dir.join("config");
    fs::create_dir_all(&config).map_err(|e| e.to_string())?;
    let path = config.join("iris.properties");
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let mut pairs = vec![("enableShaders", instance.shaders_enabled.to_string())];
    if let Some(pack) = instance
        .shader_pack
        .as_deref()
        .and_then(|wanted| resolve_shader_file(dir, wanted))
    {
        pairs.push(("shaderPack", pack));
    }
    fs::write(&path, upsert(&existing, "=", &pairs))
        .map_err(|e| format!("Could not save Iris settings: {e}"))
}

/// Distant Horizons creates its TOML on first start. Hearth only replaces the
/// LOD radius value when the key is already there, so it never writes a file
/// layout the installed Distant Horizons version does not expect.
fn write_distant_horizons(dir: &Path, instance: &Instance) -> Result<(), String> {
    if instance.lod_distance == 0 || !instance.mods.iter().any(|m| matches!(m.slug.as_str(), "distanthorizons" | "distant-horizons")) {
        return Ok(());
    }
    let path = dir.join("config").join("DistantHorizons.toml");
    let Ok(text) = fs::read_to_string(&path) else {
        return Ok(());
    };
    let key = "lodChunkRenderDistanceRadius";
    if !text.contains(key) {
        return Ok(());
    }
    let updated: Vec<String> = text
        .lines()
        .map(|line| {
            let trimmed = line.trim_start();
            if trimmed.starts_with(key) && trimmed[key.len()..].trim_start().starts_with('=') {
                let indent = &line[..line.len() - trimmed.len()];
                format!("{indent}{key} = {}", instance.lod_distance.clamp(32, 4096))
            } else {
                line.to_string()
            }
        })
        .collect();
    fs::write(&path, updated.join("\n") + "\n")
        .map_err(|e| format!("Could not save Distant Horizons settings: {e}"))
}

pub fn apply_game_config(instance: &Instance) -> Result<(), String> {
    let dir = instance_dir(&instance.id)?;
    write_options(&dir, instance)?;
    write_iris(&dir, instance)?;
    write_distant_horizons(&dir, instance)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_keeps_unrelated_lines_and_replaces_keys() {
        let text = "version:3955\nrenderDistance:12\nfov:0.5\n";
        let out = upsert(text, ":", &[("renderDistance", "16".into()), ("maxFps", "260".into())]);
        assert!(out.contains("version:3955"));
        assert!(out.contains("fov:0.5"));
        assert!(out.contains("renderDistance:16"));
        assert!(!out.contains("renderDistance:12"));
        assert!(out.contains("maxFps:260"));
    }

    #[test]
    fn upsert_does_not_touch_keys_with_shared_prefix() {
        let out = upsert("renderDistanceScale:2\n", ":", &[("renderDistance", "8".into())]);
        assert!(out.contains("renderDistanceScale:2"));
    }

    #[test]
    fn pack_list_is_json() {
        assert_eq!(json_string_list(&["vanilla".into(), "file/A B.zip".into()]), r#"["vanilla","file/A B.zip"]"#);
    }

    #[test]
    fn normalise_matches_titles_to_files() {
        assert!(normalise("ComplementaryReimagined_r5.5.1.zip").contains(&normalise("Complementary")));
    }
}
