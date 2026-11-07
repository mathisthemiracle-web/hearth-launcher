use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::Mutex,
};

use async_recursion::async_recursion;
use futures_util::{stream, StreamExt};
use serde::Deserialize;

use crate::{
    models::{InstalledMod, Instance, PresetInstallResult, ProjectSearchResult},
    net,
    storage::instance_dir,
};

const API_ROOT: &str = "https://api.modrinth.com/v2";
const MANAGED_FILE: &str = ".hearth-managed.json";

/// Serialises read-modify-write of each instance's managed-files list.
static MANAGED_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Deserialize)]
struct SearchResponse {
    hits: Vec<SearchHit>,
}

#[derive(Debug, Deserialize)]
struct SearchHit {
    project_id: String,
    slug: String,
    title: String,
    description: String,
    author: String,
    #[serde(default)]
    icon_url: Option<String>,
    downloads: u64,
    project_type: String,
}

pub async fn search_projects(
    query: String,
    version: String,
    loader: String,
    project_type: String,
) -> Result<Vec<ProjectSearchResult>, String> {
    if !matches!(project_type.as_str(), "mod" | "shader" | "resourcepack") {
        return Err("Only mods, shader packs and resource packs can be searched.".into());
    }
    let mut facets = vec![
        vec![format!("project_type:{project_type}")],
        vec![format!("versions:{version}")],
    ];
    if project_type == "mod" {
        if loader == "quilt" {
            facets.push(vec!["categories:quilt".to_string(), "categories:fabric".to_string()]);
        } else {
            facets.push(vec![format!("categories:{loader}")]);
        }
        facets.push(vec![
            "client_side:required".to_string(),
            "client_side:optional".to_string(),
        ]);
    }
    let index = if query.trim().is_empty() {
        "downloads"
    } else {
        "relevance"
    };
    let response = net::client()
        .get(format!("{API_ROOT}/search"))
        .query(&[
            ("query", query.trim()),
            ("limit", "20"),
            ("index", index),
            (
                "facets",
                &serde_json::to_string(&facets).map_err(|error| error.to_string())?,
            ),
        ])
        .send()
        .await
        .map_err(|error| format!("Could not reach Modrinth: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Modrinth search returned {}.", response.status()));
    }
    let results = response
        .json::<SearchResponse>()
        .await
        .map_err(|error| format!("Could not read Modrinth’s response: {error}"))?;
    Ok(results
        .hits
        .into_iter()
        .map(|hit| ProjectSearchResult {
            project_id: hit.project_id,
            slug: hit.slug,
            title: hit.title,
            description: hit.description,
            author: hit.author,
            icon_url: hit.icon_url.unwrap_or_default(),
            downloads: hit.downloads,
            project_type: hit.project_type,
        })
        .collect())
}

#[derive(Debug, Deserialize)]
struct ModrinthVersion {
    id: String,
    project_id: String,
    version_number: String,
    #[serde(default)]
    version_type: String,
    files: Vec<VersionFile>,
    dependencies: Vec<VersionDependency>,
}

#[derive(Debug, Deserialize)]
struct VersionFile {
    url: String,
    filename: String,
    primary: bool,
    #[serde(default)]
    hashes: HashMap<String, String>,
    #[serde(default)]
    size: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct VersionDependency {
    project_id: Option<String>,
    dependency_type: String,
}

async fn fetch_versions(
    project: &str,
    game_version: &str,
    loaders: Option<&[&str]>,
) -> Result<Vec<ModrinthVersion>, String> {
    let game_versions =
        serde_json::to_string(&[game_version]).map_err(|error| error.to_string())?;
    let mut request = net::client()
        .get(format!("{API_ROOT}/project/{project}/version"))
        .query(&[("game_versions", game_versions)]);
    if let Some(loaders) = loaders {
        let loaders = serde_json::to_string(loaders).map_err(|error| error.to_string())?;
        request = request.query(&[("loaders", loaders)]);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("Could not resolve {project}: {error}"))?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(format!("{project} does not exist on Modrinth."));
    }
    if !response.status().is_success() {
        return Err(format!(
            "Modrinth returned {} while resolving {project}.",
            response.status()
        ));
    }
    response
        .json::<Vec<ModrinthVersion>>()
        .await
        .map_err(|error| format!("Could not read releases for {project}: {error}"))
}

