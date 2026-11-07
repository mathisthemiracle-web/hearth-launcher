import { ArrowUpRight, Box, ChevronRight } from 'lucide-react'
import { memo, useState, type CSSProperties, type ReactNode } from 'react'
import type { Instance, ProjectSearchResult } from '../types'
import { formatDownloads } from '../lib/format'

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`}>
      <img src="./hearth-mark.svg" alt="" className="brand__mark" />
      {!compact && <div><span className="brand__name">Hearth</span><span className="brand__sub">Minecraft launcher</span></div>}
    </div>
  )
}

export function PlayerHead({ uuid, name, size = 40 }: { uuid?: string; name?: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className="player-head" style={{ width: size, height: size }} aria-hidden="true">
      {uuid && !failed
        ? <img src={`https://mc-heads.net/avatar/${uuid}/${size * 2}`} alt="" onError={() => setFailed(true)} loading="lazy" />
        : (name?.slice(0, 1).toUpperCase() ?? '?')}
    </span>
  )
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  )
}

export function InstanceBadge({ instance, large = false }: { instance: Instance; large?: boolean }) {
  const palette = ['badge--coral', 'badge--gold', 'badge--mint', 'badge--teal']
  const index = instance.id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length
  return (
    <span className={`instance-badge ${palette[index]} ${large ? 'instance-badge--large' : ''}`} aria-hidden="true">
      <Box size={large ? 26 : 19} strokeWidth={1.9} />
    </span>
  )
}

/** Blocky, Minecraft-like ridge line built from fixed steps. */
function ridge(heights: number[], step: number, base: number) {
  let d = `M0 ${base}`
  heights.forEach((h, i) => { d += ` V${h} H${(i + 1) * step}` })
  return `${d} V${base} Z`
}

const FAR = [250, 250, 232, 232, 214, 196, 196, 214, 232, 250, 232, 214, 214, 196, 178, 178, 196, 214, 232, 232, 250, 250, 232, 214, 214, 232, 250, 268, 268, 250]
const MID = [318, 300, 300, 282, 282, 300, 318, 318, 300, 282, 264, 264, 282, 300, 300, 318, 336, 318, 300, 300, 282, 300, 318, 336, 336, 318, 300, 300, 318, 336]
const STARS: Array<[number, number, number]> = [
  [60, 40, 3], [140, 90, 2], [220, 30, 3], [300, 120, 2], [370, 60, 3], [450, 24, 2], [520, 100, 3], [600, 48, 2],
  [660, 130, 2], [720, 30, 3], [790, 86, 2], [860, 20, 2], [930, 70, 3], [1010, 40, 2], [1080, 110, 3], [1150, 54, 2],
  [250, 170, 2], [560, 160, 2], [990, 160, 2], [400, 150, 2], [1120, 160, 2], [30, 130, 2],
]
const TREES = [70, 150, 255, 330, 610, 690, 1020, 1100, 1160]
const EMBERS: Array<[number, number, string]> = [[-6, 0, '18px'], [4, -6, '-12px'], [10, 2, '22px'], [-12, -4, '-20px'], [0, -10, '8px'], [7, 4, '-6px']]

/**
 * The night-time campfire behind the Play button. Pure SVG with CSS
 * transform/opacity animations, paused automatically while the game runs.
 */
