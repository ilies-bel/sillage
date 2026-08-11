/**
 * Screen 0 at the surface (VISION.md §6, DEC-30).
 *
 * The pure half — which steps exist and which of them hold the window — is
 * settled and tested in `core/contracts/`. What only a rendered screen can show
 * is checked here: that each of the three lines carries a value the *main
 * process* supplied rather than a phrase this file invented, that the download
 * variant draws a real bar reading a real percentage, and that `App` opens over
 * a failed step instead of trapping the rep behind it.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { BootState, BootStep } from '../../../electron/core/contracts/boot.ts'
import { fakeBridge, installBridge, type FakeBridge } from '../../test/appBridge.ts'
import { Splash } from '../Splash.tsx'
import { App } from '../../App.tsx'

let bridge: FakeBridge
let uninstall: () => void

const booted = (steps: Partial<BootState> = {}): BootState => ({
  store: { state: 'ready', value: 'sillage.db · schéma v3' },
  devices: { state: 'ready', value: 'moteur de capture chargé' },
  transcription: { state: 'ready', value: 'Whisper (local)' },
  version: '0.1.0',
  ...steps,
})

const downloading: BootStep = { state: 'downloading', value: '37 %', percent: 37 }

beforeEach(() => {
  bridge = fakeBridge()
  uninstall = installBridge(bridge)
})

afterEach(() => {
  cleanup()
  uninstall()
})

describe('the wordmark', () => {
  test('it names the product and says what the product is', () => {
    render(<Splash state={booted()} />)

    // The one screen every rep sees before they have been told anything. The
    // wordmark alone names a thing without saying what it does.
    expect(screen.getByRole('heading', { name: 'Sillage' })).toBeTruthy()
    expect(screen.getByText('Compte-rendu de réunion')).toBeTruthy()
  })
})

describe('the three lines', () => {
  test('it names the local database, the audio and the transcription — and nothing else', () => {
    render(<Splash state={booted()} />)

    expect(screen.getByText('Base locale')).toBeTruthy()
    expect(screen.getByText('Audio')).toBeTruthy()
    expect(screen.getByText('Transcription')).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  test('nothing optional is on this screen (DEC-26)', () => {
    const { container } = render(<Splash state={booted()} />)
    const text = container.textContent ?? ''

    for (const optional of ['Calendrier', 'VerySwing', 'Outlook', 'Microsoft']) {
      expect(text, `${optional} must never hold the window`).not.toContain(optional)
    }
  })

  test('the values are the main process’s words, rendered verbatim', () => {
    // The renderer owns « Base locale ». It owns none of these — a value
    // assembled on this side of the bridge is the renderer guessing at state it
    // does not hold.
    render(<Splash state={booted()} />)

    expect(screen.getByText('sillage.db · schéma v3')).toBeTruthy()
    expect(screen.getByText('moteur de capture chargé')).toBeTruthy()
    expect(screen.getByText('Whisper (local)')).toBeTruthy()
  })

  test('local transcription is stated, never called a downgrade (DEC-30)', () => {
    const { container } = render(<Splash state={booted()} />)
    const text = (container.textContent ?? '').toLowerCase()

    expect(text).toContain('whisper (local)')
    for (const word of ['dégradé', 'repli', 'secours', 'par défaut faute']) {
      expect(text).not.toContain(word)
    }
  })

  test('a refusal is shown with its own reason, in a down tone', () => {
    const { container } = render(
      <Splash
        state={booted({
          devices: { state: 'failed', value: 'module audio natif indisponible — introuvable' },
        })}
      />,
    )

    expect(screen.getByText('module audio natif indisponible — introuvable')).toBeTruthy()
    expect(container.querySelector('[aria-hidden].bg-danger')).toBeTruthy()
  })

  test('before main answers, the three lines read as unanswered rather than as fine', () => {
    const { container } = render(<Splash state={null} />)

    expect(screen.getAllByText('en cours…')).toHaveLength(3)
    // Not green. « ready » is a claim, and the renderer has not earned it yet.
    expect(container.querySelector('.bg-success')).toBeNull()
  })

  test('the version is in the footer', () => {
    render(<Splash state={booted()} />)
    expect(screen.getByText('Version 0.1.0')).toBeTruthy()
  })
})

describe('the first-run download (DEC-30)', () => {
  test('it draws a real bar at the percentage main reported', () => {
    render(<Splash state={booted({ transcription: downloading })} />)

    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('37')
    expect((bar as HTMLElement).style.width).toBe('37%')
    expect(screen.getByText('37 %')).toBeTruthy()
  })

  test('it says the download happens once and then stays on the machine', () => {
    const { container } = render(<Splash state={booted({ transcription: downloading })} />)
    expect(container.textContent).toContain('Téléchargement unique')
    expect(container.textContent).toContain('reste ensuite sur cette machine')
  })

  test('there is no bar when nothing is downloading', () => {
    // The variant exists; nothing fabricates it. A bar wired to a timer is
    // worse than no bar at all.
    render(<Splash state={booted()} />)
    expect(screen.queryByRole('progressbar')).toBeNull()
  })
})

describe('what the splash holds the window for', () => {
  const openApp = () => {
    // Whatever Aujourd'hui needs once the splash lets go.
    bridge
      .when('agenda:snapshot', () => ({ events: [], syncedAt: 0, armed: null, reason: '' }))
      .when('auth:state', () => ({ status: 'signedOut' as const }))
      .when('meeting:list', () => [])
      .when('health:snapshot', () => ({
        capture: { state: 'ok' as const },
        transcribe: { state: 'ok' as const },
        calendar: { state: 'ok' as const },
        llm: { state: 'ok' as const },
        crm: { state: 'ok' as const },
        mail: { state: 'ok' as const },
      }))
  }

  test('a pending step holds it', async () => {
    openApp()
    bridge.when('boot:state', () => booted({ transcription: { state: 'pending' } }))
    render(<App />)

    expect(await screen.findByText('en cours…')).toBeTruthy()
    expect(screen.queryByText('Aujourd’hui')).toBeNull()
  })

  test('a download holds it', async () => {
    openApp()
    bridge.when('boot:state', () => booted({ transcription: downloading }))
    render(<App />)

    expect(await screen.findByRole('progressbar')).toBeTruthy()
    expect(screen.queryByText('Aujourd’hui')).toBeNull()
  })

  test('a failed step does NOT hold it', async () => {
    // The app opening is not conditional on transcription being available.
    // Capture, the notepad and a hand-written compte-rendu all survive it.
    openApp()
    bridge.when('boot:state', () =>
      booted({ transcription: { state: 'failed', value: 'aucun moteur disponible' } }),
    )
    render(<App />)

    expect(await screen.findByText('Aujourd’hui')).toBeTruthy()
    expect(screen.queryByText('Base locale')).toBeNull()
  })

  test('everything ready opens the app', async () => {
    openApp()
    bridge.when('boot:state', () => booted())
    render(<App />)

    expect(await screen.findByText('Aujourd’hui')).toBeTruthy()
  })

  test('a boot:changed broadcast releases it, with no poll', async () => {
    openApp()
    bridge.when('boot:state', () => booted({ transcription: downloading }))
    render(<App />)
    await screen.findByRole('progressbar')

    await act(async () => {
      bridge.emit('boot:changed', booted())
    })

    await waitFor(() => expect(screen.getByText('Aujourd’hui')).toBeTruthy())
  })

  test('a rejected boot:state does not trap the rep behind the splash', async () => {
    // The channel failing says something about IPC, not about the store or the
    // audio engine. Holding forever would be the one outcome worse than an app
    // whose header reports a subsystem down.
    openApp()
    render(<App />)

    expect(await screen.findByText('Aujourd’hui')).toBeTruthy()
  })
})
