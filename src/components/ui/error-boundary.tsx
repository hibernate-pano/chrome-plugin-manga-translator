import React from 'react';
import { cn } from '../../lib/utils';
import { Button } from './button';

export interface ErrorInfo {
  componentStack: string;
  errorBoundary?: string;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ComponentType<ErrorFallbackProps>;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  className?: string;
}

export interface ErrorFallbackProps {
  error: Error;
  errorInfo: ErrorInfo;
  resetError: () => void;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const info: ErrorInfo = {
      componentStack: errorInfo.componentStack,
      errorBoundary: this.constructor.name,
    };

    this.setState({
      errorInfo: info,
    });

    // 调用错误回调
    if (this.props.onError) {
      this.props.onError(error, info);
    }

    // 记录错误到控制台
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  resetError = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError && this.state.error && this.state.errorInfo) {
      const FallbackComponent = this.props.fallback || DefaultErrorFallback;
      
      return (
        <div className={this.props.className}>
          <FallbackComponent
            error={this.state.error}
            errorInfo={this.state.errorInfo}
            resetError={this.resetError}
          />
        </div>
      );
    }

    return this.props.children;
  }
}

// 默认错误回退组件
export const DefaultErrorFallback: React.FC<ErrorFallbackProps> = ({
  error,
  errorInfo,
  resetError,
}) => {
  return (
    <div className="min-h-[200px] flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <div className="mb-4">
          <svg
            className="mx-auto h-12 w-12 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
          出现了错误
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          抱歉，应用程序遇到了意外错误。请尝试刷新页面或联系支持。
        </p>
        <details className="text-left mb-4">
          <summary className="cursor-pointer text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100">
            查看错误详情
          </summary>
          <div className="mt-2 p-3 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono text-gray-700 dark:text-gray-300 overflow-auto max-h-32">
            <div className="mb-2">
              <strong>错误信息:</strong> {error.message}
            </div>
            <div className="mb-2">
              <strong>错误堆栈:</strong>
              <pre className="whitespace-pre-wrap">{error.stack}</pre>
            </div>
            {errorInfo.componentStack && (
              <div>
                <strong>组件堆栈:</strong>
                <pre className="whitespace-pre-wrap">{errorInfo.componentStack}</pre>
              </div>
            )}
          </div>
        </details>
        <Button onClick={resetError} variant="outline">
          重试
        </Button>
      </div>
    </div>
  );
};

// 简单错误消息组件
export interface ErrorMessageProps {
  title?: string;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({
  title = '错误',
  message,
  action,
  className,
}) => {
  return (
    <div className={cn(
      'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-4',
      className
    )}>
      <div className="flex">
        <div className="flex-shrink-0">
          <svg
            className="h-5 w-5 text-red-400"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="ml-3 flex-1">
          <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
            {title}
          </h3>
          <div className="mt-2 text-sm text-red-700 dark:text-red-300">
            {message}
          </div>
          {action && (
            <div className="mt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={action.onClick}
                className="text-red-800 border-red-300 hover:bg-red-100 dark:text-red-200 dark:border-red-600 dark:hover:bg-red-800"
              >
                {action.label}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// 网络错误组件
export interface NetworkErrorProps {
  onRetry?: () => void;
  className?: string;
}

export const NetworkError: React.FC<NetworkErrorProps> = ({
  onRetry,
  className,
}) => {
  return (
    <div className={cn(
      'text-center py-8 px-4',
      className
    )}>
      <div className="mb-4">
        <svg
          className="mx-auto h-12 w-12 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
        网络连接错误
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        无法连接到服务器，请检查您的网络连接。
      </p>
      {onRetry && (
        <Button onClick={onRetry} variant="outline">
          重试
        </Button>
      )}
    </div>
  );
};

// API错误组件
export interface APIErrorProps {
  error: {
    status?: number;
    message: string;
    code?: string;
  };
  onRetry?: () => void;
  className?: string;
}

export const APIError: React.FC<APIErrorProps> = ({
  error,
  onRetry,
  className,
}) => {
  const getErrorTitle = (status?: number) => {
    switch (status) {
      case 401:
        return 'API密钥无效';
      case 403:
        return '访问被拒绝';
      case 404:
        return '服务不可用';
      case 429:
        return '请求过于频繁';
      case 500:
        return '服务器错误';
      default:
        return 'API错误';
    }
  };

  const getErrorDescription = (status?: number) => {
    switch (status) {
      case 401:
        return '请检查您的API密钥是否正确配置。';
      case 403:
        return '您没有权限访问此服务。';
      case 404:
        return '请求的服务端点不存在。';
      case 429:
        return '请求次数超过限制，请稍后再试。';
      case 500:
        return '服务器内部错误，请稍后重试。';
      default:
        return '请求失败，请检查网络连接和配置。';
    }
  };

  return (
    <div className={cn(
      'text-center py-6 px-4',
      className
    )}>
      <div className="mb-4">
        <svg
          className="mx-auto h-10 w-10 text-red-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
        {getErrorTitle(error.status)}
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
        {getErrorDescription(error.status)}
      </p>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
        {error.message}
        {error.code && ` (${error.code})`}
      </p>
      {onRetry && (
        <Button onClick={onRetry} variant="outline" size="sm">
          重试
        </Button>
      )}
    </div>
  );
};

// 错误处理 Hook
export const useErrorHandler = () => {
  const [error, setError] = React.useState<string | null>(null);

  const handleError = React.useCallback((error: Error | string) => {
    const message = typeof error === 'string' ? error : error.message;
    setError(message);
    console.error('Error handled:', error);
  }, []);

  const clearError = React.useCallback(() => {
    setError(null);
  }, []);

  return {
    error,
    handleError,
    clearError,
  };
};
