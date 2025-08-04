/**
 * 统一错误处理机制
 * 提供错误分类、用户友好提示和错误恢复建议
 */

// 错误类型枚举
export enum ErrorType {
  NETWORK = 'network',
  API = 'api',
  AUTHENTICATION = 'authentication',
  VALIDATION = 'validation',
  PERMISSION = 'permission',
  RESOURCE = 'resource',
  TIMEOUT = 'timeout',
  UNKNOWN = 'unknown',
}

// 错误严重程度
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

// 错误信息接口
export interface ErrorInfo {
  type: ErrorType;
  severity: ErrorSeverity;
  message: string;
  userMessage: string;
  recoverySuggestion: string;
  retryable: boolean;
  timestamp: Date;
  context?: Record<string, any>;
}

// 错误处理选项
export interface ErrorHandlerOptions {
  showUserMessage?: boolean;
  logToConsole?: boolean;
  reportToService?: boolean;
  retryCount?: number;
  retryDelay?: number;
}

// 默认错误处理选项
const DEFAULT_OPTIONS: ErrorHandlerOptions = {
  showUserMessage: true,
  logToConsole: true,
  reportToService: false,
  retryCount: 3,
  retryDelay: 1000,
};

/**
 * 错误分类器
 */
export class ErrorClassifier {
  /**
   * 根据错误对象分类错误类型
   */
  static classifyError(error: Error | unknown): ErrorType {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      const _name = error.name.toLowerCase();

      // 网络错误
      if (message.includes('network') || message.includes('fetch') || message.includes('connection')) {
        return ErrorType.NETWORK;
      }

      // API错误
      if (message.includes('api') || message.includes('http') || message.includes('response')) {
        return ErrorType.API;
      }

      // 认证错误
      if (message.includes('auth') || message.includes('unauthorized') || message.includes('forbidden')) {
        return ErrorType.AUTHENTICATION;
      }

      // 验证错误
      if (message.includes('validation') || message.includes('invalid') || message.includes('format')) {
        return ErrorType.VALIDATION;
      }

      // 权限错误
      if (message.includes('permission') || message.includes('access denied')) {
        return ErrorType.PERMISSION;
      }

      // 资源错误
      if (message.includes('not found') || message.includes('resource')) {
        return ErrorType.RESOURCE;
      }

      // 超时错误
      if (message.includes('timeout') || message.includes('timed out')) {
        return ErrorType.TIMEOUT;
      }
    }

    return ErrorType.UNKNOWN;
  }

  /**
   * 确定错误严重程度
   */
  static determineSeverity(errorType: ErrorType, _context?: Record<string, any>): ErrorSeverity {
    switch (errorType) {
      case ErrorType.UNKNOWN:
        return ErrorSeverity.CRITICAL;
      case ErrorType.AUTHENTICATION:
      case ErrorType.PERMISSION:
        return ErrorSeverity.HIGH;
      case ErrorType.API:
      case ErrorType.NETWORK:
        return ErrorSeverity.MEDIUM;
      case ErrorType.VALIDATION:
      case ErrorType.TIMEOUT:
        return ErrorSeverity.LOW;
      default:
        return ErrorSeverity.MEDIUM;
    }
  }
}

/**
 * 错误消息生成器
 */
export class ErrorMessageGenerator {
  private static readonly ERROR_MESSAGES = {
    [ErrorType.NETWORK]: {
      userMessage: '网络连接出现问题，请检查您的网络连接',
      recoverySuggestion: '请检查网络连接，稍后重试',
    },
    [ErrorType.API]: {
      userMessage: 'API服务暂时不可用',
      recoverySuggestion: '请稍后重试，或联系技术支持',
    },
    [ErrorType.AUTHENTICATION]: {
      userMessage: '认证失败，请检查您的API密钥',
      recoverySuggestion: '请在设置中更新您的API密钥',
    },
    [ErrorType.VALIDATION]: {
      userMessage: '输入数据格式不正确',
      recoverySuggestion: '请检查输入数据格式',
    },
    [ErrorType.PERMISSION]: {
      userMessage: '没有权限执行此操作',
      recoverySuggestion: '请检查您的账户权限',
    },
    [ErrorType.RESOURCE]: {
      userMessage: '请求的资源不存在',
      recoverySuggestion: '请检查资源地址是否正确',
    },
    [ErrorType.TIMEOUT]: {
      userMessage: '请求超时，请稍后重试',
      recoverySuggestion: '请稍后重试，或检查网络连接',
    },
    [ErrorType.UNKNOWN]: {
      userMessage: '发生未知错误',
      recoverySuggestion: '请刷新页面重试，或联系技术支持',
    },
  };

  /**
   * 生成用户友好的错误消息
   */
  static generateUserMessage(errorType: ErrorType, originalMessage?: string): string {
    const template = this.ERROR_MESSAGES[errorType];
    if (template) {
      return template.userMessage;
    }
    return originalMessage || '发生了一个错误';
  }

  /**
   * 生成错误恢复建议
   */
  static generateRecoverySuggestion(errorType: ErrorType): string {
    const template = this.ERROR_MESSAGES[errorType];
    return template?.recoverySuggestion || '请稍后重试';
  }

  /**
   * 判断错误是否可重试
   */
  static isRetryable(errorType: ErrorType): boolean {
    return [
      ErrorType.NETWORK,
      ErrorType.API,
      ErrorType.TIMEOUT,
    ].includes(errorType);
  }
}

