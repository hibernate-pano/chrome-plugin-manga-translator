/**
 * 统一错误处理机制
 *
 * 漫画翻译助手 v2 错误处理模块
 * 提供错误解析、友好消息转换和指数退避重试逻辑
 *
 * Requirements: 8.1, 8.2, 8.3, 4.4
 */

// ============================================================================
// HTTP 状态码载体
// ============================================================================

/**
 * An Error that carries the HTTP status code of the response that failed.
 *
 * The status is what turns a generic "翻译失败" into "API 密钥无效" (401),
 * "请求过于频繁" (429) or "图片被内容审核拦截" (422), so it has to survive
 * every hop: provider → background worker → content script.
 */
export interface HttpStatusError extends Error {
  /** HTTP status code, when the failure came from an HTTP response. */
  status?: number;
}

/**
 * Machine-readable prefix that carries an HTTP status inside a plain-text
 * error message.
 *
 * The background worker flattens every error to its message before handing
 * it back to the content script, so the `status` property cannot survive on
 * its own — the status also has to travel inside the message.
 *
 * The marker is not anchored: a message may pick up a prefix on the way
 * (a provider name, a job id), and the status still has to be found.
 */
const HTTP_STATUS_MARKER = /\[HTTP (\d{3})\]/;

/**
 * Prefix an error message with its HTTP status.
 */
export function formatHttpStatusMessage(
  status: number,
  message: string
): string {
  return `[HTTP ${status}] ${message}`;
}

/**
 * Read the HTTP status back out of a message produced by
 * {@link formatHttpStatusMessage}.
 */
export function parseHttpStatusFromMessage(
  message: string
): number | undefined {
  const match = HTTP_STATUS_MARKER.exec(message);
  const raw = match?.[1];
  if (!raw) {
    return undefined;
  }
  const status = Number.parseInt(raw, 10);
  return Number.isFinite(status) ? status : undefined;
}

/**
 * Remove the status marker so the raw provider message can be shown to the
 * user without the internal prefix.
 */
export function stripHttpStatusMarker(message: string): string {
  return message.replace(HTTP_STATUS_MARKER, '').trim();
}

/**
 * Does this raw message look like a sentence written for the reader?
 *
 * Our own errors are written in Chinese, for the person using the
 * extension. What comes back from a provider is a protocol payload: an
 * HTTP status line, a JSON body, an English stack. Pasting that into the
 * popup made the extension look like it was showing a log instead of an
 * explanation, so those go to the console and the reader gets the plain
 * message.
 */
function isReaderFacingMessage(message: string): boolean {
  if (message.length > 120) {
    return false;
  }
  return /[一-鿿]/.test(message);
}

// ============================================================================
// 错误码定义（符合设计文档）
// ============================================================================

/**
 * 错误码枚举
 * 对应设计文档中的错误类型
 */
export enum TranslationErrorCode {
  // 配置错误
  CONFIG_MISSING = 'CONFIG_MISSING', // API 密钥未配置
  AUTH_ERROR = 'AUTH_ERROR', // API 密钥无效
  INVALID_API_KEY_FORMAT = 'INVALID_API_KEY_FORMAT', // API 密钥格式无效

  // 网络错误
  NETWORK_ERROR = 'NETWORK_ERROR', // 网络连接失败
  TIMEOUT_ERROR = 'TIMEOUT_ERROR', // 请求超时
  RATE_LIMIT = 'RATE_LIMIT', // 请求过于频繁
  CONNECTION_REFUSED = 'CONNECTION_REFUSED', // 连接被拒绝

  // Ollama 错误
  OLLAMA_NOT_RUNNING = 'OLLAMA_NOT_RUNNING', // Ollama 服务未启动
  OLLAMA_ORIGIN_NOT_ALLOWED = 'OLLAMA_ORIGIN_NOT_ALLOWED', // Ollama 未放行扩展来源
  MODEL_NOT_FOUND = 'MODEL_NOT_FOUND', // 模型不存在

  // 参数错误
  PARAM_ERROR = 'PARAM_ERROR', // 请求参数超出限制

  // 模型不兼容
  MODEL_INCOMPATIBLE = 'MODEL_INCOMPATIBLE', // 模型不支持结构化输出

  // 解析错误
  PARSE_ERROR = 'PARSE_ERROR', // 翻译结果解析失败

