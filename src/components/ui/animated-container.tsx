import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface AnimatedContainerProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  duration?: number;
  direction?: 'up' | 'down' | 'left' | 'right' | 'fade';
}

const AnimatedContainer: React.FC<AnimatedContainerProps> = ({
  children,
  className,
  delay = 0,
  duration = 0.3,
  direction = 'up',
}) => {
  const getInitialPosition = () => {
    switch (direction) {
      case 'up':
        return { y: 20, opacity: 0 };
      case 'down':
        return { y: -20, opacity: 0 };
      case 'left':
        return { x: 20, opacity: 0 };
      case 'right':
        return { x: -20, opacity: 0 };
      case 'fade':
        return { opacity: 0 };
      default:
        return { y: 20, opacity: 0 };
    }
  };

  const getFinalPosition = () => {
    switch (direction) {
      case 'up':
      case 'down':
        return { y: 0, opacity: 1 };
      case 'left':
      case 'right':
        return { x: 0, opacity: 1 };
      case 'fade':
        return { opacity: 1 };
      default:
        return { y: 0, opacity: 1 };
    }
  };

  return (
    <motion.div
      initial={getInitialPosition()}
      animate={getFinalPosition()}
      transition={{
        duration,
        delay,
        ease: [0.25, 0.46, 0.45, 0.94], // easeOutQuart
      }}
      className={cn(className)}
    >
      {children}
    </motion.div>
  );
};

interface StaggeredContainerProps {
  children: React.ReactNode;
  className?: string;
  staggerDelay?: number;
  direction?: 'up' | 'down' | 'left' | 'right' | 'fade';
}

const StaggeredContainer: React.FC<StaggeredContainerProps> = ({
  children,
  className,
  staggerDelay = 0.1,
  direction = 'up',
}) => {
  const childrenArray = React.Children.toArray(children);

  return (
    <div className={cn(className)}>
      {childrenArray.map((child, index) => (
        <AnimatedContainer
          key={index}
          delay={index * staggerDelay}
          direction={direction}
        >
          {child}
        </AnimatedContainer>
      ))}
    </div>
  );
};

interface SlideTransitionProps {
  children: React.ReactNode;
  isVisible: boolean;
  direction?: 'up' | 'down' | 'left' | 'right';
  className?: string;
}

const SlideTransition: React.FC<SlideTransitionProps> = ({
  children,
  isVisible,
  direction = 'up',
  className,
}) => {
  const getVariants = () => {
    const distance = 20;

    switch (direction) {
      case 'up':
        return {
          hidden: { y: distance, opacity: 0 },
          visible: { y: 0, opacity: 1 },
          exit: { y: -distance, opacity: 0 },
        };
      case 'down':
        return {
          hidden: { y: -distance, opacity: 0 },
          visible: { y: 0, opacity: 1 },
          exit: { y: distance, opacity: 0 },
        };
      case 'left':
        return {
          hidden: { x: distance, opacity: 0 },
          visible: { x: 0, opacity: 1 },
          exit: { x: -distance, opacity: 0 },
        };
      case 'right':
        return {
          hidden: { x: -distance, opacity: 0 },
          visible: { x: 0, opacity: 1 },
          exit: { x: distance, opacity: 0 },
        };
      default:
        return {
          hidden: { y: distance, opacity: 0 },
          visible: { y: 0, opacity: 1 },
          exit: { y: -distance, opacity: 0 },
        };
    }
  };

  return (
    <AnimatePresence mode="wait">
      {isVisible && (
        <motion.div
          variants={getVariants()}
          initial="hidden"
          animate="visible"
          exit="exit"
          transition={{
            duration: 0.3,
            ease: [0.25, 0.46, 0.45, 0.94],
          }}
          className={cn(className)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// 页面切换动画组件
interface PageTransitionProps {
  children: React.ReactNode;
  className?: string;
  direction?: 'horizontal' | 'vertical';
}

const PageTransition: React.FC<PageTransitionProps> = ({
  children,
  className,
  direction = 'horizontal',
}) => {
  const variants = {
    initial: {
      opacity: 0,
      x: direction === 'horizontal' ? 20 : 0,
      y: direction === 'vertical' ? 20 : 0,
    },
    animate: {
      opacity: 1,
      x: 0,
      y: 0,
    },
    exit: {
      opacity: 0,
      x: direction === 'horizontal' ? -20 : 0,
      y: direction === 'vertical' ? -20 : 0,
    },
  };

  return (
    <motion.div
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{
        duration: 0.4,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
      className={cn(className)}
    >
      {children}
    </motion.div>
  );
};

// 悬浮动画组件
interface FloatingElementProps {
  children: React.ReactNode;
  className?: string;
  intensity?: 'subtle' | 'normal' | 'strong';
}

const FloatingElement: React.FC<FloatingElementProps> = ({
  children,
  className,
  intensity = 'normal',
}) => {
  const getIntensityValues = () => {
    switch (intensity) {
      case 'subtle':
        return { scale: 1.02, y: -2 };
      case 'strong':
        return { scale: 1.08, y: -8 };
      default:
        return { scale: 1.05, y: -4 };
    }
  };

  const { scale, y } = getIntensityValues();

  return (
    <motion.div
      whileHover={{ scale, y }}
      transition={{
        type: 'spring',
        stiffness: 300,
        damping: 20,
      }}
      className={cn(className)}
    >
      {children}
    </motion.div>
  );
};

// 脉冲动画组件
interface PulseAnimationProps {
  children: React.ReactNode;
  className?: string;
  duration?: number;
  intensity?: number;
}

const PulseAnimation: React.FC<PulseAnimationProps> = ({
  children,
  className,
  duration = 2,
  intensity = 0.1,
}) => {
  return (
    <motion.div
      animate={{
        scale: [1, 1 + intensity, 1],
      }}
      transition={{
        duration,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
      className={cn(className)}
    >
      {children}
    </motion.div>
  );
};

// 打字机效果组件
interface TypewriterProps {
  text: string;
  className?: string;
  speed?: number;
  delay?: number;
  cursor?: boolean;
}

const Typewriter: React.FC<TypewriterProps> = ({
  text,
  className,
  speed = 50,
  delay = 0,
  cursor = true,
}) => {
  const [displayText, setDisplayText] = React.useState('');
  const [showCursor, setShowCursor] = React.useState(cursor);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      let index = 0;
      const interval = setInterval(() => {
        if (index < text.length) {
          setDisplayText(text.slice(0, index + 1));
          index++;
        } else {
          clearInterval(interval);
          if (cursor) {
            // 光标闪烁效果
            setInterval(() => {
              setShowCursor(prev => !prev);
            }, 500);
          }
        }
      }, speed);

      return () => clearInterval(interval);
    }, delay);

    return () => clearTimeout(timer);
  }, [text, speed, delay, cursor]);

  return (
    <span className={cn(className)}>
      {displayText}
      {cursor && (
        <motion.span
          animate={{ opacity: showCursor ? 1 : 0 }}
          transition={{ duration: 0.1 }}
          className="inline-block w-0.5 h-5 bg-current ml-1"
        />
      )}
    </span>
  );
};

export {
  AnimatedContainer,
  StaggeredContainer,
  SlideTransition,
  PageTransition,
  FloatingElement,
  PulseAnimation,
  Typewriter,
};
