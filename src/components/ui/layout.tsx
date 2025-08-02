import React from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

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

export {
  LayoutHeader,
  LayoutSection,
  LayoutGrid,
  LayoutStack,
  LayoutContainer,
};
