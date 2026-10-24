import { describe, expect, it } from 'vitest';

import {
  SKIPPED_IMAGES_REASON,
  describeFee,
  describeForceRetranslate,
  describePendingImages,
  describeRequestCount,
  describeRetryFailedCost,
  describeRetryFee,
} from './cost-wording';

describe('the wording about money', () => {
  it('names every way one image turns into more than one request', () => {
    // A long strip is cut into tiles; a page the model cannot read is asked
    // again through the OCR fallback, in batches; a request that times out
    // is retried, and the retry is a request too.
    expect(describeRequestCount('openai-compatible')).toContain(
      '长条图会拆成多片分别请求'
    );
    expect(describeRequestCount('openai-compatible')).toContain('OCR');
    expect(describeRequestCount('openai-compatible')).toContain('自动重试一次');
    expect(describeRequestCount('openai-compatible')).toContain(
      '实际请求次数可能高于图片数'
    );
  });

  it('does not promise the OCR fallback to a local model', () => {
    // The OCR fallback is skipped for Ollama: the note cannot claim
    // something the pipeline does not do.
    expect(describeRequestCount('ollama')).not.toContain('OCR');
    expect(describeRequestCount('ollama')).toContain(
      '长条图会拆成多片分别请求'
    );
  });

  it('says a local provider is free, and a cloud one is not', () => {
    expect(describeFee('ollama')).toContain('不产生服务商费用');
    expect(describeFee('lm-studio')).toContain('不产生服务商费用');
    expect(describeFee('openai-compatible')).toBe('会产生费用');
    // An unknown provider is treated as a cloud one: promising a new
    // provider is free before anyone knows what it charges is the wrong
    // direction to be wrong in.
    expect(describeFee(undefined)).toBe('会产生费用');
  });

  it('says what a retry costs and what it does not cost', () => {
    const cost = describeRetryFailedCost('openai-compatible');
    expect(cost).toContain('会再次调用 Vision LLM 产生费用');
    expect(cost).toContain('已经翻译成功的图片不会重来');
    expect(cost).toContain(describeRequestCount('openai-compatible'));

    const local = describeRetryFailedCost('ollama');
    expect(local).toContain('不产生服务商费用');
    expect(local).not.toContain('产生费用');
  });

  it('has a short form for a button', () => {
    expect(describeRetryFee('openai-compatible')).toBe('会再次计费');
    expect(describeRetryFee('ollama')).toBe('会再次调用本机模型');
  });

  it('prices the images that have not loaded yet', () => {
    // 弹窗和页内确认框都写着「本页 N 张」，而懒加载的漫画页还压着 36 张
    // 没有字节的图。自动续翻开着的时候，它们一加载就会被送去模型并计费：
    // 一个只报 4 张的报价，比没有报价更糟，因为它看起来是个总数。
    const cost = describeForceRetranslate(4, 'openai-compatible', 36, true);
    expect(cost).toContain('本页 4 张图片');
    expect(cost).toContain('另有 36 张还在加载');
    expect(cost).toContain('加载后会自动翻译');
    expect(cost).not.toContain('本页全部');
  });

  it('does not promise auto-translation when it is switched off', () => {
    const cost = describeForceRetranslate(4, 'openai-compatible', 36, false);
    expect(cost).toContain('另有 36 张还在加载');
    expect(cost).toContain('自动续翻是关着的');
    expect(cost).not.toContain('加载后会自动翻译');
  });

  it('does not call a page with only pending images empty', () => {
    // 加载好的图一张都没有，但还有 36 张在路上。这时说「本页没有可翻译的
    // 图片」是错的：打开自动续翻的人，钱马上就要花了。
    const cost = describeForceRetranslate(0, 'openai-compatible', 36, true);
    expect(cost).toContain('36');
    expect(cost).toContain('会产生费用');
    expect(cost).not.toContain('没有可翻译的图片');

    const idle = describeForceRetranslate(0, 'openai-compatible', 36, false);
    expect(idle).toContain('自动续翻是关着的');
  });

  it('says a page with nothing on it costs nothing', () => {
    expect(describeForceRetranslate(0, 'openai-compatible', 0)).toContain(
      '不会产生费用'
    );
  });

  it('does not charge a local provider for the images still loading', () => {
    const cost = describeForceRetranslate(2, 'ollama', 30, true);
    expect(cost).toContain('不产生服务商费用');
    expect(cost).not.toContain('会产生费用');
    // 费用已经在上一句里说过一次了，pending 这句不再重复。
    expect(describePendingImages(30, true)).toBe(
      '另有 30 张还在加载，加载后会自动翻译。'
    );
    expect(describePendingImages(0, true)).toBe('');
  });

  it('does not answer "will they be translated" before the page says', () => {
    // null 是"还没问过"，不是 false。假false 会替用户断言一件我们不知道
    // 的事 —— 而它恰好是"要不要花钱"。
    const unknown = describePendingImages(12, null);
    expect(unknown).toContain('12');
    expect(unknown).toContain('取决于自动续翻设置');
    expect(unknown).not.toContain('会自动翻译');
  });

  it('does not mistake an uncountable page for an empty one', () => {
    // 数不出来（null）和数出来是 0 是两件事。以前两者都会写成
    // 「现在还没有加载好的图片」—— 前者是在说一件我们并不知道的事。
    const unknown = describeForceRetranslate(null, 'openai-compatible', 5);
    expect(unknown).toContain('还没数出来');
    expect(unknown).not.toContain('还没有加载好的图片');

    const empty = describeForceRetranslate(0, 'openai-compatible', 5);
    expect(empty).toContain('现在还没有加载好的图片');
  });

  it('says why an image was skipped', () => {
    expect(SKIPPED_IMAGES_REASON.length).toBeGreaterThan(0);
  });
});
