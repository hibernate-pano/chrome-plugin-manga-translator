/**
 * API Key 安全混淆工具
 *
 * 供 Chrome 插件在持久化存储时对密钥进行混淆与还原，防止明文直接暴露在 LocalStorage 或 Chrome Sync 中。
 */

const SALT = 'manga-translator-salt';

/**
 * 混淆 API Key
 * 使用简单的 XOR 与 Base64 编码，增加恶意扩展扫描窃取的难度
 */
export function obfuscateApiKey(key: string): string {
  if (!key) return '';
  if (key.startsWith('obf:')) return key;

  try {
    const latin1Key = unescape(encodeURIComponent(key));

    let hex = '';
    for (let i = 0; i < latin1Key.length; i++) {
      const charCode = latin1Key.charCodeAt(i) ^ SALT.charCodeAt(i % SALT.length);
      hex += charCode.toString(16).padStart(2, '0');
    }

    return `obf:${hex}`;
  } catch (e) {
    console.error('[Crypto] 混淆 API Key 失败，返回原值:', e);
    return key;
  }
}

/**
 * 解密/还原混淆的 API Key
 */
export function deobfuscateApiKey(obfuscatedKey: string): string {
  if (!obfuscatedKey) return '';
  if (!obfuscatedKey.startsWith('obf:')) return obfuscatedKey;

  try {
    const hex = obfuscatedKey.substring(4);
    let latin1Key = '';
    for (let i = 0; i < hex.length; i += 2) {
      const charHex = hex.substring(i, i + 2);
      const charCode = parseInt(charHex, 16) ^ SALT.charCodeAt((i / 2) % SALT.length);
      latin1Key += String.fromCharCode(charCode);
    }

    return decodeURIComponent(escape(latin1Key));
  } catch (e) {
    console.error('[Crypto] 还原 API Key 失败，返回混淆值:', e);
    return obfuscatedKey;
  }
}

/**
 * 递归遍历对象，对所有敏感字段应用 processFn
 * 替代各处重复的 provider 逐一处理逻辑
 *
 * 字段名集合为闭包外的可变 Set，通过 {@link registerSensitiveKey} 注入，
 * 这样未来加新 provider（lm-studio 等）或新字段（accessToken / token 等）
 * 也能自动纳入混淆范围，不必修改本文件。
 */
const SENSITIVE_KEYS = new Set<string>(['apiKey']);

export function registerSensitiveKey(key: string): void {
  SENSITIVE_KEYS.add(key);
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key);
}

export function processAllApiKeys(
  obj: Record<string, unknown>,
  processFn: (key: string) => string
): void {
  if (!obj || typeof obj !== 'object') return;

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (SENSITIVE_KEYS.has(key) && typeof value === 'string') {
      obj[key] = processFn(value);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      processAllApiKeys(value as Record<string, unknown>, processFn);
    }
  }
}

/**
 * 批量混淆配置中的所有 apiKey
 */
export function obfuscateAllApiKeys(config: Record<string, unknown>): void {
  processAllApiKeys(config, obfuscateApiKey);
}

/**
 * 批量解密配置中的所有 apiKey
 */
export function deobfuscateAllApiKeys(config: Record<string, unknown>): void {
  processAllApiKeys(config, deobfuscateApiKey);
}


