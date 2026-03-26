import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSLATION_STYLE_PRESET,
  getTranslationStyleInstruction,
} from './translation-style';

describe('translation-style', () => {
  it('has natural-zh as the default preset', () => {
    expect(DEFAULT_TRANSLATION_STYLE_PRESET).toBe('natural-zh');
  });

  it('returns distinct prompt instructions for presets', () => {
    expect(getTranslationStyleInstruction('faithful')).toContain('fidelity');
    expect(getTranslationStyleInstruction('natural-zh')).toContain(
      'Simplified Chinese manga dialogue'
    );
    expect(getTranslationStyleInstruction('concise-bubble')).toContain(
      'tight speech bubbles'
    );
  });
});
