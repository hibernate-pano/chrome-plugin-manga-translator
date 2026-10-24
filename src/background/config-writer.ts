/**
 * The one place the worker writes the persisted configuration.
 *
 * Two writers used to share `APP_CONFIG_STORAGE_KEY`: zustand's `persist`
 * middleware wrote `{ state, version }`, and the worker wrote a flat object
 * to the same key. The shapes are not interchangeable — zustand rehydrates
 * from `deserializedStorageValue.state`, so a flat object reads back as
 * `undefined`, merges the defaults over the user's settings and writes
 * those defaults straight back to disk. The user's API key, endpoint, model
 * and auto-translate allowlist were destroyed by a single extension update.
 *
 * So every write goes through here, and it always writes the envelope the
 * store reads.
 */
import {
  APP_CONFIG_STORAGE_KEY,
  APP_CONFIG_VERSION,
  detectFlatConfigVersion,
} from '@/shared/app-config';
import { obfuscateAllApiKeys } from '@/utils/crypto';

/**
 * The on-disk shape of the persisted configuration.
 *
 * `state` holds the config fields, `version` the shape version. Zustand
 * writes exactly this and reads exactly this.
 */
export interface ConfigEnvelope {
  state: Record<string, unknown>;
  version: number;
}

/**
 * Build the envelope for a config state.
 *
 * The state is cloned first so the caller's object is never mutated, and
 * its API keys are obfuscated on the way in: what lands on disk is never a
 * plaintext key, exactly as with the store's own storage adapter.
 *
 * The version defaults to the current one, but it can be pinned: a value
 * that came off disk keeps the version it was written with, because that is
 * the version the store's own migration knows how to step forward from.
 * Overwriting it with the current version would skip that migration.
 */
export function buildConfigEnvelope(
  state: Record<string, unknown>,
  version: number = APP_CONFIG_VERSION
): ConfigEnvelope {
  const cloned = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
  obfuscateAllApiKeys(cloned);
  return { state: cloned, version };
}

/**
 * Write the config in the shape the store reads.
 *
 * This is the only function in the worker that writes the config key. Every
 * write goes through it, so the key holds exactly one shape.
 */
export async function writeConfigEnvelope(
  state: Record<string, unknown>,
  version: number = APP_CONFIG_VERSION
): Promise<void> {
  await chrome.storage.local.set({
    [APP_CONFIG_STORAGE_KEY]: buildConfigEnvelope(state, version),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Is this value already the envelope the store reads?
 */
export function isConfigEnvelope(value: unknown): boolean {
  return isRecord(value) && isRecord(value['state']);
}

/**
 * Wrap whatever is on disk into the envelope the store reads.
 *
 * Two shapes exist in the wild. The envelope `{ state, version }` is what
 * zustand writes today. The flat object is what the worker used to write to
 * the same key — and it is still on disk for anyone who installed the
 * extension before the envelope existed, or whose configuration was moved
 * out of `chrome.storage.sync`.
 *
 * The version matters as much as the shape:
 *
 * - An envelope keeps the version it was written with, because that version
 *   is the one the store's own migration knows how to step forward from.
 * - A flat object has no version of its own, so it is dated by its contents
 *   — see `detectFlatConfigVersion`. Guessing "version 0" for it would replay
 *   the whole legacy migration over a perfectly modern configuration, and the
 *   step that adds `onboardingCompleted` would never run, so a user who had
 *   already been through the wizard was shown it again.
 *
 * The API keys are obfuscated on the way in. `obfuscateApiKey` leaves an
 * already-obfuscated key alone, so this is safe to run over a value that came
 * off disk, and it also means a key that was somehow stored in plaintext
 * stops being plaintext.
 *
 * Returns `null` for a value that is not a config object at all.
 */
export function toConfigEnvelope(value: unknown): ConfigEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }

  if (isRecord(value['state'])) {
    const state = { ...(value['state'] as Record<string, unknown>) };
    const storedVersion = value['version'];
    obfuscateAllApiKeys(state);
    return {
      state,
      version:
        typeof storedVersion === 'number'
          ? storedVersion
          : detectFlatConfigVersion(state),
    };
  }

  const state = { ...value };
  obfuscateAllApiKeys(state);
  return { state, version: detectFlatConfigVersion(state) };
}
