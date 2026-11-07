use std::{fs, path::PathBuf};

use crate::models::LauncherState;

pub fn hearth_dir() -> Result<PathBuf, String> {
    let base =
        dirs::data_dir().ok_or_else(|| "Could not locate the app-data folder.".to_string())?;
    let path = base.join("Hearth");
    fs::create_dir_all(&path)
        .map_err(|error| format!("Could not create Hearth’s data folder: {error}"))?;
    Ok(path)
}

fn state_path() -> Result<PathBuf, String> {
    Ok(hearth_dir()?.join("launcher-state.json"))
}

pub fn load_state() -> Result<Option<LauncherState>, String> {
    let path = state_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read saved settings: {error}"))?;
    let state = serde_json::from_str(&text)
        .map_err(|error| format!("Saved settings are not valid JSON: {error}"))?;
    Ok(Some(state))
}

pub fn save_state(state: &LauncherState) -> Result<(), String> {
    let path = state_path()?;
    let text = serde_json::to_string_pretty(state)
        .map_err(|error| format!("Could not encode settings: {error}"))?;
    fs::write(&path, text).map_err(|error| format!("Could not save settings: {error}"))?;
    Ok(())
}

pub fn instance_dir(instance_id: &str) -> Result<PathBuf, String> {
    if instance_id.is_empty()
        || !instance_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("The instance ID is unsafe to use as a folder name.".into());
    }
    let path = hearth_dir()?.join("instances").join(instance_id);
    fs::create_dir_all(&path)
        .map_err(|error| format!("Could not create the instance folder: {error}"))?;
    Ok(path)
}
