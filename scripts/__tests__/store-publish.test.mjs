/**
 * The publish path is the last thing that runs before a package reaches
 * every store user, so the parts of it that can be decided without a network
 * are decided here instead: what the flags mean, where the credentials come
 * from, what the request says, and what the store's answers mean.
 *
 * Two of these are regressions waiting to happen, and each has a test:
 *
 *   - `fetchStatus` is a GET. Posting to it fails, and the failure looks
 *     like a broken item rather than a wrong verb.
 *   - The publish request decides whether a version goes live the moment
 *     the review passes, or waits for a second, deliberate release. A
 *     request with no body leaves that to whatever the dashboard saved.
 */
import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPublishRequest,
  buildServiceAccountAssertion,
  compareVersions,
  decodeAssertion,
  describeStatus,
  interpretUploadState,
  parseArgs,
  parseCredentialFile,
  publishedVersion,
  PublishError,
  resolveCredentials,
} from '../store-publish.mjs';
import { formatFindings, scanTree } from '../credential-scan.mjs';

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);

const FULL_ENV = {
  CLIENT_ID: 'id',
  CLIENT_SECRET: 'secret',
  REFRESH_TOKEN: 'token',
  PUBLISHER_ID: 'pub',
  ITEM_ID: 'item',
};

describe('parseArgs', () => {
  it('defaults to publishing live on approval', () => {
    const options = parseArgs([]);
    expect(options.publishType).toBe('default');
    expect(options.rollout).toBeNull();
    expect(options.dryRun).toBe(false);
    expect(options.zip).toBeNull();
  });

  it('reads the package path from the first positional argument', () => {
    expect(parseArgs(['release/x.zip']).zip).toBe('release/x.zip');
  });

  it('reads the staged publish type', () => {
    expect(parseArgs(['--publish-type=staged']).publishType).toBe('staged');
  });

  it('rejects an unknown publish type', () => {
    expect(() => parseArgs(['--publish-type=slow'])).toThrow(PublishError);
  });

  it('reads the rollout percentage', () => {
    expect(parseArgs(['--rollout=25']).rollout).toBe(25);
  });

  it('rejects a rollout percentage outside 0-100', () => {
    expect(() => parseArgs(['--rollout=101'])).toThrow(PublishError);
    expect(() => parseArgs(['--rollout=-1'])).toThrow(PublishError);
    expect(() => parseArgs(['--rollout=half'])).toThrow(PublishError);
  });

  it('rejects an unknown flag instead of ignoring it', () => {
    // A typo in a flag that changes what goes live must not read as a
    // successful run with the default behaviour.
    expect(() => parseArgs(['--publsh-type=staged'])).toThrow(PublishError);
  });

  it('rejects a second positional argument', () => {
    expect(() => parseArgs(['a.zip', 'b.zip'])).toThrow(PublishError);
  });

  it('reads the credentials file and the review flags', () => {
    const options = parseArgs([
      '--credentials=/tmp/creds.env',
      '--skip-review',
      '--block-on-warnings',
      '--dry-run',
    ]);
    expect(options.credentialsFile).toBe('/tmp/creds.env');
    expect(options.skipReview).toBe(true);
    expect(options.blockOnWarnings).toBe(true);
    expect(options.dryRun).toBe(true);
  });
});

describe('parseCredentialFile', () => {
  it('reads KEY=VALUE lines', () => {
    const values = parseCredentialFile('CLIENT_ID=abc\nCLIENT_SECRET=def\n');
    expect(values.CLIENT_ID).toBe('abc');
    expect(values.CLIENT_SECRET).toBe('def');
  });

  it('skips comments and blank lines', () => {
    const values = parseCredentialFile(
      '# a comment\n\nCLIENT_ID=abc\n   \n#CLIENT_SECRET=nope\n'
    );
    expect(values.CLIENT_ID).toBe('abc');
    expect(values.CLIENT_SECRET).toBeUndefined();
  });

  it('accepts an export prefix and quotes', () => {
    const values = parseCredentialFile(
      'export CLIENT_ID="abc"\nexport REFRESH_TOKEN=\'xyz\'\n'
    );
    expect(values.CLIENT_ID).toBe('abc');
    expect(values.REFRESH_TOKEN).toBe('xyz');
  });

  it('ignores a line that is not a pair', () => {
    expect(parseCredentialFile('just some text\n')).toEqual({});
  });

  it('keeps a value that contains an equals sign', () => {
    expect(parseCredentialFile('CLIENT_SECRET=ab=cd\n').CLIENT_SECRET).toBe(
      'ab=cd'
    );
  });
});

