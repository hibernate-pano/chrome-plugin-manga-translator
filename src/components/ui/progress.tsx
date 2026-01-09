import * as React from 'react';
import { cn } from '@/lib/utils';

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  max?: number;
  showPercentage?: boolean;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  (
    { className, value = 0, max = 100, showPercentage = false, ...props },
    ref
  ) => {
    const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

    return (
      <div
        ref={ref}
        className={cn('h-2.5 w-full rounded-full bg-gray-200', className)}
        {...props}
      >
        <div
          className='h-2.5 rounded-full bg-blue-600 transition-all duration-300 ease-in-out'
          style={{ width: `${percentage}%` }}
        />
        {showPercentage && (
          <div className='mt-1 text-center text-xs text-gray-600'>
            {Math.round(percentage)}%
          </div>
        )}
      </div>
    );
  }
);

Progress.displayName = 'Progress';

export { Progress };
