/**
 * 统一错误处理机制
 * 
 * 漫画翻译助手 v2 错误处理模块
 * 提供错误解析、友好消息转换和指数退避重试逻辑
 * 
 * Requirements: 8.1, 8.2, 8.3, 4.4
 */

// ============================================================================
// 错误码定义（符合设计文档）
// ============================================================================

/**
 * 错误码枚举
 * 对应设计文档中的错误类型
 */
export enum TranslationErrorCode {
  // 配置错误
  CONFIG_MISSING = 'CONFIG_MISSING',       // API 密钥未配置
  AUTH_ERROR = 'AUTH_ERROR',               // API 密钥无效
  
  // 网络错误
  NETWORK_ERROR = 'NETWORK_ERROR',         // 网络连接失败
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',         // 请求超时
  RATE_LIMIT = 'RATE_LIMIT',               // 请求过于频繁
  
  // Ollama 错误
  OLLAMA_NOT_RUNNING = 'OLLAMA_NOT_RUNNING', // Ollama 服务未启动
  MODEL_NOT_FOUND = 'MODEL_NOT_FOUND',       // 模型不存在
  
  // 解析错误
  PARSE_ERROR = 'PARSE_ERROR',             // 翻译结果解析失败
  
  // 其他错误
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',         // 未知错误
}

/**
 * 友好错误接口（符合设计文档）
 */
export interface FriendlyError {
  code: TranslationErrorCode;
  message: string;      // 用户友好的中文消息
  retryable: boolean;
  suggestion?: string;  // 解决建议
}

/**
 * 错误消息映射表
 * 对应设计文档中的错误类型与用户提示
 */
const ERROR_MESSAGES: Record<TranslationErrorCode, { message: string; suggestion: string; retryable: boolean }> = {
  [TranslationErrorCode.CONFIG_MISSING]: {
    message: '请先配置 API 密钥',
    suggestion: '请在设置页面配置您的 API 密钥',
    retryable: false,
  },
  [TranslationErrorCode.AUTH_ERROR]: {
    message: 'API 密钥无效，请检查配置',
    suggestion: '请确认您的 API 密钥是否正确',
    retryable: false,
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
    suggestion: '请确保 Ollama 已安装并运行：ollama serve',
    retryable: false,
  },
  [TranslationErrorCode.MODEL_NOT_FOUND]: {
    message: '模型未安装，请先下载模型',
    suggestion: '请运行 ollama pull <model_name> 下载模型',
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

    const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    const statusCode = TranslationErrorHandler.extractStatusCode(error);

    // 根据状态码判断
    if (statusCode) {
      const codeFromStatus = TranslationErrorHandler.getCodeFromStatusCode(statusCode);
      if (codeFromStatus) {
        return TranslationErrorHandler.createFriendlyError(codeFromStatus);
      }
    }

    // 根据错误消息关键词判断
    const code = TranslationErrorHandler.getCodeFromMessage(errorMessage);
    return TranslationErrorHandler.createFriendlyError(code);
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
      Object.values(TranslationErrorCode).includes((error as FriendlyError).code)
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
  private static getCodeFromStatusCode(statusCode: number): TranslationErrorCode | null {
    switch (statusCode) {
      case 401:
        return TranslationErrorCode.AUTH_ERROR;
      case 403:
        return TranslationErrorCode.AUTH_ERROR;
      case 404:
        return TranslationErrorCode.MODEL_NOT_FOUND;
      case 429:
        return TranslationErrorCode.RATE_LIMIT;
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
    if (message.includes('api key') || message.includes('apikey') || message.includes('密钥')) {
      if (message.includes('missing') || message.includes('未配置') || message.includes('not configured')) {
        return TranslationErrorCode.CONFIG_MISSING;
      }
      return TranslationErrorCode.AUTH_ERROR;
    }

    // 认证错误
    if (message.includes('unauthorized') || message.includes('invalid') && message.includes('key')) {
      return TranslationErrorCode.AUTH_ERROR;
    }

    // 网络错误
    if (message.includes('network') || message.includes('fetch') || message.includes('failed to fetch')) {
      return TranslationErrorCode.NETWORK_ERROR;
    }

    // 连接错误（可能是 Ollama）
    if (message.includes('connection') || message.includes('econnrefused') || message.includes('连接')) {
      if (message.includes('ollama') || message.includes('11434') || message.includes('localhost')) {
        return TranslationErrorCode.OLLAMA_NOT_RUNNING;
      }
      return TranslationErrorCode.NETWORK_ERROR;
    }

    // 超时错误
    if (message.includes('timeout') || message.includes('超时') || message.includes('timed out')) {
      return TranslationErrorCode.TIMEOUT_ERROR;
    }

    // 限流错误
    if (message.includes('rate limit') || message.includes('too many') || message.includes('频繁')) {
      return TranslationErrorCode.RATE_LIMIT;
    }

    // Ollama 相关
    if (message.includes('ollama')) {
      if (message.includes('not running') || message.includes('未启动') || message.includes('connection refused')) {
        return TranslationErrorCode.OLLAMA_NOT_RUNNING;
      }
    }

    // 模型不存在
    if (message.includes('model') && (message.includes('not found') || message.includes('不存在') || message.includes('does not exist'))) {
      return TranslationErrorCode.MODEL_NOT_FOUND;
    }

    // 解析错误
    if (message.includes('parse') || message.includes('json') || message.includes('解析')) {
      return TranslationErrorCode.PARSE_ERROR;
    }

    // 配置缺失
    if (message.includes('未配置') || message.includes('not configured') || message.includes('missing config')) {
      return TranslationErrorCode.CONFIG_MISSING;
    }

    return TranslationErrorCode.UNKNOWN_ERROR;
  }

  /**
   * 创建 FriendlyError 对象
   */
  private static createFriendlyError(code: TranslationErrorCode): FriendlyError {
    const errorInfo = ERROR_MESSAGES[code];
    return {
      code,
      message: errorInfo.message,
      retryable: errorInfo.retryable,
      suggestion: errorInfo.suggestion,
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
 * 判断错误是否可重试
 */
export function isTranslationErrorRetryable(error: unknown): boolean {
  return TranslationErrorHandler.isRetryable(error);
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

/**
 * 创建特定类型的 FriendlyError
 */
export function createFriendlyError(code: TranslationErrorCode): FriendlyError {
  const errorInfo = ERROR_MESSAGES[code];
  return {
    code,
    message: errorInfo.message,
    retryable: errorInfo.retryable,
    suggestion: errorInfo.suggestion,
  };
}

/**
 * 获取用户友好的错误消息
 */
export function getFriendlyErrorMessage(error: unknown): string {
  const friendlyError = TranslationErrorHandler.parseError(error);
  return friendlyError.message;
}

/**
 * 获取完整的错误提示（包含建议）
 */
export function getFullFriendlyErrorMessage(error: unknown): string {
  const friendlyError = TranslationErrorHandler.parseError(error);
  return friendlyError.suggestion 
    ? `${friendlyError.message}。${friendlyError.suggestion}`
    : friendlyError.message;
} 