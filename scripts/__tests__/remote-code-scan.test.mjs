/**
 * The scan's loader branches.
 *
 * A URL ending in `.js`/`.mjs`/`.wasm` is reported on its own, but that pass
 * cannot see a loader pointed at an extensionless URL: `new Worker(url)` or
 * `import(url)` still executes whatever the URL returns, because the loader
 * decides how to run it. The Chrome Web Store review rejects those too.
 *
 * The negative cases are just as load-bearing. This scanner runs on every
 * build, and flagging the extension's own packaged scripts would teach people
 * to work around the gate instead of trusting it.
 */
import { describe, expect, it } from 'vitest';

import { findRemoteCodeVectors } from '../lib/remote-code-scan.mjs';

function reasons(source) {
  return findRemoteCodeVectors(source).map(finding => finding.reason);
}

describe('remote code scanner: new Worker', () => {
  it('reports a remote worker even without a code-like extension', () => {
    const findings = findRemoteCodeVectors(
      "const worker = new Worker('https://cdn.example.com/ocr-worker');"
    );
    expect(findings).toContainEqual({
      file: '<source>',
      reason: 'remote new Worker',
      evidence: 'https://cdn.example.com/ocr-worker',
    });
  });

  it('reports a remote worker that also looks like a script URL', () => {
    const found = reasons(
      "new Worker('https://cdn.example.com/ocr-worker.js');"
    );
    expect(found).toContain('remote new Worker');
    expect(found).toContain('remote code URL');
  });

  it('does not report a worker loaded from the package', () => {
    expect(
      findRemoteCodeVectors("new Worker('tesseract/worker.min.js');")
    ).toEqual([]);
  });

  it('does not report a worker loaded through chrome.runtime.getURL', () => {
    expect(
      findRemoteCodeVectors(
        "new Worker(chrome.runtime.getURL('tesseract/worker.min.js'));"
      )
    ).toEqual([]);
  });
});

describe('remote code scanner: dynamic import', () => {
  it('reports a remote dynamic import even without a code-like extension', () => {
    const findings = findRemoteCodeVectors(
      "const panel = await import('https://cdn.example.com/manga-panel');"
    );
    expect(findings).toContainEqual({
      file: '<source>',
      reason: 'remote dynamic import',
      evidence: 'https://cdn.example.com/manga-panel',
    });
  });

  it('reports a remote dynamic import that also looks like a script URL', () => {
    const found = reasons("import('https://cdn.example.com/panel.js');");
    expect(found).toContain('remote dynamic import');
    expect(found).toContain('remote code URL');
  });

  it('does not report a bundled chunk import', () => {
    expect(findRemoteCodeVectors("import('./chunks/panel.js');")).toEqual([]);
  });

  it('does not report a chunk resolved through chrome.runtime.getURL', () => {
    expect(
      findRemoteCodeVectors("import(chrome.runtime.getURL('chunks/panel.js'));")
    ).toEqual([]);
  });

  it('does not report importScripts from the package', () => {
    expect(
      findRemoteCodeVectors("importScripts('tesseract/worker.min.js');")
    ).toEqual([]);
  });

  it('reports a remote importScripts', () => {
    const findings = findRemoteCodeVectors(
      "importScripts('https://cdn.example.com/worker');"
    );
    expect(findings).toContainEqual({
      file: '<source>',
      reason: 'remote importScripts',
      evidence: 'https://cdn.example.com/worker',
    });
  });
});