export const CampfireScene = memo(function CampfireScene() {
  return (
    <div className="campfire-scene" aria-hidden="true">
      <svg viewBox="0 0 1200 440" preserveAspectRatio="xMidYMax slice">
        <defs>
          <linearGradient id="cf-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0e1024" />
            <stop offset=".55" stopColor="#261a33" />
            <stop offset="1" stopColor="#4a2620" />
          </linearGradient>
          <radialGradient id="cf-moon" cx=".5" cy=".5" r=".5">
            <stop offset="0" stopColor="#fff3d6" stopOpacity=".55" />
            <stop offset="1" stopColor="#fff3d6" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="cf-fireglow" cx=".5" cy=".5" r=".5">
            <stop offset="0" stopColor="#ff8a3d" stopOpacity=".55" />
            <stop offset=".45" stopColor="#ff6a2b" stopOpacity=".18" />
            <stop offset="1" stopColor="#ff6a2b" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="cf-flame-a" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#ff4d16" />
            <stop offset="1" stopColor="#ff9a45" />
          </linearGradient>
          <linearGradient id="cf-flame-b" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#ff8a3d" />
            <stop offset="1" stopColor="#ffd28a" />
          </linearGradient>
        </defs>

        <rect width="1200" height="440" fill="url(#cf-sky)" />
        <circle cx="1010" cy="92" r="90" fill="url(#cf-moon)" />
        <rect x="986" y="68" width="48" height="48" rx="4" fill="#fbe9c4" />
        <rect x="1000" y="80" width="10" height="10" fill="#e9d3a8" />
        <rect x="1016" y="96" width="8" height="8" fill="#e9d3a8" />
        <g fill="#fff3d6">
          {STARS.map(([x, y, s], i) => <rect key={i} className="cf-star" x={x} y={y} width={s} height={s} />)}
        </g>

        <path d={ridge(FAR, 40, 440)} fill="#2a2140" />
        <path d={ridge(MID, 40, 440)} fill="#1d1a26" />
        <g fill="#141219">
          {TREES.map((x, i) => (
            <g key={x} transform={`translate(${x} ${300 + (i % 3) * 10})`}>
              <rect x="-4" y="40" width="8" height="18" fill="#2b1d16" />
              <path d="M0 -6 L22 22 H12 L28 44 H-28 L-12 22 H-22 Z" />
            </g>
          ))}
        </g>
        <rect y="392" width="1200" height="48" fill="#120e10" />
        <rect y="388" width="1200" height="6" fill="#1d1612" />

        {/* tent */}
        <g transform="translate(700 300)">
          <path d="M0 92 L62 0 L124 92 Z" fill="#3b2a24" />
          <path d="M62 0 L124 92 H92 Z" fill="#2c1f1b" />
          <path d="M52 92 L62 56 L72 92 Z" fill="#ff8a3d" opacity=".35" />
        </g>

        {/* fire */}
        <g transform="translate(900 392)">
          <ellipse className="cf-glow" cx="0" cy="-26" rx="190" ry="120" fill="url(#cf-fireglow)" />
          <g>
            <path className="cf-flame" d="M0 -118 C18 -84 46 -66 46 -34 C46 -12 26 0 0 0 C-26 0 -46 -12 -46 -34 C-46 -56 -30 -66 -24 -82 C-20 -66 -12 -58 -6 -56 C-10 -80 -8 -100 0 -118 Z" fill="url(#cf-flame-a)" />
            <path className="cf-flame cf-flame--mid" d="M2 -86 C14 -64 30 -52 30 -30 C30 -12 18 -2 0 -2 C-18 -2 -30 -12 -30 -30 C-30 -44 -20 -52 -16 -60 C-12 -48 -6 -44 -2 -44 C-6 -60 -4 -74 2 -86 Z" fill="url(#cf-flame-b)" />
            <path className="cf-flame cf-flame--core" d="M0 -52 C8 -40 16 -32 16 -20 C16 -10 9 -4 0 -4 C-9 -4 -16 -10 -16 -20 C-16 -30 -8 -38 0 -52 Z" fill="#fff0c4" />
          </g>
          <g stroke="#140c08" strokeWidth="3" strokeLinejoin="round">
            <rect x="-62" y="-12" width="124" height="18" rx="9" fill="#7a4a2e" transform="rotate(-12)" />
            <rect x="-62" y="-12" width="124" height="18" rx="9" fill="#93593a" transform="rotate(12)" />
          </g>
          <g fill="#4a4048">
            <rect x="-78" y="-6" width="18" height="12" rx="4" />
            <rect x="60" y="-6" width="18" height="12" rx="4" />
            <rect x="-40" y="2" width="16" height="10" rx="4" />
            <rect x="24" y="2" width="16" height="10" rx="4" />
          </g>
          <g fill="#ffb35c">
            {EMBERS.map(([x, y, drift], i) => (
              <rect key={i} className="cf-ember" x={x} y={-70 + y} width="4" height="4" style={{ '--drift': drift } as CSSProperties} />
            ))}
          </g>
        </g>

        {/* log seat */}
        <g transform="translate(1030 372)" stroke="#140c08" strokeWidth="3">
          <rect x="0" y="0" width="120" height="22" rx="11" fill="#6a4029" />
          <circle cx="11" cy="11" r="8" fill="#b07a52" />
        </g>
      </svg>
    </div>
  )
})

export function ProjectRow({ project, action, actionLabel, disabled }: {
  project: ProjectSearchResult
  action: () => void
  actionLabel: string
  disabled?: boolean
}) {
  return (
    <article className="project-row">
      {project.iconUrl
        ? <img className="project-row__icon" src={project.iconUrl} alt="" loading="lazy" decoding="async" />
        : <span className="project-row__icon project-row__icon--fallback"><Box size={22} /></span>}
      <div className="project-row__copy">
        <div className="project-row__title"><h3>{project.title}</h3><span>{formatDownloads(project.downloads)} downloads</span></div>
        <p>{project.description}</p>
        <small>by {project.author} · Modrinth</small>
      </div>
      <button className="button button--small button--outline" onClick={action} disabled={disabled}>
        {actionLabel}<ChevronRight size={15} />
      </button>
    </article>
  )
}

export function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button className="text-link" onClick={onClick}>{children}<ArrowUpRight size={15} /></button>
}
