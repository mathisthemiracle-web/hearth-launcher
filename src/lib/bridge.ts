import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import type {
  AccountInfo,
  BackupInfo,
  Diagnosis,
  ImportedPack,
  Screenshot,
  WorldInfo,
  DeviceCodeInfo,
  GameVersion,
  Instance,
  InstalledMod,
  LaunchReport,
  LauncherState,
  OfficialLinkResult,
  PresetInstallResult,
  ProjectSearchResult,
  SystemInfo,
} from '../types'

export const isTauri = Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)

const API_ROOT = 'https://api.modrinth.com/v2'

/**
 * Tauri rejects commands with the Rust error *string*, not an Error object.
 * The old `error instanceof Error ? … : 'generic'` pattern threw the real
 * reason away, which is why sign-in only ever said “could not finish”.
 */
export function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return fallback
}

export async function loadDesktopState(): Promise<LauncherState | null> {
  if (!isTauri) return null
  return invoke<LauncherState>('get_state')
}

export async function saveDesktopState(state: LauncherState): Promise<void> {
  if (!isTauri) return
  await invoke('save_state', { state })
}

export async function searchProjects(
  query: string,
  instance: Instance,
  projectType: 'mod' | 'shader' | 'resourcepack',
  signal?: AbortSignal,
): Promise<ProjectSearchResult[]> {
  if (isTauri) {
    return invoke<ProjectSearchResult[]>('search_projects', {
      query,
      version: instance.version,
      loader: instance.loader,
      projectType,
    })
  }

  const facets: string[][] = [[`project_type:${projectType}`], [`versions:${instance.version}`]]
  if (projectType === 'mod') facets.push([`categories:${instance.loader}`])
  const params = new URLSearchParams({
    query,
    limit: '20',
    index: query ? 'relevance' : 'downloads',
    facets: JSON.stringify(facets),
  })
  const response = await fetch(`${API_ROOT}/search?${params}`, { signal })
  if (!response.ok) throw new Error(`Modrinth returned ${response.status}`)
  const data = await response.json() as {
    hits: Array<{
      project_id: string
      slug: string
      title: string
      description: string
      author: string
      icon_url: string | null
      downloads: number
      project_type: 'mod' | 'shader'
    }>
  }
  return data.hits.map((hit) => ({
    projectId: hit.project_id,
    slug: hit.slug,
    title: hit.title,
    description: hit.description,
    author: hit.author,
    iconUrl: hit.icon_url ?? '',
    downloads: hit.downloads,
    projectType: hit.project_type,
  }))
}

export async function installProject(
  instance: Instance,
  project: ProjectSearchResult,
): Promise<InstalledMod> {
  if (isTauri) {
    return invoke<InstalledMod>('install_project', { instance, project })
  }
  await new Promise((resolve) => setTimeout(resolve, 250))
  return {
    projectId: project.projectId,
    slug: project.slug,
    name: project.title,
    iconUrl: project.iconUrl,
    status: 'planned',
  }
}

export async function installPresetMods(instance: Instance): Promise<PresetInstallResult> {
  if (!isTauri) {
    await new Promise((resolve) => setTimeout(resolve, 350))
    return { mods: instance.mods.map((mod) => ({ ...mod, status: 'planned' as const })), skipped: [] }
  }
  return invoke<PresetInstallResult>('install_preset_mods', { instance })
}

export async function removeDesktopMod(instance: Instance, mod: InstalledMod): Promise<void> {
  if (!isTauri) return
  // The Rust parameter is `mod_info`; Tauri expects it as `modInfo`.
  await invoke('remove_mod', { instance, modInfo: mod })
}

export async function launchInstance(instance: Instance, clientId: string, boostPriority: boolean, gpuHighPerformance: boolean): Promise<LaunchReport> {
  if (isTauri) return invoke<LaunchReport>('launch_instance', { instance, clientId, boostPriority, gpuHighPerformance })
  return {
    canLaunch: false,
    message: 'The browser preview manages configurations only. Use the desktop app for files and launch.',
    checks: [
      { label: 'Instance configured', ready: true, detail: `${instance.name} · ${instance.version} ${instance.loader}` },
      { label: 'Mods downloaded', ready: instance.mods.every((mod) => mod.status === 'installed'), detail: 'Browser changes are a setup plan, not files on disk.' },
      { label: 'Microsoft account', ready: false, detail: 'Account authentication is not simulated.' },
    ],
  }
}

export async function getAccount(): Promise<AccountInfo | null> {
  if (!isTauri) return null
  return invoke<AccountInfo | null>('get_account')
}