/**
 * 统一错误处理器
 */
export class ErrorHandler {
  private static instance: ErrorHandler;
  private errorListeners: Array<(error: ErrorInfo) => void> = [];
  private retryQueue: Map<string, { count: number; maxCount: number; delay: number }> = new Map();

  private constructor() {}

  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  /**
   * 处理错误
   */
  handleError(
    error: Error | unknown,
    options: ErrorHandlerOptions = {},
    context?: Record<string, any>
  ): ErrorInfo {
    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
    const errorType = ErrorClassifier.classifyError(error);
    const severity = ErrorClassifier.determineSeverity(errorType, context);
    const userMessage = ErrorMessageGenerator.generateUserMessage(
      errorType,
      error instanceof Error ? error.message : String(error)
    );
    const recoverySuggestion = ErrorMessageGenerator.generateRecoverySuggestion(errorType);
    const retryable = ErrorMessageGenerator.isRetryable(errorType);

    const errorInfo: ErrorInfo = {
      type: errorType,
      severity,
      message: error instanceof Error ? error.message : String(error),
      userMessage,
      recoverySuggestion,
      retryable,
      timestamp: new Date(),
      context,
    };

    // 记录到控制台
    if (mergedOptions.logToConsole) {
      this.logError(errorInfo);
    }

    // 显示用户消息
    if (mergedOptions.showUserMessage) {
      this.showUserMessage(errorInfo);
    }

    // 上报错误
    if (mergedOptions.reportToService) {
      this.reportError(errorInfo);
    }

    // 通知监听器
    this.notifyListeners(errorInfo);

    return errorInfo;
  }

  /**
   * 添加错误监听器
   */
  addErrorListener(listener: (error: ErrorInfo) => void): () => void {
    this.errorListeners.push(listener);
    return () => {
      const index = this.errorListeners.indexOf(listener);
      if (index > -1) {
        this.errorListeners.splice(index, 1);
      }
    };
  }

  /**
   * 重试操作
   */
  async retryOperation<T>(
    operation: () => Promise<T>,
    operationId: string,
    maxRetries: number = 3,
    delay: number = 1000
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt === maxRetries) {
          throw lastError;
        }

        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, delay * attempt));
      }
    }

    throw lastError!;
  }

  /**
   * 记录错误到控制台
   */
  private logError(errorInfo: ErrorInfo): void {
    const logLevel = this.getLogLevel(errorInfo.severity);
    const logMessage = `[${errorInfo.type.toUpperCase()}] ${errorInfo.message}`;
    
    switch (logLevel) {
      case 'error':
        console.error(logMessage, errorInfo);
        break;
      case 'warn':
        console.warn(logMessage, errorInfo);
        break;
      case 'info':
        console.info(logMessage, errorInfo);
        break;
      default:
        console.log(logMessage, errorInfo);
    }
  }

  /**
   * 显示用户消息
   */
  private showUserMessage(errorInfo: ErrorInfo): void {
    // 这里可以集成toast通知或其他UI组件
    // 暂时使用console.log，实际应用中应该使用UI组件
    console.log(`用户提示: ${errorInfo.userMessage}`);
    console.log(`恢复建议: ${errorInfo.recoverySuggestion}`);
  }

  /**
   * 上报错误到服务
   */
  private reportError(errorInfo: ErrorInfo): void {
    // 这里可以集成错误上报服务，如Sentry
    // 暂时使用console.log，实际应用中应该发送到错误上报服务
    console.log('错误上报:', errorInfo);
  }

  /**
   * 通知错误监听器
   */
  private notifyListeners(errorInfo: ErrorInfo): void {
    this.errorListeners.forEach(listener => {
      try {
        listener(errorInfo);
      } catch (listenerError) {
        console.error('错误监听器执行失败:', listenerError);
      }
    });
  }

  /**
   * 获取日志级别
   */
  private getLogLevel(severity: ErrorSeverity): 'error' | 'warn' | 'info' | 'log' {
    switch (severity) {
      case ErrorSeverity.CRITICAL:
      case ErrorSeverity.HIGH:
        return 'error';
      case ErrorSeverity.MEDIUM:
        return 'warn';
      case ErrorSeverity.LOW:
        return 'info';
      default:
        return 'log';
    }
  }
}

// 导出单例实例
export const errorHandler = ErrorHandler.getInstance();

// 便捷函数
export function handleError(
  error: Error | unknown,
  options?: ErrorHandlerOptions,
  context?: Record<string, any>
): ErrorInfo {
  return errorHandler.handleError(error, options, context);
}

// React Hook for error handling
import { useState, useEffect, useCallback } from 'react';

export function useErrorHandler() {
  const [errors, setErrors] = useState<ErrorInfo[]>([]);

  useEffect(() => {
    const unsubscribe = errorHandler.addErrorListener((errorInfo) => {
      setErrors(prev => [...prev, errorInfo]);
    });

    return unsubscribe;
  }, []);

  const clearErrors = useCallback(() => {
    setErrors([]);
  }, []);

  return {
    errors,
    clearErrors,
    handleError: (error: Error | unknown, options?: ErrorHandlerOptions, context?: Record<string, any>) => {
      return errorHandler.handleError(error, options, context);
    },
  };
} 