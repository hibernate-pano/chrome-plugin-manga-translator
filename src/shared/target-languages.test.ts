import { describe, expect, it } from 'vitest';

import { TARGET_LANGUAGES, getTargetLanguageLabel } from './target-languages';

describe('目标语言', () => {
  it('is defined once, for both the popup and the settings page', () => {
    // 弹窗和设置页以前各写一份，两份已经漂移过一次：弹窗写"简中 / 繁中"，
    // 设置页写"简体中文 / 繁体中文"。用户会把两个说法当成两个设置。
    expect(TARGET_LANGUAGES.length).toBeGreaterThan(0);
    const values = TARGET_LANGUAGES.map(language => language.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain('zh-CN');
  });

  it('names a language in words', () => {
    expect(getTargetLanguageLabel('zh-CN')).toBe('简体中文');
    expect(getTargetLanguageLabel('en')).toBe('English');
  });

  it('falls back to the raw value for a language it does not know', () => {
    // 旧版本写进配置的、或者用户手改的值，也要显示得出来。
    expect(getTargetLanguageLabel('fr')).toBe('fr');
  });
});