  // 内容审核拦截（服务端拒绝了图片，通常是 NSFW/敏感内容）。
  // 重试无意义；用户必须换 Provider/模型或换图源。
  CONTENT_BLOCKED = 'CONTENT_BLOCKED', // 图片被内容审核拦截

  // 其他错误
  UNKNOWN_ERROR = 'UNKNOWN_ERROR', // 未知错误
}

/**
 * 错误对应的"修复入口"动作类型。
 * - open-settings：跳到扩展设置页（chrome.runtime.openOptionsPage）
 * - copy-command：复制 suggestion 里的命令到剪贴板
 */
export interface ErrorAction {
  type: 'open-settings' | 'copy-command';
  label: string;
  /**
   * For `copy-command` actions, this is the exact string that will be written
   * to the clipboard when the user clicks the action button. The `suggestion`
   * field stays human-readable; `command` is the runnable shell snippet.
   *
   * Examples:
   *   OLLAMA_NOT_RUNNING     -> "ollama serve"
   *   OLLAMA_ORIGIN_NOT_ALLOWED -> "OLLAMA_ORIGINS=chrome-extension://* ollama serve"
   *   MODEL_NOT_FOUND        -> "ollama pull <model>" (filled in at render time)
   */
  command?: string;
}

/**
 * 友好错误接口（符合设计文档）
 */
export interface FriendlyError {
  code: TranslationErrorCode;
  message: string; // 用户友好的中文消息
  retryable: boolean;
  suggestion?: string; // 解决建议
  action?: ErrorAction; // 可执行的修复入口
}

/**
 * 错误消息映射表
 * 对应设计文档中的错误类型与用户提示
 */
const ERROR_MESSAGES: Record<
  TranslationErrorCode,
  {
    message: string;
    suggestion: string;
    retryable: boolean;
    action?: ErrorAction;
  }
> = {
  [TranslationErrorCode.CONFIG_MISSING]: {
    message: '请先配置 API 密钥',
    suggestion: '请在设置页面配置您的 API 密钥',
    retryable: false,
    action: { type: 'open-settings', label: '打开设置' },
  },
  [TranslationErrorCode.AUTH_ERROR]: {
    message: 'API 密钥无效，请检查配置',
    suggestion: '请确认您的 API 密钥是否正确',
    retryable: false,
    action: { type: 'open-settings', label: '打开设置' },
  },
  [TranslationErrorCode.INVALID_API_KEY_FORMAT]: {
    message: 'API 密钥格式不正确',
    suggestion: '请检查 API 密钥格式是否正确，例如 OpenAI 密钥应以 sk- 开头',
    retryable: false,
    action: { type: 'open-settings', label: '打开设置' },
  },
  [TranslationErrorCode.CONNECTION_REFUSED]: {
    message: '无法连接到服务器',
    suggestion: '请检查服务器是否运行，或地址/端口是否正确',
    retryable: true,
    action: {
      type: 'copy-command',
      label: '复制排查命令',
      command: '# 检查服务是否在监听\ncurl -v http://localhost:11434/api/tags',
    },
  },
  [TranslationErrorCode.NETWORK_ERROR]: {
    message: '网络连接失败，请检查网络',
    suggestion: '请检查您的网络连接是否正常',
    retryable: true,
  },
  [TranslationErrorCode.TIMEOUT_ERROR]: {
    message: '请求超时，请稍后重试',
    suggestion: '网络可能较慢，请稍后再试',
    retryable: true,
  },
  [TranslationErrorCode.RATE_LIMIT]: {
    message: '请求过于频繁，请稍后重试',
    suggestion: '请等待一段时间后再继续使用',
    retryable: true,
  },
  [TranslationErrorCode.OLLAMA_NOT_RUNNING]: {
    message: '请先启动 Ollama 服务',
    suggestion: '在终端运行 ollama serve 启动本地 Ollama，然后刷新本页',
    retryable: false,
    action: {
      type: 'copy-command',
      label: '复制命令',
      command: 'ollama serve',
    },
  },
  [TranslationErrorCode.OLLAMA_ORIGIN_NOT_ALLOWED]: {
    message: 'Ollama 未允许当前浏览器扩展访问',
    suggestion:
      '用下方命令启动 Ollama，并临时放行所有浏览器扩展来源。macOS 需先在 shell 中执行一次 launchctl setenv OLLAMA_ORIGINS "chrome-extension://*" 后再启动 Ollama。',
    retryable: false,
    action: {
      type: 'copy-command',
      label: '复制启动命令',
      command: 'OLLAMA_ORIGINS=chrome-extension://* ollama serve',
    },
  },
  [TranslationErrorCode.MODEL_NOT_FOUND]: {
    message: '当前模型未安装',
    suggestion:
      '运行下方命令拉取你当前配置的模型（命令由当前 provider 配置动态生成）。',
    retryable: false,
    action: {
      type: 'copy-command',
      label: '复制 ollama pull 命令',
      // command 由 content.ts 在渲染错误时根据当前 provider.model 注入
      command: 'ollama pull <model>',
    },
  },
  [TranslationErrorCode.PARAM_ERROR]: {
    message: '请求参数超出模型限制',
    suggestion: '请在设置中调整模型参数，或更换支持更大上下文的模型',
    retryable: false,
    action: { type: 'open-settings', label: '打开设置' },
  },
  [TranslationErrorCode.MODEL_INCOMPATIBLE]: {
    message: '当前模型不支持翻译任务',
    suggestion:
      '请更换为支持指令跟随的视觉语言模型，如 Qwen2.5-VL-32B-Instruct',
    retryable: false,
    action: { type: 'open-settings', label: '打开设置' },
  },
  [TranslationErrorCode.CONTENT_BLOCKED]: {
    message: '图片被内容审核拦截',
    suggestion:
      '这张图被服务方的内容审核拦下了，重试没有用。可以换一个不带审核的服务，或改用本地 Ollama 试试。',
    retryable: false,
  },
  [TranslationErrorCode.PARSE_ERROR]: {
    message: '翻译结果解析失败',
    suggestion: '请稍后重试，或尝试其他 Provider',
    retryable: true,
  },
  [TranslationErrorCode.UNKNOWN_ERROR]: {
    message: '发生未知错误',
    suggestion: '请稍后重试，如问题持续请联系支持',
    retryable: false,
  },
};

