/*!
 * **Which applications are holding a microphone right now.**
 *
 * This is the signal that separates « Teams is running » from « Teams is in a
 * call », and it is the one axis on which Granola was straightforwardly better
 * than this product.
 *
 * `modules/capture/MeetingApps.ts` shells out to `ps`/`tasklist` and its own
 * docblock says what that buys: *"It says a conferencing app is running, not
 * that a call is in progress: Teams starts with Windows and stays open all
 * day."* So it can only ever be the second half of a conjunction whose first
 * half is a calendar event — which means an **ad-hoc call, the one nobody put
 * in Outlook, is invisible to this product**. Granola catches those, with a
 * native module per platform (`macos_mic_apps_with_devices.node`,
 * `mic_monitor_v2`) and a table of conferencing bundle ids.
 *
 * ## Why this is not a new native addon
 *
 * CLAUDE.md allows exactly one *third-party* native addon (`keytar`), and that
 * rule was read here for a while as « no mic detection without a second addon ».
 * It is the wrong reading. This crate is **ours**: already built per Electron
 * ABI, already cross-compiled for both platforms, already shipped inside the
 * installer. A function here costs a function. And neither platform needs a new
 * dependency:
 *
 * - macOS: `kAudioHardwarePropertyProcessObjectList`, through `cidre`, which is
 *   already a dependency and already has the `core_audio` feature on.
 * - Windows: `IAudioSessionManager2`, through the `windows` crate, already a
 *   dependency. Three further *feature flags* on it — see Cargo.toml.
 *
 * ## Why reading this does not light the orange microphone indicator
 *
 * `abi_probe`'s docblock records that cpal device *enumeration* registers the
 * process with the CoreAudio HAL and lights the menu-bar indicator, which is why
 * the ABI probe is a string allocation rather than a device call. That hazard
 * applies here too and had to be measured rather than assumed, because this
 * function is called on a timer with no meeting running.
 *
 * Measured on macOS 25.6, reading the process-object list 50 times in a row —
 * i.e. what a 20-second arming poll does over about 17 minutes:
 *
 *     round  1: 34 objects | own pid in list: true | default-input RunningSomewhere: 0
 *     round 50: 34 objects | own pid in list: true | default-input RunningSomewhere: 0
 *
 * `kAudioDevicePropertyDeviceIsRunningSomewhere` is the state the indicator
 * follows, and it stays 0. The object count does not grow either, so the read
 * leaks no HAL objects. Reading a property is not opening a stream.
 *
 * ## The one trap: we are on this list ourselves
 *
 * Our own pid appears among the process objects as soon as we ask (that is what
 * « client processes currently connected to the system » means), and during a
 * meeting **we genuinely hold the microphone with `is_running_input = 1`**. A
 * detector that did not exclude itself would report a call in progress for the
 * whole of every recording, which is exactly the state in which arming must not
 * fire again. Excluded here, by pid, rather than left to the caller — the caller
 * cannot know which process this is.
 *
 * ## What is deliberately not reported
 *
 * Granola's function is `mic_apps_with_devices` and `cidre` exposes
 * `Process::devices()`, so *which* microphone each app holds is one call away.
 * It is not returned, because no decision here reads it: a rep whose Teams is on
 * a headset while this product captures the built-in microphone is still in a
 * call, and arming has to fire. A field nothing reads is the shape
 * `check:ports` and `check:surfaces` exist to refuse.
 *
 * ## Failure is silence, never noise (DEC-26, DEC-45)
 *
 * Every path answers an empty list on error, which the caller reads as « no
 * conferencing app is holding a microphone » — i.e. exactly today's behaviour
 * before this existed. That covers macOS before 14.4, where the process-object
 * list does not exist and `System::processes()` simply fails, and a locked-down
 * Windows box where COM will not start. Nothing downstream may stop a meeting
 * being recorded, and a rep can always start one by hand.
 */

