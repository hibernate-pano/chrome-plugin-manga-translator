import React from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Settings,
  History,
  Palette,
  Keyboard,
  Database,
  Zap,
  Eye
} from 'lucide-react';

interface NavigationItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: string | number;
  disabled?: boolean;
}

interface NavigationProps {
  items: NavigationItem[];
  activeItem: string;
  onItemClick: (itemId: string) => void;
  orientation?: 'horizontal' | 'vertical';
  variant?: 'default' | 'pills' | 'underline';
  className?: string;
}

const Navigation: React.FC<NavigationProps> = ({
  items,
  activeItem,
  onItemClick,
  orientation = 'horizontal',
  variant = 'default',
  className,
}) => {
  const getVariantStyles = () => {
    switch (variant) {
      case 'pills':
        return {
          container: 'bg-muted p-1 rounded-lg',
          item: 'rounded-md',
          activeItem: 'bg-background shadow-sm',
        };
      case 'underline':
        return {
          container: 'border-b',
          item: 'border-b-2 border-transparent rounded-none',
          activeItem: 'border-primary',
        };
      default:
        return {
          container: '',
          item: 'rounded-md',
          activeItem: 'bg-accent text-accent-foreground',
        };
    }
  };

  const styles = getVariantStyles();

  return (
    <nav
      className={cn(
        'flex',
        orientation === 'vertical' ? 'flex-col space-y-1' : 'space-x-1',
        styles.container,
        className
      )}
    >
      {items.map((item) => (
        <motion.div
          key={item.id}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Button
            variant="ghost"
            size="sm"
            disabled={item.disabled}
            onClick={() => onItemClick(item.id)}
            className={cn(
              'relative flex items-center gap-2 transition-all duration-200',
              styles.item,
              activeItem === item.id && styles.activeItem,
              orientation === 'vertical' ? 'w-full justify-start' : '',
              item.disabled && 'opacity-50 cursor-not-allowed'
            )}
          >
            {item.icon}
            <span className={cn(
              orientation === 'horizontal' && 'hidden sm:inline'
            )}>
              {item.label}
            </span>
            {item.badge && (
              <Badge variant="secondary" className="ml-auto text-xs">
                {item.badge}
              </Badge>
            )}
            {activeItem === item.id && variant === 'underline' && (
              <motion.div
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                layoutId="activeIndicator"
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              />
            )}
          </Button>
        </motion.div>
      ))}
    </nav>
  );
};

// 预定义的导航配置
export const popupNavigationItems: NavigationItem[] = [
  {
    id: 'main',
    label: '主要设置',
    icon: <Settings className="w-4 h-4" />,
  },
  {
    id: 'history',
    label: '翻译历史',
    icon: <History className="w-4 h-4" />,
  },
];

export const optionsNavigationItems: NavigationItem[] = [
  {
    id: 'api',
    label: 'API设置',
    icon: <Zap className="w-4 h-4" />,
  },
  {
    id: 'style',
    label: '样式设置',
    icon: <Palette className="w-4 h-4" />,
  },
  {
    id: 'ocr',
    label: 'OCR设置',
    icon: <Eye className="w-4 h-4" />,
  },
  {
    id: 'shortcuts',
    label: '快捷键',
    icon: <Keyboard className="w-4 h-4" />,
  },
  {
    id: 'cache',
    label: '缓存管理',
    icon: <Database className="w-4 h-4" />,
  },
  {
    id: 'advanced',
    label: '高级设置',
    icon: <Settings className="w-4 h-4" />,
  },
];

interface QuickActionsProps {
  actions: Array<{
    id: string;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    variant?: 'default' | 'destructive' | 'outline' | 'secondary';
    disabled?: boolean;
  }>;
  className?: string;
}

const QuickActions: React.FC<QuickActionsProps> = ({ actions, className }) => {
  return (
    <div className={cn('flex gap-2', className)}>
      {actions.map((action) => (
        <motion.div
          key={action.id}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <Button
            variant={action.variant || 'outline'}
            size="sm"
            onClick={action.onClick}
            disabled={action.disabled}
            className="flex items-center gap-2"
          >
            {action.icon}
            <span className="hidden sm:inline">{action.label}</span>
          </Button>
        </motion.div>
      ))}
    </div>
  );
};

export { Navigation, QuickActions };
