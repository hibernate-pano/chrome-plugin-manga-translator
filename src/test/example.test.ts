import { describe, it, expect } from 'vitest';

describe('测试环境验证', () => {
  it('应该能够运行基本测试', () => {
    expect(1 + 1).toBe(2);
  });

  it('应该能够访问Chrome API mock', () => {
    expect(chrome).toBeDefined();
    expect(chrome.storage).toBeDefined();
    expect(chrome.storage.local).toBeDefined();
  });

  it('应该能够使用TypeScript', () => {
    const message: string = 'Hello TypeScript';
    expect(message).toBe('Hello TypeScript');
  });
});
