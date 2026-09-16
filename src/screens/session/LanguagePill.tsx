/**
 * « FR » — the language the app is transcribing this call in.
 *
 * **Display only, and not a setting.** DEC-34 says no environment variable is
 * required to run this app, and the corollary the other way round is that a
 * control on screen has to do something: v1 transcribes French — every row in
 * `STT_PROVIDERS` declares `fr-FR`, and `recordingOptionsFor` asks the registry
 * for that tag — so a picker here would offer a choice the engines cannot
 * honour. `TRANSCRIPTION_LANGUAGE` is the one place the product states it, and
 * this reads that rather than a string of its own.
 *
 * It is in the header because the answer matters before the compte-rendu: a rep
 * about to take a call in English is better told here than told by the document.
 *
 * `header-legend`: below a 1080px header it goes, with the meter's channel key,
 * because at the app's own minimum window (960px) the fifty pixels it takes are
 * the meeting's own title truncating. A legend is what a narrow header drops;
 * the instrument stays.
 */
import { Languages } from 'lucide-react'
import { TRANSCRIPTION_LANGUAGE, languageChip } from '../../../electron/core/contracts/transcript.ts'

export function LanguagePill() {
  const chip = languageChip(TRANSCRIPTION_LANGUAGE)
  return (
    <span
      className="header-legend border-card bg-inner text-muted inline-flex shrink-0 items-center gap-tight rounded-sm border px-snug py-0.5 text-meta"
      aria-label={`Transcription en ${chip === 'FR' ? 'français' : chip}`}
    >
      <Languages aria-hidden size={12} strokeWidth={2} />
      {chip}
    </span>
  )
}
