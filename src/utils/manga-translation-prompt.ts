/**
 * 漫画翻译专用 Prompt 配置
 * 
 * 针对漫画翻译场景优化的提示词，确保翻译结果：
 * 1. 保持漫画对话的自然口语化风格
 * 2. 正确处理拟声词和音效
 * 3. 保留角色说话的语气和情感
 * 4. 适应中文阅读习惯
 * 
 * Requirements:
 * - 5.1: 将检测到的任何外语文字翻译成简体中文
 * - 5.2: 自动识别源语言（日语、英语、韩语等），无需用户手动选择
 */

/**
 * 固定的目标语言 - 简体中文
 */
export const TARGET_LANGUAGE = 'zh-CN';

/**
 * 目标语言显示名称
 */
export const TARGET_LANGUAGE_NAME = '简体中文';

/**
 * 漫画翻译专用系统提示词
 * 
 * 设计原则：
 * - 保持漫画对话的口语化和自然感
 * - 正确翻译拟声词（如日语的オノマトペ）
 * - 保留角色的语气和情感表达
 * - 适应中文漫画的阅读习惯
 */
export const MANGA_TRANSLATION_SYSTEM_PROMPT = `你是一位专业的漫画翻译专家，精通日语、英语、韩语等多种语言到简体中文的翻译。

翻译要求：
1. **口语化表达**：漫画对话应该自然、口语化，避免书面语和生硬的翻译腔
2. **拟声词处理**：
   - 日语拟声词（如「ドキドキ」「ガタガタ」）翻译成对应的中文拟声词
   - 保留音效的表现力，如「砰」「嗖」「咔嚓」等
3. **语气保留**：
   - 保持角色说话的语气（傲娇、温柔、愤怒等）
   - 注意敬语和语气词的转换
4. **简洁有力**：漫画气泡空间有限，翻译要简洁但不失原意
5. **文化适应**：将文化特定表达转换为中文读者能理解的方式

注意事项：
- 只输出翻译结果，不要添加解释或注释
- 如果是多段文本用分隔符分开，保持相同的分隔符格式
- 保持原文的换行格式`;

/**
 * 获取漫画翻译的完整选项
 * 
 * @returns 翻译选项对象
 */
export function getMangaTranslationOptions(): {
  targetLanguage: string;
  sourceLanguage: string;
  context: string;
  translationPrompt: string;
} {
  return {
    targetLanguage: TARGET_LANGUAGE,
    sourceLanguage: 'auto', // 自动检测源语言
    context: 'manga',
    translationPrompt: MANGA_TRANSLATION_SYSTEM_PROMPT,
  };
}

/**
 * 获取针对特定文本类型的翻译提示
 * 
 * @param textType - 文本类型：bubble（对话气泡）、narration（旁白）、sfx（音效）
 * @returns 针对该类型优化的翻译提示
 */
export function getTextTypePrompt(textType: 'bubble' | 'narration' | 'sfx' | 'other'): string {
  switch (textType) {
    case 'bubble':
      return '这是漫画对话气泡中的文字，请用自然口语化的方式翻译。';
    case 'narration':
      return '这是漫画旁白/叙述文字，可以稍微正式一些，但仍要流畅易读。';
    case 'sfx':
      return '这是漫画音效/拟声词，请翻译成对应的中文拟声词或音效词。';
    default:
      return '';
  }
}
