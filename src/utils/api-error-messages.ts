/**
 * API 错误消息工具
 *
 * 提供用户友好的错误消息，确保错误正确传递到 Popup
 *
 * Requirements:
 * - 5.1: API 密钥无效时显示"API 密钥无效"错误
 * - 5.2: API 调用失败时显示具体的错误原因
 * - 5.3: 网络错误时显示"网络连接失败"错误
 */

// 错误类型枚举
export enum APIErrorCode {
  // 认证错误
  API_KEY_MISSING = 'API_KEY_MISSING',
  API_KEY_INVALID = 'API_KEY_INVALID',
  API_KEY_EXPIRED = 'API_KEY_EXPIRED',
  API_ACCESS_DENIED = 'API_ACCESS_DENIED',

  // 网络错误
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  CONNECTION_FAILED = 'CONNECTION_FAILED',

  // 服务器错误
  SERVER_ERROR = 'SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',

  // 请求错误
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  INVALID_REQUEST = 'INVALID_REQUEST',
  MODEL_NOT_FOUND = 'MODEL_NOT_FOUND',
  CONTENT_FILTERED = 'CONTENT_FILTERED',

  // Provider 错误
  PROVIDER_NOT_CONFIGURED = 'PROVIDER_NOT_CONFIGURED',
  PROVIDER_NOT_REGISTERED = 'PROVIDER_NOT_REGISTERED',

  // 未知错误
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

// 用户友好的错误消息映射
const USER_FRIENDLY_MESSAGES: Record<
  APIErrorCode,
  { title: string; message: string; suggestion: string }
> = {
  [APIErrorCode.API_KEY_MISSING]: {
    title: 'API 密钥未配置',
    message: '请先配置 API 密钥',
    suggestion: '请在设置页面配置您的 API 密钥',
  },
  [APIErrorCode.API_KEY_INVALID]: {
    title: 'API 密钥无效',
    message: 'API 密钥无效，请检查配置',
    suggestion: '请确认您的 API 密钥是否正确，或重新生成一个新的密钥',
  },
  [APIErrorCode.API_KEY_EXPIRED]: {
    title: 'API 密钥已过期',
    message: 'API 密钥已过期，请更新',
    suggestion: '请登录 API 提供商网站重新生成密钥',
  },
  [APIErrorCode.API_ACCESS_DENIED]: {
    title: '访问被拒绝',
    message: 'API 访问被拒绝，请检查密钥权限',
    suggestion: '请确认您的 API 密钥具有所需的权限',
  },
  [APIErrorCode.NETWORK_ERROR]: {
    title: '网络错误',
    message: '网络连接失败，请检查网络',
    suggestion: '请检查您的网络连接是否正常',
  },
  [APIErrorCode.TIMEOUT_ERROR]: {
    title: '请求超时',
    message: '请求超时，请稍后重试',
    suggestion: '网络可能较慢，请稍后再试',
  },
  [APIErrorCode.CONNECTION_FAILED]: {
    title: '连接失败',
    message: '无法连接到 API 服务器',
    suggestion: '请检查网络连接或 API 服务器地址是否正确',
  },
  [APIErrorCode.SERVER_ERROR]: {
    title: '服务器错误',
    message: 'API 服务器错误，请稍后重试',
    suggestion: 'API 服务暂时不可用，请稍后再试',
  },
  [APIErrorCode.SERVICE_UNAVAILABLE]: {
    title: '服务不可用',
    message: 'API 服务暂时不可用',
    suggestion: '服务可能正在维护，请稍后再试',
  },
  [APIErrorCode.RATE_LIMIT_EXCEEDED]: {
    title: '请求过于频繁',
    message: '请求过于频繁，请稍后重试',
    suggestion: '请等待一段时间后再继续使用',
  },
  [APIErrorCode.QUOTA_EXCEEDED]: {
    title: '配额已用尽',
    message: 'API 配额已用尽',
    suggestion: '请检查您的账户余额或升级套餐',
  },
  [APIErrorCode.INVALID_REQUEST]: {
    title: '请求错误',
    message: '请求参数错误',
    suggestion: '请检查设置是否正确',
  },
  [APIErrorCode.MODEL_NOT_FOUND]: {
    title: '模型不存在',
    message: '指定的模型不存在或不可用',
    suggestion: '请在设置中选择其他模型',
  },
  [APIErrorCode.CONTENT_FILTERED]: {
    title: '内容被过滤',
    message: '内容被安全过滤器拦截',
    suggestion: '请尝试翻译其他内容',
  },
  [APIErrorCode.PROVIDER_NOT_CONFIGURED]: {
    title: 'API 未配置',
    message: 'API 提供者未配置',
    suggestion: '请在设置页面选择并配置 API 提供者',
  },
  [APIErrorCode.PROVIDER_NOT_REGISTERED]: {
    title: 'Provider 错误',
    message: 'API Provider 未正确加载',
    suggestion: '请刷新页面或重新安装扩展',
  },
  [APIErrorCode.UNKNOWN_ERROR]: {
    title: '未知错误',
    message: '发生未知错误',
    suggestion: '请稍后重试，如问题持续请联系支持',
  },
};

/**
 * 用户友好的 API 错误类
 */
export class UserFriendlyAPIError extends Error {
  public code: APIErrorCode;
  public userTitle: string;
  public userMessage: string;
  public suggestion: string;
  public statusCode?: number;
  public retryable: boolean;
  public originalError?: Error;

