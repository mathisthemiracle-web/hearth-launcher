import { useEffect, useState } from 'react'
import { Boxes, Flame, Home, Library, LoaderCircle, Package, Settings, SunMedium } from 'lucide-react'
import { Toaster } from 'sonner'
import { Brand, PlayerHead } from './components/Common'
import { LauncherProvider, useLauncher } from './state/LauncherContext'
import { isTauri } from './lib/bridge'
import type { Page } from './types'
import HomePage from './pages/HomePage'
import InstancesPage from './pages/InstancesPage'
import ModsPage from './pages/ModsPage'
import PresetsPage from './pages/PresetsPage'
import ShadersPage from './pages/ShadersPage'
import SettingsPage from './pages/SettingsPage'
import LibraryPage from './pages/LibraryPage'

const NAV = [
  { id: 'home' as Page, label: 'Home', icon: Home },
  { id: 'instances' as Page, label: 'Instances', icon: Boxes },
  { id: 'presets' as Page, label: 'Performance', icon: Flame },
  { id: 'mods' as Page, label: 'Mods', icon: Package },
  { id: 'shaders' as Page, label: 'Shaders', icon: SunMedium },
  { id: 'library' as Page, label: 'Library', icon: Library },
  { id: 'settings' as Page, label: 'Settings', icon: Settings },
]

function LauncherShell() {
  const [page, setPage] = useState<Page>('home')
  const { busy, activeInstance, account, gameRunning, t } = useLauncher()

  // Pause decorative animation when the window is hidden or minimised.
  useEffect(() => {
    const update = () => document.documentElement.classList.toggle('is-hidden', document.hidden)
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  function navigate(next: Page) {
    setPage(next)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">{t('Skip to content')}</a>
      <aside className="sidebar">
        <Brand />
        <nav className="sidebar-nav" aria-label="Main navigation">
          {NAV.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'is-active' : ''} onClick={() => navigate(id)} aria-current={page === id ? 'page' : undefined}><Icon size={19} strokeWidth={1.9} /><span>{t(label)}</span></button>)}
        </nav>
        <button className="sidebar-player" onClick={() => navigate('settings')}>
          <PlayerHead uuid={account?.uuid} name={account?.username} />
          <span><strong>{account?.username ?? t('Connect your account')}</strong><small>{gameRunning ? t('In game right now') : account ? t('Java Edition verified') : t('Microsoft sign-in')}</small></span>
        </button>
        <div className="sidebar-note">
          <span className={`runtime-dot ${isTauri ? 'is-desktop' : ''}`} />
          <span>{isTauri ? t('Rust core ready') : t('Browser preview')} · v0.3</span>
        </div>
      </aside>

      <main className="main-content" id="main-content">
        {busy && <div className="busy-banner" role="status"><LoaderCircle className="spin" size={16} /><span>{busy}</span><small>{activeInstance.name}</small></div>}
        {page === 'home' && <HomePage navigate={navigate} />}
        {page === 'instances' && <InstancesPage />}
        {page === 'mods' && <ModsPage />}
        {page === 'presets' && <PresetsPage />}
        {page === 'shaders' && <ShadersPage />}
        {page === 'library' && <LibraryPage />}
        {page === 'settings' && <SettingsPage />}
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {NAV.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'is-active' : ''} onClick={() => navigate(id)} aria-current={page === id ? 'page' : undefined}><Icon size={20} /><span>{t(label)}</span></button>)}
      </nav>
      <Toaster position="bottom-right" theme="dark" closeButton toastOptions={{ style: { background: 'var(--surface-2)', border: '1px solid var(--line-strong)', color: 'var(--ink)' } }} />
    </div>
  )
}

export default function App() {
  return <LauncherProvider><LauncherShell /></LauncherProvider>
}