/// One process that currently has an input stream running.
#[napi(object)]
pub struct MicApp {
    /// The OS process id. Reported so a caller can tell two copies of the same
    /// binary apart in a diagnostic line; never used to address the process.
    pub pid: i32,
    /// macOS bundle id (`us.zoom.xos`, `com.microsoft.teams2`). Empty on Windows
    /// and for any macOS process with no bundle — a CLI binary has none, and
    /// `ffmpeg` recording from the terminal is the case that proved it.
    pub bundle_id: String,
    /// Executable name (`ms-teams.exe`, `zoom.us`, `ffmpeg`), or empty when the
    /// OS would not say. Matched case-insensitively by the caller.
    pub name: String,
}

/// Every process holding a microphone right now, excluding this one.
///
/// Empty means « nothing is, or we could not tell » — the two are deliberately
/// not distinguished, because no caller would do anything different (DEC-45).
#[napi]
pub fn get_mic_holding_apps() -> Vec<MicApp> {
    platform::mic_holding_apps()
}

#[cfg(target_os = "macos")]
mod platform {
    use super::MicApp;
    use cidre::core_audio as ca;

    // `proc_pidpath` lives in libproc, which is part of libSystem, so naming it
    // here links nothing new. It is the only way to get an executable name for
    // a process with no bundle id, and every unbundled process has none.
    extern "C" {
        fn proc_pidpath(pid: i32, buffer: *mut u8, buffersize: u32) -> i32;
    }

    /// `/Applications/Zoom.app/Contents/MacOS/zoom.us` -> `zoom.us`.
    ///
    /// The same trailing-component rule `MeetingApps.basename` applies, kept here
    /// rather than returning the full path: a path is a filesystem location that
    /// may carry a user name, and this value reaches a diagnostics line.
    fn exe_name(pid: i32) -> String {
        // PROC_PIDPATHINFO_MAXSIZE is 4 * MAXPATHLEN.
        let mut buf = vec![0u8; 4 * 1024];
        let written = unsafe { proc_pidpath(pid, buf.as_mut_ptr(), buf.len() as u32) };
        if written <= 0 {
            return String::new();
        }
        buf.truncate(written as usize);
        let path = String::from_utf8_lossy(&buf).to_string();
        match path.rfind('/') {
            Some(cut) => path[cut + 1..].to_string(),
            None => path,
        }
    }

    pub fn mic_holding_apps() -> Vec<MicApp> {
        // Before macOS 14.4 this property does not exist and the call fails.
        // That is the capability probe: no list, no detection, today's behaviour.
        let processes = match ca::System::processes() {
            Ok(processes) => processes,
            Err(_) => return Vec::new(),
        };

        let own = std::process::id() as i32;
        let mut out = Vec::new();

        for process in processes {
            // `is_running_input` is documented as « running IO and at least one
            // active input stream », which is the exact question. `is_running`
            // would also be true for an app only playing audio, and a rep with
            // Spotify open is not in a meeting.
            if !process.is_running_input().unwrap_or(false) {
                continue;
            }
            let pid = match process.pid() {
                Ok(pid) => pid,
                // No pid means nothing can be matched or excluded, including
                // ourselves — so the row is worse than useless.
                Err(_) => continue,
            };
            if pid == own {
                continue;
            }
            let bundle_id = process
                .bundle_id()
                .map(|id| id.to_string())
                .unwrap_or_default();
            out.push(MicApp {
                pid,
                bundle_id,
                name: exe_name(pid),
            });
        }

        out
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::MicApp;
    use windows::core::{ComInterface, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, RPC_E_CHANGED_MODE};
    use windows::Win32::Media::Audio::{
        eCapture, AudioSessionStateActive, IAudioSessionControl2, IAudioSessionManager2,
        IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    /// `C:\Program Files\WindowsApps\...\ms-teams.exe` -> `ms-teams.exe`.
    ///
    /// Only the trailing component is kept, and that is not tidiness: the full
    /// path of a per-user install contains the rep's Windows account name
    /// (`C:\Users\Jean-Pierre.Dupont\...`), and this value can reach a
    /// diagnostics line whose button promises no conversation content.
    ///
    /// `PROCESS_QUERY_LIMITED_INFORMATION` is deliberately the weakest right
    /// that answers the question: it is granted for processes of the same user
    /// without elevation, which is every conferencing app a rep runs.
    fn exe_name(pid: u32) -> String {
        unsafe {
            let handle = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                Ok(handle) => handle,
                // A protected or already-exited process. The pid is still worth
                // reporting; the name simply is not knowable.
                Err(_) => return String::new(),
            };
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let read = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                PWSTR(buf.as_mut_ptr()),
                &mut len,
            );
            let _ = CloseHandle(handle);
            if read.is_err() || len == 0 {
                return String::new();
            }
            let path = String::from_utf16_lossy(&buf[..len as usize]);
            match path.rfind('\\') {
                Some(cut) => path[cut + 1..].to_string(),
                None => path,
            }
        }
    }

