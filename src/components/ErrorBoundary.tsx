import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({
      error,
      errorInfo,
    });

    // 记录错误日志
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // 调用错误处理回调
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // 可以在这里添加错误上报逻辑
    this.reportError(error, errorInfo);
  }

  private reportError(error: Error, errorInfo: ErrorInfo): void {
    // 错误上报逻辑
    try {
      // 这里可以集成错误上报服务，如Sentry
      const _errorData = {
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href,
      };

      // 发送到错误上报服务
      // this.sendErrorReport(_errorData);
    } catch (reportError) {
      console.error('Error reporting failed:', reportError);
    }
  }

  private handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  private handleReset = (): void => {
    // 重置应用状态
    window.location.reload();
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      // 自定义错误界面
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // 默认错误界面
      return (
        <div className='flex min-h-screen items-center justify-center bg-gray-50'>
          <div className='w-full max-w-md rounded-lg bg-white p-6 shadow-lg'>
            <div className='mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100'>
              <svg
                className='h-6 w-6 text-red-600'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z'
                />
              </svg>
            </div>
            <div className='mt-4 text-center'>
              <h3 className='text-lg font-medium text-gray-900'>
                出现了一个错误
              </h3>
              <p className='mt-2 text-sm text-gray-500'>
                抱歉，应用程序遇到了一个意外错误。我们已经记录了这个错误，并将尽快修复。
              </p>
              {import.meta.env.DEV && this.state.error && (
                <details className='mt-4 text-left'>
                  <summary className='cursor-pointer text-sm font-medium text-gray-700'>
                    错误详情 (开发模式)
                  </summary>
                  <div className='mt-2 max-h-40 overflow-auto rounded bg-gray-100 p-3 font-mono text-xs text-gray-800'>
                    <div className='mb-2'>
                      <strong>错误信息:</strong>
                      <div className='mt-1'>{this.state.error.message}</div>
                    </div>
                    {this.state.error.stack && (
                      <div className='mb-2'>
                        <strong>错误堆栈:</strong>
                        <div className='mt-1 whitespace-pre-wrap'>
                          {this.state.error.stack}
                        </div>
                      </div>
                    )}
                    {this.state.errorInfo && (
                      <div>
                        <strong>组件堆栈:</strong>
                        <div className='mt-1 whitespace-pre-wrap'>
                          {this.state.errorInfo.componentStack}
                        </div>
                      </div>
                    )}
                  </div>
                </details>
              )}
            </div>
            <div className='mt-6 flex space-x-3'>
              <button
                onClick={this.handleRetry}
                className='flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2'
              >
                重试
              </button>
              <button
                onClick={this.handleReset}
                className='flex-1 rounded-md bg-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2'
              >
                重置应用
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// 高阶组件，用于包装组件并提供错误边界
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<Props, 'children'>
) {
  return function WrappedComponent(props: P) {
    return (
      <ErrorBoundary {...errorBoundaryProps}>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
}

// Hook for functional components
export function useErrorHandler() {
  const [error, setError] = React.useState<Error | null>(null);

  const handleError = React.useCallback((error: Error) => {
    setError(error);
    console.error('Error caught by useErrorHandler:', error);
  }, []);

  const clearError = React.useCallback(() => {
    setError(null);
  }, []);

  return {
    error,
    handleError,
    clearError,
  };
}
