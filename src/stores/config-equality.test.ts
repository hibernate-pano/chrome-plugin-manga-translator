import { describe, expect, it } from 'vitest';

import { isConfigValueEqual, pickConfigFields } from './config-equality';

describe('isConfigValueEqual', () => {
  it('treats identical primitives as equal', () => {
    expect(isConfigValueEqual(1, 1)).toBe(true);
    expect(isConfigValueEqual('a', 'a')).toBe(true);
    expect(isConfigValueEqual(null, null)).toBe(true);
    expect(isConfigValueEqual(undefined, undefined)).toBe(true);
  });

  it('compares arrays element-wise and rejects length mismatches', () => {
    expect(isConfigValueEqual([1, 2], [1, 2])).toBe(true);
    expect(isConfigValueEqual([1, 2], [2, 1])).toBe(false);
    expect(isConfigValueEqual([1], [1, 2])).toBe(false);
    expect(isConfigValueEqual([1], '1')).toBe(false);
  });

  it('compares objects by value and key count', () => {
    expect(
      isConfigValueEqual({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })
    ).toBe(true);
    expect(isConfigValueEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(isConfigValueEqual({ a: 1 }, { b: 1 })).toBe(false);
  });

  it('rejects mixed kinds and differing primitives', () => {
    expect(isConfigValueEqual(1, '1')).toBe(false);
    expect(isConfigValueEqual({ a: 1 }, [1])).toBe(false);
    expect(isConfigValueEqual([1], { 0: 1 })).toBe(false);
  });

  it('compares functions by reference', () => {
    const fn = () => undefined;
    expect(isConfigValueEqual(fn, fn)).toBe(true);
    expect(
      isConfigValueEqual(
        () => undefined,
        () => undefined
      )
    ).toBe(false);
  });
});

describe('pickConfigFields', () => {
  it('projects only requested keys that exist on the source', () => {
    const source = { a: 1, b: 'x', c: () => undefined };
    expect(pickConfigFields(source, ['a', 'b', 'missing'])).toEqual({
      a: 1,
      b: 'x',
    });
  });

  it('returns an empty object for non-object sources', () => {
    expect(pickConfigFields(null, ['a'])).toEqual({});
    expect(pickConfigFields('str', ['a'])).toEqual({});
    expect(pickConfigFields([1, 2], ['0'])).toEqual({});
  });
});
