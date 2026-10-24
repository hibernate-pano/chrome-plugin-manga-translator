/**
 * The languages the extension can translate into.
 *
 * The popup and the settings page each kept their own copy of this list, and
 * they had already drifted once: the popup said 「简中 / 繁中」 while the
 * settings page said 「简体中文 / 繁体中文」. A user reasonably read two
 * different labels for one setting as two different settings, and the popup's
 * own comment said so.
 *
 * One list, one place. The values are the keys the translation-style
 * instructions and the prompt use — see `src/utils/translation-style.ts` and
 * `src/providers/base.ts`.
 */
export interface TargetLanguage {
  /** The value stored in the config and sent to the model. */
  value: string;
  /** The name shown to the user, in that language. */
  label: string;
}

export const TARGET_LANGUAGES: readonly TargetLanguage[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁体中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
];

/**
 * The name of a target language, or the raw value when it is not one we know.
 *
 * The prompt has to name the language in words — "translate to en" is not
 * something a model reads as "translate to English".
 */
export function getTargetLanguageLabel(value: string): string {
  const found = TARGET_LANGUAGES.find(item => item.value === value);
  return found?.label ?? value;
}
