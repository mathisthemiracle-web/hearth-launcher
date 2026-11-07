import { useRef, useState, type FormEvent } from 'react'
import { Check, Copy, FileArchive, FolderOpen, LoaderCircle, Plus, Settings2, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PRESETS } from '../data'
import { toast } from 'sonner'
import { errorMessage, isTauri, openInstanceFolder } from '../lib/bridge'
import { formatDuration } from '../lib/format'
import { useLauncher } from '../state/LauncherContext'
import type { Loader } from '../types'
import { InstanceBadge, PageHeader } from '../components/Common'

const LAUNCHABLE: Loader[] = ['fabric', 'quilt']

export default function InstancesPage() {
  const { state, activeInstance, setLodEngine, setActiveInstance, createInstance, duplicateInstance, deleteInstance, updateInstance, importModpack, busy, versions, system, t } = useLauncher()
  const maxMemory = Math.max(4, Math.min(32, (system?.totalRamGb ?? state.settings.systemRamGb) - 2))
  const packRef = useRef<HTMLInputElement>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  // 1.21.1 has the widest optimisation-mod support; newer versions are in the list.
  const [version, setVersion] = useState('1.21.1')
  const [loader, setLoader] = useState<Loader>('fabric')
  const [presetId, setPresetId] = useState('balanced')
  const [error, setError] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    const finalName = name.trim() || t('A new adventure')
    createInstance({ name: finalName, version, loader, presetId: LAUNCHABLE.includes(loader) ? presetId : 'custom' })
    setCreating(false)
    setError('')
    setName('')
  }

  function edit(id: string) {
    setActiveInstance(id)
    setEditing(true)
  }

  async function onPack(file?: File) {
    if (!file) return
    await importModpack(file)
    if (packRef.current) packRef.current.value = ''
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow={t('Separate spaces for separate adventures')}
        title={t('Instances')}
        description={t('Each instance keeps its own mods, settings, shaders, resource packs and worlds.')}
        action={(
          <div className="header-actions">
            <button className="button button--outline" onClick={() => packRef.current?.click()} disabled={Boolean(busy)}><FileArchive size={18} />{t('Import modpack')}</button>
            <button className="button button--primary" onClick={() => setCreating(true)}><Plus size={18} />{t('New instance')}</button>
            <input ref={packRef} type="file" accept=".mrpack,application/zip" hidden onChange={(event) => void onPack(event.target.files?.[0])} />
          </div>
        )}
      />

      <div className="instance-list">
        {state.instances.map((instance) => {
          const preset = PRESETS.find((item) => item.id === instance.presetId)
          return (
            <article key={instance.id} className={`instance-row ${instance.id === activeInstance.id ? 'is-active' : ''}`}>
              <button className="instance-row__identity" onClick={() => setActiveInstance(instance.id)} aria-label={t('Make {name} active', { name: instance.name })}>
                <InstanceBadge instance={instance} large />
                <span><strong>{instance.name}</strong><small>{instance.version} · {instance.loader === 'neoforge' ? 'NeoForge' : instance.loader}{(instance.playtimeSeconds ?? 0) > 0 ? ` · ${formatDuration(instance.playtimeSeconds ?? 0)}` : ''}</small></span>
                {instance.id === activeInstance.id && <em><Check size={13} />{t('Active')}</em>}
              </button>
              <div className="instance-row__preset"><strong>{preset?.name ?? t('Custom setup')}</strong><small>{instance.memoryGb} GB · {instance.renderDistance} {t('chunks')}</small></div>
              <div className="instance-row__mods"><strong>{instance.mods.length}</strong><small>{instance.mods.some((mod) => mod.status === 'planned') ? t('to download') : t('ready')}</small></div>
              <div className="instance-row__actions">
                <button className="icon-button" onClick={() => edit(instance.id)} aria-label={t('Edit')} title={t('Edit')}><Settings2 size={18} /></button>
                <button className="icon-button" onClick={() => duplicateInstance(instance.id)} aria-label={t('Duplicate')} title={t('Duplicate')}><Copy size={18} /></button>
                <button className="icon-button icon-button--danger" disabled={state.instances.length === 1} onClick={() => setDeletingId(instance.id)} aria-label={t('Delete')} title={t('Delete')}><Trash2 size={18} /></button>
              </div>
            </article>
          )
        })}
      </div>
      <p className="footnote">{t('Removing an instance from this list never deletes its world saves or desktop folder automatically. Modpacks import from Modrinth .mrpack files.')}</p>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="hearth-dialog">
          <DialogHeader>
            <p className="eyebrow">{t('A fresh little corner')}</p>
            <DialogTitle>{t('Create an instance')}</DialogTitle>
            <DialogDescription>{t('Start with a performance preset, then make it yours. Game files start downloading in the background right away.')}</DialogDescription>
          </DialogHeader>
          <form className="form-stack" onSubmit={submit}>
            <label>{t('Instance name')}<input value={name} placeholder={t('A new adventure')} onChange={(event) => setName(event.target.value)} maxLength={48} autoFocus /></label>
            <div className="form-grid">
              <label>{t('Minecraft version')}<select value={version} onChange={(event) => setVersion(event.target.value)}>{versions.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label>{t('Mod loader')}<select value={loader} onChange={(event) => { const next = event.target.value as Loader; setLoader(next); if (!LAUNCHABLE.includes(next)) setPresetId('custom') }}>
                <option value="fabric">Fabric</option><option value="quilt">Quilt</option><option value="neoforge">NeoForge</option><option value="forge">Forge</option>
              </select></label>
            </div>
            <label>{t('Starting setup')}<select value={presetId} onChange={(event) => setPresetId(event.target.value)} disabled={!LAUNCHABLE.includes(loader)}>
              <option value="custom">{t('Empty / custom setup')}</option>
              {PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name} — {t(preset.tier)}</option>)}
            </select></label>
            {loader === 'quilt' && <p className="form-hint">{t('Quilt runs most Fabric mods. Hearth prefers native Quilt builds and falls back to Fabric ones.')}</p>}
            {!LAUNCHABLE.includes(loader) && <p className="form-hint">{t('Hearth launches Fabric and Quilt. Forge and NeoForge instances can be configured and filled with mods, then played through the official launcher.')}</p>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="dialog-actions"><button type="button" className="button button--quiet" onClick={() => setCreating(false)}>{t('Cancel')}</button><button className="button button--primary" type="submit"><Plus size={17} />{t('Create instance')}</button></div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="hearth-dialog hearth-dialog--wide">
          <DialogHeader>
            <p className="eyebrow">{activeInstance.version} · {activeInstance.loader}</p>
            <DialogTitle>{activeInstance.name}</DialogTitle>
            <DialogDescription>{t('Presets are only a starting point. Changes stay with this instance.')}</DialogDescription>
          </DialogHeader>
          <div className="settings-form">
            <label>{t('Name')}<input className="text-input" value={activeInstance.name} maxLength={48} onChange={(event) => updateInstance({ name: event.target.value })} /></label>
            <label className="range-field"><span>{t('Memory allocation')} <strong>{activeInstance.memoryGb} GB</strong></span><input type="range" min="2" max={maxMemory} step="1" value={activeInstance.memoryGb} onChange={(event) => updateInstance({ memoryGb: Number(event.target.value), presetId: null })} /><small>{t('More is not faster. 4–8 GB suits most setups; leave the rest for Windows and your GPU driver.')}</small></label>
            <label className="range-field"><span>{t('Vanilla render distance')} <strong>{activeInstance.renderDistance} {t('chunks')}</strong></span><input type="range" min="2" max="32" step="1" value={activeInstance.renderDistance} onChange={(event) => updateInstance({ renderDistance: Number(event.target.value), presetId: null })} /></label>
            <label className="range-field"><span>{t('Simulation distance')} <strong>{activeInstance.simulationDistance} {t('chunks')}</strong></span><input type="range" min="5" max="24" step="1" value={activeInstance.simulationDistance} onChange={(event) => updateInstance({ simulationDistance: Number(event.target.value), presetId: null })} /><small>{t('Lower simulation distance is one of the biggest CPU savings in single-player.')}</small></label>
            <div className="switch-row" style={{ display: 'flex' }}><span><strong>{t('Far terrain')}</strong><small>{t('Distant Horizons supports the most versions. Voxy is faster but alpha, Fabric-only and limited to recent versions. If one has no build for this version, Hearth tries the other.')}</small></span><div className="segmented" role="group" aria-label={t('Far terrain')}>{(['off', 'distanthorizons', 'voxy'] as const).map((engine) => { const on = engine === 'off' ? !activeInstance.mods.some((mod) => ['distanthorizons', 'voxy'].includes(mod.slug)) : activeInstance.mods.some((mod) => mod.slug === engine); return <button key={engine} type="button" className={on ? 'is-on' : ''} disabled={engine === 'voxy' && activeInstance.loader !== 'fabric'} onClick={() => setLodEngine(engine)}>{engine === 'off' ? t('Off') : engine === 'voxy' ? 'Voxy' : 'Distant Horizons'}</button> })}</div></div>
            {activeInstance.mods.some((mod) => mod.slug === 'distanthorizons') && <label>{t('Distant Horizons radius')}<select value={activeInstance.lodDistance || 128} onChange={(event) => updateInstance({ lodDistance: Number(event.target.value), presetId: null })}><option value="64">64</option><option value="128">128</option><option value="192">192</option><option value="256">256</option><option value="384">384 — {t('demanding')}</option><option value="512">512 — {t('high-end only')}</option></select><small>{t('Hearth writes this into Distant Horizons’ config before each launch (after its first start creates the file). Far terrain fills in gradually and leans on your CPU.')}</small></label>}
            <label className="switch-row"><span><strong>{t('FPS boost')}</strong><small>{t('Fast graphics, minimal particles, no clouds, no entity shadows, no smooth lighting. Big gains on weaker PCs; applied every launch while on.')}</small></span><input type="checkbox" checked={Boolean(activeInstance.fpsBoost)} onChange={(event) => updateInstance({ fpsBoost: event.target.checked })} /></label>
            <div className="switch-row" style={{ display: 'flex' }}><span><strong>{t('Garbage collector')}</strong><small>{t('G1 works everywhere. ZGC (Java 21+) gives the smallest stutters and uses a little more memory.')}</small></span><div className="segmented" role="group" aria-label={t('Garbage collector')}>{(['g1', 'zgc'] as const).map((gc) => <button key={gc} type="button" className={(activeInstance.gc ?? 'g1') === gc ? 'is-on' : ''} onClick={() => updateInstance({ gc })}>{gc === 'g1' ? t('G1 · steady') : t('ZGC · smoothest')}</button>)}</div></div>
            <label className="switch-row"><span><strong>{t('Enable shaders')}</strong><small>{t('Pick a pack in Shaders first.')}</small></span><input type="checkbox" checked={activeInstance.shadersEnabled} disabled={!activeInstance.shaderPack} onChange={(event) => updateInstance({ shadersEnabled: event.target.checked })} /></label>
          </div>
          <div className="dialog-actions">
            {isTauri && <button className="button button--quiet" onClick={() => openInstanceFolder(activeInstance).catch((error) => toast.error(errorMessage(error, t('Could not open the folder.'))))}><FolderOpen size={17} />{t('Open folder')}</button>}
            <button className="button button--primary" disabled={Boolean(busy)} onClick={() => setEditing(false)}>{busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{t('Done')}</button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deletingId)} onOpenChange={(open) => !open && setDeletingId(null)}>
        <DialogContent className="hearth-dialog">
          <DialogHeader><DialogTitle>{t('Remove this instance?')}</DialogTitle><DialogDescription>{t('This removes it from Hearth’s list. Your world saves and desktop files are not deleted.')}</DialogDescription></DialogHeader>
          <div className="dialog-actions"><button className="button button--quiet" onClick={() => setDeletingId(null)}>{t('Keep it')}</button><button className="button button--danger" onClick={() => { if (deletingId) deleteInstance(deletingId); setDeletingId(null) }}><Trash2 size={17} />{t('Remove instance')}</button></div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
