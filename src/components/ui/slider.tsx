import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';

import { cn } from '@/lib/utils';

export interface SliderProps extends React.ComponentPropsWithoutRef<
  typeof SliderPrimitive.Root
> {
  /**
   * 逐个手柄透传的属性，顺序与 `value` 数组一致。
   *
   * Radix 给每个手柄的默认 aria-label 是英文的 "Minimum" / "Maximum"。
   * 中文界面里读屏会直接念出这两个英文词，而且两个手柄只差一个字母，
   * 用户根本分不清自己在调上限还是下限。调用方在这里指定每个手柄的
   * 名称（以及 aria-valuetext 这类"人能读懂的值"）。
   */
  thumbProps?: Array<
    React.ComponentPropsWithoutRef<typeof SliderPrimitive.Thumb>
  >;
}

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  SliderProps
>(({ className, thumbProps, ...props }, ref) => {
  // Radix renders one thumb per value in the array. Hard-coding a single
  // thumb meant a range slider (minFontSize / maxFontSize) showed one
  // handle: dragging it moved both ends at once, and the user could not
  // tell there were two values to set.
  const values = Array.isArray(props.value) ? props.value : [props.value];
  const thumbCount = Math.max(values.length, 1);

  // 单值滑块没有"上下限"之分，直接沿用调用方写在 Root 上的名称。
  // 区间滑块必须逐个给名，否则两个手柄会共用同一个名字。
  const singleThumbLabel = thumbCount === 1 ? props['aria-label'] : undefined;

  return (
    <SliderPrimitive.Root
      ref={ref}
      className={cn(
        'relative flex w-full touch-none select-none items-center',
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track className='relative h-1.5 w-full grow overflow-hidden rounded-full bg-primary/20'>
        <SliderPrimitive.Range className='absolute h-full bg-primary' />
      </SliderPrimitive.Track>
      {Array.from({ length: thumbCount }, (_, index) => {
        const thumbPropsForIndex = thumbProps?.[index];
        const ariaLabel =
          thumbPropsForIndex?.['aria-label'] ?? singleThumbLabel;
        return (
          <SliderPrimitive.Thumb
            key={index}
            {...thumbPropsForIndex}
            // 只在确实有名字时才写这个属性：传一个 undefined 会把 Radix
            // 自己的默认值（"Minimum" / "Maximum"）也一并抹掉。
            {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
            className='block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50'
          />
        );
      })}
    </SliderPrimitive.Root>
  );
});
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
