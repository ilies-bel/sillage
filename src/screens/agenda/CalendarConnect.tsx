/**
 * **The calendar's account, beside the calendar.**
 *
 * « Microsoft non connecté · Connecteurs › » used to sit in the empty day's
 * card — a sentence about the calendar drawn in the list, three columns away
 * from the grid it is about. It lives under the grid now, where a rep looking
 * at a month with no dots on it is looking, and it carries the one control
 * that changes it. Réglages › Calendrier is the same account with the longer
 * explanation.
 *
 * With no Entra registration (`AuthState.reason`, DEC-28) *Connecter* can only
 * reject, so the card states the condition and offers Réglages alone — a button
 * that does nothing is the defect DEC-26 names.
 */
import { CalendarDays } from 'lucide-react'
import { useState } from 'react'
import type { AuthState } from '../../../electron/core/contracts/identity.ts'
import { invoke } from '../../app/bridge.ts'
import { Button, unavailable } from '../../ui/index.ts'

export function CalendarConnect({
  auth,
  onReglages,
}: {
  auth: AuthState
  onReglages: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  if (auth.status === 'signedIn') return null

  const signIn = async () => {
    setBusy(true)
    setFailure(null)
    try {
      await invoke('auth:signIn', {})
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'La connexion Microsoft n’a pas abouti.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-label="Agenda Outlook"
      className="border-card bg-card mt-block rounded-sm border p-row"
    >
      <div className="flex items-start gap-inline">
        <span className="bg-brand-100 text-brand-700 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm">
          <CalendarDays size={18} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-strong text-ui font-semibold">Agenda Outlook</h3>
          <p className="text-muted mt-0.5 text-meta leading-relaxed">
            {auth.reason ??
              'Non connecté. Vos réunions, leurs participants et l’objet de l’invitation apparaîtront ici.'}
          </p>
          {failure ? (
            <p role="alert" className="text-danger mt-1 text-meta">
              {failure}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-row flex items-center gap-inline">
        {auth.reason ? null : (
          <Button onClick={() => void signIn()} {...unavailable(busy, 'Connexion en cours…')}>
            {busy ? 'Connexion…' : 'Connecter'}
          </Button>
        )}
        <Button variant="nav" onClick={onReglages}>
          En savoir plus ›
        </Button>
      </div>
    </section>
  )
}
