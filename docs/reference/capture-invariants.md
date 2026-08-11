# Capture-path invariants

ARCHITECTURE.md §3 keeps `SystemAudioCapture`, `MicrophoneCapture`, `AudioDevices` and the
whisper worker **as-is**. It does not keep `main.ts`, which is where their lifecycle was
actually orchestrated — start, stop, recovery, teardown ordering.

Roughly forty tests asserted that orchestration by reading `main.ts` and `ipcHandlers.ts`
as *text*. They died with those files. What they asserted did not: these are behaviours the
capture path needs whatever orchestrates it, and most were written in response to a real bug.

**This is the acceptance checklist for step 2** (ARCHITECTURE.md §6) and, where the rule is
about session lifecycle rather than the device, for `app/session/MeetingSession.ts`. Each item
below was a passing assertion before demolition. Re-establish it as a test against the new
orchestrator — this time against the module, not against a file's source text.

Recovered from `electron/audio/__tests__/` at commit `93053e8`.

---

## 1. Device selection

**Bluetooth HFP avoidance.** Opening a Bluetooth mic forces the headset into HFP, which
collapses the *output* to 8 kHz narrowband — the far end becomes unusable to transcribe.

- Recognise Bluetooth output devices by name heuristic (OnePlus, generic TWS earbuds)
  without false-positiving on built-in or USB device names.
- Resolve the *effective* output name for the default output before deciding.
- When the output is Bluetooth, select the **built-in mic** before opening `MicrophoneCapture`.
- An unresolved explicit output id is treated as **unsafe** — assume HFP risk, don't guess.
- CoreAudio output selection must match suffixed output ids rather than silently falling
  back to default.

This one matters more here than it did in the old product: DEC-26 says the capture path has
no network dependency, so a degraded local capture is unrecoverable downstream.

## 2. Start / stop ordering

- **Microphone starts before system audio.** Every path: `startMeeting`, reconfigure,
  STT-provider change, resume-from-sleep, mic recovery.
- Disable mic pre-warm immediately *before* stopping the mic on reconfigure.
- `endMeeting` nulls both capture fields **synchronously**, forcing the serialized
  recreate path.
- `endMeeting` tears down via `destroy()`, never fire-and-forget `stop()`.
- Teardown is threaded into a pending-teardown promise that `startMeeting` awaits **up
  front**, before async audio init.

> **The second-meeting deadlock.** Meeting 2's mic must not be constructed until meeting 1's
> `destroy()` resolves. Overlapping HAL handles deadlock the audio unit. This is the bug that
> produced half the rules above — treat the ordering as load-bearing, not stylistic.

## 3. Generation tokens — stale async work must not touch live state

A meeting start captures a generation token; `endMeeting` invalidates it. Every awaited
step re-checks it after resuming:

- Route-change rebuild aborts when the generation changed mid-await.
- Microphone recovery aborts when the generation changed mid-await.
- System-audio recovery aborts when the generation changed mid-await.
- Deferred audio init aborts *and destroys* the captures it created if it lost the race.
- `startMeeting` resets recovery counters so a stale meeting cannot consume the new
  meeting's retry budget.

Audio init runs under an `AbortController`; `isCurrentMeeting()` includes `!signal.aborted`;
the init body clears the controller in a `finally`; `endMeeting` aborts **and awaits** the
in-flight init before touching captures, then clears it. Expected `audio_init_aborted`
errors are silenced rather than surfaced.

## 4. Mutual exclusion between recovery paths

Route-change handling and error-driven recovery can fire simultaneously and fight:

- `handleDefaultOutputChanged` bails when system-audio recovery is in progress, and
  **checks that flag before setting its own**.
- The recovery error listener bails when a default-output switch is in progress, and
  likewise checks before setting.

Check-then-set ordering is the whole point; reversing it reintroduces the race.

## 5. Watchdogs

- Both `wireSystemCapture` and `wireMicCapture` attach a disarm handle to the capture instance.
- Watchdogs are disarmed **before** captures are stopped, on both `endMeeting` and stale-init
  abort. Disarming after teardown fires a spurious stuck-capture alert.
- The timer body keeps a meeting-active guard as defence in depth.

## 6. Shutdown

- The default-output watcher interval body bails immediately once quitting.
- `before-quit` sets the quitting flag **before** stopping the watcher.
- Watcher shutdown precedes other subsystem stops.
- `stopDefaultOutputWatcher()` clears its interval symmetrically with the start call.

## 7. Silence classification

Silence is ambiguous: it can mean a quiet room or a broken permission. Guessing wrong either
cries wolf or hides a dead capture.

- `wireSystemCapture` delegates ambiguous silence to the audio health classifier.
- Sustained zero-valued system-output chunks **do not** raise a permission banner.
- A hard same-device route conflict **does** raise an actionable warning.

`systemAudioHealthClassifier.mjs` survives demolition and keeps its test.

## 8. Reconnect discipline (STT adapters)

Applies to whichever streaming adapter ships (Azure Speech / Gladia / Deepgram-EU):

- Capped exponential backoff, base delay ≥ 1 s.
- Jitter, to avoid a thundering herd when a provider blips across many clients.

`DeepgramStreamingSTT` survives and demonstrates the pattern; port it rather than reinventing.

## 9. Local whisper (the offline floor, HR-4)

- `main.ts` consumed the whisper load sentinel **before** any preload or validation — the
  new bootstrap must keep that ordering or a poisoned model reloads on every launch.
- The recovery notice needs a getter/setter, an IPC to pull it, and a renderer surface.
  Rebuild it in `modules/diagnostics/`, not as a bespoke channel.
- `local-whisper-set-model` validates the id against the model catalogue.
- Channel config validates non-empty mic and system ids.
- ONNX defaults disable the CPU memory arena and memory pattern; env vars can flip them;
  **every** local ONNX consumer routes through the shared helper. `onnxThreadConfig.ts` and
  `onnxLoadSentinel.ts` both survive.

## 10. Startup

- Acquire the single-instance lock **before** native ABI recovery can rebuild or relaunch,
  and request it exactly once.

`nativeArchGate.ts` and `lib/nativeArch.mjs` survive with their tests.

---

## Deliberately not carried forward

Activation-policy and dock-visibility ordering, content-protection dedupe, overlay and
launcher focus rules, interface-theme allowlists, IPC broadcast targeting between overlay
surfaces, RAG in-flight guards, and profile-upload gates. These asserted behaviours of the
stealth overlay and the answer assistant — both deleted (VISION.md §2, ARCHITECTURE.md §2).
The three-pane window in DEC-14 is an ordinary window and needs none of it.
