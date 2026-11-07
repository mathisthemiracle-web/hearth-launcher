import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { listen } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import { INITIAL_STATE, LOD_MODS, MOD_LIBRARY, PRESETS, VERSIONS, modsForPreset } from '../data'
import {
  backupAllWorlds,
  errorMessage,
  getAccount,
  getSystemInfo,
  importMrpack,
  installPresetMods,
  installProject,
  isTauri,
  linkOfficialLauncher,
  listVersions,
  loadDesktopState,
  openOfficialLauncher,
  prefetchInstance,
  removeDesktopMod,
  saveDesktopState,
  setWindowMinimized,
} from '../lib/bridge'
import { translate, type Translate } from '../lib/i18n'
import { startCampfireSound, stopCampfireSound } from '../lib/sound'
import type { AccountInfo, GameExited, Instance, LauncherState, Loader, Preset, ProjectSearchResult, SystemInfo } from '../types'

interface NewInstanceInput {
  name: string
  version: string
  loader: Loader
  presetId: string
}

interface LauncherContextValue {
  state: LauncherState
  activeInstance: Instance
  account: AccountInfo | null
  setAccount: (account: AccountInfo | null) => void
  ready: boolean
  busy: string | null
  system: SystemInfo | null
  versions: string[]
  gameRunning: boolean
  setGameRunning: (running: boolean) => void
  t: Translate
  setLodEngine: (engine: 'off' | 'distanthorizons' | 'voxy') => void
  setActiveInstance: (id: string) => void
  updateInstance: (patch: Partial<Instance>) => void
  updateSettings: (patch: Partial<LauncherState['settings']>) => void
  createInstance: (input: NewInstanceInput) => void
  duplicateInstance: (id: string) => void
  deleteInstance: (id: string) => void
  applyPreset: (preset: Preset) => Promise<void>
  addProject: (project: ProjectSearchResult) => Promise<void>
  removeMod: (slug: string) => Promise<void>
  removeResourcePack: (file: string) => void
  moveResourcePack: (file: string, direction: -1 | 1) => void
  prepareMods: (instance: Instance) => Promise<Instance>
  updateAllMods: () => Promise<void>
  importModpack: (file: File) => Promise<void>
  playWithOfficialLauncher: () => Promise<void>
  importState: (value: LauncherState) => void
  resetState: () => void
}

const LauncherContext = createContext<LauncherContextValue | null>(null)
const STORAGE_KEY = 'hearth-launcher-state-v1'
const SAVE_DELAY_MS = 350

