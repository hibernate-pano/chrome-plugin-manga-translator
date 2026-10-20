/**
 * API Key 安全混淆工具
 *
 * 供 Chrome 插件在持久化存储时对密钥进行混淆与还原，防止明文直接暴露在 LocalStorage 或 Chrome Sync 中。
 *
 * ## 这不是加密
 *
 * 这里做的是**混淆**（obfuscation），不是加密：算法是固定盐值的 XOR，盐值随扩展一起分发。
 * 任何能读到扩展代码的人都能把 `obf:` 值还原成明文。真正的保护来自"扩展代码不可被网页读取"
 * 这一前提 —— `scripts/check-release-consistency.mjs` 会在构建时检查：一旦混淆代码出现在
 * 任何 web-accessible 资源里，构建直接失败。
 *
 * 改成"安装期生成随机盐并存进 chrome.storage.local"**并不能**带来实际收益：
 *   - 网页本来就读不到扩展的 storage，也读不到非 web-accessible 的扩展代码；
 *   - 能读到本机 storage 的人同时也能读到盐，盐放在同一处毫无区别；
 *   - 而改造要求把同步 API 改成异步，会波及 `src/background/background.ts` 等文件，
 *     并引入"盐读取失败 → key 用错误的盐混淆 → 用户的 key 永久无法还原"的风险。
 *
 * 详见 `docs/privacy-policy.md` 与 `docs/store-review-notes-zh.md` 中的如实表述。
 */

const SALT = 'manga-translator-salt';

/**
 * 混淆前缀。
 *
 * 存储里带这个前缀的值走还原流程，不带的原样返回 —— 这样手工写入的明文 key
 * 也能正常工作。
 */
const OBFUSCATED_PREFIX = 'obf:';

const SALT_BYTES = new TextEncoder().encode(SALT);

/**
 * 严格解码器：遇到非法 UTF-8 字节序列就抛错。
 *
 * 这样被损坏的 `obf:` 值会走"还原失败 → 原样返回"的路径，而不是被静默地
 * 解成一串替换字符（U+FFFD）——后者会变成一个看起来正常、实则完全错误的 key。
 */
const DECODER = new TextDecoder('utf-8', { fatal: true });

const HEX_PATTERN = /^[0-9a-fA-F]*$/;

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

function fromHex(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !HEX_PATTERN.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < hex.length; index += 2) {
    const byte = Number.parseInt(hex.slice(index, index + 2), 16);
    if (Number.isNaN(byte)) {
      return null;
    }
    bytes[index / 2] = byte;
  }
  return bytes;
}

/**
 * 与盐值逐字节异或。
 *
 * XOR 是自逆运算：同样的函数再跑一次就还原了，所以混淆与还原共用这一段。
 */
function xorBytes(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index] ?? 0;
    const saltByte = SALT_BYTES[index % SALT_BYTES.length] ?? 0;
    result[index] = byte ^ saltByte;
  }
  return result;
}

/**
 * 混淆 API Key
 * 使用简单的 XOR 与 Base64 编码，增加恶意扩展扫描窃取的难度
 */
export function obfuscateApiKey(key: string): string {
  if (!key) return '';
  if (key.startsWith(OBFUSCATED_PREFIX)) return key;

  try {
    // TextEncoder 输出 UTF-8 字节，与旧实现（escape/unescape 方案）对所有
    // 合法字符串完全一致，因此升级后用户已存的 key 依然能还原。
    const bytes = new TextEncoder().encode(key);
    // 编码会替换掉落单的代理项（U+D800 之类）。那种字符串还原回来就变了，
    // 用户的 key 会凭空损坏 —— 与其存一个坏值，不如退回明文，至少还能用。
    if (DECODER.decode(bytes) !== key) {
      console.error('[Crypto] API Key 含有非法字符序列，返回原值');
      return key;
    }
    return `${OBFUSCATED_PREFIX}${toHex(xorBytes(bytes))}`;
  } catch (error) {
    // 走到这里说明连编码都失败了。返回原值可以让用户的 key 继续可用，
    // 代价是它在存储里是明文 —— 所以必须留下错误日志，而不是静默吞掉。
    console.error('[Crypto] 混淆 API Key 失败，返回原值:', error);
    return key;
  }
}

/**
 * 解密/还原混淆的 API Key
 */
export function deobfuscateApiKey(obfuscatedKey: string): string {
  if (!obfuscatedKey) return '';
  if (!obfuscatedKey.startsWith(OBFUSCATED_PREFIX)) return obfuscatedKey;

  try {
    const hex = obfuscatedKey.slice(OBFUSCATED_PREFIX.length);
    const bytes = fromHex(hex);
    if (!bytes) {
      return obfuscatedKey;
    }
    return DECODER.decode(xorBytes(bytes));
  } catch (error) {
    console.error('[Crypto] 还原 API Key 失败，返回混淆值:', error);
    return obfuscatedKey;
  }
}

/**
 * 递归遍历对象，对所有敏感字段应用 processFn
 * 替代各处重复的 provider 逐一处理逻辑
 *
 * 字段名只有 `apiKey`：三个 provider（openai-compatible / ollama /
 * lm-studio）都用这一个字段名存密钥，本地 provider 只是把它留空而已。
 * 以前这里有一个可变的全局 Set 和一个 `registerSensitiveKey` 注册口，
 * 说是"以后加新 provider 时自动纳入"——但除了测试没有任何地方注册过
 * 东西，所以那个扩展点只会在没人注意的时候悄悄少混淆一个字段。
 * 多一个字段就往这个数组里加一行，看得见、改得动。
 */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set<string>(['apiKey']);

export function processAllApiKeys(
  obj: Record<string, unknown>,
  processFn: (key: string) => string
): void {
  if (!obj || typeof obj !== 'object') return;

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (SENSITIVE_KEYS.has(key) && typeof value === 'string') {
      obj[key] = processFn(value);
    } else if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    ) {
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
