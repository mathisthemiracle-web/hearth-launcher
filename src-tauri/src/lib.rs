mod auth;
mod config;
mod official;
mod game;
mod library;
mod models;
mod modrinth;
mod net;
mod storage;

use std::{process::Command, sync::Mutex};

use models::{
    GameVersion, InstalledMod, Instance, LaunchReport, LauncherState, PresetInstallResult,
    ProjectSearchResult, SystemInfo,
};
use storage::{instance_dir, load_state, save_state as write_state};
use tauri::{AppHandle, Emitter, Manager};

#[tauri::command]
fn get_state() -> Result<Option<LauncherState>, String> {
    load_state()
}

#[tauri::command]
async fn save_state(state: LauncherState) -> Result<(), String> {
    if state.instances.is_empty() {
        return Err("Hearth needs at least one instance.".into());
    }
    if !state
        .instances
        .iter()
        .any(|instance| instance.id == state.active_instance_id)
    {
        return Err("The active instance no longer exists.".into());
    }
    // Disk work happens off the UI thread so typing and sliders stay smooth.
    tauri::async_runtime::spawn_blocking(move || write_state(&state))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn search_projects(
    query: String,
    version: String,
    loader: String,
    project_type: String,
) -> Result<Vec<ProjectSearchResult>, String> {
    modrinth::search_projects(query, version, loader, project_type).await
}

#[tauri::command]
async fn install_project(
    instance: Instance,
    project: ProjectSearchResult,
) -> Result<InstalledMod, String> {
    if !matches!(project.project_type.as_str(), "mod" | "shader" | "resourcepack") {
        return Err("This project type is not supported.".into());
    }
    modrinth::install_project(&instance, &project).await
}

#[tauri::command]
async fn install_preset_mods(instance: Instance) -> Result<PresetInstallResult, String> {
    if !game::launchable(&instance.loader) {
        return Err("Hearth installs presets for Fabric and Quilt instances.".into());
    }
    modrinth::install_all(&instance).await
}

#[tauri::command]
fn remove_mod(instance: Instance, mod_info: InstalledMod) -> Result<(), String> {
    if let Some(filename) = mod_info.file_name {
        let safe_name = std::path::Path::new(&filename)
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "The mod filename is unsafe.".to_string())?;
        if safe_name != filename {
            return Err("The mod filename contains a path.".into());
        }
        let dir = instance_dir(&instance.id)?;
        for folder in ["mods", "shaderpacks"] {
            let path = dir.join(folder).join(safe_name);
            if path.exists() {
                std::fs::remove_file(&path)
                    .map_err(|error| format!("Could not remove the file: {error}"))?;
            }
        }
        modrinth::forget_managed(&instance.id, safe_name);
    }
    Ok(())
}

#[tauri::command]
fn get_account() -> Result<Option<auth::AccountInfo>, String> {
    auth::current_account()
}

#[tauri::command]
async fn begin_microsoft_login(client_id: String) -> Result<auth::DeviceCodeInfo, String> {
    auth::begin_sign_in(client_id).await
}

#[tauri::command]
async fn complete_microsoft_login(
    client_id: String,
    device_code: String,
    interval: u64,
    expires_in: Option<u64>,
) -> Result<auth::AccountInfo, String> {
    auth::finish_sign_in(client_id, device_code, interval, expires_in.unwrap_or(900)).await
}

#[tauri::command]
fn cancel_microsoft_login() {
    auth::cancel_sign_in();
}

#[tauri::command]
fn microsoft_sign_out() -> Result<(), String> {
    auth::sign_out()
}

#[tauri::command]
async fn list_versions() -> Result<Vec<GameVersion>, String> {
    game::list_versions().await
}

#[tauri::command]
fn system_info() -> SystemInfo {
    let mut system = sysinfo::System::new();
    system.refresh_memory();
    let bytes = system.total_memory();
    SystemInfo {
        total_ram_gb: ((bytes as f64) / 1_073_741_824.0).round() as u16,
        cpu_threads: std::thread::available_parallelism()
            .map(|n| n.get() as u16)
            .unwrap_or(4),
    }
}

#[tauri::command]
async fn launch_instance(
    app: AppHandle,
    instance: Instance,
    client_id: String,
    boost_priority: Option<bool>,
    gpu_high_performance: Option<bool>,
) -> Result<LaunchReport, String> {
    config::apply_game_config(&instance)?;
    let Some(session) = auth::valid_session(&client_id).await? else {
        return Ok(LaunchReport {
            can_launch: false,
            checks: vec![models::LaunchCheck {
                label: "Microsoft account".into(),
                ready: false,
                detail: "Sign in with a Microsoft account that owns Minecraft: Java Edition."
                    .into(),
            }],
            message: "Sign in from Settings before starting Minecraft.".into(),
        });
    };
    game::launch(
        app,
        instance,
        session,
        boost_priority.unwrap_or(true),
        gpu_high_performance.unwrap_or(true),
    )
    .await
}

