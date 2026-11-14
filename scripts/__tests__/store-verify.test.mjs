/**
 * The verify path exists because a version string is not a build: v2.2.0 was
 * live with the version the ledger recorded and without the security fix the
 * repository had. These tests pin the two decisions that make the check
 * meaningful — where the ZIP starts inside a CRX, and that "same version" is
 * not the same as "same files".
 */
import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import {
  compareBundles,
  crxZipOffset,
  describeVerdict,
  hashTree,
  parseArgs,
  StoreVerifyError,
} from '../store-verify.mjs';

function crx3(zipBytes, headerSize = 6) {
  const bytes = Buffer.alloc(12 + headerSize + zipBytes.length);
  bytes.write('Cr24', 0, 'latin1');
  bytes.writeUInt32LE(3, 4);
  bytes.writeUInt32LE(headerSize, 8);
  Buffer.from(zipBytes).copy(bytes, 12 + headerSize);
  return bytes;
}

function crx2(zipBytes, publicKeySize = 4, signatureSize = 5) {
  const bytes = Buffer.alloc(
    16 + publicKeySize + signatureSize + zipBytes.length
  );
  bytes.write('Cr24', 0, 'latin1');
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(publicKeySize, 8);
  bytes.writeUInt32LE(signatureSize, 12);
  Buffer.from(zipBytes).copy(bytes, 16 + publicKeySize + signatureSize);
  return bytes;
}

const ZIP_LOCAL_HEADER = 'PK\x03\x04payload';

describe('parseArgs', () => {
  it('defaults to the listing this repository publishes to', () => {
    const options = parseArgs([]);
    expect(options.itemId).toBe('llicfmiagjiknidigpdcnogfeheogpfd');
    expect(options.zip).toBeNull();
    expect(options.json).toBe(false);
  });

  it('reads a package path, an item override and JSON mode', () => {
    const options = parseArgs(['release/x.zip', '--item=abc', '--json']);
    expect(options.zip).toBe('release/x.zip');
    expect(options.itemId).toBe('abc');
    expect(options.json).toBe(true);
  });

  it('refuses an empty item id instead of downloading the default', () => {
    expect(() => parseArgs(['--item='])).toThrow(StoreVerifyError);
  });

  it('refuses unknown flags', () => {
    expect(() => parseArgs(['--live'])).toThrow(StoreVerifyError);
  });
});

describe('crxZipOffset', () => {
  it('reads the offset from a CRX3 header length', () => {
    const bytes = crx3(ZIP_LOCAL_HEADER, 6);
    expect(crxZipOffset(bytes)).toBe(12 + 6);
  });

  it('reads the offset from a legacy CRX2 key and signature', () => {
    const bytes = crx2(ZIP_LOCAL_HEADER, 4, 5);
    expect(crxZipOffset(bytes)).toBe(16 + 4 + 5);
  });

  it('rejects bytes that are not a CRX', () => {
    expect(() => crxZipOffset(Buffer.from('PK\x03\x04'))).toThrow(
      /missing the Cr24 header/
    );
  });

  it('rejects an unknown CRX version', () => {
    const bytes = crx3(ZIP_LOCAL_HEADER);
    bytes.writeUInt32LE(9, 4);
    expect(() => crxZipOffset(bytes)).toThrow(/unsupported CRX version/);
  });

  it('rejects a declared offset that does not land on a ZIP header', () => {
    const bytes = crx3(ZIP_LOCAL_HEADER, 6);
    bytes.writeUInt32LE(7, 8);
    expect(() => crxZipOffset(bytes)).toThrow(/does not/);
  });
});

describe('hashTree', () => {
  it('hashes files, normalises separators and drops store metadata', () => {
    const tree = hashTree({
      'content.js': Buffer.from('a'),
      'chunks\\x.js': Buffer.from('b'),
      '_metadata/verified_contents.json': Buffer.from('{}'),
    });
    expect([...tree.keys()]).toEqual(['content.js', 'chunks/x.js']);
    expect(tree.get('content.js')).toBe(
      'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'
    );
  });
});

describe('compareBundles', () => {
  const expected = new Map([
    ['content.js', 'a'.repeat(64)],
    ['manifest.json', 'b'.repeat(64)],
  ]);

  it('passes only when every file and hash matches', () => {
    const result = compareBundles(expected, new Map(expected));
    expect(result).toEqual({
      ok: true,
      missing: [],
      extra: [],
      changed: [],
    });
  });

  it('names a file whose bytes differ — the v2.2.0 failure', () => {
    const live = new Map(expected);
    live.set('content.js', 'c'.repeat(64));
    const result = compareBundles(expected, live);
    expect(result.ok).toBe(false);
    expect(result.changed).toEqual(['content.js']);
  });

  it('names files the store lacks or added', () => {
    const live = new Map([['manifest.json', 'b'.repeat(64)]]);
    live.set('extra.js', 'd'.repeat(64));
    const result = compareBundles(expected, live);
    expect(result.missing).toEqual(['content.js']);
    expect(result.extra).toEqual(['extra.js']);
  });
});

describe('describeVerdict', () => {
  it('says OK only when both the version and the files match', () => {
    const verdict = describeVerdict({
      expectedVersion: '2.2.1',
      liveVersion: '2.2.1',
      result: { ok: true, missing: [], extra: [], changed: [] },
    });
    expect(verdict).toContain('verdict          : OK');
  });

  it('does not call a version-equal but different bundle OK', () => {
    const verdict = describeVerdict({
      expectedVersion: '2.2.0',
      liveVersion: '2.2.0',
      result: { ok: false, missing: [], extra: [], changed: ['content.js'] },
    });
    expect(verdict).toContain('changed          : content.js');
    expect(verdict).toContain('MISMATCH');
    expect(verdict).not.toContain('OK —');
  });
});
