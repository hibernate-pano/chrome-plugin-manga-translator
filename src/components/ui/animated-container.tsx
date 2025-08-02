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

export { AnimatedContainer, StaggeredContainer, SlideTransition };
