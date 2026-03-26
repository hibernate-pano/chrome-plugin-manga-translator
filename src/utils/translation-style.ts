export type TranslationStylePreset =
  | 'faithful'
  | 'natural-zh'
  | 'concise-bubble';

export const DEFAULT_TRANSLATION_STYLE_PRESET: TranslationStylePreset =
  'natural-zh';

const STYLE_PROMPTS: Record<TranslationStylePreset, string> = {
  faithful:
    'Style: stay close to the source wording and nuance. Prefer fidelity over rewriting.',
  'natural-zh':
    'Style: read like polished natural Simplified Chinese manga dialogue. Keep tone vivid and native.',
  'concise-bubble':
    'Style: optimize for tight speech bubbles. Keep lines short, direct, and easy to read at a glance.',
};

export function getTranslationStyleInstruction(
  preset: TranslationStylePreset = DEFAULT_TRANSLATION_STYLE_PRESET
): string {
  return STYLE_PROMPTS[preset];
}
