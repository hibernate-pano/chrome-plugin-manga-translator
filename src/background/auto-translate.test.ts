import { describe, expect, it } from 'vitest';
import {
  createAutoTranslateMessage,
  isTranslationEnabled,
} from './auto-translate';

describe('background auto translate helpers', () => {
  it('reads enabled from top-level config', () => {
    expect(isTranslationEnabled({ enabled: true })).toBe(true);
    expect(isTranslationEnabled({ enabled: false })).toBe(false);
  });

  it('reads enabled from zustand persisted state shape', () => {
    expect(isTranslationEnabled({ state: { enabled: true } })).toBe(true);
    expect(isTranslationEnabled({ state: { enabled: false } })).toBe(false);
  });

  it('defaults to disabled for invalid config', () => {
    expect(isTranslationEnabled(null)).toBe(false);
    expect(isTranslationEnabled(undefined)).toBe(false);
    expect(isTranslationEnabled('bad')).toBe(false);
  });

  it('creates correct messages for auto translate transitions', () => {
    expect(createAutoTranslateMessage(true)).toEqual({
      type: 'TRANSLATE_PAGE',
    });
    expect(createAutoTranslateMessage(false)).toEqual({
      type: 'CANCEL_TRANSLATION',
    });
  });
});
