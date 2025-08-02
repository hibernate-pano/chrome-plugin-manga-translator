import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  Eye,
  ChevronRight,
  ChevronDown
} from 'lucide-react';

interface NavigationItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: string | number;
  disabled?: boolean;
  description?: string;
  children?: NavigationItem[];
  shortcut?: string;
}

interface NavigationProps {
  items: NavigationItem[];
  activeItem: string;
  onItemClick: (itemId: string) => void;
  orientation?: 'horizontal' | 'vertical';
  variant?: 'default' | 'pills' | 'underline' | 'sidebar';
  className?: string;
  showTooltips?: boolean;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

const Navigation: React.FC<NavigationProps> = ({
  items,
  activeItem,
  onItemClick,
  orientation = 'horizontal',
  variant = 'default',
  className,
  showTooltips = false,
  collapsible = false,
  defaultCollapsed = false,
}) => {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const toggleExpanded = (itemId: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(itemId)) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedItems(newExpanded);
  };

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
      case 'sidebar':
        return {
          container: 'bg-card border rounded-lg p-2',
          item: 'rounded-md',
          activeItem: 'bg-primary text-primary-foreground',
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

  const renderNavigationItem = (item: NavigationItem, level = 0) => {
    const isExpanded = expandedItems.has(item.id);
    const hasChildren = item.children && item.children.length > 0;
    const isActive = activeItem === item.id;

    return (
      <div key={item.id}>
        <motion.div
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="relative"
        >
          <Button
            variant="ghost"
            size="sm"
            disabled={item.disabled}
            onClick={() => {
              if (hasChildren) {
                toggleExpanded(item.id);
              } else {
                onItemClick(item.id);
              }
            }}
            className={cn(
              'relative flex items-center gap-2 transition-all duration-200 w-full justify-start',
              styles.item,
              isActive && styles.activeItem,
              item.disabled && 'opacity-50 cursor-not-allowed',
              level > 0 && 'ml-4 text-sm'
            )}
            title={showTooltips ? item.description || item.label : undefined}
          >
            <div className="flex items-center gap-2 flex-1">
              {item.icon}
              <AnimatePresence mode="wait">
                {(!collapsed || variant !== 'sidebar') && (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ duration: 0.2 }}
                    className={cn(
                      orientation === 'horizontal' && 'hidden sm:inline'
                    )}
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>

            <div className="flex items-center gap-1">
              {item.shortcut && (!collapsed || variant !== 'sidebar') && (
                <Badge variant="outline" className="text-xs font-mono">
                  {item.shortcut}
                </Badge>
              )}
              {item.badge && (
                <Badge variant="secondary" className="text-xs">
                  {item.badge}
                </Badge>
              )}
              {hasChildren && (
                <motion.div
                  animate={{ rotate: isExpanded ? 90 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronRight className="w-4 h-4" />
                </motion.div>
              )}
            </div>

            {isActive && variant === 'underline' && (
              <motion.div
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                layoutId="activeIndicator"
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              />
            )}
          </Button>
        </motion.div>

        {/* 子项目 */}
        <AnimatePresence>
          {hasChildren && isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="overflow-hidden"
            >
              <div className="py-1 space-y-1">
                {item.children?.map((child) => renderNavigationItem(child, level + 1))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <nav
      className={cn(
        'flex',
        orientation === 'vertical' ? 'flex-col space-y-1' : 'space-x-1',
        styles.container,
        collapsible && variant === 'sidebar' && collapsed && 'w-16',
        className
      )}
    >
      {collapsible && variant === 'sidebar' && (
        <motion.div
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed(!collapsed)}
            className="w-full justify-center mb-2"
          >
            <motion.div
              animate={{ rotate: collapsed ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown className="w-4 h-4" />
            </motion.div>
          </Button>
        </motion.div>
      )}

      {items.map((item) => renderNavigationItem(item))}
    </nav>
  );
};

// 预定义的导航配置
export const popupNavigationItems: NavigationItem[] = [
  {
    id: 'main',
    label: '主要设置',
    icon: <Settings className="w-4 h-4" />,
    description: '配置基本翻译参数和API设置',
    shortcut: 'Alt+S',
  },
  {
    id: 'history',
    label: '翻译历史',
    icon: <History className="w-4 h-4" />,
    description: '查看和管理翻译历史记录',
    shortcut: 'Alt+H',
  },
];

export const optionsNavigationItems: NavigationItem[] = [
  {
    id: 'api',
    label: 'API设置',
    icon: <Zap className="w-4 h-4" />,
    description: '配置各种AI服务提供者',
    shortcut: 'Ctrl+1',
    children: [
      {
        id: 'api-openai',
        label: 'OpenAI',
        icon: <Database className="w-3 h-3" />,
        description: 'OpenAI GPT模型配置',
      },
      {
        id: 'api-deepseek',
        label: 'DeepSeek',
        icon: <Database className="w-3 h-3" />,
        description: 'DeepSeek模型配置',
      },
      {
        id: 'api-claude',
        label: 'Claude',
        icon: <Database className="w-3 h-3" />,
        description: 'Anthropic Claude模型配置',
      },
    ],
  },
  {
    id: 'style',
    label: '样式设置',
    icon: <Palette className="w-4 h-4" />,
    description: '自定义翻译文本的外观样式',
    shortcut: 'Ctrl+2',
  },
  {
    id: 'ocr',
    label: 'OCR设置',
    icon: <Eye className="w-4 h-4" />,
    description: '配置文字识别相关参数',
    shortcut: 'Ctrl+3',
  },
  {
    id: 'shortcuts',
    label: '快捷键',
    icon: <Keyboard className="w-4 h-4" />,
    description: '自定义键盘快捷键',
    shortcut: 'Ctrl+4',
  },
  {
    id: 'cache',
    label: '缓存管理',
    icon: <Database className="w-4 h-4" />,
    description: '管理翻译缓存和历史记录',
    shortcut: 'Ctrl+5',
  },
  {
    id: 'advanced',
    label: '高级设置',
    icon: <Settings className="w-4 h-4" />,
    description: '高级功能和实验性特性',
    shortcut: 'Ctrl+6',
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
