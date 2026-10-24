import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSLATION_STYLE_PRESET,
  getTargetLanguageName,
  getTranslationStyleInstruction,
} from './translation-style';

describe('translation-style', () => {
  it('has natural-zh as the default preset', () => {
    expect(DEFAULT_TRANSLATION_STYLE_PRESET).toBe('natural-zh');
  });

  it('returns distinct prompt instructions for presets', () => {
    expect(getTranslationStyleInstruction('faithful')).toContain('honorifics');
    expect(getTranslationStyleInstruction('natural-zh')).toContain(
      'natural manga dialogue'
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

  it('natural-zh allows four-character idioms when the target is Chinese', () => {
    // The idiom clause belongs to the Chinese localization, not to the
    // preset core: four-character idioms are a Chinese-language device.
    const prompt = getTranslationStyleInstruction('natural-zh', 'zh-CN');
    expect(prompt).toContain('Four-character idiom');
  });

  it('preserve-original keeps Japanese elements', () => {
    const prompt = getTranslationStyleInstruction('preserve-original');
    expect(prompt).toContain('romaji');
    expect(prompt).toContain('たぬき');
  });

  /**
   * The bug this split exists to prevent: every preset named Chinese, so a
   * user who picked English was sent "translate to en" and "read like
   * polished natural Simplified Chinese" in the same breath.
   *
   * Naming a *source* language is fine and necessary — the model has to
   * know what the comic might be written in. What must never appear is an
   * instruction to *write* in a language the user did not pick.
   */
  it('never asks the model to write in a language the user did not pick', () => {
    const english = getTranslationStyleInstruction('natural-zh', 'en');
    expect(english).toContain('Target language: English');
    expect(english).toContain('Write in English');
    expect(english).not.toContain('Write in Chinese');
    expect(english).not.toContain('Write in Japanese');
    expect(english).not.toContain('Write in Korean');
  });

  it('localizes each supported target language', () => {
    expect(getTranslationStyleInstruction('natural-zh', 'zh-CN')).toContain(
      'Simplified Chinese'
    );
    expect(getTranslationStyleInstruction('natural-zh', 'zh-TW')).toContain(
      'Traditional Chinese'
    );
    expect(getTranslationStyleInstruction('natural-zh', 'ja')).toContain(
      'Japanese'
    );
    expect(getTranslationStyleInstruction('natural-zh', 'ko')).toContain(
      'Korean'
    );
  });

  it('falls back to a generic clause for an unknown target language', () => {
    const prompt = getTranslationStyleInstruction('natural-zh', 'fr');
    expect(prompt).toContain('Target language: fr');
    expect(prompt).not.toContain('Write in Chinese');
  });

  it('treats a regional variant as its base language', () => {
    // `en-US` must not fall into the generic branch: the user did ask for
    // English, just with a region attached.
    expect(getTranslationStyleInstruction('natural-zh', 'en-US')).toContain(
      'English'
    );
  });

  it("never asks the output to keep the source language's grammar", () => {
    // The register of the speaker has to survive the translation, but it
    // has to survive as the TARGET language's register. Asking an English
    // translation to keep -요/-습니다 and 반말 is asking for Korean grammar
    // markers in an English sentence — which is how the mixed-language
    // output the presets used to produce came about.
    for (const target of ['en', 'ja', 'zh-CN', 'zh-TW']) {
      const prompt = getTranslationStyleInstruction('natural-zh', target);
      expect(prompt).not.toMatch(/must keep that distinction/);
      expect(prompt).not.toMatch(/반말 is casual, and the translation/);
      expect(prompt).toContain('Carry the source speaker');
    }
  });

  it('keeps the register instruction for a Korean target', () => {
    // The Korean clause still has to say what 해요체/합쇼체/반말 mean — that
    // is the target language's own register.
    expect(getTranslationStyleInstruction('natural-zh', 'ko')).toContain(
      '반말 for casual speech'
    );
  });
});

describe('getTargetLanguageName', () => {
  it('names the supported languages', () => {
    expect(getTargetLanguageName('zh-CN')).toBe('Simplified Chinese');
    expect(getTargetLanguageName('zh-TW')).toBe('Traditional Chinese');
    expect(getTargetLanguageName('en')).toBe('English');
    expect(getTargetLanguageName('ja')).toBe('Japanese');
    expect(getTargetLanguageName('ko')).toBe('Korean');
  });

  it('passes an unknown language through unchanged', () => {
    expect(getTargetLanguageName('fr')).toBe('fr');
  });

  it('does not name a language when none was chosen', () => {
    expect(getTargetLanguageName('')).toBe('the target language');
  });
});

describe('getTargetLanguageName 拒绝继承来的键', () => {
  it('does not hand back the inherited Object constructor', () => {
    // A hand-edited config could carry `targetLanguage: 'constructor'`.
    // The plain-object lookup used to return `Object` itself, and the
    // prompt ended up containing `function Object() { [native code] }`.
    const name = getTargetLanguageName('constructor');
    expect(name).toBe('constructor');
    expect(name).not.toContain('function');
  });

  it('does not fall back to the inherited constructor for a region tag', () => {
    expect(getTargetLanguageName('constructor-x')).toBe('constructor-x');
  });
});
