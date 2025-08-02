import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ChevronUp, Menu, X } from 'lucide-react';

interface LayoutHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}

const LayoutHeader: React.FC<LayoutHeaderProps> = ({
  title,
  subtitle,
  actions,
  className,
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn('flex items-center justify-between', className)}
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && (
          <p className="text-muted-foreground mt-1">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2">
          {actions}
        </div>
      )}
    </motion.div>
  );
};

interface LayoutSectionProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  variant?: 'default' | 'card' | 'minimal';
}

const LayoutSection: React.FC<LayoutSectionProps> = ({
  title,
  description,
  children,
  className,
  contentClassName,
  variant = 'default',
}) => {
  const content = (
    <div className={cn(contentClassName)}>
      {children}
    </div>
  );

  if (variant === 'card') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={cn(className)}
      >
        <Card>
          {(title || description) && (
            <CardHeader>
              {title && <CardTitle>{title}</CardTitle>}
              {description && (
                <p className="text-sm text-muted-foreground">{description}</p>
              )}
            </CardHeader>
          )}
          <CardContent>
            {content}
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  if (variant === 'minimal') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={cn('space-y-4', className)}
      >
        {(title || description) && (
          <div>
            {title && (
              <h3 className="text-lg font-medium">{title}</h3>
            )}
            {description && (
              <p className="text-sm text-muted-foreground mt-1">{description}</p>
            )}
          </div>
        )}
        {content}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn('space-y-4', className)}
    >
      {(title || description) && (
        <div>
          {title && (
            <h2 className="text-xl font-semibold">{title}</h2>
          )}
          {description && (
            <p className="text-muted-foreground mt-1">{description}</p>
          )}
          <Separator className="mt-4" />
        </div>
      )}
      {content}
    </motion.div>
  );
};

interface LayoutGridProps {
  children: React.ReactNode;
  columns?: 1 | 2 | 3 | 4;
  gap?: 'sm' | 'md' | 'lg';
  className?: string;
}

const LayoutGrid: React.FC<LayoutGridProps> = ({
  children,
  columns = 2,
  gap = 'md',
  className,
}) => {
  const getGridClasses = () => {
    const columnClasses = {
      1: 'grid-cols-1',
      2: 'grid-cols-1 md:grid-cols-2',
      3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
      4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
    };

    const gapClasses = {
      sm: 'gap-2',
      md: 'gap-4',
      lg: 'gap-6',
    };

    return `grid ${columnClasses[columns]} ${gapClasses[gap]}`;
  };

  return (
    <div className={cn(getGridClasses(), className)}>
      {children}
    </div>
  );
};

interface LayoutStackProps {
  children: React.ReactNode;
  spacing?: 'sm' | 'md' | 'lg';
  className?: string;
}

const LayoutStack: React.FC<LayoutStackProps> = ({
  children,
  spacing = 'md',
  className,
}) => {
  const getSpacingClass = () => {
    switch (spacing) {
      case 'sm':
        return 'space-y-2';
      case 'lg':
        return 'space-y-6';
      default:
        return 'space-y-4';
    }
  };

  return (
    <div className={cn('flex flex-col', getSpacingClass(), className)}>
      {children}
    </div>
  );
};

interface LayoutContainerProps {
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  padding?: 'sm' | 'md' | 'lg';
  className?: string;
}

const LayoutContainer: React.FC<LayoutContainerProps> = ({
  children,
  maxWidth = 'lg',
  padding = 'md',
  className,
}) => {
  const getMaxWidthClass = () => {
    switch (maxWidth) {
      case 'sm':
        return 'max-w-sm';
      case 'md':
        return 'max-w-md';
      case 'lg':
        return 'max-w-lg';
      case 'xl':
        return 'max-w-xl';
      case 'full':
        return 'max-w-full';
      default:
        return 'max-w-lg';
    }
  };

  const getPaddingClass = () => {
    switch (padding) {
      case 'sm':
        return 'p-2';
      case 'lg':
        return 'p-6';
      default:
        return 'p-4';
    }
  };

  return (
    <div className={cn(
      'mx-auto w-full',
      getMaxWidthClass(),
      getPaddingClass(),
      className
    )}>
      {children}
    </div>
  );
};

// 响应式侧边栏布局
interface ResponsiveSidebarLayoutProps {
  children: React.ReactNode;
  sidebar: React.ReactNode;
  className?: string;
  sidebarWidth?: 'sm' | 'md' | 'lg';
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

const ResponsiveSidebarLayout: React.FC<ResponsiveSidebarLayoutProps> = ({
  children,
  sidebar,
  className,
  sidebarWidth = 'md',
  collapsible = true,
  defaultCollapsed = false,
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth >= 768) {
        setIsMobileMenuOpen(false);
      }
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const getSidebarWidth = () => {
    if (isCollapsed) return 'w-16';

    switch (sidebarWidth) {
      case 'sm':
        return 'w-48';
      case 'lg':
        return 'w-80';
      default:
        return 'w-64';
    }
  };

  return (
    <div className={cn('flex h-screen bg-background', className)}>
      {/* 桌面端侧边栏 */}
      <motion.aside
        initial={false}
        animate={{
          width: isMobile ? 0 : isCollapsed ? 64 : sidebarWidth === 'sm' ? 192 : sidebarWidth === 'lg' ? 320 : 256,
        }}
        transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
        className={cn(
          'hidden md:flex flex-col border-r bg-card overflow-hidden',
          getSidebarWidth()
        )}
      >
        <div className="flex-1 overflow-y-auto">
          {sidebar}
        </div>

        {collapsible && (
          <div className="p-2 border-t">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="w-full"
            >
              <motion.div
                animate={{ rotate: isCollapsed ? 180 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <ChevronUp className="w-4 h-4" />
              </motion.div>
              {!isCollapsed && <span className="ml-2">收起</span>}
            </Button>
          </div>
        )}
      </motion.aside>

      {/* 移动端侧边栏覆盖层 */}
      <AnimatePresence>
        {isMobile && isMobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/50 z-40 md:hidden"
              onClick={() => setIsMobileMenuOpen(false)}
            />
            <motion.aside
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="fixed left-0 top-0 h-full w-80 bg-card border-r z-50 md:hidden"
            >
              <div className="flex items-center justify-between p-4 border-b">
                <h2 className="font-semibold">菜单</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {sidebar}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* 主内容区域 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 移动端顶部栏 */}
        {isMobile && (
          <div className="flex items-center justify-between p-4 border-b bg-card md:hidden">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsMobileMenuOpen(true)}
            >
              <Menu className="w-4 h-4" />
            </Button>
            <h1 className="font-semibold">漫画翻译助手</h1>
            <div className="w-8" /> {/* 占位符保持居中 */}
          </div>
        )}

        {/* 主内容 */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
};

// 面包屑导航组件
interface BreadcrumbItem {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

const Breadcrumb: React.FC<BreadcrumbProps> = ({ items, className }) => {
  return (
    <nav className={cn('flex items-center space-x-1 text-sm text-muted-foreground', className)}>
      {items.map((item, index) => (
        <React.Fragment key={index}>
          {index > 0 && <span className="mx-2">/</span>}
          {item.href || item.onClick ? (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={item.onClick}
              className="hover:text-foreground transition-colors"
            >
              {item.label}
            </motion.button>
          ) : (
            <span className={index === items.length - 1 ? 'text-foreground font-medium' : ''}>
              {item.label}
            </span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
};

export {
  LayoutHeader,
  LayoutSection,
  LayoutGrid,
  LayoutStack,
  LayoutContainer,
  ResponsiveSidebarLayout,
  Breadcrumb,
};
