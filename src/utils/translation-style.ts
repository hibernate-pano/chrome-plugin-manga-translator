/**
 * Translation style presets.
 *
 * A preset says *how* to translate — faithfully, naturally, tersely, or with
 * the source flavour intact. It does not say *into which language*: that is
 * the target-language setting, and it is a separate knob the user picks.
 *
 * The two used to be fused. Every preset's prompt named Chinese explicitly
 * ("read like polished natural Simplified Chinese", "minimal Chinese
 * translation"), and the same string was appended to every request — while
 * the target-language list offered English, Japanese and Korean. Picking
 * English therefore sent the model two contradictory instructions ("translate
 * to en" and "read like natural Simplified Chinese"), and the model resolved
 * the conflict unpredictably: sometimes Chinese came back, sometimes English,
 * sometimes a mix.
 *
 * So the presets are now split in two: a language-neutral core that says what
 * to do, and a localization clause that says what "natural" means in the
 * language actually being written. The clause is derived from the target
 * language, so the two settings can no longer disagree.
 */

export type TranslationStylePreset =
  | 'faithful'
  | 'natural-zh'
  | 'concise-bubble'
  | 'preserve-original';

export const DEFAULT_TRANSLATION_STYLE_PRESET: TranslationStylePreset =
  'natural-zh';

/**
 * The language-neutral part of each preset.
 *
 * Nothing here names a language. That is deliberate: the target-language
 * setting supplies the language, and this supplies the register.
 */
const STYLE_CORES: Record<TranslationStylePreset, string> = {
  /**
   * 忠实原文
   * - 保留敬语不做本地化改写
   * - 直译为主
   * - 保留原文注释和文化背景说明
   */
  faithful:
    "Style: faithful to the source text. Keep honorifics (-san, -kun, -chan, -sama) as they are rather than localizing them. Keep the translation literal, without idiomatic rewriting. Convert SFX/onomatopoeia into the target language's equivalent rather than leaving them in the source script, but keep them as close to the original meaning as the language allows. Preserve cultural notes and annotations from the source.",

  /**
   * 自然表达（默认）
   * - 译文流畅自然，像该语言母语者的漫画对话
   * - 允许该语言惯用的成语化表达
   * - SFX 翻译为该语言的象声词
   * - 敬语翻译为该语言常用的对应形式
   * - 语气和情感表达本地化
   */
  'natural-zh':
    "Style: read like polished, natural manga dialogue in the target language. Allow the idioms and set expressions that language actually uses. Convert SFX to vivid onomatopoeia in the target language. Translate honorifics to the forms that language normally uses (Japanese -san → a familiar form of address or omit naturally). Carry the source speaker's register across: a Korean -요/-습니다 is polite and 반말 is casual, a Japanese -san is familiar, English \"sir\" is formal — render that politeness level in the target language's own register, never by leaving the source language's grammar markers in the output. Localize tone and emotional expression, including webtoon idiom and slang.",

  /**
   * 简洁气泡
   * - 专为狭窄气泡优化，字数最少化
   * - 砍掉所有修饰性成分，保留核心语义
   * - SFX 极简化处理
   * - 敬语省略
   * - 适合屏幕空间有限的场景
   */
  'concise-bubble':
    'Style: optimize for tight speech bubbles. Keep lines extremely short and direct in the target language. Strip all decorative elements, preserve only core meaning. Minimal SFX. Omit honorifics. Ideal for space-constrained panels.',

  /**
   * 保留原味
   * - 最大程度保留原文语言元素
   * - 保留罗马音（romaji）注释
   * - 保留敬语形式及注释
   * - 保留原文拟声词原样（不翻译）
   * - 仅提供最低限度的译文
   * - 适合学习原文语言的读者
   */
  'preserve-original':
    'Style: preserve the original flavor of the source. Keep romaji annotations (e.g., tanuki → たぬき). Keep honorifics with notes (e.g., 「田中さん」). Keep source-language SFX onomatopoeia untranslated. Provide only a minimal translation into the target language. Ideal for learners of the source language.',
};

/**
 * What "natural" means in each target language.
 *
 * These are the details that used to be hardcoded into the Chinese presets.
 * Keeping them here means a Korean translation gets Korean idiom, and an
 * English one gets English rhythm, instead of both being told to sound like
 * Simplified Chinese.
 */
