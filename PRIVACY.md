# Privacy

The product records meetings. That makes these guarantees load-bearing rather
than reassuring, so each one names the decision it comes from in
[VISION.md](./VISION.md).

## Raw audio is never retained (DEC-12)

Audio is captured, streamed to a transcriber, and discarded. Frames are not
buffered to disk, not written to a temp file, and not included in diagnostic
bundles. What persists is the transcript.

## The recording is local by default

The event log is a SQLite database in the OS's per-user application-data
directory. Transcripts, notes and extraction results stay there. Nothing is
uploaded anywhere the operator has not configured.

## Where speech goes

Two modes, both explicit:

- **Local** — Whisper runs on the machine. Audio never leaves it (HR-4).
- **EU cloud** — an EU-resident provider. HR-11 excludes Soniox, ElevenLabs and
  Speechmatics; Deepgram is used only if its EU tier is confirmed.

## What leaves the machine, and when

Nothing leaves without a human act.

- **Microsoft Graph** — reads the calendar and the prior mail thread for the
  meeting's participants (DEC-15). Writes exactly one thing: an email **draft**
  (`Mail.ReadWrite`, never `Mail.Send` — HR-8). It never writes to an event body
  (DEC-10), because that mails every attendee.
- **VerySwing (VSA)** — receives the compte-rendu and any opportunity update
  only after the rep confirms, once, on a screen showing what will be sent
  (DEC-4).

## What the AI is and is not allowed to do

The model interprets; it does not supply facts. Attendee names, email addresses,
dates and account codes come from Graph or from VSA, never from a model (DEC-7).
Every interpretive field cites a span of the transcript, and the app verifies
that span exists before showing it — an unverifiable claim is marked `⚠ faible`
rather than presented as confident (DEC-21).

The AI never writes into the rep's document during a call. Its text enters the
document once, at meeting end, in grey, for the rep to accept or reject (DEC-5,
DEC-14).

## Telemetry

None. The previous product in this repository sent anonymous install pings; that
code is deleted. If telemetry is reintroduced it will be opt-in and EU-hosted
(HR-11).

## Consent

The app records a meeting the user is in, from the user's own machine. It never
joins the call and never appears to other participants as a bot. Telling the
other participants that the meeting is being recorded is the user's
responsibility, and in most European jurisdictions it is a legal one.
