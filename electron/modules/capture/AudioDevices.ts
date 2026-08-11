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
import { loadNativeModule, type AudioDeviceInfo } from './nativeModule.ts'

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
