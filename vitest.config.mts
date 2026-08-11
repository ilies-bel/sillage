/**
 * The renderer's test runner.
 *
 * A second framework, reluctantly and for one reason: the ported ProseMirror
 * code keeps its upstream tests (CLAUDE.md), those tests are vitest, and they
 * encode edge cases that are expensive to rediscover. Rewriting them into
 * `node --test` would be rewriting the thing that made the port worth doing.
 *
 * The split is mechanical and stays that way: `electron/` runs under Node's
 * type stripping with no build step, `src/` runs under vitest with a DOM.
 * `npm test` drives both, so there is still one command.
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // ProseMirror measures layout. jsdom is not a browser, but it is enough for
    // schema, plugin and transaction behaviour — which is all that is tested.
    environment: 'jsdom',
    globals: false,
  },
})