// ============================================================================
// 漫画翻译助手 v2 错误处理 API（符合设计文档）
// ============================================================================

/**
 * 翻译错误处理器
 * 符合设计文档中的 ErrorHandler 接口
 */
export class TranslationErrorHandler {
  /**
   * 解析错误并返回友好消息
   *
   * @param error - 原始错误对象
   * @returns FriendlyError - 用户友好的错误信息
   */
  static parseError(error: unknown): FriendlyError {
    // 如果已经是 FriendlyError，直接返回
    if (TranslationErrorHandler.isFriendlyError(error)) {
      return error;
    }

    const rawErrorMessage =
      error instanceof Error ? error.message : String(error);
    // The `[HTTP 401]` marker is internal plumbing — it must never reach the
    // user, but it does have to be read before the keyword heuristics run,
    // because it carries the authoritative status code.
    const messageWithoutMarker = stripHttpStatusMarker(rawErrorMessage);
    const errorMessage = messageWithoutMarker.toLowerCase();
    const statusCode =
      TranslationErrorHandler.extractStatusCode(error) ??
      parseHttpStatusFromMessage(rawErrorMessage);

    // 根据状态码判断
    if (statusCode) {
      const codeFromStatus =
        TranslationErrorHandler.getCodeFromStatusCode(statusCode);
      if (codeFromStatus) {
        return TranslationErrorHandler.createFriendlyError(codeFromStatus);
      }
    }

    // 根据错误消息关键词判断
    const code = TranslationErrorHandler.getCodeFromMessage(errorMessage);
    const friendlyError = TranslationErrorHandler.createFriendlyError(code);

    if (
      code === TranslationErrorCode.UNKNOWN_ERROR &&
      messageWithoutMarker.trim() &&
      messageWithoutMarker !== friendlyError.message
    ) {
      const detail = messageWithoutMarker.trim();
      if (isReaderFacingMessage(detail)) {
        return {
          ...friendlyError,
          message: `${friendlyError.message}：${detail}`,
        };
      }
      // A protocol payload is for the console, not for the reader.
      console.error('[Translation] 未分类错误原文:', detail);
    }

    return friendlyError;
  }

