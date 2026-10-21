/**
 * 剩余时间的中文写法。
 *
 * HUD 和弹窗都要显示"大概还要多久"，所以格式化只写一份——两个地方各写
 * 一遍，早晚会长得不一样。
 */

/**
 * 把秒数写成一句人话：45 秒 / 2 分 / 1 分 30 秒。
 *
 * 不足一分钟只报秒，超过一分钟才带上余下的秒，好让用户看出进度还在动。
 * 返回空串表示"这个数不值得显示"（负数、非有限值）。
 */
export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${minutes} 分` : `${minutes} 分 ${rest} 秒`;
}