#[tauri::command]
async fn link_official_launcher(instance: Instance) -> Result<official::OfficialLinkResult, String> {
    official::link_instance(&instance).await
}

#[tauri::command]
fn open_official_launcher() -> Result<(), String> {
    official::open_launcher()
}

static PREFETCHING: Mutex<Vec<String>> = Mutex::new(Vec::new());

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PrefetchDone {
    instance_id: String,
    ok: bool,
    message: String,
}

/// Warms an instance in the background (game files, assets, Java) so the
/// first Play only has to start the game.
#[tauri::command]
fn prefetch_instance(app: AppHandle, instance: Instance) {
    if !game::launchable(&instance.loader) {
        return;
    }
    {
        let mut running = PREFETCHING.lock().unwrap_or_else(|p| p.into_inner());
        if running.contains(&instance.id) {
            return;
        }
        running.push(instance.id.clone());
    }
    tauri::async_runtime::spawn(async move {
        let result = game::prepare(&app, &instance).await;
        PREFETCHING
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .retain(|id| id != &instance.id);
        let _ = app.emit(
            "prefetch-done",
            PrefetchDone {
                instance_id: instance.id.clone(),
                ok: result.is_ok(),
                message: result.err().unwrap_or_default(),
            },
        );
    });
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_worlds(instance_id: String) -> Result<Vec<library::WorldInfo>, String> {
    blocking(move || library::list_worlds(&instance_id)).await
}

#[tauri::command]
async fn list_backups(instance_id: String) -> Result<Vec<library::BackupInfo>, String> {
    blocking(move || library::list_backups(&instance_id)).await
}

#[tauri::command]
async fn backup_world(instance_id: String, world: String) -> Result<library::BackupInfo, String> {
    blocking(move || library::backup_world(&instance_id, &world, false)).await
}

#[tauri::command]
async fn backup_all_worlds(instance_id: String) -> Result<usize, String> {
    blocking(move || library::backup_all(&instance_id)).await
}

#[tauri::command]
async fn restore_backup(instance_id: String, file: String) -> Result<String, String> {
    blocking(move || library::restore_backup(&instance_id, &file)).await
}

#[tauri::command]
async fn delete_backup(instance_id: String, file: String) -> Result<(), String> {
    blocking(move || library::delete_backup(&instance_id, &file)).await
}

#[tauri::command]
async fn list_screenshots(instance_id: String) -> Result<Vec<library::Screenshot>, String> {
    blocking(move || library::list_screenshots(&instance_id)).await
}

#[tauri::command]
async fn diagnose_instance(instance_id: String) -> Result<library::Diagnosis, String> {
    blocking(move || library::diagnose(&instance_id)).await
}

#[tauri::command]
async fn import_mrpack(instance_id: String, bytes: Vec<u8>) -> Result<library::ImportedPack, String> {
    library::import_mrpack(&instance_id, bytes).await
}

fn open_path(path: &std::path::Path) -> Result<(), String> {
    let _ = std::fs::create_dir_all(path);
    #[cfg(target_os = "windows")]
    let result = Command::new("explorer").arg(path).spawn();
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(path).spawn();
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(path).spawn();
    result
        .map(|_| ())
        .map_err(|error| format!("Could not open the folder: {error}"))
}

/// Opens a known sub-folder of an instance (mods, saves, screenshots…).
#[tauri::command]
fn open_instance_subfolder(instance_id: String, folder: String) -> Result<(), String> {
    let allowed = ["", "mods", "saves", "screenshots", "backups", "resourcepacks", "shaderpacks", "crash-reports", "logs", "config"];
    if !allowed.contains(&folder.as_str()) {
        return Err("That folder is not part of an instance.".into());
    }
    let base = instance_dir(&instance_id)?;
    open_path(&if folder.is_empty() { base } else { base.join(folder) })
}

#[tauri::command]
fn open_instance_folder(instance: Instance) -> Result<(), String> {
    let path = instance_dir(&instance.id)?;
    #[cfg(target_os = "windows")]
    let result = Command::new("explorer").arg(&path).spawn();
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(&path).spawn();
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(&path).spawn();
    result
        .map(|_| ())
        .map_err(|error| format!("Could not open the instance folder: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Warm the HTTP client and version list in the background so the
            // first click on Play or New instance does not wait for TLS setup.
            tauri::async_runtime::spawn(async {
                let _ = game::list_versions().await;
            });
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            save_state,
            get_account,
            begin_microsoft_login,
            complete_microsoft_login,
            cancel_microsoft_login,
            microsoft_sign_out,
            search_projects,
            install_project,
            install_preset_mods,
            remove_mod,
            launch_instance,
            open_instance_folder,
            list_versions,
            system_info,
            link_official_launcher,
            open_official_launcher,
            prefetch_instance,
            list_worlds,
            list_backups,
            backup_world,
            backup_all_worlds,
            restore_backup,
            delete_backup,
            list_screenshots,
            diagnose_instance,
            import_mrpack,
            open_instance_subfolder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Hearth");
}
