#!/usr/bin/env node
/**
 * Fast electron build using esbuild (transpile-only, no type checking).
 * ~10-50x faster than `tsc` for dev builds.
 * Run `npm run typecheck:electron` separately for type safety.
 */

const { build } = require('esbuild');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const outDir = path.resolve(rootDir, 'dist-electron');

const entryPoints = [];

// Function to recursively find all .ts files in a directory
const findTs = (dir) => {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) {
      if (f.name === '__tests__') continue;
      results.push(...findTs(full));
    } else if (f.name.endsWith('.ts') && !f.name.endsWith('.d.ts') && !f.name.endsWith('.test.ts')) {
      results.push(full);
    }
  }
  return results;
};

// The rebuilt tree, and it is deliberately not `electron/**`.
//
// `audio/`, `services/`, `update/`, `utils/` and `lib/` survived demolition as
// dead-but-kept source (ARCHITECTURE.md §3): several of them import modules that
// went with the old product, so bundling them fails. They are not repaired in
// place — each is repaired at the step that ports it into `modules/`
// (`audio/` → `capture/` + `transcribe/` in step 2, `services/meeting/` →
// `extract/` in step 6). Keep this list in step with `electron/tsconfig.json`'s
// `include`; the two answer the same question.
const electronDir = path.resolve(rootDir, 'electron');
for (const layer of ['core', 'modules', 'app']) {
  entryPoints.push(...findTs(path.join(electronDir, layer)).map((f) => path.relative(rootDir, f)));
}
entryPoints.push('electron/preload.ts');

const start = Date.now();

build({
  entryPoints,
  bundle: true,           // resolve all static + dynamic imports so postProcessor
                         // is inlined and the path rewrite works (vs bundle:false
                         // which copies files as-is and leaves unresolved relative paths)
  outdir: outDir,
  outbase: rootDir,       // preserve directory structure (electron/main.ts → dist-electron/electron/main.js)
  platform: 'node',
  target: 'node20',
  format: 'cjs',          // Electron loads package.json main as CommonJS in this repo
                          // (package.json has no "type": "module").
  external: [
    'electron',
    'better-sqlite3',
    'keytar',
    'sqlite-vec',
    '@vectorize-io/hindsight-client',
    // Heavy native ESM modules with `import.meta.url`-dependent init. Keeping
    // them external lets Node's loader give them a real `import.meta.url`,
    // which the bundled version can't (esbuild's CJS target sets
    // `import_meta = {}`). pdfjs-dist's legacy build runs a canvas/DOMMatrix
    // polyfill block at module-init that uses
    // `createRequire(import.meta.url)` to load `@napi-rs/canvas`; the
    // bundled version breaks this and `new DOMMatrix()` then throws
    // "DOMMatrix is not a constructor" at line 15620 (`const SCALE_MATRIX
    // = new DOMMatrix();`). The bundling also breaks pdf-parse@2.x's
    // fake-worker bootstrap (workerSrc resolves to a non-existent
    // dist-electron/electron/pdf.worker.mjs). Externalizing keeps them
    // loadable from node_modules at runtime, where the real polyfill chain
    // works and our pinPdfjsWorkerSrcOnce() helper can resolve the real
    // worker file.
    'pdfjs-dist',
    'pdf-parse',
    'mammoth',
  ],
  sourcemap: true,
  jsx: 'automatic',
  loader: {
    '.ts': 'ts',
    '.js': 'js',
  },
  logLevel: 'warning',
}).then(() => {
  console.log(`[build-electron] Done in ${Date.now() - start}ms`);
}).catch((err) => {
  console.error('[build-electron] Build failed:', err.message);
  process.exit(1);
});
