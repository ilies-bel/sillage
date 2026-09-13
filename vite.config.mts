import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { version } from './package.json'

// Read by the diagnostics panel (DEC-27) so a bundle names the build it came from.
process.env.VITE_APP_VERSION = version

/**
 * The renderer build.
 *
 * The previous config carried the old product's chunking: `manualChunks` naming
 * framer-motion, three, tesseract, katex, radix, react-syntax-highlighter and
 * `@huggingface/transformers`. Naming a package there puts it in the graph
 * whether or not anything imports it, and the transformers entry was pulling a
 * **21 MB ONNX runtime `.wasm`** into a bundle that has no use for it — whisper
 * runs in the main process, behind `modules/transcribe`, and the renderer is
 * not allowed to import `modules/` at all.
 *
 * So there is no `manualChunks` here now. The renderer's dependencies are React
 * and ProseMirror; one chunk is the right number of chunks for that, and a
 * split invented ahead of a measurement is a split that goes stale.
 */
export default defineConfig({
  plugins: [react()],
  base: './', // relative paths — Electron loads this from the filesystem
  resolve: {
    // `@hooks` and `@config` went with the old product; the directories they
    // pointed at no longer exist.
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // TS/TSX must win over .mjs/.js so an unqualified import of a basename with
    // both a source and a stale/stub sibling always resolves to the real source.
    extensions: ['.mts', '.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'],
  },
  server: {
    port: 5180,
    watch: {
      /*
       * **Anchored at this config's own directory, never `**` — a glob here reaches
       * *up* the absolute path, and the worktrees are where the agents live.**
       *
       * chokidar matches these against absolute paths, so `**​/.claude/worktrees/**`
       * matched **every file of every isolated agent's own checkout** — the server
       * running inside `.claude/worktrees/agent-xxx/` was ignoring its whole source
       * tree. No HMR, and the module graph never invalidated, so a page reload
       * served the pre-edit file: two agents in one wave independently measured
       * their own fix as if it did not exist and reported it as broken, and a third
       * recorded « a `git checkout` of a `src/` file does not invalidate the
       * transform cache » as a property of Vite. It is this line.
       *
       * What the entry is *for* is the main checkout not watching seven sibling
       * worktrees, and `path.resolve(__dirname, …)` says exactly that: inside a
       * worktree it points at that worktree's own (empty) `.claude/worktrees`.
       */
      ignored: [
        `${path.resolve(__dirname, '.claude/worktrees')}/**`,
        '**/.code-review-graph/**',
        '**/dist-electron/**',
        '**/release/**',
      ],
    },
  },
  build: {
    // Below Vite's default 500 kB warning, and meant to stay there. If this has
    // to be raised, the honest move is to find out what grew.
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      input: path.resolve(__dirname, 'index.html'),
    },
  },
})