const STYLE_LOCALIZATION: Record<string, string> = {
  'zh-CN':
    'Write in Simplified Chinese. Four-character idiom expressions are welcome. Chinese onomatopoeia are preferred, and webtoon slang should read as idiomatic Chinese (ㅋㅋ → 哈哈哈, ㅠㅠ → 呜呜).',
  'zh-TW':
    'Write in Traditional Chinese. Use Taiwan-style wording and Chinese onomatopoeia.',
  en: 'Write in English. Use natural English comic dialogue, not a word-for-word rendering.',
  ja: 'Write in Japanese. Use natural Japanese manga dialogue with appropriate keigo for the speaker.',
  ko: 'Write in Korean. Use natural Korean webtoon dialogue, including 해요체/합쇼체 for polite speech and 반말 for casual speech, and keep Korean netspeak idiomatic (ㅋㅋ, ㅠㅠ) rather than translating it literally.',
};

/**
 * The fallback when the target language is one we have no clause for.
 *
 * Better to say nothing specific than to say something specific and wrong.
 */
const GENERIC_LOCALIZATION =
  'Write in the target language, using its natural idioms and onomatopoeia.';

/**
 * How the target language reaches the prompt.
 *
 * The value in the config is a BCP-47-ish tag ('zh-CN'); the model reads an
 * English name far more reliably than it reads a tag.
 */
const TARGET_LANGUAGE_NAMES: Record<string, string> = {
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
};

/**
 * Look a key up in a plain map, ignoring what it inherits.
 *
 * `STYLE_LOCALIZATION['constructor']` used to hand back the inherited
 * `Object` constructor, and a hand-edited `targetLanguage: 'constructor'`
 * put `function Object() { [native code] }` into the prompt. The config
 * store already defends against this class of corruption; the prompt
 * builder has to defend against it too.
 */
function lookupOwn(
  map: Record<string, string>,
  key: string
): string | undefined {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

/**
 * What each preset means, in the reader's words.
 *
 * The prompts say it to the model; the reader sees only the name of the
 * preset on a dropdown. 「自然中文」 versus 「尽量忠实」 is a real choice —
 * it changes every request the extension makes from then on — and it used
 * to be a choice the reader had to make from four words, with no sentence
 * anywhere saying what any of them would do.
 */
export const TRANSLATION_STYLE_DESCRIPTIONS: Record<
  TranslationStylePreset,
  string
> = {
  'natural-zh':
    '译得像该语言的母语漫画对白：允许当地成语，敬语按当地习惯处理，梗和语气都翻到位。',
  faithful:
    '尽量贴着原文直译：保留敬语形式不做本地化改写，注释和文化背景照留。',
  'concise-bubble': '为窄气泡写：句子短而直接，去掉修饰词，符号词最简化。',
  'preserve-original':
    '给学原文的人：保留原文的拟声词和罗马音注释，只给最低限度的译文。',
};

/**
 * The name of a target language, for the prompt.
 *
 * `en-US` and `en` both mean English; an unknown tag is passed through
 * unchanged, because the base prompt already contains the raw value and
 * the model can work from it.
 */
export function getTargetLanguageName(targetLanguage: string): string {
  const trimmed = (targetLanguage ?? '').trim();
  if (!trimmed) {
    return 'the target language';
  }
  const exact = lookupOwn(TARGET_LANGUAGE_NAMES, trimmed);
  if (exact) {
    return exact;
  }
  const base = trimmed.split(/[-_]/)[0] ?? trimmed;
  return lookupOwn(TARGET_LANGUAGE_NAMES, base) ?? trimmed;
}

/**
 * The full style instruction for a preset and a target language.
 *
 * @param preset Which register to translate in.
 * @param targetLanguage The language being written. When it is a Chinese
 *   variant the localization clause names it explicitly; the preset cores
 *   stay language-neutral either way.
 */
export function getTranslationStyleInstruction(
  preset: TranslationStylePreset = DEFAULT_TRANSLATION_STYLE_PRESET,
  targetLanguage: string = 'zh-CN'
): string {
  const core =
    STYLE_CORES[preset] ?? STYLE_CORES[DEFAULT_TRANSLATION_STYLE_PRESET];
  const trimmed = (targetLanguage ?? '').trim();
  const base = trimmed.split(/[-_]/)[0] ?? trimmed;
  const localization =
    lookupOwn(STYLE_LOCALIZATION, trimmed) ??
    lookupOwn(STYLE_LOCALIZATION, base) ??
    GENERIC_LOCALIZATION;
  const languageName = getTargetLanguageName(trimmed);
  return `${core}\nTarget language: ${languageName}. ${localization}`;
}