    pub fn mic_holding_apps() -> Vec<MicApp> {
        unsafe {
            /*
             * This runs on whichever thread napi called us on, and the DSP
             * threads in this crate already initialise COM through `wasapi`. So
             * three outcomes have to be handled rather than two: `S_OK` (we
             * started it and must balance it), `S_FALSE` (already started on
             * this thread, still a reference to balance), and
             * `RPC_E_CHANGED_MODE` (already started in a *different* apartment,
             * so there is nothing to balance and calling `CoUninitialize` would
             * drop somebody else's reference). In the third case the existing
             * apartment serves the calls perfectly well.
             */
            let init = CoInitializeEx(None, COINIT_MULTITHREADED);
            let owned = match init {
                Ok(()) => true,
                Err(error) if error.code() == RPC_E_CHANGED_MODE => false,
                Err(_) => return Vec::new(),
            };
            let out = collect();
            if owned {
                CoUninitialize();
            }
            out
        }
    }

    unsafe fn collect() -> Vec<MicApp> {
        let enumerator: IMMDeviceEnumerator =
            match CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) {
                Ok(enumerator) => enumerator,
                Err(_) => return Vec::new(),
            };

        /*
         * **Every active capture endpoint, not the default one.**
         *
         * `speaker/windows.rs` documents the hole this product already has on
         * the render side: the loopback tap binds `eConsole` while Teams renders
         * to `eCommunications`, two roles a rep configures separately. The same
         * split exists for capture, and here it costs nothing to be immune to
         * it — a rep whose headset is the communications device and whose webcam
         * microphone is the multimedia default is the ordinary case, not an
         * exotic one, and asking only the default would miss the call.
         */
        let devices = match enumerator.EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE) {
            Ok(devices) => devices,
            Err(_) => return Vec::new(),
        };
        let count = devices.GetCount().unwrap_or(0);

        let own = std::process::id();
        let mut out: Vec<MicApp> = Vec::new();

        for index in 0..count {
            let Ok(device) = devices.Item(index) else { continue };
            let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else {
                continue;
            };
            let Ok(sessions) = manager.GetSessionEnumerator() else { continue };
            let total = sessions.GetCount().unwrap_or(0);

            for slot in 0..total {
                let Ok(control) = sessions.GetSession(slot) else { continue };
                let Ok(control) = control.cast::<IAudioSessionControl2>() else { continue };

                // `Active` is the state that means a stream is running.
                // `Inactive` is an app that holds a session and is not
                // capturing — Teams sitting idle all day is exactly that, and
                // it is the whole reason this signal is worth more than
                // `tasklist`.
                // A state we could not read is treated as not-in-a-call. The
                // asymmetry is deliberate: a false negative costs the automatic
                // offer and nothing else — the rep still has « Démarrer une
                // réunion » — while a false positive puts a recording offer on
                // screen during no call at all, which is the noise `MEETING_APPS`
                // excludes browsers to avoid.
                if !matches!(control.GetState(), Ok(AudioSessionStateActive)) {
                    continue;
                }
                let Ok(pid) = control.GetProcessId() else { continue };
                // Pid 0 is the system session (`IsSystemSoundsSession`), which
                // is never a conferencing app.
                if pid == 0 || pid == own {
                    continue;
                }
                // One process can own a session on several endpoints; report it
                // once.
                if out.iter().any(|app| app.pid == pid as i32) {
                    continue;
                }
                out.push(MicApp {
                    pid: pid as i32,
                    // Windows has no bundle id. The caller matches on `name`
                    // there, which is what `tasklist` gave it before this.
                    bundle_id: String::new(),
                    name: exe_name(pid),
                });
            }
        }

        out
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use super::MicApp;

    /// Neither platform this product ships to. An empty list degrades to the
    /// process-name signal alone, which is what CI runs on.
    pub fn mic_holding_apps() -> Vec<MicApp> {
        Vec::new()
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use cidre::core_audio as ca;

    /// `kAudioDevicePropertyDeviceIsRunningSomewhere` on the default input —
    /// the state the menu-bar microphone indicator follows.
    fn indicator() -> Option<bool> {
        let device = ca::System::default_input_device().ok()?;
        device
            .bool_prop(&ca::PropSelector::DEVICE_IS_RUNNING_SOMEWHERE.global_addr())
            .ok()
    }

    /// **Reading the process list must not register us as using the microphone.**
    ///
    /// This is the measurement the twenty-fourth review round could not
    /// independently reproduce, and it said so rather than claiming it verified.
    /// It is worth having as a test rather than as a number in a docblock,
    /// because the hazard is real and documented one file over: `abi_probe`
    /// exists as a *string allocation* precisely because cpal's device
    /// enumeration registers the process with the CoreAudio HAL and lights the
    /// orange indicator — at app launch, with no meeting running. This function
    /// is called on a timer with no meeting running, so the same hazard applies
    /// and assuming it does not would be the whole defect.
    ///
    /// **What is asserted is that the reading does not *change* the state, not
    /// that the state is zero.** A developer with Zoom open has a genuinely lit
    /// indicator, and a test that demanded zero would fail for a reason that has
    /// nothing to do with this code — the shape this repo calls a fixture that
    /// cannot exercise its own property, in reverse.
    ///
    /// **And the instrument was proved to observe a change**, because a test
    /// that cannot fail measures nothing. Reading the same property from a
    /// separate process while `ffmpeg` held the default input:
    ///
    ///     idle                          34 objects | RunningSomewhere: 0
    ///     while a real stream is open   35 objects | RunningSomewhere: 1
    ///
    /// So the property does move, and fifty polls of the process list do not
    /// move it. Note what that separates: our own pid is in the object list
    /// either way — asking the question registers this process as a HAL
    /// *client* — and being a client is not using the device.
    ///
    /// One thing measured and deliberately not concluded: injecting
    /// `microphone::list_input_devices()` into the loop below did **not** light
    /// the indicator here either, which does not contradict `abi_probe`'s
    /// docblock — that is about `cpal::default_host()` on Electron's main thread
    /// at launch, which is not what this test runs — and is not enough evidence
    /// to relax anything over there.
    #[test]
    fn reading_the_process_list_does_not_light_the_microphone_indicator() {
        let Some(before) = indicator() else {
            // No default input device, or the HAL refused. Nothing to measure —
            // and this file already treats « we could not ask » as a non-finding.
            return;
        };

        // Fifty polls is what a twenty-second arming poll does over roughly
        // seventeen minutes.
        for _ in 0..50 {
            let _ = super::platform::mic_holding_apps();
        }

        let after = indicator().expect("the indicator was readable a moment ago");
        assert_eq!(
            before, after,
            "polling the process object list changed the microphone indicator \
             ({before} -> {after}); it must be a property read, never a stream"
        );
    }

    /// The same read must not leak HAL objects either — a process object list
    /// that grows on every poll is a process that will be holding thousands of
    /// them by the end of a working day.
    #[test]
    fn polling_does_not_accumulate_process_objects() {
        let Ok(first) = ca::System::processes() else {
            return; // macOS before 14.4: the property does not exist.
        };
        let before = first.len();
        for _ in 0..50 {
            let _ = super::platform::mic_holding_apps();
        }
        let after = ca::System::processes().expect("readable a moment ago").len();
        // Other applications legitimately come and go during a test run, so the
        // assertion is about growth on the scale a leak would produce, not
        // exact equality.
        assert!(
            after < before + 10,
            "process objects grew {before} -> {after} across 50 polls"
        );
    }
}
