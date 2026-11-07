import type { LauncherState, ModDefinition, Preset, ShaderDefinition } from './types'

export const MOD_LIBRARY: ModDefinition[] = [
  { slug: 'sodium', name: 'Sodium', role: 'Renderer', description: 'A modern rendering engine focused on frame rate and frame-time consistency.' },
  { slug: 'lithium', name: 'Lithium', role: 'Game logic', description: 'Optimises game physics, mob AI, and block ticking without changing vanilla behaviour.' },
  { slug: 'ferrite-core', name: 'FerriteCore', role: 'Memory', description: 'Reduces the memory used by blockstates, leaving more room for worlds and mods.' },
  { slug: 'entityculling', name: 'Entity Culling', role: 'Visibility', description: 'Avoids drawing entities and block entities hidden behind solid geometry.' },
  { slug: 'dynamic-fps', name: 'Dynamic FPS', role: 'Background use', description: 'Reduces unnecessary rendering work while the game is idle or unfocused.' },
  { slug: 'immediatelyfast', name: 'ImmediatelyFast', role: 'Rendering', description: 'Optimises immediate-mode rendering such as text, entities, and interface elements.' },
  { slug: 'modernfix', name: 'ModernFix', role: 'Loading & memory', description: 'Improves resource loading and reduces memory pressure in modded instances.' },
  { slug: 'iris', name: 'Iris Shaders', role: 'Shaders', description: 'Adds shader-pack support alongside Sodium’s rendering pipeline.' },
  { slug: 'sodium-extra', name: 'Sodium Extra', role: 'Video controls', description: 'Adds granular visual toggles for particles, fog, animations, and more.' },
  { slug: 'reeses-sodium-options', name: 'Reese’s Sodium Options', role: 'Video controls', description: 'Provides an alternative, highly configurable Sodium video-settings interface.' },
  { slug: 'modmenu', name: 'Mod Menu', role: 'Mod controls', description: 'Adds an in-game list for finding and configuring installed mods.' },
  { slug: 'fabric-api', name: 'Fabric API', role: 'Compatibility', description: 'Shared hooks used by many Fabric mods.' },
  { slug: 'distanthorizons', name: 'Distant Horizons', role: 'Distant terrain', description: 'Draws simplified level-of-detail terrain far beyond the normal chunk radius.' },
  { slug: 'c2me-fabric', name: 'C2ME', role: 'Chunk generation', description: 'Improves chunk-generation parallelism on supported Fabric versions.' },
  { slug: 'noisium', name: 'Noisium', role: 'World generation', description: 'Optimises terrain noise generation while preserving world generation.' },
  { slug: 'voxy', name: 'Voxy', role: 'Distant terrain (alternative)', description: 'Very fast far-terrain renderer for the newest Minecraft versions (Fabric, alpha). Needs OpenGL 4.6; shaders must support it explicitly. Use it instead of Distant Horizons, not with it.' },
  { slug: 'moreculling', name: 'More Culling', role: 'Culling', description: 'Skips drawing more hidden faces, leaves and block entities that the camera cannot see.' },
  { slug: 'badoptimizations', name: 'BadOptimizations', role: 'Frame time', description: 'Many small client savings, like skipping lightmap and sky work when nothing changed.' },
  { slug: 'scalablelux', name: 'ScalableLux', role: 'Lighting', description: 'A faster, multi-threaded light engine (Starlight’s successor). Helps chunk loading in single-player.' },
  { slug: 'alternate-current', name: 'Alternate Current', role: 'Redstone', description: 'Much faster redstone dust with fewer block updates, same behaviour.' },
]

export const SHADERS: ShaderDefinition[] = [
  { slug: 'complementary-reimagined', name: 'Complementary Reimagined', mood: 'Soft & cinematic', description: 'Warm lighting, gentle atmosphere, and scalable visual profiles.', horizonsReady: true },
  { slug: 'bsl-shaders', name: 'BSL Shaders', mood: 'Bright & airy', description: 'A bright, customisable look with a lighter starting point for modest GPUs.', horizonsReady: true },
  { slug: 'bliss-shader', name: 'Bliss Shaders', mood: 'Dreamy & natural', description: 'Atmospheric lighting with support for Distant Horizons terrain.', horizonsReady: true },
  { slug: 'shrimple', name: 'Shrimple', mood: 'Crisp & colourful', description: 'Vivid shadows and reflections with distant-terrain support.', horizonsReady: true },
]

