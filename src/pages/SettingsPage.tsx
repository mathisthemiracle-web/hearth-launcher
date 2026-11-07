import { useRef, useState } from 'react'
import { Copy, Download, ExternalLink, LoaderCircle, LogOut, RotateCcw, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { beginMicrosoftLogin, cancelMicrosoftLogin, completeMicrosoftLogin, errorMessage, isTauri, microsoftSignOut, openExternal } from '../lib/bridge'
import { useLauncher } from '../state/LauncherContext'
import type { DeviceCodeInfo, Language, LauncherState } from '../types'
import { PageHeader, PlayerHead, TextLink } from '../components/Common'

const CLIENT_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function SettingsPage() {
  const { state, account, system, setAccount, updateSettings, importState, resetState, t } = useLauncher()
  const fileRef = useRef<HTMLInputElement>(null)
  const [resetting, setResetting] = useState(false)
  const [importError, setImportError] = useState('')
  const [authError, setAuthError] = useState('')
  const [device, setDevice] = useState<DeviceCodeInfo | null>(null)
  const [signing, setSigning] = useState(false)
  const clientId = state.settings.microsoftClientId
  const clientIdValid = CLIENT_ID_SHAPE.test(clientId)
  const s = state.settings

  function exportSettings() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'hearth-settings.json'
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function importSettings(file?: File) {
    if (!file) return
    setImportError('')
    try {
      const parsed = JSON.parse(await file.text()) as LauncherState
      if (!Array.isArray(parsed.instances) || !parsed.settings) throw new Error(t('This file does not look like a Hearth settings export.'))
      importState(parsed)
    } catch (error) {
      setImportError(errorMessage(error, t('The settings file could not be read.')))
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function connectMicrosoft() {
    setAuthError('')
    setSigning(true)
    try {
      const code = await beginMicrosoftLogin(clientId)
      setDevice(code)
      void navigator.clipboard?.writeText(code.userCode).catch(() => undefined)
      void openExternal(code.verificationUri)
      const profile = await completeMicrosoftLogin(clientId, code)
      setAccount(profile)
      toast.success(t('Welcome, {name}. Java Edition ownership verified.', { name: profile.username }))
    } catch (error) {
      const message = errorMessage(error, t('Microsoft sign-in could not finish.'))
      if (message !== 'Sign-in cancelled.') setAuthError(message)
    } finally {
      setDevice(null)
      setSigning(false)
    }
  }

  async function cancelSignIn() {
    await cancelMicrosoftLogin().catch(() => undefined)
    setDevice(null)
    setSigning(false)
  }

  async function disconnectMicrosoft() {
    try {
      await microsoftSignOut()
      setAccount(null)
      setDevice(null)
      toast.success(t('Microsoft account disconnected from Hearth.'))
    } catch (error) {
      setAuthError(errorMessage(error, t('The account could not be disconnected.')))
    }
  }

  const toggle = (key: 'boostPriority' | 'gpuHighPerformance' | 'closeOnLaunch' | 'autoBackup' | 'sounds' | 'reduceMotion', title: string, detail: string) => (
    <label className="setting-row"><span><strong>{t(title)}</strong><small>{t(detail)}</small></span><input type="checkbox" checked={s[key]} onChange={(event) => updateSettings({ [key]: event.target.checked })} /></label>
  )

  return (
    <div className="page settings-page">
      <PageHeader eyebrow={t('Account, comfort and data')} title={t('Your campfire, your rules')} description={t('Connect the account that owns Minecraft, decide how Hearth behaves while you play, and keep every setup portable.')} />

      <div className="settings-sections">
        <section className="settings-section account-section">
          <div><p className="eyebrow">{t('Microsoft account')}</p><h2>{t('Your player identity')}</h2></div>
          <div className="settings-rows">
            {account ? (
              <div className="account-connected">
                <PlayerHead uuid={account.uuid} name={account.username} size={52} />
                <span><strong>{account.username}</strong><small>{t('Java Edition ownership verified')} · {account.uuid}</small></span>
                <button className="button button--outline button--small" onClick={disconnectMicrosoft}><LogOut size={15} />{t('Disconnect')}</button>
              </div>
            ) : (
              <>
                <label className="client-id-field">
                  <span>{t('Microsoft Entra application (client) ID')}</span>
                  <input type="text" value={clientId} onChange={(event) => updateSettings({ microsoftClientId: event.target.value.trim() })} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autoComplete="off" spellCheck={false} />
                  {clientId && !clientIdValid && <small style={{ color: 'var(--danger)' }}>{t('That does not look like an Entra client ID. It has 36 characters in five groups.')}</small>}
                  <small>{t('Free to create. The client ID is not a secret and Hearth never sees your password.')}</small>
                </label>
                <ol className="help-steps">
                  <li>entra.microsoft.com → App registrations → New registration → <code>Personal Microsoft accounts only</code></li>
                  <li>Redirect URI: <code>Public client/native</code> → <code>http://localhost</code></li>
                  <li>Authentication → <code>Allow public client flows</code> = Yes</li>
                  <li>{t('New apps need Mojang’s approval before Minecraft accepts them:')} <button type="button" className="text-link" onClick={() => openExternal('https://aka.ms/mce-reviewappid')}>{t('submit your ID')}</button></li>
                </ol>
                <div className="setting-row setting-row--actions">
                  <button className="button button--primary" onClick={connectMicrosoft} disabled={!isTauri || signing || !clientIdValid}>
                    {signing ? <LoaderCircle className="spin" size={17} /> : <ExternalLink size={17} />}{signing ? t('Waiting for Microsoft') : t('Connect Microsoft')}
                  </button>
                  {!isTauri && <small>{t('Account sign-in is available only in the desktop app.')}</small>}
                </div>
              </>
            )}
            {device && (
              <div className="device-login" role="status">
                <span>{t('Enter this code at')} <strong>{device.verificationUri.replace('https://', '')}</strong>. {t('It is already copied.')}</span>
                <button className="code" onClick={() => navigator.clipboard.writeText(device.userCode).then(() => toast.success(t('Code copied.')))} aria-label={t('Copy code')}><strong>{device.userCode}</strong><Copy size={17} /></button>
                <div className="device-foot">
                  <span>{t('Your browser should be open. Hearth is waiting for Microsoft to confirm.')}</span>
                  <button className="button button--quiet button--small" onClick={cancelSignIn}><X size={15} />{t('Cancel')}</button>
                </div>
              </div>
            )}
            {authError && <p className="form-error" role="alert">{authError}</p>}
          </div>
        </section>

        <section className="settings-section">
          <div><p className="eyebrow">{t('While you play')}</p><h2>{t('Performance')}</h2></div>
          <div className="settings-rows">
            {toggle('boostPriority', 'Give Minecraft priority', 'Starts the game with “above normal” Windows priority so background apps get out of its way.')}
            {toggle('gpuHighPerformance', 'Use the high-performance GPU', 'Tells Windows to run Minecraft’s Java on your dedicated graphics card, not the integrated one. Matters most on laptops.')}
            {toggle('closeOnLaunch', 'Minimise Hearth while playing', 'Hearth steps aside and pauses its animations and sounds, then comes back when the game closes.')}
          </div>
        </section>

        <section className="settings-section">
          <div><p className="eyebrow">{t('Comfort')}</p><h2>{t('Look, sound & language')}</h2></div>
          <div className="settings-rows">
            <label className="setting-row"><span><strong>{t('Language')}</strong><small>{t('Interface language.')}</small></span><select value={s.language} onChange={(event) => updateSettings({ language: event.target.value as Language })}><option value="fr">Français (Québec)</option><option value="en">English</option></select></label>
            {toggle('sounds', 'Campfire sounds', 'A soft crackle while Hearth is open. Silent while you play.')}
            {toggle('reduceMotion', 'Reduce interface motion', 'Freezes the campfire and other decorative movement.')}
            <label className="setting-row"><span><strong>{t('Colour mood')}</strong><small>{t('Campfire night is the default. Morning camp is lighter.')}</small></span><select value={s.theme} onChange={(event) => updateSettings({ theme: event.target.value as 'light' | 'dark' })}><option value="dark">{t('Campfire night')}</option><option value="light">{t('Morning camp')}</option></select></label>
          </div>
        </section>

        <section className="settings-section">
          <div><p className="eyebrow">{t('Safety')}</p><h2>{t('Worlds & hardware')}</h2></div>
          <div className="settings-rows">
            {toggle('autoBackup', 'Back up worlds automatically', 'Before a preset or “Update all mods” changes anything, each world is zipped. The last 5 automatic backups per world are kept.')}
            {system ? (
              <div className="setting-row"><span><strong>{system.totalRamGb} GB RAM · {system.cpuThreads} {t('CPU threads')}</strong><small>{t('Detected automatically and used to recommend a preset and memory size.')}</small></span></div>
            ) : (
              <label className="range-field"><span>{t('System memory')} <strong>{s.systemRamGb} GB</strong></span><input type="range" min="4" max="64" step="4" value={s.systemRamGb} onChange={(event) => updateSettings({ systemRamGb: Number(event.target.value) })} /><small>{t('The desktop app detects this for you.')}</small></label>
            )}
          </div>
        </section>

        <section className="settings-section">
          <div><p className="eyebrow">{t('Your data')}</p><h2>{t('Portable and plain')}</h2></div>
          <div className="settings-rows">
            <div className="setting-row"><span><strong>{isTauri ? t('Stored on this computer') : t('Browser preview storage')}</strong><small>{isTauri ? t('Settings live in %APPDATA%\\Hearth. The Microsoft session is kept in Windows Credential Manager.') : t('Preview changes stay in this browser only.')}</small></span></div>
            <div className="setting-row setting-row--actions"><button className="button button--outline" onClick={exportSettings}><Download size={17} />{t('Export setup')}</button><button className="button button--outline" onClick={() => fileRef.current?.click()}><Upload size={17} />{t('Import setup')}</button><input ref={fileRef} type="file" accept="application/json" hidden onChange={(event) => importSettings(event.target.files?.[0])} /></div>
            {importError && <p className="form-error" role="alert">{importError}</p>}
            <div className="setting-row"><span><strong>{t('Start over')}</strong><small>{t('Resets Hearth’s instance list and preferences. Your account, worlds and downloaded files stay.')}</small></span><button className="button button--quiet" onClick={() => setResetting(true)}><RotateCcw size={16} />{t('Reset')}</button></div>
          </div>
        </section>
      </div>

      <footer className="settings-footer"><span>Hearth 0.3 · Rust + Tauri</span><TextLink onClick={() => openExternal('https://modrinth.com')}>{t('Mods & shaders from Modrinth')}</TextLink></footer>

      <Dialog open={resetting} onOpenChange={setResetting}>
        <DialogContent className="hearth-dialog"><DialogHeader><DialogTitle>{t('Reset Hearth’s setup?')}</DialogTitle><DialogDescription>{t('This clears launcher preferences and the instance list. It never deletes Minecraft worlds or disconnects your account.')}</DialogDescription></DialogHeader><div className="dialog-actions"><button className="button button--quiet" onClick={() => setResetting(false)}>{t('Cancel')}</button><button className="button button--danger" onClick={() => { resetState(); setResetting(false) }}>{t('Reset setup')}</button></div></DialogContent>
      </Dialog>
    </div>
  )
}
