/**
 * The freshness guard exists because a real release-ready ZIP survived two
 * later bug-fix commits: it was built at 19:05, the fixes landed at 21:00, and
 * the artifact sat in release/ with a matching .sha256 that made it look
 * verified. The guard is only worth having if it actually catches that, so
 * these tests pin both directions.
 *
 * The first implementation compared mtimes and failed both ways — a `touch`
 * into the future permanently blocked packaging, and a fresh manifest beside
 * a stale bundle passed. Content hashing is what makes these tests pass, so a
 * regression back to timestamps fails here rather than in a release.
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);
const modulePath = join(projectRoot, 'scripts', 'source-fingerprint.mjs');

/**
 * The fingerprint module resolves the project root from its own file
 * location, so exercising it against a fixture tree needs the module to be
 * importable with an overridden root. Rather than add a root override used
 * only by tests, the assertions below run against the real tree: they are
 * cheap, and they test the code that actually ships.
 */
describe('source fingerprint', () => {
  it('produces a stable digest for an unchanged tree', async () => {
    const mod = await import(pathToFileURL(modulePath).href);
    const first = mod.computeSourceFingerprint();
    const second = mod.computeSourceFingerprint();
    expect(second.digest).toBe(first.digest);
    expect(first.fileCount).toBeGreaterThan(0);
  });

  it('changes the digest when a build input changes', async () => {
    const mod = await import(pathToFileURL(modulePath).href);
    const before = mod.computeSourceFingerprint().digest;

    // A real source file, restored immediately. Using a throwaway file under
    // src/ would change the digest but not represent the real failure mode
    // (editing an existing module and forgetting to rebuild).
    const target = join(projectRoot, 'src', 'shared', 'runtime-contracts.ts');
    const original = readFileSync(target, 'utf8');
    try {
      writeFileSync(target, `${original}\n// fingerprint test\n`);
      const after = mod.computeSourceFingerprint().digest;
      expect(after).not.toBe(before);
    } finally {
      writeFileSync(target, original);
    }

    // And the restore must bring the digest back, proving the guard is not
    // merely accumulating state.
    expect(mod.computeSourceFingerprint().digest).toBe(before);
  });

  it('ignores non-build files such as tests and docs', async () => {
    const mod = await import(pathToFileURL(modulePath).href);
    const before = mod.computeSourceFingerprint().digest;

    const scratch = join(projectRoot, 'src', '__tests__');
    mkdirSync(scratch, { recursive: true });
    const file = join(scratch, 'fingerprint-probe.test.ts');
    try {
      writeFileSync(file, 'export const probe = 1;\n');
      expect(mod.computeSourceFingerprint().digest).toBe(before);
    } finally {
      rmSync(file, { force: true });
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('agrees with itself: changed iff no fingerprint matches the tree', async () => {
    const mod = await import(pathToFileURL(modulePath).href);
    const target = join(projectRoot, 'src', 'shared', 'runtime-contracts.ts');
    const original = readFileSync(target, 'utf8');

    try {
      // Record the tree as built, then confirm the guard calls it fresh.
      mod.writeSourceFingerprint();
      expect(mod.fingerprintSourceChanged().changed).toBe(false);

      // Now edit a build input without rebuilding: this is exactly the state
      // that shipped a stale ZIP, and the guard must reject it.
      writeFileSync(target, `${original}\n// edited after build\n`);
      const stale = mod.fingerprintSourceChanged();
      expect(stale.changed).toBe(true);
      expect(stale.reason).toContain('source changed');
    } finally {
      writeFileSync(target, original);
      rmSync(mod.FINGERPRINT_PATH, { force: true });
    }
  });

  it('stores the cache outside dist so it cannot reach the artifact', async () => {
    const mod = await import(pathToFileURL(modulePath).href);
    expect(
      mod.FINGERPRINT_PATH.startsWith(join(projectRoot, 'node_modules'))
    ).toBe(true);
    expect(mod.FINGERPRINT_PATH.startsWith(join(projectRoot, 'dist'))).toBe(
      false
    );
  });
});
