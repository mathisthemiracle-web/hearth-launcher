export type Page = 'home' | 'instances' | 'mods' | 'presets' | 'shaders' | 'library' | 'settings'
export type Language = 'en' | 'fr'
export type Loader = 'fabric' | 'neoforge' | 'forge' | 'quilt'
export type ModStatus = 'planned' | 'installed'
export type Theme = 'light' | 'dark'

export interface InstalledMod {
  projectId: string
  slug: string
  name: string
  versionNumber?: string
  fileName?: string
  iconUrl?: string
  status: ModStatus
}

export interface Instance {
  id: string
  name: string
  version: string
  loader: Loader
  presetId: string | null
  memoryGb: number
  renderDistance: number
  simulationDistance: number
  shadersEnabled: boolean
  shaderPack: string | null
  lodDistance: number
  gc?: 'g1' | 'zgc'
  fpsBoost?: boolean
  resourcePacks?: string[]
  playtimeSeconds?: number
  launches?: number
  mods: InstalledMod[]
  createdAt: string
  lastPlayed?: string
}

export interface Preset {
  id: string
  name: string
  eyebrow: string
  tagline: string
  description: string
  mods: string[]
  memoryGb: number
  renderDistance: number
  simulationDistance: number
  shadersEnabled: boolean
  lodDistance: number
  tier: 'Lightweight' | 'Balanced' | 'Visual' | 'Extreme'
  accent: 'coral' | 'gold' | 'mint' | 'teal'
  bestFor: string
}

export interface ModDefinition {
  slug: string
  name: string
  role: string
  description: string
}

export interface ShaderDefinition {
  slug: string
  name: string
  mood: string
  description: string
  horizonsReady: boolean
}

export interface LauncherSettings {
  theme: Theme
  closeOnLaunch: boolean
  downloadThreads: number
  systemRamGb: number
  reduceMotion: boolean
  microsoftClientId: string
  boostPriority: boolean
  gpuHighPerformance: boolean
  autoBackup: boolean
  sounds: boolean
  language: Language
}

export interface LauncherState {
  instances: Instance[]
  activeInstanceId: string
  settings: LauncherSettings
}

export interface ProjectSearchResult {
  projectId: string
  slug: string
  title: string
  description: string
  author: string
  iconUrl: string
  downloads: number
  projectType: 'mod' | 'shader' | 'resourcepack'
}

export interface LaunchCheck {
  label: string
  ready: boolean
  detail: string
}

export interface LaunchReport {
  canLaunch: boolean
  checks: LaunchCheck[]
  message: string
}

export interface AccountInfo {
  username: string
  uuid: string
}

export interface DeviceCodeInfo {
  userCode: string
  verificationUri: string
  deviceCode: string
  expiresIn: number
  interval: number
  message: string
}

export interface LaunchProgress {
  message: string
  detail: string
  percent?: number | null
}

export interface PresetInstallResult {
  mods: InstalledMod[]
  skipped: string[]
}

export interface OfficialLinkResult {
  profileName: string
  versionId: string
  minecraftDir: string
  launcherFound: boolean
}

export interface SystemInfo {
  totalRamGb: number
  cpuThreads: number
}

export interface GameVersion {
  id: string
  releaseTime: string
}

export interface WorldInfo {
  folder: string
  sizeBytes: number
  lastPlayed: number
  iconPath: string | null
}

export interface BackupInfo {
  file: string
  world: string
  sizeBytes: number
  created: number
}

export interface Screenshot {
  path: string
  name: string
  created: number
}

export interface Diagnosis {
  found: boolean
  title: string
  explanation: string
  fixes: string[]
  suspects: string[]
  source: string | null
  excerpt: string
}

export interface ImportedPack {
  name: string
  version: string
  loader: Loader
  mods: InstalledMod[]
  fileCount: number
}

export interface GameExited {
  instanceId: string
  code: number | null
  seconds: number
}
