/**
 * Structural comparison for persisted app-config snapshots.
 *
 * Why this module exists: the persisted snapshot and the runtime Zustand
 * store describe the same configuration, but they are not the same object
 * shape and not the same reference graph.
 *
 * - The snapshot carries only the `partialize` whitelist (~19 fields).
 * - The runtime store additionally carries every action (~23 fields).
 * - Every persist write rebuilds `providers` and `overlayStyle` as brand new
 *   object references.
 *
 * So both "key count differs" and "reference differs" always report a change,
 * even when nothing changed. That is what turned `chrome.storage.onChanged`
 * into an unbounded loop (storage -> setState -> persist -> storage) and,
 * worse, fed the `obf:`-obfuscated key straight back into memory state.
 *
 * Comparison therefore has to be by value, over the fields the snapshot
 * actually carries.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep value equality for JSON-shaped config data.
 *
 * Functions are compared by reference: they never appear inside the
 * persisted snapshot, and identity is the only meaningful check for them.
 */
export function isConfigValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false;
    }
    if (left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => isConfigValueEqual(item, right[index]));
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    return leftKeys.every(
      key =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        isConfigValueEqual(left[key], right[key])
    );
  }

  return false;
}

/**
 * Extract `keys` from `source`, skipping keys the source does not carry.
 *
 * Used to project the runtime store down to the persisted field set before
 * comparing, so actions never enter the comparison and a freshly written
 * snapshot is recognised as identical to current state.
 */
export function pickConfigFields(
  source: unknown,
  keys: readonly string[]
): Record<string, unknown> {
  if (!isPlainObject(source)) {
    return {};
  }
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      picked[key] = source[key];
    }
  }
  return picked;
}
