use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledMod {
    pub project_id: String,
    pub slug: String,
    pub name: String,
    pub version_number: Option<String>,
    pub file_name: Option<String>,
    pub icon_url: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub id: String,
    pub name: String,
    pub version: String,
    pub loader: String,
    pub preset_id: Option<String>,
    pub memory_gb: u16,
    pub render_distance: u16,
    pub simulation_distance: u16,
    pub shaders_enabled: bool,
    pub shader_pack: Option<String>,
    pub lod_distance: u32,
    /// "g1" (default, works on every Java) or "zgc" (Java 21+, lowest pauses).
    #[serde(default)]
    pub gc: Option<String>,
    /// Lower-cost video settings written on every launch (particles, clouds…).
    #[serde(default)]
    pub fps_boost: bool,
    /// Enabled resource pack file names, in priority order (first = top).
    #[serde(default)]
    pub resource_packs: Vec<String>,
    #[serde(default)]
    pub playtime_seconds: u64,
    #[serde(default)]
    pub launches: u32,
    pub mods: Vec<InstalledMod>,
    pub created_at: String,
    pub last_played: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherSettings {
    pub theme: String,
    pub close_on_launch: bool,
    pub download_threads: u8,
    pub system_ram_gb: u16,
    pub reduce_motion: bool,
    #[serde(default)]
    pub microsoft_client_id: String,
    /// Start Minecraft with "above normal" Windows priority.
    #[serde(default = "default_true")]
    pub boost_priority: bool,
    #[serde(default = "default_true")]
    pub gpu_high_performance: bool,
    #[serde(default = "default_true")]
    pub auto_backup: bool,
    #[serde(default)]
    pub sounds: bool,
    #[serde(default = "default_language")]
    pub language: String,
}

fn default_true() -> bool {
    true
}

fn default_language() -> String {
    "en".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherState {
    pub instances: Vec<Instance>,
    pub active_instance_id: String,
    pub settings: LauncherSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSearchResult {
    pub project_id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub author: String,
    pub icon_url: String,
    pub downloads: u64,
    pub project_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchCheck {
    pub label: String,
    pub ready: bool,
    pub detail: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchReport {
    pub can_launch: bool,
    pub checks: Vec<LaunchCheck>,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetInstallResult {
    pub mods: Vec<InstalledMod>,
    /// Human-readable notes for mods that have no release for this version.
    pub skipped: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub total_ram_gb: u16,
    pub cpu_threads: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameVersion {
    pub id: String,
    pub release_time: String,
}
