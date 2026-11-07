import { useEffect, useState } from 'react'
import { FolderOpen, LoaderCircle, Stethoscope } from 'lucide-react'
import { toast } from 'sonner'
import { diagnoseInstance, errorMessage, openInstanceSubfolder } from '../lib/bridge'
import { useLauncher } from '../state/LauncherContext'
import type { Diagnosis } from '../types'

/** Reads the newest crash report/log and explains it in plain words. */
export default function CrashDoctor({ autoRun = false }: { autoRun?: boolean }) {
  const { activeInstance, t, updateAllMods, busy } = useLauncher()
  const [result, setResult] = useState<Diagnosis | null>(null)
  const [running, setRunning] = useState(false)

  async function run() {
    setRunning(true)
    try {
      setResult(await diagnoseInstance(activeInstance.id))
    } catch (error) {
      toast.error(errorMessage(error, t('The crash doctor could not read the logs.')))
    } finally {
      setRunning(false)
    }
  }

  useEffect(() => {
    if (autoRun) void run()
    // Run once when shown from a failed launch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="doctor">
      {!result && (
        <button className="button button--outline" onClick={run} disabled={running}>
          {running ? <LoaderCircle className="spin" size={16} /> : <Stethoscope size={16} />}{t('Diagnose the last crash')}
        </button>
      )}
      {result && (
        <div className={`doctor__card ${result.found ? 'is-found' : ''}`}>
          <p className="eyebrow">{t('Crash doctor')}</p>
          <h3>{t(result.title)}</h3>
          <p>{t(result.explanation)}</p>
          {result.suspects.length > 0 && (
            <div className="doctor__suspects">
              <strong>{t('Likely involved')}</strong>
              {result.suspects.map((suspect) => <span key={suspect} className="chip chip--warn">{suspect}</span>)}
            </div>
          )}
          {result.fixes.length > 0 && <ul className="doctor__fixes">{result.fixes.map((fix) => <li key={fix}>{t(fix)}</li>)}</ul>}
          {result.excerpt && <pre className="log-tail">{result.excerpt}</pre>}
          <div className="card-actions">
            <button className="button button--small button--primary" onClick={() => void updateAllMods()} disabled={Boolean(busy)}>{t('Update all mods')}</button>
            <button className="button button--small button--outline" onClick={() => openInstanceSubfolder(activeInstance.id, 'crash-reports').catch((error) => toast.error(errorMessage(error, t('Could not open the folder.'))))}><FolderOpen size={15} />{t('Crash reports')}</button>
            <button className="button button--small button--quiet" onClick={run} disabled={running}>{t('Check again')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
