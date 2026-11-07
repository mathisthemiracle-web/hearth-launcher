import { useCallback, useEffect, useState } from 'react'
import { Archive, Clock, FolderOpen, Globe2, Image as ImageIcon, LoaderCircle, Play, RotateCcw, Stethoscope, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  backupWorld,
  deleteBackup,
  errorMessage,
  fileUrl,
  isTauri,
  listBackups,
  listScreenshots,
  listWorlds,
  openInstanceSubfolder,
  restoreBackup,
} from '../lib/bridge'
import { useLauncher } from '../state/LauncherContext'
import type { BackupInfo, Screenshot, WorldInfo } from '../types'
import { PageHeader } from '../components/Common'
import { formatDuration } from '../lib/format'
import CrashDoctor from '../components/CrashDoctor'

type Tab = 'worlds' | 'backups' | 'screenshots' | 'stats' | 'doctor'

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function formatDate(secs: number, language: string) {
  if (!secs) return '—'
  return new Date(secs * 1000).toLocaleString(language === 'fr' ? 'fr-CA' : 'en-CA', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function LibraryPage() {
  const { state, activeInstance, t } = useLauncher()
  const [tab, setTab] = useState<Tab>('worlds')
  const [worlds, setWorlds] = useState<WorldInfo[]>([])
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [shots, setShots] = useState<Screenshot[]>([])
  const [loading, setLoading] = useState(false)
  const [working, setWorking] = useState<string | null>(null)
  const [viewing, setViewing] = useState<Screenshot | null>(null)
  const language = state.settings.language

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [w, b, s] = await Promise.all([
        listWorlds(activeInstance.id),
        listBackups(activeInstance.id),
        listScreenshots(activeInstance.id),
      ])
      setWorlds(w)
      setBackups(b)
      setShots(s)
    } catch (error) {
      toast.error(errorMessage(error, t('Could not read this instance’s folder.')))
    } finally {
      setLoading(false)
    }
  }, [activeInstance.id, t])

  useEffect(() => { void refresh() }, [refresh])

  async function backup(world: string) {
    setWorking(world)
    try {
      await backupWorld(activeInstance.id, world)
      toast.success(t('{name} backed up.', { name: world }))
      await refresh()
    } catch (error) {
      toast.error(errorMessage(error, t('The backup failed.')))
    } finally {
      setWorking(null)
    }
  }

  async function restore(file: string) {
    setWorking(file)
    try {
      const folder = await restoreBackup(activeInstance.id, file)
      toast.success(t('Restored as a new world: {name}', { name: folder }))
      await refresh()
    } catch (error) {
      toast.error(errorMessage(error, t('The restore failed.')))
    } finally {
      setWorking(null)
    }
  }

  async function remove(file: string) {
    setWorking(file)
    try {
      await deleteBackup(activeInstance.id, file)
      await refresh()
    } catch (error) {
      toast.error(errorMessage(error, t('Could not delete the backup.')))
    } finally {
      setWorking(null)
    }
  }

  function open(folder: string) {
    openInstanceSubfolder(activeInstance.id, folder).catch((error) => toast.error(errorMessage(error, t('Could not open the folder.'))))
  }

  const totalPlay = state.instances.reduce((sum, item) => sum + (item.playtimeSeconds ?? 0), 0)
  const totalLaunches = state.instances.reduce((sum, item) => sum + (item.launches ?? 0), 0)
  const tabs: Array<{ id: Tab; label: string; icon: typeof Globe2 }> = [
    { id: 'worlds', label: 'Worlds', icon: Globe2 },
    { id: 'backups', label: 'Backups', icon: Archive },
    { id: 'screenshots', label: 'Screenshots', icon: ImageIcon },
    { id: 'stats', label: 'Playtime', icon: Clock },
    { id: 'doctor', label: 'Crash doctor', icon: Stethoscope },
  ]

  return (
    <div className="page">
      <PageHeader eyebrow={`${activeInstance.name} · ${activeInstance.version}`} title={t('Your library')} description={t('Worlds, backups, screenshots and playtime for this instance, plus a doctor for crashes.')} />
      {!isTauri && <p className="inline-notice">{t('The library reads files on your PC, so it fills in inside the desktop app.')}</p>}

      <div className="tab-row" role="tablist">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}><Icon size={16} />{t(label)}</button>
        ))}
        {loading && <LoaderCircle className="spin" size={16} />}
      </div>

      {tab === 'worlds' && (
        <section className="library-list">
          {worlds.length === 0 && <div className="empty-state"><Globe2 size={28} /><h3>{t('No worlds yet')}</h3><p>{t('Worlds you create in this instance show up here.')}</p></div>}
          {worlds.map((world) => (
            <article key={world.folder} className="library-row">
              {world.iconPath && isTauri ? <img src={fileUrl(world.iconPath)} alt="" className="world-icon" /> : <span className="world-icon world-icon--empty"><Globe2 size={22} /></span>}
              <div><strong>{world.folder}</strong><small>{t('Last played')} {formatDate(world.lastPlayed, language)} · {formatBytes(world.sizeBytes)}</small></div>
              <button className="button button--small button--outline" onClick={() => backup(world.folder)} disabled={working !== null}>{working === world.folder ? <LoaderCircle className="spin" size={15} /> : <Archive size={15} />}{t('Back up')}</button>
            </article>
          ))}
          <div className="card-actions"><button className="button button--quiet button--small" onClick={() => open('saves')}><FolderOpen size={15} />{t('Open saves folder')}</button></div>
        </section>
      )}

      {tab === 'backups' && (
        <section className="library-list">
          <p className="footnote" style={{ marginTop: 0 }}>{t('Restoring never overwrites a world: the backup comes back as a new world next to it. Hearth keeps the last 5 automatic backups per world.')}</p>
          {backups.length === 0 && <div className="empty-state"><Archive size={28} /><h3>{t('No backups yet')}</h3><p>{t('Back up a world, or let Hearth do it before presets and mod updates.')}</p></div>}
          {backups.map((item) => (
            <article key={item.file} className="library-row">
              <span className="world-icon world-icon--empty"><Archive size={20} /></span>
              <div><strong>{item.world}</strong><small>{formatDate(item.created, language)} · {formatBytes(item.sizeBytes)}{item.file.includes('-auto-') ? ` · ${t('automatic')}` : ''}</small></div>
              <div className="row-actions">
                <button className="button button--small button--outline" onClick={() => restore(item.file)} disabled={working !== null}>{working === item.file ? <LoaderCircle className="spin" size={15} /> : <RotateCcw size={15} />}{t('Restore')}</button>
                <button className="icon-button icon-button--danger" onClick={() => remove(item.file)} disabled={working !== null} aria-label={t('Delete')}><Trash2 size={16} /></button>
              </div>
            </article>
          ))}
          <div className="card-actions"><button className="button button--quiet button--small" onClick={() => open('backups')}><FolderOpen size={15} />{t('Open backups folder')}</button></div>
        </section>
      )}

      {tab === 'screenshots' && (
        <section>
          {shots.length === 0 && <div className="empty-state"><ImageIcon size={28} /><h3>{t('No screenshots yet')}</h3><p>{t('Press F2 in game. Your shots land here.')}</p></div>}
          <div className="shot-grid">
            {shots.map((shot) => (
              <button key={shot.path} className="shot" onClick={() => setViewing(shot)}>
                <img src={fileUrl(shot.path)} alt={shot.name} loading="lazy" decoding="async" />
              </button>
            ))}
          </div>
          <div className="card-actions"><button className="button button--quiet button--small" onClick={() => open('screenshots')}><FolderOpen size={15} />{t('Open screenshots folder')}</button></div>
        </section>
      )}

      {tab === 'stats' && (
        <section>
          <div className="stat-grid">
            <div className="card stat"><span>{t('Total playtime')}</span><strong>{formatDuration(totalPlay)}</strong></div>
            <div className="card stat"><span>{t('Launches')}</span><strong>{totalLaunches}</strong></div>
            <div className="card stat"><span>{t('Instances')}</span><strong>{state.instances.length}</strong></div>
          </div>
          <div className="library-list" style={{ marginTop: 14 }}>
            {[...state.instances].sort((a, b) => (b.playtimeSeconds ?? 0) - (a.playtimeSeconds ?? 0)).map((item) => {
              const share = totalPlay > 0 ? ((item.playtimeSeconds ?? 0) / totalPlay) * 100 : 0
              return (
                <article key={item.id} className="library-row">
                  <span className="world-icon world-icon--empty"><Play size={18} /></span>
                  <div style={{ flex: 1 }}><strong>{item.name}</strong><small>{formatDuration(item.playtimeSeconds ?? 0)} · {item.launches ?? 0} {t('launches')}</small><div className="progress-track"><span className="progress-fill" style={{ width: `${share}%` }} /></div></div>
                </article>
              )
            })}
          </div>
          <p className="footnote">{t('Counted from games started by Hearth.')}</p>
        </section>
      )}

      {tab === 'doctor' && <section className="card"><CrashDoctor /></section>}

      <Dialog open={Boolean(viewing)} onOpenChange={(value) => !value && setViewing(null)}>
        <DialogContent className="hearth-dialog shot-dialog">
          <DialogHeader><DialogTitle>{viewing?.name}</DialogTitle><DialogDescription>{viewing ? formatDate(viewing.created, language) : ''}</DialogDescription></DialogHeader>
          {viewing && <img src={fileUrl(viewing.path)} alt={viewing.name} className="shot-full" />}
          <div className="dialog-actions"><button className="button button--quiet" onClick={() => setViewing(null)}><X size={16} />{t('Close')}</button></div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
