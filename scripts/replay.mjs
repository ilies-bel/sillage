#!/usr/bin/env node
/**
 * Replays recorded audio through the real pipeline: file → capture → transcribe
 * → event log → SQLite.
 *
 * No Electron, no devices, no network. Everything below `app/` is the code that
 * runs in a meeting — `Recording` wires the two modules, `MeetingSession` writes
 * the events, `Store` folds the projections — with `FileCapture` substituted for
 * the sound card. That substitution is the only difference, and it is injected
 * through the seam `Recording` already had.
 *
 * Two things it is for. Judging a transcript: comparing two providers, or two
 * Whisper checkpoints, needs both fed the *same* audio, which a microphone
 * cannot do twice. And rehearsing the demo without a live prospect.
 *
 *   node scripts/replay.mjs <file…> [options]
 *
 *   --channel rep|far|split   which side the audio is (default far)
 *   --speed <n>               1 = wall clock (default). Higher drops segments.
 *   --provider <id>           default local-whisper
 *   --key <k>                 for a cloud provider
 *   --model <id>              Whisper checkpoint
 *   --models-dir <path>       default resources/whisper-models
 *   --db <path>               default a temp file, printed at the end
 *   --keep                    keep the converted WAV next to the source
 *   --client <name>           read that client's stored lexicon scope
 *   --terms <a,b,c>           boost terms (DEC-17). `--terms ''` disables them,
 *                             which is the control arm when measuring the gain.
 *   --terms-file <path>       same, one term per line, `#` comments allowed
 *
 * Any container ffmpeg can read is accepted; anything that is not already
 * 16 kHz mono 16-bit PCM WAV is converted into one first.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const load = async (relative) => import(pathToFileURL(path.join(ROOT, relative)).href);

// ── Arguments ──────────────────────────────────────────────────────────────

/** `#` starts a comment so a terms file can say why a term is in it. */
const splitTerms = (raw, separator = ',') =>
  raw
    .split(separator)
    .map((t) => t.replace(/#.*$/, '').trim())
    .filter(Boolean);

const parseArgs = (argv) => {
  const options = {
    files: [],
    channel: 'far',
    speed: 1,
    provider: 'local-whisper',
    key: '',
    model: undefined,
    modelsDir: path.join(ROOT, 'resources', 'whisper-models'),
    db: null,
    keep: false,
    terms: null,
    client: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--channel') options.channel = next();
    else if (arg === '--speed') options.speed = Number(next());
    else if (arg === '--provider') options.provider = next();
    else if (arg === '--key') options.key = next();
    else if (arg === '--model') options.model = next();
    else if (arg === '--models-dir') options.modelsDir = path.resolve(next());
    else if (arg === '--db') options.db = path.resolve(next());
    else if (arg === '--keep') options.keep = true;
    else if (arg === '--client') options.client = next();
    else if (arg === '--terms') options.terms = splitTerms(next());
    else if (arg === '--terms-file') options.terms = splitTerms(fs.readFileSync(path.resolve(next()), 'utf8'), '\n');
    else if (arg.startsWith('--')) throw new Error(`option inconnue: ${arg}`);
    else options.files.push(path.resolve(arg));
  }
  if (options.files.length === 0) throw new Error('aucun fichier — usage: node scripts/replay.mjs <file…>');
  return options;
};

// ── Conversion ─────────────────────────────────────────────────────────────

/**
 * Anything ffmpeg reads becomes 16 kHz mono 16-bit PCM.
 *
 * Downmixing here rather than in `FileCapture` is deliberate: a Teams recording
 * is already a single mixed track, so there is nothing to separate and no
 * channel attribution to be had from it. Saying that out loud in `--channel`
 * matters — a mixed file replayed as `far` is *everyone*, the rep included.
 */
const toWav = (source, keep) => {
  const destination = keep
    ? source.replace(/\.[^.]+$/, '.16k.wav')
    : path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'replay-')), `${path.basename(source, path.extname(source))}.wav`);

  process.stdout.write(`  conversion  ${path.basename(source)} … `);
  execFileSync(
    'ffmpeg',
    ['-v', 'error', '-y', '-i', source, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', destination],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  const { size } = fs.statSync(destination);
  console.log(`${(size / 1024 / 1024).toFixed(1)} MB`);
  return destination;
};

// ── Output ─────────────────────────────────────────────────────────────────

const clock = (ms) => {
  const total = Math.round(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

const label = (channel) => (channel === 'rep' ? 'MOI' : 'EUX');

// ── Main ───────────────────────────────────────────────────────────────────

const main = async () => {
  const options = parseArgs(process.argv.slice(2));

  const { Store } = await load('electron/modules/store/index.ts');
  const { MeetingSession } = await load('electron/app/session/MeetingSession.ts');
  const { Recording } = await load('electron/app/session/Recording.ts');
  const { FileCapture } = await load('electron/modules/capture/FileCapture.ts');
  const { isModelCached, DEFAULT_MODEL_ID } = await load('electron/modules/transcribe/whisper/catalog.ts');
  const { resolveInferenceConfig } = await load('electron/modules/transcribe/whisper/inference.ts');
  const { buildBoostSet } = await load('electron/core/domain/lexicon/boost.ts');
  const { correct } = await load('electron/core/domain/lexicon/correct.ts');

  const model = options.model ?? DEFAULT_MODEL_ID;

  // The same two overrides the packaged app honours. Setting them here is what
  // lets `LocalWhisperSession` resolve its worker and its weights without ever
  // calling into Electron, which does not exist in this process.
  process.env.SILLAGE_WHISPER_MODELS_DIR = options.modelsDir;
  process.env.SILLAGE_WHISPER_WORKER ??= path.join(
    ROOT,
    'dist-electron/electron/modules/transcribe/whisper/worker.js',
  );
  const dbPath = options.db ?? path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'replay-db-')), 'replay.db');

  console.log('');
  const sources = options.files.map((file, index) => ({
    // `split` puts the first file on the rep and the second on the far end,
    // which is the only way this fixture ever produces two channels.
    channel: options.channel === 'split' ? (index === 0 ? 'rep' : 'far') : options.channel,
    path: toWav(file, options.keep),
    origin: file,
  }));

  if (options.provider === 'local-whisper') {
    const cached = isModelCached(options.modelsDir, model, resolveInferenceConfig().dtype);
    if (!cached) {
      console.error(
        `\n  ✗ ${model} absent de ${options.modelsDir}\n    → node scripts/fetch-whisper-model.mjs\n`,
      );
      process.exit(1);
    }
  }

  const store = new Store(dbPath);

  // The real assembly path: stored terms (client scope, then account) ahead of
  // the shipped list, ranked and budgeted by `boost.ts`. There is no calendar in
  // a replay, so the meeting scope above them is empty unless `--terms` supplies
  // it by hand. `--terms ''` is the control arm.
  const boostTerms =
    options.terms ??
    buildBoostSet(null, {
      capability: 'initialPrompt',
      stored: store.lexicon.forClient(options.client),
    }).terms;

  console.log('');
  console.log(`  provider    ${options.provider}${options.provider === 'local-whisper' ? ` (${model})` : ''}`);
  console.log(`  vitesse     ×${options.speed}`);
  console.log(
    `  lexique     ${boostTerms.length === 0 ? 'aucun' : `${boostTerms.length} terme(s)`}` +
      (options.client ? ` · client ${options.client}` : ''),
  );
  console.log(`  base        ${dbPath}`);
  for (const source of sources) console.log(`  ${label(source.channel)}         ${path.basename(source.origin)}`);
  console.log('');

  // Everything the app would write to its diagnostics log, on stdout instead.
  // A replay that prints only transcripts cannot explain an empty transcript,
  // which is the single most likely outcome worth debugging.
  const diagnostics = {
    record: (event) => {
      if (event.severity === 'info' && !process.env.REPLAY_VERBOSE) return;
      const mark = event.severity === 'error' ? '✗' : event.severity === 'warn' ? '⚠' : '·';
      console.log(`  ${mark} ${event.code}: ${event.message}`);
    },
  };

  const meetingId = `replay-${path.basename(options.files[0], path.extname(options.files[0]))}`
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .slice(0, 60);

  const session = MeetingSession.create(store, { id: meetingId, title: 'Rejeu de fichier' });
  session.dispatch('arm', 'replay');
  session.dispatch('start', 'replay');

  let settle = () => {};
  const finished = new Promise((resolve) => {
    let done = false;
    settle = () => {
      if (done) return;
      done = true;
      resolve();
    };
  });
  process.on('SIGINT', () => settle());

  const startedAt = Date.now();
  const recording = await Recording.start(
    session,
    {
      transcribe: {
        providerId: options.provider,
        apiKey: options.key,
        language: 'fr-FR',
        model,
        boostTerms,
      },
    },
    {
      diagnostics,
      createCapture: () =>
        new FileCapture({
          sources: sources.map((s) => ({ channel: s.channel, path: s.path })),
          speed: options.speed,
          onEnded: () => settle(),
        }),
      onSegment: (segment) => {
        if (!segment.isFinal) return;
        // The second half of DEC-17: what the prompt could not prevent, the
        // known-variant pass repairs. Nothing about the decode changes.
        const { text, applied } = correct(segment.text.trim());
        const fixed = applied.length > 0 ? `   [${applied.join(', ')}]` : '';
        console.log(`  ${clock(segment.startMs)}  ${label(segment.channel)}  ${text}${fixed}`);
      },
      onHealth: (connector, health) => {
        if (health.state !== 'ok') console.log(`  ⚠ ${connector}: ${health.reason ?? health.state}`);
      },
    },
  );

  await finished;
  console.log('\n  … fin du fichier, on attend les transcriptions en vol');
  await recording.stop();
  session.dispatch('end', 'replay');

  const segments = store.projections.segments(meetingId);
  const words = segments.reduce((n, s) => n + s.text.trim().split(/\s+/).filter(Boolean).length, 0);
  console.log(
    `\n  ${segments.length} segment(s), ${words} mots, en ${Math.round((Date.now() - startedAt) / 1000)} s réels\n`,
  );
  console.log(`  base: ${dbPath}\n`);
  store.close();
};

main().catch((err) => {
  console.error(`\n  ✗ ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