export async function beginMicrosoftLogin(clientId: string): Promise<DeviceCodeInfo> {
  if (!isTauri) throw new Error('Microsoft sign-in requires the desktop app.')
  return invoke<DeviceCodeInfo>('begin_microsoft_login', { clientId })
}

export async function completeMicrosoftLogin(clientId: string, code: DeviceCodeInfo): Promise<AccountInfo> {
  if (!isTauri) throw new Error('Microsoft sign-in requires the desktop app.')
  return invoke<AccountInfo>('complete_microsoft_login', {
    clientId,
    deviceCode: code.deviceCode,
    interval: code.interval,
    expiresIn: code.expiresIn,
  })
}

export async function cancelMicrosoftLogin(): Promise<void> {
  if (!isTauri) return
  await invoke('cancel_microsoft_login')
}

export async function microsoftSignOut(): Promise<void> {
  if (!isTauri) return
  await invoke('microsoft_sign_out')
}

export async function listVersions(): Promise<GameVersion[]> {
  if (!isTauri) return []
  return invoke<GameVersion[]>('list_versions')
}

export async function getSystemInfo(): Promise<SystemInfo | null> {
  if (!isTauri) return null
  return invoke<SystemInfo>('system_info')
}

export async function linkOfficialLauncher(instance: Instance): Promise<OfficialLinkResult> {
  if (!isTauri) throw new Error('The official launcher bridge works in the desktop app.')
  return invoke<OfficialLinkResult>('link_official_launcher', { instance })
}

export async function openOfficialLauncher(): Promise<void> {
  if (!isTauri) return
  await invoke('open_official_launcher')
}

export async function openInstanceFolder(instance: Instance): Promise<void> {
  if (!isTauri) throw new Error('Folders are available in the desktop build.')
  await invoke('open_instance_folder', { instance })
}

export async function setWindowMinimized(minimized: boolean): Promise<void> {
  if (!isTauri) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  if (minimized) await win.minimize()
  else {
    await win.unminimize()
    await win.setFocus()
  }
}

export async function openExternal(url: string): Promise<void> {
  if (isTauri) {
    await openUrl(url)
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

/** Local file → URL the webview can show (screenshots, world icons). */
export function fileUrl(path: string): string {
  return isTauri ? convertFileSrc(path) : ''
}

export function prefetchInstance(instance: Instance): void {
  if (isTauri) void invoke('prefetch_instance', { instance }).catch(() => undefined)
}

export async function listWorlds(instanceId: string): Promise<WorldInfo[]> {
  if (!isTauri) return []
  return invoke<WorldInfo[]>('list_worlds', { instanceId })
}

export async function listBackups(instanceId: string): Promise<BackupInfo[]> {
  if (!isTauri) return []
  return invoke<BackupInfo[]>('list_backups', { instanceId })
}

export async function backupWorld(instanceId: string, world: string): Promise<BackupInfo> {
  return invoke<BackupInfo>('backup_world', { instanceId, world })
}

export async function backupAllWorlds(instanceId: string): Promise<number> {
  if (!isTauri) return 0
  return invoke<number>('backup_all_worlds', { instanceId })
}

export async function restoreBackup(instanceId: string, file: string): Promise<string> {
  return invoke<string>('restore_backup', { instanceId, file })
}

export async function deleteBackup(instanceId: string, file: string): Promise<void> {
  await invoke('delete_backup', { instanceId, file })
}

export async function listScreenshots(instanceId: string): Promise<Screenshot[]> {
  if (!isTauri) return []
  return invoke<Screenshot[]>('list_screenshots', { instanceId })
}

export async function diagnoseInstance(instanceId: string): Promise<Diagnosis> {
  if (!isTauri) {
    return { found: false, title: 'Desktop only', explanation: 'The crash doctor reads files on your PC, so it works in the desktop app.', fixes: [], suspects: [], source: null, excerpt: '' }
  }
  return invoke<Diagnosis>('diagnose_instance', { instanceId })
}

export async function importMrpack(instanceId: string, file: File): Promise<ImportedPack> {
  if (!isTauri) throw new Error('Modpack import works in the desktop app.')
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()))
  return invoke<ImportedPack>('import_mrpack', { instanceId, bytes })
}

export async function openInstanceSubfolder(instanceId: string, folder: string): Promise<void> {
  if (!isTauri) throw new Error('Folders are available in the desktop build.')
  await invoke('open_instance_subfolder', { instanceId, folder })
}
