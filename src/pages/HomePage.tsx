import { useEffect, useMemo, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { ArrowRight, Check, ChevronDown, Circle, Clock, Cpu, ExternalLink, Flame, Library, LoaderCircle, MemoryStick, Mountain, Package, Play, SunMedium, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PRESETS, recommendPreset } from '../data'
import { errorMessage, isTauri, launchInstance, setWindowMinimized } from '../lib/bridge'
import { formatDuration } from '../lib/format'
import { useLauncher } from '../state/LauncherContext'
import type { LaunchProgress, LaunchReport, Page, Preset } from '../types'
import { CampfireScene } from '../components/Common'
import CrashDoctor from '../components/CrashDoctor'

function greetingKey() {
  const hour = new Date().getHours()
  if (hour < 5) return 'Late night by the fire'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function HomePage({ navigate }: { navigate: (page: Page) => void }) {
  const { state, activeInstance, account, system, setActiveInstance, applyPreset, updateInstance, prepareMods, playWithOfficialLauncher, busy, gameRunning, setGameRunning, t } = useLauncher()
  const [report, setReport] = useState<LaunchReport | null>(null)
  const [launching, setLaunching] = useState(false)
  const [launchProgress, setLaunchProgress] = useState<LaunchProgress | null>(null)
  const [pendingPreset, setPendingPreset] = useState<Preset | null>(null)

  useEffect(() => {
    if (!isTauri) return
    const progress = listen<LaunchProgress>('launch-progress', (event) => setLaunchProgress(event.payload))
    return () => { progress.then((unlisten) => unlisten()) }
  }, [])

  const preset = PRESETS.find((item) => item.id === activeInstance.presetId)
  const ramGb = system?.totalRamGb ?? state.settings.systemRamGb
  const threads = system?.cpuThreads ?? 8
  const recommended = useMemo(() => recommendPreset(ramGb, threads), [ramGb, threads])
  const plannedCount = activeInstance.mods.filter((mod) => mod.status !== 'installed').length
  const launchable = ['fabric', 'quilt'].includes(activeInstance.loader)

  async function play() {
    setLaunching(true)
    setLaunchProgress({ message: t('Checking your setup'), detail: t('Account, mods, game files and Java'), percent: null })
    try {
      let instance = activeInstance
      if (instance.mods.some((mod) => mod.status !== 'installed')) {
        setLaunchProgress({ message: t('Downloading mods'), detail: t('{count} mods from Modrinth, in parallel', { count: plannedCount }), percent: null })
        instance = await prepareMods(instance)
      }
      const result = await launchInstance(instance, state.settings.microsoftClientId, state.settings.boostPriority, state.settings.gpuHighPerformance)
      if (result.canLaunch) {
        updateInstance({ lastPlayed: new Date().toISOString(), launches: (activeInstance.launches ?? 0) + 1 })
        setGameRunning(true)
        toast.success(result.message)
        if (state.settings.closeOnLaunch) void setWindowMinimized(true)
      } else {
        setReport(result)
      }
    } catch (error) {
      setReport({
        canLaunch: false,
        message: errorMessage(error, t('Minecraft could not be started. Your instance files were left in place.')),
        checks: [],
      })
    } finally {
      setLaunching(false)
      setLaunchProgress(null)
    }
  }

  async function confirmPreset() {
    if (!pendingPreset) return
    const selected = pendingPreset
    setPendingPreset(null)
    await applyPreset(selected)
  }

  const [reportText, reportLog] = (report?.message ?? '').split('\n\nLast lines of logs/hearth-launch.log:\n')
  const crashed = Boolean(report?.message.includes('closed right after starting'))
  const percent = launchProgress?.percent

  return (
    <div className="page home-page">
      <header className="home-heading">
        <div>
          <p className="eyebrow">{t(greetingKey())}{account ? `, ${account.username}` : ''}</p>
          <h1>{t('The fire’s going. Pull up a log.')}</h1>
        </div>
        <label className="instance-select">
          <span>{t('Instance')}</span>
          <div>
            <select value={activeInstance.id} onChange={(event) => setActiveInstance(event.target.value)} aria-label={t('Instance')}>
              {state.instances.map((instance) => <option key={instance.id} value={instance.id}>{instance.name}</option>)}
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </div>
        </label>
      </header>

      <section className="hero-panel">
        <CampfireScene />
        <div className="hero-panel__copy">
          <p className="eyebrow">{activeInstance.version} · {activeInstance.loader === 'neoforge' ? 'NeoForge' : activeInstance.loader}{preset ? ` · ${preset.name}` : ''}</p>
          <h2>{activeInstance.name}</h2>
          <p className="hero-lede">{t(preset?.tagline ?? 'A setup that feels like yours.')}</p>
          <div className="hero-chips">
            <span className="chip"><MemoryStick size={14} /><strong>{activeInstance.memoryGb} GB</strong> {t('memory')}</span>
            <span className="chip"><Mountain size={14} /><strong>{activeInstance.renderDistance}</strong> {t('chunks')}{activeInstance.lodDistance > 0 ? <> + <strong>{activeInstance.lodDistance}</strong> {t('far')}</> : null}</span>
            <span className="chip"><Package size={14} /><strong>{activeInstance.mods.length}</strong> mods</span>
            {activeInstance.shadersEnabled && <span className="chip"><SunMedium size={14} />{t('Shaders on')}</span>}
            {activeInstance.fpsBoost && <span className="chip"><Zap size={14} />{t('FPS boost')}</span>}
            {(activeInstance.playtimeSeconds ?? 0) > 0 && <span className="chip"><Clock size={14} />{formatDuration(activeInstance.playtimeSeconds ?? 0)}</span>}
            {plannedCount > 0 && <span className="chip chip--warn">{t('{count} to download on Play', { count: plannedCount })}</span>}
          </div>
          <div className="hero-actions">
            <button className="button button--play" onClick={play} disabled={launching || Boolean(busy) || gameRunning}>
              {launching ? <LoaderCircle className="spin" /> : <Play fill="currentColor" />}
              {launching ? t('Lighting…') : gameRunning ? t('Playing') : t('Play')}
            </button>
            <button className="button button--quiet" onClick={() => void playWithOfficialLauncher()} disabled={launching || Boolean(busy) || !launchable} title={t('Use Hearth’s mods and settings, sign in and launch through Mojang’s launcher')}><ExternalLink size={18} />{t('Play via Minecraft Launcher')}</button>
            <button className="button button--quiet" onClick={() => navigate('presets')}><Flame size={18} />{t('Tune')}</button>
          </div>
          {launching && launchProgress && (
            <div className="launch-progress" role="status">
              <div className="launch-progress__top"><strong>{t(launchProgress.message)}</strong>{typeof percent === 'number' && <span>{percent}%</span>}</div>
              <small>{launchProgress.detail}</small>
              <div className="progress-track"><span className={`progress-fill ${typeof percent === 'number' ? '' : 'progress-fill--indeterminate'}`} style={typeof percent === 'number' ? { width: `${percent}%` } : undefined} /></div>
            </div>
          )}
          {gameRunning && !launching && <span className="running-pill"><i />{t('Minecraft is running. Hearth is resting to save your FPS.')}</span>}
        </div>
      </section>

      <div className="home-grid">
        <section className="card recommend-card">
          <p className="eyebrow">{t('Picked for this PC')}</p>
          <h2>{recommended.name}</h2>
          <p className="card-lede">{t(recommended.description)}</p>
          <div className="hardware-line">
            <span className="chip"><MemoryStick size={14} /><strong>{ramGb} GB</strong> RAM</span>
            <span className="chip"><Cpu size={14} /><strong>{threads}</strong> {t('CPU threads')}</span>
            {!system && <span className="chip">{t('estimated')}</span>}
          </div>
          <div className="mod-name-list">
            {recommended.mods.slice(0, 8).map((slug) => <span key={slug}>{slug.replaceAll('-', ' ')}</span>)}
            {recommended.mods.length > 8 && <span>+{recommended.mods.length - 8}</span>}
          </div>
          <div className="card-actions">
            <button className="button button--primary" disabled={Boolean(busy) || activeInstance.presetId === recommended.id} onClick={() => setPendingPreset(recommended)}>
              {activeInstance.presetId === recommended.id ? <><Check size={16} />{t('Already using it')}</> : <>{t('Use for {name}', { name: activeInstance.name })}<ArrowRight size={16} /></>}
            </button>
            <button className="text-link" onClick={() => navigate('presets')}>{t('See all presets')}</button>
          </div>
        </section>

        <section className="card">
          <p className="eyebrow">{t('Around the camp')}</p>
          <div className="quick-paths">
            <button onClick={() => navigate('shaders')}><span className="qp-icon"><SunMedium size={20} /></span><div><strong>{t('Add atmosphere')}</strong><small>{t('Shader packs, set up in Iris for you.')}</small></div><ArrowRight size={18} /></button>
            <button onClick={() => navigate('mods')}><span className="qp-icon"><Package size={20} /></span><div><strong>{t('Mods & resource packs')}</strong><small>{t('Only releases that match this instance.')}</small></div><ArrowRight size={18} /></button>
            <button onClick={() => navigate('library')}><span className="qp-icon"><Library size={20} /></span><div><strong>{t('Worlds & backups')}</strong><small>{t('Screenshots, playtime and the crash doctor.')}</small></div><ArrowRight size={18} /></button>
          </div>
        </section>
      </div>

      <Dialog open={Boolean(report)} onOpenChange={(open) => !open && setReport(null)}>
        <DialogContent className="hearth-dialog hearth-dialog--wide">
          <DialogHeader>
            <p className="eyebrow">{t('Launch status')}</p>
            <DialogTitle>{report?.canLaunch ? t('Your world is opening.') : t('The fire didn’t catch.')}</DialogTitle>
            <DialogDescription>{reportText}</DialogDescription>
          </DialogHeader>
          {reportLog && !crashed && <pre className="log-tail">{reportLog}</pre>}
          {crashed && <CrashDoctor autoRun />}
          {Boolean(report?.checks.length) && (
            <div className="preflight-list">
              {report?.checks.map((check) => (
                <div key={check.label} className={check.ready ? 'is-ready' : ''}>
                  {check.ready ? <Check size={18} /> : <Circle size={18} />}
                  <span><strong>{t(check.label)}</strong><small>{t(check.detail)}</small></span>
                </div>
              ))}
            </div>
          )}
          <div className="dialog-actions">
            <button className="button button--quiet" onClick={() => setReport(null)}>{t('Close')}</button>
            {(report?.message.includes('403') || !account) && launchable && <button className="button button--outline" onClick={() => { setReport(null); void playWithOfficialLauncher() }}><ExternalLink size={16} />{t('Play via Minecraft Launcher')}</button>}
            {!account && <button className="button button--primary" onClick={() => { setReport(null); navigate('settings') }}>{t('Connect account')}<ArrowRight size={16} /></button>}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(pendingPreset)} onOpenChange={(open) => !open && setPendingPreset(null)}>
        <DialogContent className="hearth-dialog">
          <DialogHeader>
            <p className="eyebrow">{t('Apply to {name}', { name: activeInstance.name })}</p>
            <DialogTitle>{pendingPreset?.name}</DialogTitle>
            <DialogDescription>{t(pendingPreset?.description ?? '')}</DialogDescription>
          </DialogHeader>
          <p className="dialog-note">{t('Mods you added yourself are kept. Anything without a build for {version} is skipped and listed, so the rest still works.', { version: activeInstance.version })}{state.settings.autoBackup ? ` ${t('Your worlds are backed up first.')}` : ''}</p>
          <div className="dialog-actions">
            <button className="button button--quiet" onClick={() => setPendingPreset(null)}>{t('Not now')}</button>
            <button className="button button--primary" onClick={confirmPreset} disabled={Boolean(busy)}>
              {busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{t('Apply preset')}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
