export type TranslationStylePreset =
  | 'faithful'
  | 'natural-zh'
  | 'concise-bubble'
  | 'preserve-original';

export const DEFAULT_TRANSLATION_STYLE_PRESET: TranslationStylePreset =
  'natural-zh';

const STYLE_PROMPTS: Record<TranslationStylePreset, string> = {
  /**
   * 忠实原文
   * - 保留日语敬语（-san、-kun、-chan、-sama 等）不做翻译
   * - 保留拟声词/感叹词原样（SFX 如 gacha、zawa 等翻译为中文象声词）
   * - 直译为主，不做本地化改写
   * - 保留原文注释和文化背景说明
   */
  faithful:
    'Style: faithful to source text. Preserve Japanese honorifics (-san, -kun, -chan, -sama) as-is. Convert SFX/onomatopoeia to natural Chinese equivalents (e.g., gacha → 咔嚓, zawa → 沙沙). Keep literal translation, no localization. Preserve cultural notes and annotations from source.',

  /**
   * 自然中文（默认）
   * - 译文流畅自然，读起来像中文母语漫画对话
   * - 允许四字格、成语化表达
   * - SFX 翻译为中文象声词/感叹词
   * - 敬语翻译为中文常用对应形式（如 -san → 先生/同学，或省略）
   * - 语气和情感表达本地化
   */
  'natural-zh':
    'Style: read like polished natural Simplified Chinese manga dialogue. Allow four-character idiom expressions. Convert SFX to vivid Chinese onomatopoeia. Translate honorifics to common Chinese equivalents (e.g., -san → 先生/同学, or omit naturally). Localize tone and emotional expression.',

  /**
   * 简洁气泡
   * - 专为狭窄气泡优化，字数最少化
   * - 砍掉所有修饰性成分，保留核心语义
   * - SFX 极简化处理（仅保留关键声音词）
   * - 敬语省略
   * - 适合屏幕空间有限的场景
   */
  'concise-bubble':
    'Style: optimize for tight speech bubbles. Keep lines extremely short and direct. Strip all decorative elements, preserve only core meaning. Minimal SFX. Omit honorifics. Ideal for space-constrained panels.',

  /**
   * 保留原味
   * - 最大程度保留日文原文元素
   * - 保留日语罗马音（romaji）注释（如 tanuki → たぬき）
   * - 保留敬语形式及注释（如「田中さん」保留）
   * - 保留日文拟声词原样（不翻译）
   * - 仅提供最低限度的中文翻译
   * - 适合学习日语的读者
   */
  'preserve-original':
    'Style: preserve maximum Japanese original flavor. Keep romaji annotations (e.g., tanuki → たぬき). Keep honorifics with notes (e.g., 「田中さん」). Keep Japanese SFX onomatopoeia untranslated. Provide minimal Chinese translation. Ideal for Japanese language learners.',
};

export function getTranslationStyleInstruction(
  preset: TranslationStylePreset = DEFAULT_TRANSLATION_STYLE_PRESET
): string {
  return STYLE_PROMPTS[preset];
}