function localId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `instance-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function normalizeState(value: LauncherState): LauncherState {
  if (!value || !Array.isArray(value.instances) || value.instances.length === 0) return INITIAL_STATE
  const instances = value.instances.map((instance) => ({
    ...instance,
    // 0.3.0 and older used a wrong Modrinth slug for Distant Horizons.
    mods: (Array.isArray(instance.mods) ? instance.mods : []).map((mod) => mod.slug === 'distant-horizons'
      ? { ...mod, slug: 'distanthorizons', projectId: 'distanthorizons', status: 'planned' as const }
      : mod),
    loader: instance.loader || 'fabric',
    gc: instance.gc ?? 'g1',
    fpsBoost: instance.fpsBoost ?? false,
    resourcePacks: Array.isArray(instance.resourcePacks) ? instance.resourcePacks : [],
    playtimeSeconds: instance.playtimeSeconds ?? 0,
    launches: instance.launches ?? 0,
  }))
  return {
    ...INITIAL_STATE,
    ...value,
    activeInstanceId: instances.some((instance) => instance.id === value.activeInstanceId) ? value.activeInstanceId : instances[0].id,
    settings: { ...INITIAL_STATE.settings, ...value.settings },
    instances,
  }
}

function plannedMod(slug: string) {
  return {
    projectId: slug,
    slug,
    name: MOD_LIBRARY.find((mod) => mod.slug === slug)?.name ?? slug,
    status: 'planned' as const,
  }
}

const isPackMod = (slug: string) => slug.startsWith('pack:')

export function LauncherProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LauncherState>(INITIAL_STATE)
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [system, setSystem] = useState<SystemInfo | null>(null)
  const [versions, setVersions] = useState<string[]>(VERSIONS)
  const [gameRunning, setGameRunning] = useState(false)
  const [hidden, setHidden] = useState(document.hidden)
  const busyRef = useRef(false)

  const language = state.settings.language
  const t = useCallback<Translate>((text, vars) => translate(language, text, vars), [language])

  useEffect(() => {
    let cancelled = false
    async function restore() {
      try {
        const [savedAccount, desktop, hardware] = await Promise.all([
          getAccount().catch(() => null),
          loadDesktopState(),
          getSystemInfo().catch(() => null),
        ])
        if (cancelled) return
        setAccount(savedAccount)
        if (hardware) setSystem(hardware)
        let next: LauncherState | null = desktop ? normalizeState(desktop) : null
        if (!next) {
          const saved = localStorage.getItem(STORAGE_KEY)
          if (saved) next = normalizeState(JSON.parse(saved) as LauncherState)
        }
        if (!next) {
          const prefersFrench = navigator.language.toLowerCase().startsWith('fr')
          next = {
            ...INITIAL_STATE,
            settings: {
              ...INITIAL_STATE.settings,
              systemRamGb: hardware?.totalRamGb ?? INITIAL_STATE.settings.systemRamGb,
              language: prefersFrench ? 'fr' : 'en',
            },
          }
        }
        setState(next)
        const active = next.instances.find((item) => item.id === next.activeInstanceId)
        if (active) prefetchInstance(active)
      } catch {
        if (!cancelled) toast.error('Saved settings could not be read. A fresh setup was opened instead.')
      } finally {
        if (!cancelled) setReady(true)
      }
    }
    restore()
    listVersions()
      .then((list) => { if (!cancelled && list.length) setVersions(list.map((v) => v.id)) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  // Persist after the user pauses, not on every slider tick.
  const latest = useRef(state)
  latest.current = state
  useEffect(() => {
    if (!ready) return
    const timer = window.setTimeout(() => {
      if (isTauri) {
        saveDesktopState(latest.current).catch((error) => toast.error(errorMessage(error, 'Desktop settings could not be saved.')))
      } else {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(latest.current)) } catch { /* storage unavailable */ }
      }
    }, SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [state, ready])

  useEffect(() => {
    const flush = () => {
      if (!isTauri) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(latest.current)) } catch { /* ignore */ }
      } else {
        void saveDesktopState(latest.current)
      }
    }
    window.addEventListener('beforeunload', flush)
    const visibility = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = state.settings.theme
    document.documentElement.lang = state.settings.language
    document.documentElement.classList.toggle('reduce-motion', state.settings.reduceMotion)
  }, [state.settings.theme, state.settings.reduceMotion, state.settings.language])

  // Hand every spare GPU cycle to Minecraft while it runs.
  useEffect(() => {
    document.documentElement.classList.toggle('game-running', gameRunning)
  }, [gameRunning])

  // Ambient crackle only when it can be heard and the game is not running.
  useEffect(() => {
    if (state.settings.sounds && !gameRunning && !hidden) startCampfireSound()
    else stopCampfireSound()
    return () => stopCampfireSound()
  }, [state.settings.sounds, gameRunning, hidden])

  // Playtime is counted from Hearth's own launches.
  useEffect(() => {
    if (!isTauri) return
    const exited = listen<GameExited>('game-exited', (event) => {
      const { instanceId, seconds } = event.payload
      setGameRunning(false)
      void setWindowMinimized(false)
      setState((current) => ({
        ...current,
        instances: current.instances.map((item) => item.id === instanceId
          ? { ...item, playtimeSeconds: (item.playtimeSeconds ?? 0) + seconds }
          : item),
      }))
    })
    return () => { exited.then((unlisten) => unlisten()) }
  }, [])

  const activeInstance = useMemo(
    () => state.instances.find((item) => item.id === state.activeInstanceId) ?? state.instances[0],
    [state.instances, state.activeInstanceId],
  )

  const withBusy = useCallback(async <T,>(label: string, work: () => Promise<T>): Promise<T | undefined> => {
    if (busyRef.current) return undefined
    busyRef.current = true
    setBusy(label)
    try {
      return await work()
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }, [])

  const replaceInstance = useCallback((id: string, update: (instance: Instance) => Instance) => {
    setState((current) => ({
      ...current,
      instances: current.instances.map((item) => item.id === id ? update(item) : item),
    }))
  }, [])

  /** Switches the far-terrain mod; the files change on the next Play. */
  const setLodEngine = useCallback((engine: 'off' | 'distanthorizons' | 'voxy') => {
    const instance = activeInstance
    const current = instance.mods.filter((mod) => LOD_MODS.includes(mod.slug))
    void (async () => {
      for (const mod of current.filter((m) => m.slug !== engine)) {
        await removeDesktopMod(instance, mod).catch(() => undefined)
      }
    })()
    replaceInstance(instance.id, (item) => {
      const kept = item.mods.filter((mod) => !LOD_MODS.includes(mod.slug) || mod.slug === engine)
      const mods = engine === 'off' || kept.some((mod) => mod.slug === engine) ? kept : [...kept, plannedMod(engine)]
      return {
        ...item,
        mods,
        presetId: null,
        lodDistance: engine === 'off' ? 0 : item.lodDistance || 128,
        renderDistance: engine === 'off' ? item.renderDistance : Math.min(item.renderDistance, 12),
      }
    })
  }, [activeInstance, replaceInstance])

  const setActiveInstance = useCallback((id: string) => {
    setState((current) => {
      const next = current.instances.find((item) => item.id === id)
      if (next) prefetchInstance(next)
      return { ...current, activeInstanceId: id }
    })
  }, [])

  const updateInstance = useCallback((patch: Partial<Instance>) => {
    setState((current) => ({
      ...current,
      instances: current.instances.map((item) => item.id === current.activeInstanceId ? { ...item, ...patch } : item),
    }))
  }, [])

  const updateSettings = useCallback((patch: Partial<LauncherState['settings']>) => {
    setState((current) => ({ ...current, settings: { ...current.settings, ...patch } }))
  }, [])

  const createInstance = useCallback((input: NewInstanceInput) => {
    const id = localId()
    const preset = input.presetId === 'custom' ? null : PRESETS.find((item) => item.id === input.presetId) ?? PRESETS[1]
    const instance: Instance = {
      id,
      name: input.name.trim(),
      version: input.version,
      loader: input.loader,
      presetId: preset?.id ?? null,
      memoryGb: preset?.memoryGb ?? 4,
      renderDistance: preset?.renderDistance ?? 12,
      simulationDistance: preset?.simulationDistance ?? 8,
      shadersEnabled: false,
      shaderPack: null,
      lodDistance: preset?.lodDistance ?? 0,
      gc: 'g1',
      fpsBoost: false,
      resourcePacks: [],
      playtimeSeconds: 0,
      launches: 0,
      mods: preset ? modsForPreset(preset.id) : [],
      createdAt: new Date().toISOString(),
    }
    setState((current) => ({ ...current, instances: [...current.instances, instance], activeInstanceId: id }))
    prefetchInstance(instance)
    toast.success(translate(latest.current.settings.language, '{name} is ready. Mods download the first time you press Play.', { name: instance.name }))
  }, [])

  const duplicateInstance = useCallback((id: string) => {
    setState((current) => {
      const source = current.instances.find((item) => item.id === id)
      if (!source) return current
      const copy = {
        ...source,
        id: localId(),
        name: `${source.name} copy`,
        createdAt: new Date().toISOString(),
        lastPlayed: undefined,
        playtimeSeconds: 0,
        launches: 0,
        resourcePacks: [],
        mods: source.mods.filter((mod) => !isPackMod(mod.slug)).map((mod) => ({ ...mod, status: 'planned' as const, fileName: undefined })),
      }
      return { ...current, instances: [...current.instances, copy], activeInstanceId: copy.id }
    })
    toast.success(translate(latest.current.settings.language, 'Instance copied. Its mods will download on the first Play.'))
  }, [])

  const deleteInstance = useCallback((id: string) => {
    setState((current) => {
      if (current.instances.length === 1) return current
      const instances = current.instances.filter((item) => item.id !== id)
      return {
        ...current,
        instances,
        activeInstanceId: current.activeInstanceId === id ? instances[0].id : current.activeInstanceId,
      }
    })
    toast.success(translate(latest.current.settings.language, 'Instance removed from Hearth. Its folder and worlds stay on disk.'))
  }, [])

  /** Downloads anything still planned. Used by presets and right before Play. */
  const prepareMods = useCallback(async (instance: Instance): Promise<Instance> => {
    if (!['fabric', 'quilt'].includes(instance.loader) || !instance.mods.some((mod) => mod.status !== 'installed')) return instance
    let result = await installPresetMods(instance)
    const language = latest.current.settings.language
    // Far terrain fallback: Distant Horizons and Voxy support different
    // Minecraft versions, so if the chosen one has no build, try the other.
    const wanted = instance.mods.find((mod) => LOD_MODS.includes(mod.slug))
    const gotLod = result.mods.some((mod) => LOD_MODS.includes(mod.slug))
    if (wanted && !gotLod) {
      const alternative = LOD_MODS.find((slug) => slug !== wanted.slug)!
      const retry = await installPresetMods({ ...instance, mods: [...result.mods, plannedMod(alternative)] })
      if (retry.mods.some((mod) => mod.slug === alternative && mod.status === 'installed')) {
        toast.message(translate(language, '{from} has no build for {version}, so Hearth installed {to} for far terrain.', {
          from: wanted.name, version: instance.version, to: MOD_LIBRARY.find((m) => m.slug === alternative)?.name ?? alternative,
        }))
        result = { mods: retry.mods, skipped: result.skipped.filter((note) => !note.startsWith(wanted.name)) }
      }
    }
    const next = { ...instance, mods: result.mods }
    replaceInstance(instance.id, (item) => ({ ...item, mods: result.mods }))
    if (result.skipped.length) {
      toast.message(translate(language, 'Some mods were skipped'), { description: result.skipped.join(' · ') })
    }
    return next
  }, [replaceInstance])

  const autoBackup = useCallback(async (instance: Instance) => {
    if (!latest.current.settings.autoBackup) return
    try {
      const count = await backupAllWorlds(instance.id)
      if (count > 0) toast.message(translate(latest.current.settings.language, '{count} worlds backed up first', { count }))
    } catch (error) {
      toast.error(errorMessage(error, 'The automatic world backup failed, so nothing was changed.'))
      throw error
    }
  }, [])

  const applyPreset = useCallback(async (preset: Preset) => {
    if (!['fabric', 'quilt'].includes(activeInstance.loader)) {
      toast.error(t('Hearth’s performance presets target Fabric and Quilt.'))
      return
    }
    const base = activeInstance
    await withBusy(t('Preparing {name}', { name: preset.name }), async () => {
      try {
        await autoBackup(base)
      } catch {
        return
      }
      const existing = new Map(base.mods.map((mod) => [mod.slug, mod]))
      const mods = preset.mods.map((slug) => existing.get(slug) ?? plannedMod(slug))
      base.mods.filter((mod) => !preset.mods.includes(mod.slug)).forEach((mod) => mods.push(mod))
      const next: Instance = {
        ...base,
        presetId: preset.id,
        memoryGb: preset.memoryGb,
        renderDistance: preset.renderDistance,
        simulationDistance: preset.simulationDistance,
        shadersEnabled: preset.shadersEnabled && Boolean(base.shaderPack),
        lodDistance: preset.lodDistance,
        mods,
      }
      replaceInstance(base.id, () => next)
      try {
        const ready = await prepareMods(next)
        prefetchInstance(ready)
        toast.success(isTauri ? t('{preset} is installed for {name}.', { preset: preset.name, name: base.name }) : t('{preset} is now your {name} setup plan.', { preset: preset.name, name: base.name }))
      } catch (error) {
        toast.error(errorMessage(error, t('Some preset mods could not be prepared. They will retry on Play.')))
      }
    })
  }, [activeInstance, autoBackup, prepareMods, replaceInstance, t, withBusy])

  const updateAllMods = useCallback(async () => {
    const instance = activeInstance
    await withBusy(t('Updating mods'), async () => {
      try {
        await autoBackup(instance)
      } catch {
        return
      }
      const marked: Instance = {
        ...instance,
        mods: instance.mods.map((mod) => isPackMod(mod.slug) ? mod : { ...mod, status: 'planned' as const }),
      }
      try {
        await prepareMods(marked)
        toast.success(t('Every mod is on its newest release for {version}.', { version: instance.version }))
      } catch (error) {
        toast.error(errorMessage(error, t('Some mods could not be updated.')))
      }
    })
  }, [activeInstance, autoBackup, prepareMods, t, withBusy])

  const addProject = useCallback(async (project: ProjectSearchResult) => {
    const instance = activeInstance
    await withBusy(t('Adding {name}', { name: project.title }), async () => {
      try {
        const mod = await installProject(instance, project)
        const needsIris = project.projectType === 'shader' && !instance.mods.some((item) => item.slug === 'iris')
        const companion = needsIris
          ? await installProject(instance, { projectId: 'iris', slug: 'iris', title: 'Iris Shaders', description: 'Shader support for Sodium', author: 'Iris contributors', iconUrl: '', downloads: 0, projectType: 'mod' })
          : null
        replaceInstance(instance.id, (item) => {
          if (project.projectType === 'shader') {
            return {
              ...item,
              // Iris needs the real file name, not the display title.
              shaderPack: mod.fileName ?? project.title,
              shadersEnabled: true,
              mods: companion ? [...item.mods.filter((m) => m.slug !== 'iris'), companion] : item.mods,
            }
          }
          if (project.projectType === 'resourcepack') {
            const file = mod.fileName ?? project.title
            return { ...item, resourcePacks: [file, ...(item.resourcePacks ?? []).filter((name) => name !== file)] }
          }
          const others = LOD_MODS.includes(mod.slug) ? item.mods.filter((m) => !LOD_MODS.includes(m.slug)) : item.mods
          return { ...item, mods: [...others.filter((m) => m.projectId !== mod.projectId && m.slug !== mod.slug), mod] }
        })
        if (LOD_MODS.includes(project.slug)) {
          for (const other of instance.mods.filter((m) => LOD_MODS.includes(m.slug) && m.slug !== project.slug)) {
            await removeDesktopMod(instance, other).catch(() => undefined)
          }
        }
        toast.success(isTauri ? t('{name} is ready.', { name: project.title }) : t('{name} added to your setup plan.', { name: project.title }))
      } catch (error) {
        toast.error(errorMessage(error, t('Could not add {name}.', { name: project.title })))
      }
    })
  }, [activeInstance, replaceInstance, t, withBusy])

  const removeMod = useCallback(async (slug: string) => {
    const instance = activeInstance
    const mod = instance.mods.find((item) => item.slug === slug)
    if (!mod) return
    await withBusy(t('Removing {name}', { name: mod.name }), async () => {
      try {
        await removeDesktopMod(instance, mod)
        replaceInstance(instance.id, (item) => ({ ...item, mods: item.mods.filter((m) => m.slug !== slug), presetId: null }))
        toast.success(t('{name} removed.', { name: mod.name }))
      } catch (error) {
        toast.error(errorMessage(error, t('Could not remove {name}.', { name: mod.name })))
      }
    })
  }, [activeInstance, replaceInstance, t, withBusy])

  const removeResourcePack = useCallback((file: string) => {
    updateInstance({ resourcePacks: (activeInstance.resourcePacks ?? []).filter((name) => name !== file) })
  }, [activeInstance.resourcePacks, updateInstance])

  const moveResourcePack = useCallback((file: string, direction: -1 | 1) => {
    const list = [...(activeInstance.resourcePacks ?? [])]
    const index = list.indexOf(file)
    const target = index + direction
    if (index < 0 || target < 0 || target >= list.length) return
    ;[list[index], list[target]] = [list[target], list[index]]
    updateInstance({ resourcePacks: list })
  }, [activeInstance.resourcePacks, updateInstance])

  const importModpack = useCallback(async (file: File) => {
    const id = localId()
    await withBusy(t('Importing {name}', { name: file.name }), async () => {
      try {
        const pack = await importMrpack(id, file)
        const instance: Instance = {
          id,
          name: pack.name,
          version: pack.version,
          loader: pack.loader,
          presetId: null,
          memoryGb: Math.min(8, Math.max(4, Math.round((system?.totalRamGb ?? 16) / 4))),
          renderDistance: 12,
          simulationDistance: 8,
          shadersEnabled: false,
          shaderPack: null,
          lodDistance: 0,
          gc: 'g1',
          fpsBoost: false,
          resourcePacks: [],
          playtimeSeconds: 0,
          launches: 0,
          mods: pack.mods,
          createdAt: new Date().toISOString(),
        }
        setState((current) => ({ ...current, instances: [...current.instances, instance], activeInstanceId: id }))
        prefetchInstance(instance)
        toast.success(t('{name} imported with {count} files.', { name: pack.name, count: pack.fileCount }))
      } catch (error) {
        toast.error(errorMessage(error, t('This modpack could not be imported.')))
      }
    })
  }, [system, t, withBusy])

  /** Mods + settings from Hearth, sign-in and launch by the official launcher. */
  const playWithOfficialLauncher = useCallback(async () => {
    const instance = activeInstance
    await withBusy(t('Preparing the official launcher'), async () => {
      try {
        const readyInstance = await prepareMods(instance)
        const result = await linkOfficialLauncher(readyInstance)
        await openOfficialLauncher().catch(() => undefined)
        toast.success(t('“{name}” is ready in the Minecraft Launcher.', { name: result.profileName }), {
          description: result.launcherFound
            ? t('Pick it in the launcher’s Play dropdown. If the launcher was already open, restart it so the new installation shows up.')
            : t('Install the official Minecraft Launcher, then pick this installation in its Play dropdown.'),
          duration: 12000,
        })
      } catch (error) {
        toast.error(errorMessage(error, t('Could not set up the official launcher profile.')))
      }
    })
  }, [activeInstance, prepareMods, t, withBusy])

  const importState = useCallback((value: LauncherState) => {
    setState(normalizeState(value))
    toast.success(translate(latest.current.settings.language, 'Hearth settings imported.'))
  }, [])

  const resetState = useCallback(() => {
    setState({
      ...INITIAL_STATE,
      settings: {
        ...INITIAL_STATE.settings,
        microsoftClientId: state.settings.microsoftClientId,
        language: state.settings.language,
        systemRamGb: system?.totalRamGb ?? INITIAL_STATE.settings.systemRamGb,
      },
      instances: INITIAL_STATE.instances.map((item) => ({ ...item })),
    })
    toast.success(t('A fresh Hearth setup is ready.'))
  }, [state.settings.microsoftClientId, state.settings.language, system, t])

  const value: LauncherContextValue = {
    state, activeInstance, account, setAccount, ready, busy, system, versions, gameRunning, setGameRunning, t,
    setLodEngine, setActiveInstance, updateInstance, updateSettings, createInstance, duplicateInstance, deleteInstance,
    applyPreset, addProject, removeMod, removeResourcePack, moveResourcePack, prepareMods, updateAllMods,
    importModpack, playWithOfficialLauncher, importState, resetState,
  }

  return <LauncherContext.Provider value={value}>{children}</LauncherContext.Provider>
}

// The provider and its companion hook intentionally share one module.
// eslint-disable-next-line react-refresh/only-export-components
export function useLauncher() {
  const context = useContext(LauncherContext)
  if (!context) throw new Error('useLauncher must be used inside LauncherProvider')
  return context
}