  /**
   * 判断是否为 FriendlyError
   */
  private static isFriendlyError(error: unknown): error is FriendlyError {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      'message' in error &&
      'retryable' in error &&
      Object.values(TranslationErrorCode).includes(
        (error as FriendlyError).code
      )
    );
  }

  /**
   * 从错误对象中提取状态码
   */
  private static extractStatusCode(error: unknown): number | undefined {
    if (typeof error === 'object' && error !== null) {
      const e = error as Record<string, unknown>;
      if (typeof e['status'] === 'number') return e['status'];
      if (typeof e['statusCode'] === 'number') return e['statusCode'];
      if (typeof e['response'] === 'object' && e['response'] !== null) {
        const response = e['response'] as Record<string, unknown>;
        if (typeof response['status'] === 'number') return response['status'];
      }
    }
    return undefined;
  }

  /**
   * 根据 HTTP 状态码获取错误码
   */
  private static getCodeFromStatusCode(
    statusCode: number
  ): TranslationErrorCode | null {
    switch (statusCode) {
      case 401:
        return TranslationErrorCode.AUTH_ERROR;
      case 403:
        return TranslationErrorCode.AUTH_ERROR;
      case 404:
        return TranslationErrorCode.MODEL_NOT_FOUND;
      case 429:
        return TranslationErrorCode.RATE_LIMIT;
      case 422:
        // MiniMax 等 Provider 用 422 unprocessable_entity 表示图片敏感。
        return TranslationErrorCode.CONTENT_BLOCKED;
      case 408:
        return TranslationErrorCode.TIMEOUT_ERROR;
      case 500:
      case 502:
      case 503:
      case 504:
        return TranslationErrorCode.NETWORK_ERROR;
      default:
        return null;
    }
  }

  /**
   * 根据错误消息关键词获取错误码
   */
  private static getCodeFromMessage(message: string): TranslationErrorCode {
    // API 密钥相关
    if (
      message.includes('api key') ||
      message.includes('apikey') ||
      message.includes('密钥')
    ) {
      if (
        message.includes('missing') ||
        message.includes('未配置') ||
        message.includes('not configured')
      ) {
        return TranslationErrorCode.CONFIG_MISSING;
      }
      return TranslationErrorCode.AUTH_ERROR;
    }

    // API 密钥格式验证（OpenAI 风格密钥）
    if (
      message.includes('format') ||
      (message.includes('sk-') && message.includes('invalid')) ||
      message.includes('格式')
    ) {
      if (
        message.includes('key') ||
        message.includes('api') ||
        message.includes('密钥')
      ) {
        return TranslationErrorCode.INVALID_API_KEY_FORMAT;
      }
    }

    // 连接拒绝错误
    if (
      message.includes('econnrefused') ||
      message.includes('connection refused') ||
      message.includes('连接被拒绝')
    ) {
      return TranslationErrorCode.CONNECTION_REFUSED;
    }

    // 认证错误
    if (
      message.includes('unauthorized') ||
      (message.includes('invalid') && message.includes('key'))
    ) {
      return TranslationErrorCode.AUTH_ERROR;
    }

    // 网络错误
    if (
      message.includes('network') ||
      message.includes('fetch') ||
      message.includes('failed to fetch')
    ) {
      return TranslationErrorCode.NETWORK_ERROR;
    }

    // 连接错误（可能是 Ollama）
    if (
      message.includes('connection') ||
      message.includes('econnrefused') ||
      message.includes('连接')
    ) {
      if (
        message.includes('ollama') ||
        message.includes('11434') ||
        message.includes('localhost')
      ) {
        return TranslationErrorCode.OLLAMA_NOT_RUNNING;
      }
      return TranslationErrorCode.NETWORK_ERROR;
    }

    if (
      (message.includes('chrome-extension://') ||
        message.includes('ollama_origins') ||
        message.includes('access-control-allow-origin')) &&
      message.includes('ollama')
    ) {
      return TranslationErrorCode.OLLAMA_ORIGIN_NOT_ALLOWED;
    }

    if (
      message.includes('origin not allowed') ||
      (message.includes('forbidden') && message.includes('ollama'))
    ) {
      return TranslationErrorCode.OLLAMA_ORIGIN_NOT_ALLOWED;
    }

    // 超时错误
    if (
      message.includes('timeout') ||
      message.includes('超时') ||
      message.includes('timed out') ||
      message.includes('未在预期时间内出现')
    ) {
      return TranslationErrorCode.TIMEOUT_ERROR;
    }

    // 限流错误
    if (
      message.includes('rate limit') ||
      message.includes('too many') ||
      message.includes('频繁')
    ) {
      return TranslationErrorCode.RATE_LIMIT;
    }

    // Ollama 相关
    if (message.includes('ollama')) {
      if (
        message.includes('not running') ||
        message.includes('未启动') ||
        message.includes('connection refused')
      ) {
        return TranslationErrorCode.OLLAMA_NOT_RUNNING;
      }
    }

    // 模型不存在
    if (
      message.includes('model') &&
      (message.includes('not found') ||
        message.includes('不存在') ||
        message.includes('does not exist'))
    ) {
      return TranslationErrorCode.MODEL_NOT_FOUND;
    }

    // 参数超出限制 (e.g. "max_tokens exceeded max_seq_len limit")
    if (
      message.includes('exceeded') ||
      (message.includes('max_tokens') && message.includes('limit'))
    ) {
      return TranslationErrorCode.PARAM_ERROR;
    }

    // 模型不兼容（返回截断或纯文本，无法产生 JSON）
    if (
      message.includes('truncated response') ||
      message.includes('does not follow instruction') ||
      message.includes('not support structured') ||
      message.includes('当前模型不支持翻译任务') ||
      message.includes('模型不支持翻译任务')
    ) {
      return TranslationErrorCode.MODEL_INCOMPATIBLE;
    }

    // 解析错误
    if (
      message.includes('parse') ||
      message.includes('json') ||
      message.includes('解析')
    ) {
      return TranslationErrorCode.PARSE_ERROR;
    }

    // API 返回空响应
    if (
      message.includes('empty response') ||
      message.includes('empty content')
    ) {
      return TranslationErrorCode.PARSE_ERROR;
    }

    // 内容审核拦截：服务端拒绝图片（MiniMax 等常见）。
    // 触发关键词：unprocessable_entity / sensitive / 内容审核。
    if (
      message.includes('unprocessable_entity') ||
      message.includes('sensitive') ||
      message.includes('内容审核') ||
      message.includes('content blocked') ||
      message.includes('moderation')
    ) {
      return TranslationErrorCode.CONTENT_BLOCKED;
    }

    // API 错误（通用）
    if (message.includes('api error') || message.includes('unknown api')) {
      return TranslationErrorCode.NETWORK_ERROR;
    }

    // 配置缺失
    if (
      message.includes('未配置') ||
      message.includes('not configured') ||
      message.includes('missing config')
    ) {
      return TranslationErrorCode.CONFIG_MISSING;
    }

    return TranslationErrorCode.UNKNOWN_ERROR;
  }

  /**
   * 创建 FriendlyError 对象
   */
  private static createFriendlyError(
    code: TranslationErrorCode
  ): FriendlyError {
    const errorInfo = ERROR_MESSAGES[code];
    return {
      code,
      message: errorInfo.message,
      retryable: errorInfo.retryable,
      suggestion: errorInfo.suggestion,
      action: errorInfo.action,
    };
  }

  /**
   * 判断是否可重试
   *
   * @param error - FriendlyError 或原始错误
   * @returns boolean - 是否可重试
   */
  static isRetryable(error: FriendlyError | unknown): boolean {
    if (TranslationErrorHandler.isFriendlyError(error)) {
      return error.retryable;
    }
    const friendlyError = TranslationErrorHandler.parseError(error);
    return friendlyError.retryable;
  }

  /**
   * 重试逻辑（指数退避）
   *
   * @param fn - 要重试的异步函数
   * @param maxRetries - 最大重试次数（默认 3）
   * @param baseDelay - 基础延迟毫秒数（默认 1000）
   * @returns Promise<T> - 函数执行结果
   * @throws FriendlyError - 如果所有重试都失败
   */
  static async retry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        const friendlyError = TranslationErrorHandler.parseError(error);

        // 如果错误不可重试，直接抛出
        if (!friendlyError.retryable) {
          throw friendlyError;
        }

        // 如果是最后一次尝试，抛出错误
        if (attempt === maxRetries - 1) {
          throw friendlyError;
        }

        // 指数退避：delay = baseDelay * 2^attempt
        const delay = baseDelay * Math.pow(2, attempt);
        await TranslationErrorHandler.sleep(delay);
      }
    }

    // 不应该到达这里，但为了类型安全
    throw TranslationErrorHandler.parseError(lastError);
  }

  /**
   * 延迟函数
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// 便捷导出函数
// ============================================================================

/**
 * 解析错误并返回友好消息
 */
export function parseTranslationError(error: unknown): FriendlyError {
  return TranslationErrorHandler.parseError(error);
}

/**
 * 带指数退避的重试函数
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  return TranslationErrorHandler.retry(fn, maxRetries, baseDelay);
}
