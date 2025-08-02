import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '../components/theme-provider';
import { LayoutContainer, LayoutHeader, LayoutSection } from '../components/ui/layout';
import { Navigation } from '../components/ui/navigation';
import { AnimatedContainer } from '../components/ui/animated-container';

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => children,
}));

describe('布局组件测试', () => {
  describe('LayoutContainer', () => {
    it('应该正确渲染容器', () => {
      render(
        <LayoutContainer maxWidth="md">
          <div>测试内容</div>
        </LayoutContainer>
      );
      
      expect(screen.getByText('测试内容')).toBeInTheDocument();
    });

    it('应该应用正确的最大宽度类', () => {
      const { container } = render(
        <LayoutContainer maxWidth="lg">
          <div>测试内容</div>
        </LayoutContainer>
      );
      
      expect(container.firstChild).toHaveClass('max-w-lg');
    });
  });

  describe('LayoutHeader', () => {
    it('应该正确渲染标题和副标题', () => {
      render(
        <LayoutHeader
          title="测试标题"
          subtitle="测试副标题"
        />
      );
      
      expect(screen.getByText('测试标题')).toBeInTheDocument();
      expect(screen.getByText('测试副标题')).toBeInTheDocument();
    });

    it('应该正确渲染操作按钮', () => {
      render(
        <LayoutHeader
          title="测试标题"
          actions={<button>操作按钮</button>}
        />
      );
      
      expect(screen.getByText('操作按钮')).toBeInTheDocument();
    });
  });

  describe('LayoutSection', () => {
    it('应该正确渲染默认变体', () => {
      render(
        <LayoutSection title="测试部分">
          <div>部分内容</div>
        </LayoutSection>
      );
      
      expect(screen.getByText('测试部分')).toBeInTheDocument();
      expect(screen.getByText('部分内容')).toBeInTheDocument();
    });

    it('应该正确渲染卡片变体', () => {
      render(
        <LayoutSection title="测试部分" variant="card">
          <div>卡片内容</div>
        </LayoutSection>
      );
      
      expect(screen.getByText('测试部分')).toBeInTheDocument();
      expect(screen.getByText('卡片内容')).toBeInTheDocument();
    });
  });

  describe('Navigation', () => {
    const mockItems = [
      {
        id: 'item1',
        label: '项目1',
        icon: <span>图标1</span>,
      },
      {
        id: 'item2',
        label: '项目2',
        icon: <span>图标2</span>,
        badge: '新',
      },
    ];

    it('应该正确渲染导航项目', () => {
      const mockOnClick = vi.fn();
      
      render(
        <Navigation
          items={mockItems}
          activeItem="item1"
          onItemClick={mockOnClick}
        />
      );
      
      expect(screen.getByText('项目1')).toBeInTheDocument();
      expect(screen.getByText('项目2')).toBeInTheDocument();
      expect(screen.getByText('新')).toBeInTheDocument();
    });

    it('应该正确处理点击事件', () => {
      const mockOnClick = vi.fn();
      
      render(
        <Navigation
          items={mockItems}
          activeItem="item1"
          onItemClick={mockOnClick}
        />
      );
      
      const item2Button = screen.getByText('项目2').closest('button');
      item2Button?.click();
      
      expect(mockOnClick).toHaveBeenCalledWith('item2');
    });
  });

  describe('AnimatedContainer', () => {
    it('应该正确渲染动画容器', () => {
      render(
        <AnimatedContainer direction="up">
          <div>动画内容</div>
        </AnimatedContainer>
      );
      
      expect(screen.getByText('动画内容')).toBeInTheDocument();
    });
  });

  describe('主题集成', () => {
    it('应该在主题提供者中正确工作', () => {
      render(
        <ThemeProvider>
          <LayoutContainer>
            <LayoutHeader title="主题测试" />
            <LayoutSection title="内容部分">
              <div>主题化内容</div>
            </LayoutSection>
          </LayoutContainer>
        </ThemeProvider>
      );
      
      expect(screen.getByText('主题测试')).toBeInTheDocument();
      expect(screen.getByText('内容部分')).toBeInTheDocument();
      expect(screen.getByText('主题化内容')).toBeInTheDocument();
    });
  });
});
