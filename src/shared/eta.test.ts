/**
 * eta.test.ts
 *
 * 剩余时间的中文格式化。HUD 和弹窗都靠它，所以边界值要钉死：
 * 不能把"不知道"显示成"0 秒"。
 */

import { describe, it, expect } from 'vitest';
import { formatEta } from './eta';

describe('formatEta', () => {
  it('不足一分钟只报秒', () => {
    expect(formatEta(0)).toBe('0 秒');
    expect(formatEta(1)).toBe('1 秒');
    expect(formatEta(45)).toBe('45 秒');
    expect(formatEta(59)).toBe('59 秒');
  });

  it('四舍五入到整秒', () => {
    expect(formatEta(45.4)).toBe('45 秒');
    expect(formatEta(45.6)).toBe('46 秒');
  });

  it('整分钟不带秒', () => {
    expect(formatEta(60)).toBe('1 分');
    expect(formatEta(120)).toBe('2 分');
  });

  it('零头秒跟分钟一起显示', () => {
    expect(formatEta(90)).toBe('1 分 30 秒');
    expect(formatEta(191)).toBe('3 分 11 秒');
  });

  it('负数和非有限值返回空串', () => {
    // 空串表示"这个数不值得显示"，而不是"0 秒"——后者会被读成"卡住了"。
    expect(formatEta(-1)).toBe('');
    expect(formatEta(Number.NaN)).toBe('');
    expect(formatEta(Number.POSITIVE_INFINITY)).toBe('');
  });
});