describe('resolveCredentials', () => {
  it('reads the values from the environment', () => {
    const { auth, publisherId, itemId, source } = resolveCredentials({
      env: FULL_ENV,
    });
    expect(auth.mode).toBe('refresh-token');
    expect(auth.refreshToken).toBe('token');
    expect(publisherId).toBe('pub');
    expect(itemId).toBe('item');
    expect(source).toBe('environment');
  });

  it('falls back to the credentials file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mt-creds-'));
    try {
      const file = join(dir, 'credentials.env');
      writeFileSync(
        file,
        'CLIENT_ID=abc\nCLIENT_SECRET=def\nREFRESH_TOKEN=tok\n' +
          'PUBLISHER_ID=pub\nITEM_ID=item\n'
      );
      const { auth, source } = resolveCredentials({
        env: { HOME: dir, CWS_CREDENTIALS_FILE: file },
        credentialsFile: file,
      });
      expect(auth.clientId).toBe('abc');
      expect(source).toBe(file);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lets the environment win over the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mt-creds-'));
    try {
      const file = join(dir, 'credentials.env');
      writeFileSync(file, 'PUBLISHER_ID=from-file\n');
      const { publisherId } = resolveCredentials({
        env: { ...FULL_ENV, CWS_CREDENTIALS_FILE: file },
        credentialsFile: file,
      });
      expect(publisherId).toBe('pub');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('takes a ready-made access token when there is one', () => {
    const { auth } = resolveCredentials({
      env: { ...FULL_ENV, ACCESS_TOKEN: 'ya29.abc' },
    });
    expect(auth.mode).toBe('access-token');
    expect(auth.accessToken).toBe('ya29.abc');
  });

  it('takes a service account key when there is one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mt-creds-'));
    try {
      const file = join(dir, 'key.json');
      writeFileSync(file, '{}');
      const { auth } = resolveCredentials({
        env: { ...FULL_ENV, SERVICE_ACCOUNT_KEY: file },
      });
      expect(auth.mode).toBe('service-account');
      expect(auth.keyPath).toBe(file);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names what is missing', () => {
    expect(() =>
      resolveCredentials({ env: { CLIENT_ID: 'abc', PUBLISHER_ID: 'p' } })
    ).toThrow(/ITEM_ID/);
  });

  it('refuses a credentials file inside the repository', () => {
    // The repository is the one place a secret must never end up: it is
    // committed.
    expect(() =>
      resolveCredentials({
        env: FULL_ENV,
        credentialsFile: join(projectRoot, 'credentials.env'),
        projectRoot,
      })
    ).toThrow(/inside the repository/);
  });

  it('refuses a service account key inside the repository', () => {
    expect(() =>
      resolveCredentials({
        env: {
          ...FULL_ENV,
          SERVICE_ACCOUNT_KEY: join(projectRoot, 'key.json'),
        },
        projectRoot,
      })
    ).toThrow(/inside the repository/);
  });

  it('fails when a named credentials file does not exist', () => {
    expect(() =>
      resolveCredentials({
        env: FULL_ENV,
        credentialsFile: join(tmpdir(), 'mt-does-not-exist.env'),
      })
    ).toThrow(/not found/);
  });

  it('does not require the default credentials file to exist', () => {
    const { itemId } = resolveCredentials({
      env: { ...FULL_ENV, HOME: join(tmpdir(), 'mt-no-home') },
    });
    expect(itemId).toBe('item');
  });
});

describe('buildServiceAccountAssertion', () => {
  it('signs a JWT the token endpoint accepts', () => {
    // The key pair is generated here, so the signature can be checked
    // against the public half: a JWT that only looks right is not right.
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const key = {
      client_email: 'publisher@example.iam.gserviceaccount.com',
      private_key_id: 'key-id',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    };

    const assertion = buildServiceAccountAssertion(key, { now: 1000 });

    const [header, claims, signature] = assertion.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
      kid: 'key-id',
    });
    expect(decodeAssertion(assertion)).toEqual({
      iss: 'publisher@example.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/chromewebstore',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1000,
      exp: 4600,
    });
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(`${header}.${claims}`),
        publicKey,
        Buffer.from(signature, 'base64url')
      )
    ).toBe(true);
  });

  it('refuses a key file that is not a service account key', () => {
    expect(() => buildServiceAccountAssertion({})).toThrow(PublishError);
  });
});

