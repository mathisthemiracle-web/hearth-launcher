import { Check, LoaderCircle, MoonStar, SunMedium } from 'lucide-react'
import { SHADERS } from '../data'
import { useLauncher } from '../state/LauncherContext'
import { PageHeader } from '../components/Common'

export default function ShadersPage() {
  const { activeInstance, addProject, updateInstance, busy, t } = useLauncher()
  const hasIris = activeInstance.mods.some((mod) => mod.slug === 'iris')
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
  const isSelected = (name: string) => Boolean(activeInstance.shaderPack) && norm(activeInstance.shaderPack ?? '').includes(norm(name.split(' ')[0]))
  const packLabel = activeInstance.shaderPack
    ? SHADERS.find((shader) => isSelected(shader.name))?.name ?? activeInstance.shaderPack.replace(/\.zip$/i, '')
    : null

  function addShader(slug: string, name: string, description: string) {
    addProject({ projectId: slug, slug, title: name, description, author: 'Shader creator', iconUrl: '', downloads: 0, projectType: 'shader' })
  }

  return (
    <div className="page">
      <PageHeader eyebrow={t('A little atmosphere goes a long way')} title={t('Light your world')} description={t('Pick a pack and Hearth installs Iris, downloads the matching release and switches it on for you. Packs marked below also work with Distant Horizons.')} />

      <section className="shader-status">
        <div className="shader-status__icon">{activeInstance.shadersEnabled ? <SunMedium size={28} /> : <MoonStar size={28} />}</div>
        <div><p className="eyebrow">{activeInstance.name}</p><h2>{activeInstance.shadersEnabled ? packLabel ?? t('Choose a shader pack') : t('Softly switched off')}</h2><p>{hasIris ? t('Iris is installed. Hearth turns your pack on in Iris’ settings before every launch.') : t('Iris will be added automatically with your first shader pack.')}</p></div>
        <label className="switch-control"><input type="checkbox" checked={activeInstance.shadersEnabled} disabled={!activeInstance.shaderPack} onChange={(event) => updateInstance({ shadersEnabled: event.target.checked })} /><span>{activeInstance.shadersEnabled ? t('Shaders on') : t('Shaders off')}</span></label>
      </section>

      <div className="shader-grid">
        {SHADERS.map((shader, index) => {
          const selected = isSelected(shader.name)
          return (
            <article className={`shader-card shader-card--${index + 1} ${selected ? 'is-selected' : ''}`} key={shader.slug}>
              <div className="shader-card__scene" aria-hidden="true"><span className="shader-sun" /><span className="shader-hill shader-hill--back" /><span className="shader-hill shader-hill--front" /></div>
              <div className="shader-card__copy"><p className="eyebrow">{t(shader.mood)}</p><h2>{shader.name}</h2><p>{t(shader.description)}</p>{shader.horizonsReady && <span className="compatibility-label"><Check size={13} />{t('Distant Horizons support')}</span>}</div>
              <button className={`button ${selected ? 'button--quiet' : 'button--primary'}`} disabled={Boolean(busy)} onClick={() => addShader(shader.slug, shader.name, shader.description)}>{busy ? <LoaderCircle className="spin" size={17} /> : selected ? <Check size={17} /> : <SunMedium size={17} />}{selected ? t('Selected') : t('Add & enable')}</button>
            </article>
          )
        })}
      </div>

      <p className="footnote">{t('Shader support changes by Minecraft version and pack release. Hearth downloads a matching release where available; visual compatibility still needs an in-game check.')}</p>
    </div>
  )
}
