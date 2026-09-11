/**
 * Device enumeration.
 *
 * Moved from `electron/audio/AudioDevices.ts`, with the module-scope
 * `loadNativeModule()` made lazy for the same reason as its siblings — and here
 * there is a second reason that is not about testability. On macOS,
 * `getInputDevices()` instantiates `cpal::default_host()` and registers the
 * process with the CoreAudio HAL, which lights the orange microphone-in-use
 * indicator in the menu bar. Calling it at import time lit that indicator at
 * app launch, with no meeting running.
 */
import { loadNativeModule, type AudioDeviceInfo, type MicApp } from './nativeModule.ts'

export type { AudioDeviceInfo }

const empty = (kind: string, reason: string): AudioDeviceInfo[] => {
  console.warn(`[AudioDevices] ${kind} unavailable: ${reason}`)
  return []
}

export const getInputDevices = (): AudioDeviceInfo[] => {
  const result = loadNativeModule()
  if (!result.ok) return empty('input devices', result.reason)
  try {
    return result.module.getInputDevices()
  } catch (e) {
    return empty('input devices', e instanceof Error ? e.message : String(e))
  }
}

export const getOutputDevices = (): AudioDeviceInfo[] => {
  const result = loadNativeModule()
  if (!result.ok) return empty('output devices', result.reason)
  try {
    return result.module.getOutputDevices()
  } catch (e) {
    return empty('output devices', e instanceof Error ? e.message : String(e))
  }
}

/**
 * The current default output route. Polled during a meeting: when it changes,
 * the system capture has to be rebuilt or the tap keeps recording the old
 * device — which is silence, not an error.
 *
 * Returns null when the binary predates the function, so the caller can tell
 * "no route change" from "cannot tell".
 */
export const getDefaultOutputDeviceId = (): string | null => {
  const result = loadNativeModule()
  if (!result.ok || typeof result.module.getDefaultOutputDeviceId !== 'function') return null
  try {
    return result.module.getDefaultOutputDeviceId() || null
  } catch {
    return null
  }
}

/**
 * **The route a call application renders to, which on Windows is a different
 * setting from the one above.**
 *
 * The WASAPI loopback tap binds `eConsole` — `wasapi`'s `get_default_device`
 * hardcodes the role, and `getDefaultOutputDeviceId` reads the same one — while
 * Teams, Zoom and Meet render to `eCommunications`, which Windows lets a rep set
 * separately in one checkbox. When the two differ the tap records an endpoint
 * nothing is playing to and `SystemAudioCapture` emits no chunks at all.
 *
 * `speaker/windows.rs` has documented that hole since it was written and the
 * lookup that measures it has existed just as long, `#[napi]`-less, with its one
 * caller appending a label to a row in the device picker.
 *
 * Null is « we did not measure it » — an older binary, a lookup that failed, or
 * macOS, which has no such role — and is never reported as a finding (DEC-45).
 */
export const getDefaultCommunicationsDeviceId = (): string | null => {
  const result = loadNativeModule()
  if (!result.ok || typeof result.module.getDefaultCommunicationsDeviceId !== 'function') {
    return null
  }
  try {
    return result.module.getDefaultCommunicationsDeviceId() || null
  } catch {
    return null
  }
}

/**
 * **Which applications hold a microphone right now** — « Teams is in a call »
 * rather than « Teams is running ».
 *
 * The signal `MeetingApps`'s docblock had been waiting for since it was written,
 * and the one that makes an *unscheduled* call detectable at all
 * (`core/domain/adHoc.ts`). macOS answers from the CoreAudio process-object list,
 * Windows from `IAudioSessionManager2`; neither needs a permission prompt, and
 * reading the macOS list was measured not to light the microphone indicator —
 * see `native-module/src/mic_apps.rs`, which carries the measurement.
 *
 * An **empty list** is « nothing is, or we could not ask », and the two are
 * deliberately not distinguished: a binary built before this existed, a platform
 * with no implementation and a genuinely quiet machine all mean the same thing to
 * every caller, which is that the process signal stands alone (DEC-45). Unlike
 * its siblings above this returns `[]` rather than `null` for that reason —
 * there is no caller that would branch on the difference.
 */
export const getMicHoldingApps = (): MicApp[] => {
  const result = loadNativeModule()
  if (!result.ok || typeof result.module.getMicHoldingApps !== 'function') return []
  try {
    return result.module.getMicHoldingApps()
  } catch {
    return []
  }
}
