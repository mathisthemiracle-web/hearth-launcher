import { useState } from 'react'
import { Check, LoaderCircle, Sparkles } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MOD_LIBRARY, PRESETS } from '../data'
import { useLauncher } from '../state/LauncherContext'
import type { Preset } from '../types'
import { PageHeader } from '../components/Common'

export default function PresetsPage() {
  const { activeInstance, applyPreset, busy, state, t } = useLauncher()
  const [selected, setSelected] = useState<Preset | null>(null)

  async function confirm() {
    if (!selected) return
    const preset = selected
    setSelected(null)
    await applyPreset(preset)
  }

  return (
    <div className="page">
      <PageHeader eyebrow={t('Good defaults, honest trade-offs')} title={t('Pick your pace')} description={t('Each preset sets the optimisation mods, memory, render distance and far-terrain radius together. Every mod is a real, maintained project, and nothing promises magic FPS.')} />
      {!['fabric', 'quilt'].includes(activeInstance.loader) && <div className="inline-notice"><strong>{t('Fabric or Quilt needed for presets.')}</strong> {t('Your active instance uses {loader}; individual mod browsing still works.', { loader: activeInstance.loader })}</div>}

      <div className="preset-grid">
        {PRESETS.map((preset, index) => {
          const current = activeInstance.presetId === preset.id
          return (
            <article className={`preset-card preset-card--${preset.accent} ${index === 1 ? 'preset-card--featured' : ''} ${current ? 'is-current' : ''}`} key={preset.id}>
              <div className="preset-card__top"><span>{t(preset.eyebrow)}</span><span>{t(preset.tier)}</span></div>
              <h2>{preset.name}</h2>
              <h3>{t(preset.tagline)}</h3>
              <p>{t(preset.description)}</p>
              <div className="preset-metrics">
                <span><strong>{preset.memoryGb}</strong> GB RAM</span>
                <span><strong>{preset.renderDistance}</strong> {t('near chunks')}</span>
                {preset.lodDistance > 0 && <span><strong>{preset.lodDistance}</strong> {t('far chunks')}</span>}
              </div>
              <div className="preset-mod-preview">
                {preset.mods.slice(0, 5).map((slug) => <span key={slug}>{MOD_LIBRARY.find((mod) => mod.slug === slug)?.name ?? slug}</span>)}
                <span>+{Math.max(0, preset.mods.length - 5)}</span>
              </div>
              <div className="preset-card__footer"><small>{t(preset.bestFor)}</small><button className={`button button--small ${current ? 'button--quiet' : 'button--primary'}`} onClick={() => setSelected(preset)} disabled={Boolean(busy) || !['fabric', 'quilt'].includes(activeInstance.loader)}>{current ? <><Check size={16} />{t('Current')}</> : <>{t('Use preset')}</>}</button></div>
            </article>
          )
        })}
      </div>

      <section className="honest-note">
        <Sparkles size={22} />
        <div><h2>{t('High distance without the tall tales.')}</h2><p>{t('Distant Horizons draws simplified terrain far beyond normal chunks, and Hearth writes your chosen radius into its config. It still needs CPU time and memory, and shader packs must support it. Start with the preset, then raise the radius in Instances once you’ve seen how your PC copes.')}</p></div>
      </section>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="hearth-dialog hearth-dialog--wide">
          <DialogHeader><p className="eyebrow">{t('Apply to {name}', { name: activeInstance.name })}</p><DialogTitle>{selected?.name}</DialogTitle><DialogDescription>{t(selected?.description ?? '')}</DialogDescription></DialogHeader>
          <div className="preset-confirm-grid">
            <div><span>{t('Memory')}</span><strong>{selected?.memoryGb} GB</strong></div><div><span>{t('Near chunks')}</span><strong>{selected?.renderDistance}</strong></div><div><span>{t('Distant terrain')}</span><strong>{selected?.lodDistance || t('Off')}</strong></div><div><span>{t('Shaders')}</span><strong>{selected?.shadersEnabled ? t('Ready') : t('Off')}</strong></div>
          </div>
          <p className="dialog-note">{t('Mods you added yourself are kept. Anything without a build for {version} is skipped and listed, so the rest still works.', { version: activeInstance.version })}{state.settings.autoBackup ? ` ${t('Your worlds are backed up first.')}` : ''}</p>
          <div className="dialog-actions"><button className="button button--quiet" onClick={() => setSelected(null)}>{t('Cancel')}</button><button className="button button--primary" onClick={confirm} disabled={Boolean(busy)}>{busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{t('Apply preset')}</button></div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