  constructor(
    code: APIErrorCode,
    options?: {
      statusCode?: number;
      originalError?: Error;
      customMessage?: string;
    }
  ) {
    const errorInfo = USER_FRIENDLY_MESSAGES[code];
    const message = options?.customMessage || errorInfo.message;

    super(message);

    this.name = 'UserFriendlyAPIError';
    this.code = code;
    this.userTitle = errorInfo.title;
    this.userMessage = message;
    this.suggestion = errorInfo.suggestion;
    this.statusCode = options?.statusCode;
    this.originalError = options?.originalError;

    // 判断是否可重试
    this.retryable = [
      APIErrorCode.NETWORK_ERROR,
      APIErrorCode.TIMEOUT_ERROR,
      APIErrorCode.CONNECTION_FAILED,
      APIErrorCode.SERVER_ERROR,
      APIErrorCode.SERVICE_UNAVAILABLE,
      APIErrorCode.RATE_LIMIT_EXCEEDED,
    ].includes(code);
  }

  /**
   * 获取完整的用户提示信息
   */
  getFullUserMessage(): string {
    return `${this.userMessage}。${this.suggestion}`;
  }

  /**
   * 转换为可序列化的对象（用于消息传递）
   */
  toJSON(): {
    code: APIErrorCode;
    title: string;
    message: string;
    suggestion: string;
    retryable: boolean;
    statusCode?: number;
  } {
    return {
      code: this.code,
      title: this.userTitle,
      message: this.userMessage,
      suggestion: this.suggestion,
      retryable: this.retryable,
      statusCode: this.statusCode,
    };
  }
}

/**
 * 从原始错误解析出用户友好的错误
 */
export function parseAPIError(error: unknown): UserFriendlyAPIError {
  // 如果已经是 UserFriendlyAPIError，直接返回
  if (error instanceof UserFriendlyAPIError) {
    return error;
  }

  const originalError =
    error instanceof Error ? error : new Error(String(error));
  const errorMessage = originalError.message.toLowerCase();

  // 获取状态码（如果有）
  const statusCode =
    (error as { status?: number; statusCode?: number })?.status ||
    (error as { status?: number; statusCode?: number })?.statusCode;

  // 根据状态码判断
  if (statusCode) {
    switch (statusCode) {
      case 401:
        return new UserFriendlyAPIError(APIErrorCode.API_KEY_INVALID, {
          statusCode,
          originalError,
        });
      case 403:
        return new UserFriendlyAPIError(APIErrorCode.API_ACCESS_DENIED, {
          statusCode,
          originalError,
        });
      case 404:
        return new UserFriendlyAPIError(APIErrorCode.MODEL_NOT_FOUND, {
          statusCode,
          originalError,
        });
      case 429:
        return new UserFriendlyAPIError(APIErrorCode.RATE_LIMIT_EXCEEDED, {
          statusCode,
          originalError,
        });
      case 500:
      case 502:
      case 503:
      case 504:
        return new UserFriendlyAPIError(APIErrorCode.SERVER_ERROR, {
          statusCode,
          originalError,
        });
    }
  }

  // 根据错误消息关键词判断
  if (
    errorMessage.includes('api key') ||
    errorMessage.includes('apikey') ||
    errorMessage.includes('密钥')
  ) {
    if (errorMessage.includes('invalid') || errorMessage.includes('无效')) {
      return new UserFriendlyAPIError(APIErrorCode.API_KEY_INVALID, {
        originalError,
      });
    }
    if (errorMessage.includes('expired') || errorMessage.includes('过期')) {
      return new UserFriendlyAPIError(APIErrorCode.API_KEY_EXPIRED, {
        originalError,
      });
    }
    if (errorMessage.includes('missing') || errorMessage.includes('未配置')) {
      return new UserFriendlyAPIError(APIErrorCode.API_KEY_MISSING, {
        originalError,
      });
    }
  }

  if (
    errorMessage.includes('network') ||
    errorMessage.includes('fetch') ||
    errorMessage.includes('failed to fetch')
  ) {
    return new UserFriendlyAPIError(APIErrorCode.NETWORK_ERROR, {
      originalError,
    });
  }

  if (errorMessage.includes('timeout') || errorMessage.includes('超时')) {
    return new UserFriendlyAPIError(APIErrorCode.TIMEOUT_ERROR, {
      originalError,
    });
  }

  if (errorMessage.includes('connection') || errorMessage.includes('连接')) {
    return new UserFriendlyAPIError(APIErrorCode.CONNECTION_FAILED, {
      originalError,
    });
  }

  if (
    errorMessage.includes('rate limit') ||
    errorMessage.includes('too many') ||
    errorMessage.includes('频繁')
  ) {
    return new UserFriendlyAPIError(APIErrorCode.RATE_LIMIT_EXCEEDED, {
      originalError,
    });
  }

  if (
    errorMessage.includes('quota') ||
    errorMessage.includes('配额') ||
    errorMessage.includes('余额')
  ) {
    return new UserFriendlyAPIError(APIErrorCode.QUOTA_EXCEEDED, {
      originalError,
    });
  }

  if (
    errorMessage.includes('model') &&
    (errorMessage.includes('not found') || errorMessage.includes('不存在'))
  ) {
    return new UserFriendlyAPIError(APIErrorCode.MODEL_NOT_FOUND, {
      originalError,
    });
  }

  if (errorMessage.includes('content') && errorMessage.includes('filter')) {
    return new UserFriendlyAPIError(APIErrorCode.CONTENT_FILTERED, {
      originalError,
    });
  }

  if (errorMessage.includes('provider') && errorMessage.includes('未注册')) {
    return new UserFriendlyAPIError(APIErrorCode.PROVIDER_NOT_REGISTERED, {
      originalError,
    });
  }

  if (
    errorMessage.includes('未配置') ||
    errorMessage.includes('not configured')
  ) {
    return new UserFriendlyAPIError(APIErrorCode.PROVIDER_NOT_CONFIGURED, {
      originalError,
    });
  }

  if (
    errorMessage.includes('unauthorized') ||
    errorMessage.includes('未授权')
  ) {
    return new UserFriendlyAPIError(APIErrorCode.API_KEY_INVALID, {
      originalError,
    });
  }

  // 默认返回未知错误
  return new UserFriendlyAPIError(APIErrorCode.UNKNOWN_ERROR, {
    originalError,
    customMessage: originalError.message || '发生未知错误',
  });
}

/**
 * 获取用户友好的错误消息
 */
export function getUserFriendlyErrorMessage(error: unknown): string {
  const friendlyError = parseAPIError(error);
  return friendlyError.userMessage;
}

/**
 * 获取完整的错误提示（包含建议）
 */
export function getFullErrorMessage(error: unknown): string {
  const friendlyError = parseAPIError(error);
  return friendlyError.getFullUserMessage();
}

/**
 * 判断错误是否可重试
 */
export function isRetryableError(error: unknown): boolean {
  const friendlyError = parseAPIError(error);
  return friendlyError.retryable;
}