fn read_managed(dir: &Path) -> HashMap<String, String> {
    std::fs::read_to_string(dir.join(MANAGED_FILE))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Records which file Hearth installed for a project and deletes the file it
/// replaces. Without this, updating a mod left the old jar next to the new one
/// and Fabric refused to start with a duplicate-mod error.
fn record_managed(dir: &Path, key: &str, folder: &Path, filename: &str) {
    let _guard = MANAGED_LOCK.lock().unwrap_or_else(|poison| poison.into_inner());
    let mut managed = read_managed(dir);
    if let Some(previous) = managed.get(key) {
        if previous != filename {
            let _ = std::fs::remove_file(folder.join(previous));
        }
    }
    managed.insert(key.to_string(), filename.to_string());
    if let Ok(text) = serde_json::to_string_pretty(&managed) {
        let _ = std::fs::write(dir.join(MANAGED_FILE), text);
    }
}

pub fn forget_managed(instance_id: &str, filename: &str) {
    let Ok(dir) = instance_dir(instance_id) else {
        return;
    };
    let _guard = MANAGED_LOCK.lock().unwrap_or_else(|poison| poison.into_inner());
    let mut managed = read_managed(&dir);
    managed.retain(|_, value| value != filename);
    if let Ok(text) = serde_json::to_string_pretty(&managed) {
        let _ = std::fs::write(dir.join(MANAGED_FILE), text);
    }
}

#[async_recursion]
async fn download_project(
    instance: &Instance,
    project: &str,
    project_type: &str,
    visited: &mut HashSet<String>,
) -> Result<InstalledMod, String> {
    if !visited.insert(format!("{project_type}:{project}")) {
        return Ok(InstalledMod {
            project_id: project.into(),
            slug: project.into(),
            name: project.into(),
            version_number: None,
            file_name: None,
            icon_url: None,
            status: "installed".into(),
        });
    }

    let versions = if project_type == "shader" {
        // Prefer releases tagged for Iris; fall back to any shader release.
        let iris = fetch_versions(project, &instance.version, Some(&["iris"])).await?;
        if iris.is_empty() {
            fetch_versions(project, &instance.version, None).await?
        } else {
            iris
        }
    } else if project_type == "resourcepack" {
        fetch_versions(project, &instance.version, None).await?
    } else if instance.loader == "quilt" {
        // Quilt runs most Fabric mods; prefer native Quilt builds when present.
        fetch_versions(project, &instance.version, Some(&["quilt", "fabric"])).await?
    } else {
        fetch_versions(project, &instance.version, Some(&[instance.loader.as_str()])).await?
    };
    // Prefer a stable release; use betas only when nothing stable exists.
    let mut versions = versions;
    let index = versions
        .iter()
        .position(|v| v.version_type == "release")
        .unwrap_or(0);
    if versions.is_empty() {
        return Err(format!(
            "{project} has no release for Minecraft {} with {}.",
            instance.version, instance.loader
        ));
    }
    let version = versions.swap_remove(index);
    let file = version
        .files
        .iter()
        .find(|file| file.primary)
        .or_else(|| version.files.first())
        .ok_or_else(|| format!("{} has no downloadable file.", version.id))?;
    let filename = Path::new(&file.filename)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("{project} returned an unsafe filename."))?;
    if filename != file.filename {
        return Err(format!("{project} returned a filename containing a path."));
    }

    let folder_name = match project_type {
        "shader" => "shaderpacks",
        "resourcepack" => "resourcepacks",
        _ => "mods",
    };
    let dir = instance_dir(&instance.id)?;
    let folder = dir.join(folder_name);
    let destination = folder.join(filename);
    net::ensure_file(
        &file.url,
        &destination,
        file.hashes.get("sha1").map(String::as_str),
        file.size,
    )
    .await
    .map_err(|e| format!("Could not download {project}: {e}"))?;
    record_managed(
        &dir,
        &format!("{folder_name}/{}", version.project_id),
        &folder,
        filename,
    );

    for dependency in version
        .dependencies
        .iter()
        .filter(|dependency| dependency.dependency_type == "required")
    {
        if let Some(project_id) = &dependency.project_id {
            download_project(instance, project_id, "mod", visited).await?;
        }
    }

    Ok(InstalledMod {
        project_id: version.project_id.clone(),
        slug: project.to_string(),
        name: project.to_string(),
        version_number: Some(version.version_number),
        file_name: Some(filename.to_string()),
        icon_url: None,
        status: "installed".into(),
    })
}

pub async fn install_project(
    instance: &Instance,
    project: &ProjectSearchResult,
) -> Result<InstalledMod, String> {
    let mut installed = download_project(
        instance,
        &project.slug,
        &project.project_type,
        &mut HashSet::new(),
    )
    .await?;
    installed.slug = project.slug.clone();
    installed.name = project.title.clone();
    installed.icon_url = if project.icon_url.is_empty() {
        None
    } else {
        Some(project.icon_url.clone())
    };
    Ok(installed)
}

/// Installs every mod of an instance in parallel. A mod without a release for
/// this Minecraft version is skipped and reported instead of aborting the
/// whole preset (previously one missing mod blocked every launch).
pub async fn install_all(instance: &Instance) -> Result<PresetInstallResult, String> {
    let results: Vec<(InstalledMod, Result<InstalledMod, String>)> =
        stream::iter(instance.mods.iter().cloned().map(|planned| async move {
            if planned.status == "installed" && planned.file_name.is_some() {
                let dir = instance_dir(&instance.id);
                let present = dir
                    .ok()
                    .and_then(|d| {
                        planned
                            .file_name
                            .as_ref()
                            .map(|f| d.join("mods").join(f).exists())
                    })
                    .unwrap_or(false);
                if present {
                    return (planned.clone(), Ok(planned));
                }
            }
            let project = ProjectSearchResult {
                project_id: planned.project_id.clone(),
                slug: planned.slug.clone(),
                title: planned.name.clone(),
                description: String::new(),
                author: String::new(),
                icon_url: planned.icon_url.clone().unwrap_or_default(),
                downloads: 0,
                project_type: "mod".into(),
            };
            let result = install_project(instance, &project).await;
            (planned, result)
        }))
        .buffered(8)
        .collect()
        .await;

    let mut mods = Vec::new();
    let mut skipped = Vec::new();
    let mut hard_errors = Vec::new();
    for (planned, result) in results {
        match result {
            Ok(installed) => mods.push(installed),
            Err(error) if error.contains("has no release") => {
                skipped.push(format!("{} (no build for {} yet)", planned.name, instance.version))
            }
            Err(error) if error.contains("does not exist") => {
                skipped.push(format!("{} (not found on Modrinth)", planned.name))
            }
            Err(error) => {
                hard_errors.push(error);
                mods.push(planned);
            }
        }
    }
    if mods.iter().all(|m| m.status != "installed") && !hard_errors.is_empty() {
        return Err(hard_errors.remove(0));
    }
    if !hard_errors.is_empty() {
        skipped.extend(hard_errors.into_iter().map(|e| format!("Will retry: {e}")));
    }
    Ok(PresetInstallResult { mods, skipped })
}
