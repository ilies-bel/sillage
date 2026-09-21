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
 *
 * **That sentence was an argument, not a measurement, and for as long as it stood
 * it was false.** Driven on `agenda-preparer` at 960×600 with the pill forced
 * back on, against the `max-w-[42ch]` objet that shipped beside it:
 *
 *     sans la pastille   objet 379.41px de boîte, 365.41 de contenu, 368.84 de texte → coupé
 *     avec la pastille   objet 343.06px de boîte, 329.06 de contenu, 368.84 de texte → coupé
 *
 * The trade bought 36.35px of a title that ended in an ellipsis either way: the
 * cap, not the pill, was what the title was losing to. `MeetingTitle` lifted the
 * cap, and only then did this become true — same stage, same fixture, after:
 * without the pill the objet holds all 368.84px of its text, with it 329.06,
 * 39.78px short, about five characters. The legend is now paid for by something
 * a rep can see, which is what the paragraph above always claimed.
 */
import { Languages } from 'lucide-react'
import { TRANSCRIPTION_LANGUAGE, languageChip } from '../../../electron/core/contracts/transcript.ts'

export function LanguagePill() {
  const chip = languageChip(TRANSCRIPTION_LANGUAGE)
  return (
    <span
      className="header-legend border-card bg-inner text-muted inline-flex shrink-0 items-center gap-tight rounded-sm border px-snug py-hair text-meta"
      aria-label={`Transcription en ${chip === 'FR' ? 'français' : chip}`}
    >
      <Languages aria-hidden size={12} strokeWidth={2} />
      {chip}
    </span>
  )
}
