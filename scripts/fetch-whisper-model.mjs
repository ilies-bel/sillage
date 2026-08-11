#!/usr/bin/env node
/**
 * Fetches the bundled Whisper checkpoint into `resources/whisper-models/`.
 *
 * The weights ship *inside the installer*, not downloaded on the client's
 * machine: the deployment we are building for sits behind a VPN that may block
 * huggingface.co entirely, and a local engine that needs the network to start
 * is not a local engine. This runs on a build machine, where it does not.
 *
 * Not in git either. 466 MB in the repo is paid by every clone forever, and Git
 * LFS only moves that bill to a quota. `resources/` is ignored; this script and
 * its lock file are the reproducible part.
 *
 * The revision is **pinned**. A checkpoint that silently changes between builds
 * is a transcript-quality regression nobody can reproduce, and `main` on the Hub
 * is a moving branch.
 *
 *   node scripts/fetch-whisper-model.mjs              verify + fetch what is missing
 *   node scripts/fetch-whisper-model.mjs --write-lock record hashes for a new pin
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST_ROOT = path.join(ROOT, 'resources', 'whisper-models');
const LOCK_PATH = path.join(ROOT, 'scripts', 'whisper-model.lock.json');

const MODEL_ID = 'Xenova/whisper-small';
/** `main` as of 2026-08-04. Change deliberately, then re-run with --write-lock. */
const REVISION = '2d67713f236afa48a18992566e7647f6ca848e13';

/**
 * Exactly the files `resolveInferenceConfig()` will open, and no others.
 *
 * The dtype map is platform-independent — encoder fp32, decoders q8, on every
 * OS — so this one file set serves Windows, Apple Silicon and Intel alike. Only
 * `executionProviders` differ, and those are a runtime choice, not a download.
 * Adding `decoder_model.onnx` / `decoder_with_past_model.onnx` here would ship
 * ~110 MB that nothing ever loads: the merged decoder satisfies the pipeline.
 */
const FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/encoder_model.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];

const urlFor = (file) =>
  `https://huggingface.co/${MODEL_ID}/resolve/${REVISION}/${file}?download=true`;

const sha256 = async (filePath) => {
  const hash = createHash('sha256');
  const handle = await fs.open(filePath, 'r');
  try {
    for await (const chunk of handle.createReadStream()) hash.update(chunk);
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
};

const readLock = async () => {
  try {
    return JSON.parse(await fs.readFile(LOCK_PATH, 'utf8'));
  } catch {
    return null;
  }
};

const human = (bytes) =>
  bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} kB`;

/**
 * Downloads to a `.part` and renames only once the bytes are all there.
 *
 * A truncated `.onnx` is the worst artefact this script can leave behind: it is
 * present, non-empty, passes the cache check, and fails inside ONNX Runtime at
 * load with a `file_size` error — during the meeting, on the engine that exists
 * because nothing else can be relied on.
 */
const download = async (file, destination) => {
  const response = await fetch(urlFor(file), { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`${file}: HTTP ${response.status} ${response.statusText}`);
  }
  const expected = Number(response.headers.get('content-length') ?? 0);

  await fs.mkdir(path.dirname(destination), { recursive: true });
  const partial = `${destination}.part`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));

  const { size } = await fs.stat(partial);
  if (expected > 0 && size !== expected) {
    await fs.rm(partial, { force: true });
    throw new Error(`${file}: got ${size} bytes, expected ${expected}`);
  }
  await fs.rename(partial, destination);
  return size;
};

const main = async () => {
  const writeLock = process.argv.includes('--write-lock');
  const lock = await readLock();

  if (!lock && !writeLock) {
    console.error(
      `[whisper] no lock file at ${path.relative(ROOT, LOCK_PATH)} — run once with --write-lock`,
    );
    process.exit(1);
  }
  if (lock && lock.revision !== REVISION && !writeLock) {
    console.error(
      `[whisper] lock is for revision ${lock.revision}, script pins ${REVISION} — re-run with --write-lock`,
    );
    process.exit(1);
  }

  const hashes = {};
  let fetched = 0;

  for (const file of FILES) {
    const destination = path.join(DEST_ROOT, MODEL_ID, file);
    const want = lock?.files?.[file]?.sha256;

    let present = false;
    try {
      present = (await fs.stat(destination)).size > 0;
    } catch {
      present = false;
    }

    if (present && want) {
      const actual = await sha256(destination);
      if (actual === want) {
        hashes[file] = { sha256: actual, size: (await fs.stat(destination)).size };
        console.log(`[whisper] ok       ${file}`);
        continue;
      }
      console.log(`[whisper] mismatch ${file} — refetching`);
      await fs.rm(destination, { force: true });
      present = false;
    }

    if (!present) {
      process.stdout.write(`[whisper] fetch    ${file} … `);
      const size = await download(file, destination);
      fetched += size;
      console.log(human(size));
    }

    const actual = await sha256(destination);
    if (want && actual !== want) {
      throw new Error(`${file}: sha256 ${actual} does not match the lock (${want})`);
    }
    hashes[file] = { sha256: actual, size: (await fs.stat(destination)).size };
  }

  if (writeLock) {
    await fs.writeFile(
      LOCK_PATH,
      `${JSON.stringify({ modelId: MODEL_ID, revision: REVISION, files: hashes }, null, 2)}\n`,
    );
    console.log(`[whisper] lock written — ${path.relative(ROOT, LOCK_PATH)}`);
  }

  const total = Object.values(hashes).reduce((sum, f) => sum + f.size, 0);
  console.log(
    `[whisper] ${MODEL_ID} @ ${REVISION.slice(0, 7)} — ${human(total)} in ${path.relative(ROOT, path.join(DEST_ROOT, MODEL_ID))}` +
      (fetched > 0 ? ` (${human(fetched)} downloaded)` : ' (nothing to do)'),
  );
};

main().catch((err) => {
  console.error(`[whisper] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
