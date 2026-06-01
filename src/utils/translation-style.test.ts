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
    expect(getTranslationStyleInstruction('faithful')).toContain('honorifics');
    expect(getTranslationStyleInstruction('natural-zh')).toContain(
      'Simplified Chinese manga dialogue'
    );
    expect(getTranslationStyleInstruction('concise-bubble')).toContain(
      'tight speech bubbles'
    );
    expect(getTranslationStyleInstruction('preserve-original')).toContain(
      'romaji'
    );
  });

  it('faithful preserves Japanese honorifics', () => {
    const prompt = getTranslationStyleInstruction('faithful');
    expect(prompt).toContain('-san');
    expect(prompt).toContain('SFX');
  });

  it('natural-zh allows four-character idioms', () => {
    const prompt = getTranslationStyleInstruction('natural-zh');
    expect(prompt).toContain('four-character idiom');
  });

  it('preserve-original keeps Japanese elements', () => {
    const prompt = getTranslationStyleInstruction('preserve-original');
    expect(prompt).toContain('romaji');
    expect(prompt).toContain('たぬき');
  });
});
