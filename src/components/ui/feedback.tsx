import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

// ==================== 通知类型定义 ====================

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface NotificationConfig {
  type: NotificationType;
  title: string;
  message: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
  onClose?: () => void;
}

// ==================== 通知组件 ====================

interface NotificationProps extends NotificationConfig {
  className?: string;
  onClose?: () => void;
}

export const Notification: React.FC<NotificationProps> = ({
  type,
  title,
  message,
  duration = 5000,
  action,
  onClose,
  className,
}) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(() => onClose?.(), 300); // 等待动画完成
      }, duration);

      return () => clearTimeout(timer);
    }
    return undefined;
  }, [duration, onClose]);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => onClose?.(), 300);
  };

  const iconMap = {
    success: CheckCircle,
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
  };

  const colorMap = {
    success: 'border-green-200 bg-green-50 text-green-800',
    error: 'border-red-200 bg-red-50 text-red-800',
    warning: 'border-yellow-200 bg-yellow-50 text-yellow-800',
    info: 'border-blue-200 bg-blue-50 text-blue-800',
  };

  const Icon = iconMap[type];

  return (
    <div
      className={cn(
        'border rounded-lg p-4 transition-all duration-300 ease-in-out',
        colorMap[type],
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2',
        className
      )}
    >
      <div className="flex items-start">
        <Icon className="h-5 w-5 mt-0.5 mr-3 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="text-sm mt-1">{message}</p>
          {action && (
            <button
              onClick={action.onClick}
              className="text-sm font-medium mt-2 hover:underline"
            >
              {action.label}
            </button>
          )}
        </div>
        <button
          onClick={handleClose}
          className="ml-3 flex-shrink-0 text-gray-400 hover:text-gray-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

// ==================== 通知管理器 ====================

interface NotificationItem extends NotificationConfig {
  id: string;
}

interface NotificationManagerProps {
  className?: string;
}

export const NotificationManager: React.FC<NotificationManagerProps> = ({ className }) => {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const addNotification = (config: NotificationConfig) => {
    const id = Math.random().toString(36).substr(2, 9);
    const notification: NotificationItem = { ...config, id };
    setNotifications(prev => [...prev, notification]);
  };

  const removeNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  // 暴露给全局使用
  useEffect(() => {
    (window as any).showNotification = addNotification;
    return () => {
      delete (window as any).showNotification;
    };
  }, []);

  return (
    <div className={cn('fixed top-4 right-4 z-50 space-y-2', className)}>
      {notifications.map(notification => (
        <Notification
          key={notification.id}
          {...notification}
          onClose={() => removeNotification(notification.id)}
        />
      ))}
    </div>
  );
};

// ==================== 便捷通知函数 ====================

export const showNotification = (config: NotificationConfig) => {
  if (typeof window !== 'undefined' && (window as any).showNotification) {
    (window as any).showNotification(config);
  }
};

export const showSuccess = (title: string, message: string, options?: Partial<NotificationConfig>) => {
  showNotification({
    type: 'success',
    title,
    message,
    ...options,
  });
};

export const showError = (title: string, message: string, options?: Partial<NotificationConfig>) => {
  showNotification({
    type: 'error',
    title,
    message,
    ...options,
  });
};

export const showWarning = (title: string, message: string, options?: Partial<NotificationConfig>) => {
  showNotification({
    type: 'warning',
    title,
    message,
    ...options,
  });
};

export const showInfo = (title: string, message: string, options?: Partial<NotificationConfig>) => {
  showNotification({
    type: 'info',
    title,
    message,
    ...options,
  });
};

// ==================== 确认对话框 ====================

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
  className?: string;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  type = 'info',
  onConfirm,
  onCancel,
  className,
}) => {
  if (!isOpen) return null;

  const colorMap = {
    danger: 'bg-red-600 hover:bg-red-700',
    warning: 'bg-yellow-600 hover:bg-yellow-700',
    info: 'bg-blue-600 hover:bg-blue-700',
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className={cn('bg-white rounded-lg p-6 max-w-md w-full mx-4', className)}>
        <h3 className="text-lg font-medium text-gray-900 mb-2">{title}</h3>
        <p className="text-sm text-gray-600 mb-6">{message}</p>
        
        <div className="flex justify-end space-x-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              'px-4 py-2 text-sm font-medium text-white rounded-md',
              colorMap[type]
            )}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

// ==================== 工具提示 ====================

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  position = 'top',
  className,
}) => {
  const [isVisible, setIsVisible] = useState(false);

  const positionClasses = {
    top: 'bottom-full left-1/2 transform -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 transform -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 transform -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 transform -translate-y-1/2 ml-2',
  };

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <div
          className={cn(
            'absolute z-50 px-2 py-1 text-xs text-white bg-gray-900 rounded shadow-lg whitespace-nowrap',
            positionClasses[position],
            className
          )}
        >
          {content}
          <div
            className={cn(
              'absolute w-0 h-0 border-4 border-transparent',
              position === 'top' && 'top-full left-1/2 transform -translate-x-1/2 border-t-gray-900',
              position === 'bottom' && 'bottom-full left-1/2 transform -translate-x-1/2 border-b-gray-900',
              position === 'left' && 'left-full top-1/2 transform -translate-y-1/2 border-l-gray-900',
              position === 'right' && 'right-full top-1/2 transform -translate-y-1/2 border-r-gray-900'
            )}
          />
        </div>
      )}
    </div>
  );
};

// 所有组件已经在上面导出，这里不需要重复导出 