export const PRESETS: Preset[] = [
  {
    id: 'feather', name: 'Feather', eyebrow: 'Least fuss, lightest load', tagline: 'A gentle boost for smaller machines.',
    description: 'Keeps vanilla’s look intact while trimming rendering, memory, and background work. Shaders stay optional.',
    mods: ['fabric-api', 'sodium', 'lithium', 'ferrite-core', 'entityculling', 'moreculling', 'badoptimizations', 'dynamic-fps', 'immediatelyfast'],
    memoryGb: 3, renderDistance: 10, simulationDistance: 8, shadersEnabled: false, lodDistance: 0,
    tier: 'Lightweight', accent: 'mint', bestFor: '4–8 GB systems',
  },
  {
    id: 'balanced', name: 'Everyday', eyebrow: 'The comfortable default', tagline: 'Fast where it matters. Familiar everywhere else.',
    description: 'A well-rounded setup for normal play, with deeper optimisation and useful in-game controls. Iris is included but shaders start switched off.',
    mods: ['fabric-api', 'sodium', 'lithium', 'ferrite-core', 'entityculling', 'moreculling', 'badoptimizations', 'dynamic-fps', 'immediatelyfast', 'modernfix', 'modmenu', 'iris', 'sodium-extra'],
    memoryGb: 4, renderDistance: 16, simulationDistance: 10, shadersEnabled: false, lodDistance: 0,
    tier: 'Balanced', accent: 'coral', bestFor: 'Most gaming PCs',
  },
  {
    id: 'shader-glow', name: 'Golden Hour', eyebrow: 'Shaders without the drama', tagline: 'Beautiful light, sensible frame rates.',
    description: 'Pairs Sodium and Iris with performance mods, then starts at a restrained vanilla render distance so your shader pack does the visual work.',
    mods: ['fabric-api', 'sodium', 'lithium', 'ferrite-core', 'entityculling', 'moreculling', 'badoptimizations', 'dynamic-fps', 'immediatelyfast', 'modernfix', 'modmenu', 'iris', 'sodium-extra', 'reeses-sodium-options'],
    memoryGb: 6, renderDistance: 12, simulationDistance: 8, shadersEnabled: true, lodDistance: 0,
    tier: 'Visual', accent: 'gold', bestFor: 'Dedicated GPUs',
  },
  {
    id: 'horizons', name: 'Open Country', eyebrow: 'See the landscape, not the fog', tagline: 'Distant terrain with a practical footprint.',
    description: 'Adds Distant Horizons and chunk-generation optimisations. Vanilla distance stays low while simplified terrain reaches much farther.',
    mods: ['fabric-api', 'sodium', 'lithium', 'ferrite-core', 'entityculling', 'moreculling', 'badoptimizations', 'dynamic-fps', 'immediatelyfast', 'modernfix', 'modmenu', 'iris', 'sodium-extra', 'distanthorizons', 'c2me-fabric', 'noisium'],
    memoryGb: 6, renderDistance: 8, simulationDistance: 8, shadersEnabled: false, lodDistance: 128,
    tier: 'Balanced', accent: 'teal', bestFor: '6+ CPU threads, 16 GB RAM',
  },
  {
    id: 'horizons-shaders', name: 'Wanderer', eyebrow: 'Long views in warm light', tagline: 'Distant terrain and shaders, carefully matched.',
    description: 'Combines Iris and Distant Horizons for expansive shader-lit views. Use a shader pack that explicitly supports Distant Horizons.',
    mods: ['fabric-api', 'sodium', 'lithium', 'ferrite-core', 'entityculling', 'moreculling', 'badoptimizations', 'dynamic-fps', 'immediatelyfast', 'modernfix', 'modmenu', 'iris', 'sodium-extra', 'reeses-sodium-options', 'distanthorizons', 'c2me-fabric', 'noisium'],
    memoryGb: 8, renderDistance: 8, simulationDistance: 8, shadersEnabled: true, lodDistance: 192,
    tier: 'Visual', accent: 'coral', bestFor: 'Strong CPU + GPU',
  },
  {
    id: 'horizons-ultra', name: 'Cartographer', eyebrow: 'For machines with room to spare', tagline: 'Very distant terrain, honestly labelled.',
    description: 'Pushes level-of-detail terrain to 256 chunks. Terrain generation is CPU-heavy and fills gradually; this is not unlimited rendering.',
    mods: ['fabric-api', 'sodium', 'lithium', 'ferrite-core', 'entityculling', 'moreculling', 'badoptimizations', 'dynamic-fps', 'immediatelyfast', 'modernfix', 'modmenu', 'iris', 'sodium-extra', 'reeses-sodium-options', 'distanthorizons', 'c2me-fabric', 'noisium'],
    memoryGb: 8, renderDistance: 8, simulationDistance: 8, shadersEnabled: true, lodDistance: 256,
    tier: 'Extreme', accent: 'gold', bestFor: 'High-end desktops',
  },
]

/** Fallback only. The desktop app reads the live list from Mojang. */
/** Far-terrain engines. Only one can be installed at a time. */
export const LOD_MODS = ['distanthorizons', 'voxy']

export const VERSIONS = ['26.3', '26.2', '26.1.2', '1.21.11', '1.21.10', '1.21.8', '1.21.5', '1.21.4', '1.21.1', '1.20.6', '1.20.4', '1.20.1']

/** Picks a starting preset from real hardware (RAM in GB, CPU threads). */
export function recommendPreset(ramGb: number, threads: number) {
  const id = ramGb <= 8 ? 'feather'
    : ramGb < 16 ? 'balanced'
    : ramGb >= 32 && threads >= 12 ? 'horizons-shaders'
    : threads >= 8 ? 'horizons'
    : 'shader-glow'
  return PRESETS.find((item) => item.id === id) ?? PRESETS[1]
}

export function modsForPreset(presetId: string | null) {
  const preset = PRESETS.find((item) => item.id === presetId)
  if (!preset) return []
  return preset.mods.map((slug) => {
    const mod = MOD_LIBRARY.find((item) => item.slug === slug)
    return {
      projectId: slug,
      slug,
      name: mod?.name ?? slug,
      status: 'planned' as const,
    }
  })
}

export const INITIAL_STATE: LauncherState = {
  activeInstanceId: 'home-instance',
  instances: [
    {
      id: 'home-instance',
      name: 'My first world',
      version: '1.21.1',
      loader: 'fabric',
      presetId: 'balanced',
      memoryGb: 4,
      renderDistance: 16,
      simulationDistance: 10,
      shadersEnabled: false,
      shaderPack: null,
      lodDistance: 0,
      mods: modsForPreset('balanced'),
      createdAt: new Date().toISOString(),
    },
  ],
  settings: {
    theme: 'dark',
    closeOnLaunch: true,
    downloadThreads: 4,
    systemRamGb: 16,
    reduceMotion: false,
    microsoftClientId: '',
    boostPriority: true,
    gpuHighPerformance: true,
    autoBackup: true,
    sounds: false,
    language: 'en',
  },
}
