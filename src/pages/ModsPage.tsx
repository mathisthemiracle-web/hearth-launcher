import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowDown, ArrowUp, Check, Download, FolderOpen, Layers, LoaderCircle, Package, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { MOD_LIBRARY } from '../data'
import { errorMessage, openInstanceSubfolder, searchProjects } from '../lib/bridge'
import { useLauncher } from '../state/LauncherContext'
import type { ProjectSearchResult } from '../types'
import { PageHeader, ProjectRow } from '../components/Common'

type Kind = 'mod' | 'resourcepack'

export default function ModsPage() {
  const { activeInstance, addProject, removeMod, removeResourcePack, moveResourcePack, updateAllMods, busy, t } = useLauncher()
  const [kind, setKind] = useState<Kind>('mod')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProjectSearchResult[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef(0)

  async function search(event?: FormEvent, text = query, type: Kind = kind) {
    event?.preventDefault()
    const id = ++requestId.current
    setLoading(true)
    setError('')
    try {
      const found = await searchProjects(text.trim(), activeInstance, type)
      if (id === requestId.current) setResults(found)
    } catch (reason) {
      if (id === requestId.current) setError(errorMessage(reason, t('Modrinth search is unavailable right now.')))
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }

  // Search as you type, after a short pause, ignoring stale answers.
  useEffect(() => {
    if (!query.trim()) return
    const timer = window.setTimeout(() => { void search(undefined, query, kind) }, 300)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, kind, activeInstance.version, activeInstance.loader])

  // Resource packs have no curated list, so show the popular ones at once.
  useEffect(() => {
    setResults(null)
    if (kind === 'resourcepack') void search(undefined, '', 'resourcepack')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  function addCurated(slug: string, name: string, description: string) {
    addProject({ projectId: slug, slug, title: name, description, author: 'Modrinth', iconUrl: '', downloads: 0, projectType: 'mod' })
  }

  const installed = new Map(activeInstance.mods.map((mod) => [mod.slug, mod]))
  const packs = activeInstance.resourcePacks ?? []
  const open = (folder: string) => openInstanceSubfolder(activeInstance.id, folder).catch((reason) => toast.error(errorMessage(reason, t('Could not open the folder.'))))

  return (
    <div className="page">
      <PageHeader eyebrow={`${activeInstance.name} · ${activeInstance.version}`} title={t('The toolbox')} description={t('Proven optimisation mods first, then all of Modrinth, filtered to releases that match this instance’s version and loader. Required libraries come along automatically.')} />

      <div className="tab-row" role="tablist">
        <button role="tab" aria-selected={kind === 'mod'} className={kind === 'mod' ? 'is-on' : ''} onClick={() => setKind('mod')}><Package size={16} />{t('Mods')}</button>
        <button role="tab" aria-selected={kind === 'resourcepack'} className={kind === 'resourcepack' ? 'is-on' : ''} onClick={() => setKind('resourcepack')}><Layers size={16} />{t('Resource packs')}</button>
      </div>

      <form className="search-bar" onSubmit={search}>
        <Search size={20} aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={kind === 'mod' ? t('Search mods for this instance…') : t('Search resource packs…')} aria-label={t('Search Modrinth')} />
        <button className="button button--primary button--small" type="submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={17} /> : <Search size={16} />}{t('Search')}</button>
      </form>
      {error && <div className="error-state" role="alert"><strong>{t('Couldn’t reach the mod library.')}</strong><p>{error}</p><button className="button button--outline" onClick={() => search()}>{t('Try again')}</button></div>}

      <div className="mods-layout">
        {results ? (
          <section className="project-results">
            <div className="section-heading-row"><div><p className="eyebrow">{t('Live from Modrinth')}</p><h2>{query ? t('Results for “{query}”', { query }) : t('Popular for this setup')}</h2></div>{kind === 'mod' && <button className="text-link" onClick={() => { setResults(null); setQuery('') }}>{t('Back to essentials')}</button>}</div>
            {results.length === 0 ? <div className="empty-state"><Search size={28} /><h3>{t('No compatible releases found')}</h3><p>{t('Try another name, Minecraft version, or loader.')}</p></div> : results.map((project) => {
              const existing = kind === 'mod' ? installed.get(project.slug) : undefined
              return <ProjectRow key={project.projectId} project={project} action={() => addProject({ ...project, projectType: kind })} actionLabel={existing ? t('In setup') : t('Add')} disabled={Boolean(existing) || Boolean(busy)} />
            })}
          </section>
        ) : (
          <section className="essentials-list">
            <div className="section-heading-row"><div><p className="eyebrow">{t('Hearth’s essentials')}</p><h2>{t('Small mods. Meaningful work.')}</h2></div><span>{t('{count} trusted building blocks', { count: MOD_LIBRARY.length })}</span></div>
            {MOD_LIBRARY.map((mod) => {
              const existing = installed.get(mod.slug)
              return (
                <article className={`essential-row ${existing ? 'is-installed' : ''}`} key={mod.slug}>
                  <div><span className="mod-role">{t(mod.role)}</span><h3>{mod.name}</h3><p>{t(mod.description)}</p></div>
                  <button className={`button button--small ${existing ? 'button--quiet' : 'button--outline'}`} disabled={Boolean(busy)} onClick={() => existing ? removeMod(existing.slug) : addCurated(mod.slug, mod.name, mod.description)}>
                    {existing ? <Trash2 size={15} /> : <Plus size={15} />}{existing ? t('Remove') : t('Add')}
                  </button>
                </article>
              )
            })}
          </section>
        )}

        {kind === 'mod' ? (
          <aside className="installed-panel">
            <p className="eyebrow">{t('Your setup')}</p>
            <h2>{t('{count} mods', { count: activeInstance.mods.length })}</h2>
            <p>{t('{count} download on the next Play', { count: activeInstance.mods.filter((mod) => mod.status === 'planned').length })}</p>
            <div className="card-actions">
              <button className="button button--small button--outline" onClick={() => void updateAllMods()} disabled={Boolean(busy) || activeInstance.mods.length === 0}><RefreshCw size={15} />{t('Update all mods')}</button>
              <button className="icon-button" onClick={() => open('mods')} aria-label={t('Open mods folder')} title={t('Open mods folder')}><FolderOpen size={17} /></button>
            </div>
            <div className="installed-mod-list">
              {activeInstance.mods.length === 0 && <div className="empty-state"><Download size={24} /><p>{t('Your instance is pleasantly empty.')}</p></div>}
              {activeInstance.mods.map((mod) => <div key={mod.slug}><span><strong>{mod.name}</strong><small>{mod.status === 'installed' ? <><Check size={12} />{mod.versionNumber ?? t('Ready')}</> : t('Downloads on next Play')}</small></span><button className="icon-button" onClick={() => removeMod(mod.slug)} disabled={Boolean(busy)} aria-label={t('Remove')}><Trash2 size={15} /></button></div>)}
            </div>
          </aside>
        ) : (
          <aside className="installed-panel">
            <p className="eyebrow">{t('Active packs')}</p>
            <h2>{t('{count} packs', { count: packs.length })}</h2>
            <p>{t('Top of the list wins. Hearth turns them on in Minecraft’s settings before every launch.')}</p>
            <div className="installed-mod-list">
              {packs.length === 0 && <div className="empty-state"><Layers size={24} /><p>{t('No resource packs yet.')}</p></div>}
              {packs.map((file, index) => (
                <div key={file}>
                  <span><strong>{file.replace(/\.zip$/i, '')}</strong><small>#{index + 1}</small></span>
                  <span className="row-actions">
                    <button className="icon-button" onClick={() => moveResourcePack(file, -1)} disabled={index === 0} aria-label={t('Move up')}><ArrowUp size={15} /></button>
                    <button className="icon-button" onClick={() => moveResourcePack(file, 1)} disabled={index === packs.length - 1} aria-label={t('Move down')}><ArrowDown size={15} /></button>
                    <button className="icon-button" onClick={() => removeResourcePack(file)} aria-label={t('Turn off')}><Trash2 size={15} /></button>
                  </span>
                </div>
              ))}
            </div>
            <div className="card-actions"><button className="button button--small button--quiet" onClick={() => open('resourcepacks')}><FolderOpen size={15} />{t('Open resource packs folder')}</button></div>
          </aside>
        )}
      </div>
    </div>
  )
}