describe('buildPublishRequest', () => {
  it('publishes live on approval by default', () => {
    expect(buildPublishRequest()).toEqual({
      publishType: 'DEFAULT_PUBLISH',
      skipReview: false,
      blockOnWarnings: false,
    });
  });

  it('can stage a version instead of releasing it', () => {
    expect(buildPublishRequest({ publishType: 'staged' }).publishType).toBe(
      'STAGED_PUBLISH'
    );
  });

  it('carries the rollout percentage', () => {
    expect(buildPublishRequest({ rollout: 10 }).deployInfos).toEqual([
      { deployPercentage: 10 },
    ]);
  });

  it('leaves the rollout out when there is none', () => {
    expect(buildPublishRequest().deployInfos).toBeUndefined();
  });
});

describe('interpretUploadState', () => {
  it('recognises an upload that is still running', () => {
    expect(interpretUploadState({ uploadState: 'IN_PROGRESS' })).toBe(
      'pending'
    );
  });

  it('recognises the other spelling of the same state', () => {
    expect(interpretUploadState({ uploadState: 'UPLOAD_IN_PROGRESS' })).toBe(
      'pending'
    );
  });

  it('recognises a finished upload', () => {
    expect(interpretUploadState({ uploadState: 'SUCCEEDED' })).toBe(
      'succeeded'
    );
    expect(interpretUploadState({ uploadState: 'COMPLETE' })).toBe('succeeded');
  });

  it('recognises a rejected upload', () => {
    expect(interpretUploadState({ uploadState: 'FAILED' })).toBe('failed');
  });

  it('treats an absent state as nothing to wait for', () => {
    expect(interpretUploadState({})).toBe('none');
    expect(interpretUploadState(undefined)).toBe('none');
  });
});

describe('compareVersions', () => {
  it('orders versions numerically, not alphabetically', () => {
    expect(compareVersions('2.0.10', '2.0.9')).toBe(1);
    expect(compareVersions('2.0.9', '2.0.10')).toBe(-1);
  });

  it('treats a missing part as zero', () => {
    expect(compareVersions('2.0', '2.0.0')).toBe(0);
    expect(compareVersions('2.0.1', '2.0')).toBe(1);
  });

  it('reports equal versions as equal', () => {
    expect(compareVersions('2.0.4', '2.0.4')).toBe(0);
  });
});

describe('publishedVersion', () => {
  it('reads the live version out of the status', () => {
    expect(
      publishedVersion({
        publishedItemRevisionStatus: {
          distributionChannels: [{ crxVersion: '2.0.3' }],
        },
      })
    ).toBe('2.0.3');
  });

  it('has nothing to report for an unpublished item', () => {
    expect(publishedVersion({})).toBeNull();
  });
});

describe('describeStatus', () => {
  it('summarises the states', () => {
    const text = describeStatus({
      publishedItemRevisionStatus: { state: 'PUBLISHED' },
      submittedItemRevisionStatus: { state: 'PENDING_REVIEW' },
    });
    expect(text).toContain('published=PUBLISHED');
    expect(text).toContain('submitted=PENDING_REVIEW');
  });

  it('says so when the store reports nothing', () => {
    expect(describeStatus({})).toContain('no state');
  });
});

describe('credential scan', () => {
  it('finds a key in a bundle', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mt-scan-'));
    try {
      mkdirSync(join(dir, 'chunks'));
      writeFileSync(
        join(dir, 'chunks', 'base.js'),
        'const key = "sk-abcdefghijklmnopqrstuvwx";'
      );
      const findings = scanTree(dir, filePath =>
        filePath.slice(dir.length + 1)
      );
      expect(findings.length).toBeGreaterThan(0);
      expect(formatFindings(findings)[0]).toContain('chunks/base.js');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves a clean package alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mt-scan-'));
    try {
      writeFileSync(join(dir, 'content.js'), 'console.log("hello");');
      expect(scanTree(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores files it cannot read as text', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mt-scan-'));
    try {
      writeFileSync(join(dir, 'icon.png'), 'sk-abcdefghijklmnopqrstuvwx');
      expect(scanTree(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports the same secret once', () => {
    const findings = [
      { label: 'a.js', name: 'OpenAI-style key', preview: 'sk-abc…' },
      { label: 'b.js', name: 'OpenAI-style key', preview: 'sk-abc…' },
    ];
    expect(formatFindings(findings)).toHaveLength(1);
  });
});
