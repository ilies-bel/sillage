/**
 * PARITY TEST — guards against drift between the ESM and CJS implementations
 * of nativeArch. The two files MUST stay byte-equivalent in behavior:
 *
 *   electron/lib/nativeArch.mjs  — used by async/ESM callers
 *                                  (verify-native-arch.js, the boot gate's
 *                                  parent module)
 *   electron/lib/nativeArch.cjs  — used by sync CJS callers
 *                                  (rebuild-native-electron.js, the boot
 *                                  gate's IIFE which fires before __esm
 *                                  initializers)
 *
 * Drift here re-introduces the bug the shared module exists to prevent.
 * If you change one, change the other and update the tests below.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

describe('nativeArch parity (cjs ↔ esm)', () => {
  test('both modules expose the same surface', () => {
    const cjs = require('../nativeArch.cjs');
    // Dynamic import for the ESM module
    return import('../nativeArch.mjs').then((esm) => {
      const cjsKeys = Object.keys(cjs).sort();
      const esmKeys = Object.keys(esm).sort();
      assert.deepEqual(
        esmKeys,
        cjsKeys,
        `Surface mismatch — ESM exports ${JSON.stringify(esmKeys)} but CJS exports ${JSON.stringify(cjsKeys)}. Update both files together.`,
      );
    });
  });

  test('detectHardwareArch returns the same value from both modules', () => {
    const cjs = require('../nativeArch.cjs');
    return import('../nativeArch.mjs').then((esm) => {
      const c = cjs.detectHardwareArch();
      const e = esm.detectHardwareArch();
      assert.equal(c, e, `cjs.detectHardwareArch=${c} esm.detectHardwareArch=${e}`);
    });
  });

  test('TARGETS is byte-equal between cjs and esm', () => {
    const cjs = require('../nativeArch.cjs');
    return import('../nativeArch.mjs').then((esm) => {
      assert.deepEqual([...esm.TARGETS], [...cjs.TARGETS]);
    });
  });

  test('buildFixCommand returns the same value from both modules', () => {
    const cjs = require('../nativeArch.cjs');
    return import('../nativeArch.mjs').then((esm) => {
      assert.equal(cjs.buildFixCommand(), esm.buildFixCommand());
    });
  });

  test('binaryArch produces the same result for the same file', () => {
    const cjs = require('../nativeArch.cjs');
    return import('../nativeArch.mjs').then((esm) => {
      // Use the actually-installed better-sqlite3 binary if available.
      // If not present (CI without native modules), skip — parity is still
      // validated by the other tests in this file.
      const realPath = require('node:path').resolve(
        process.cwd(),
        'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
      );
      const exists = require('node:fs').existsSync(realPath);
      if (!exists) return;
      assert.equal(cjs.binaryArch(realPath), esm.binaryArch(realPath));
    });
  });

  test('verifyAll produces equivalent results for an explicit repoRoot', () => {
    const cjs = require('../nativeArch.cjs');
    return import('../nativeArch.mjs').then((esm) => {
      const cResult = cjs.verifyAll(process.cwd());
      const eResult = esm.verifyAll(process.cwd());
      assert.equal(cResult.ok, eResult.ok, 'ok mismatch');
      assert.equal(cResult.skipped, eResult.skipped, 'skipped mismatch');
      assert.equal(cResult.hardware, eResult.hardware, 'hardware mismatch');
      assert.deepEqual(cResult.mismatches, eResult.mismatches, 'mismatches mismatch');
      assert.equal(cResult.fix, eResult.fix, 'fix mismatch');
    });
  });

  // --- Packaged-mode parity (v2.8.2 fix for false-positive dialog) ---------
  // The packaged branch is what the boot gate uses when running from a real
  // .app bundle. It must remain byte-equivalent between the cjs and esm
  // implementations, because the gate loads the cjs version synchronously
  // at module-load (before require('electron')) — and any drift here
  // re-introduces the false-positive "Built unknown" mismatch that broke
  // v2.8.1.

  test('resolveTargetPath produces the same packaged-path string from both modules', () => {
    const cjs = require('../nativeArch.cjs');
    return import('../nativeArch.mjs').then((esm) => {
      const rel = 'node_modules/better-sqlite3/build/Release/better_sqlite3.node';
      const fakeResources = '/Applications/Sillage.app/Contents/Resources';
      const c = cjs.resolveTargetPath(rel, { resourcesPath: fakeResources });
      const e = esm.resolveTargetPath(rel, { resourcesPath: fakeResources });
      assert.equal(c, e, `cjs=${c} esm=${e}`);
      // And it must point into app.asar.unpacked — NOT into app.asar/,
      // which is the bug we are fixing.
      assert.ok(c.includes('app.asar.unpacked'), 'must resolve into app.asar.unpacked');
      assert.ok(!c.includes('app.asar/'), 'must NOT resolve into the asar virtual filesystem');
    });
  });

  test('resolveTargetPath falls back to repoRoot when no resourcesPath given', () => {
    const cjs = require('../nativeArch.cjs');
    return import('../nativeArch.mjs').then((esm) => {
      const rel = 'node_modules/keytar/build/Release/keytar.node';
      const c = cjs.resolveTargetPath(rel, { repoRoot: process.cwd() });
      const e = esm.resolveTargetPath(rel, { repoRoot: process.cwd() });
      assert.equal(c, e);
      assert.equal(c, require('node:path').join(process.cwd(), rel));
    });
  });

  test('buildFixCommand({ packaged }) returns the same reinstall message from both modules', () => {
    const cjs = require('../nativeArch.cjs');
    return import('../nativeArch.mjs').then((esm) => {
      const c = cjs.buildFixCommand({ packaged: true });
      const e = esm.buildFixCommand({ packaged: true });
      assert.equal(c, e, 'packaged-mode fix messages must match');
      // Must NOT suggest a developer shell command.
      assert.ok(!c.includes('npm run rebuild:native'), 'must NOT suggest npm run rebuild:native to end-users');
      // There is no public release page yet, so the message cannot link to one.
      // What it must still do is name the action and both CPU flavours.
      assert.ok(c.includes('reinstall'), 'must tell the user to reinstall');
      assert.ok(c.includes('arm64'), 'must explain the two DMG flavours');
    });
  });

  test('verifyAll(opts.packaged) marks the result as packaged in both modules', () => {
    const cjs = require('../nativeArch.cjs');
    return import('../nativeArch.mjs').then((esm) => {
      const cResult = cjs.verifyAll(undefined, { packaged: true });
      const eResult = esm.verifyAll(undefined, { packaged: true });
      assert.equal(cResult.packaged, eResult.packaged);
      assert.equal(cResult.packaged, true);
    });
  });

  /*
   * The reason the test above spent a release red.
   *
   * `verifyAll` short-circuits off darwin and used to return a *narrower*
   * object — no `packaged`, no `fix`, no `hardware`. Written and run on a Mac,
   * that branch is never taken, so the file was green locally and red on every
   * CI run, on the one platform this app actually ships to (HR-2). Asserting
   * the key set rather than a value is what makes this hold on every host: it
   * fails wherever the two paths disagree, not only where the short one runs.
   */
  test('both return paths carry the whole documented result shape', () => {
    const cjs = require('../nativeArch.cjs');
    return import('../nativeArch.mjs').then((esm) => {
      const documented = ['fix', 'hardware', 'mismatches', 'ok', 'packaged', 'skipped'];
      for (const [name, mod] of [
        ['cjs', cjs],
        ['esm', esm],
      ]) {
        const result = mod.verifyAll(undefined, { packaged: true });
        assert.deepEqual(
          Object.keys(result).sort(),
          documented,
          `${name}.verifyAll on ${process.platform} returned ${JSON.stringify(Object.keys(result).sort())}`,
        );
        // Whichever branch this host took, none of it may be undefined.
        for (const key of documented) {
          assert.notEqual(result[key], undefined, `${name}.${key} is undefined on ${process.platform}`);
        }
      }
    });
  });
});