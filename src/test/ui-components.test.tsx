import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

describe('shadcn/ui 组件测试', () => {
  it('Button 组件应该正常渲染', () => {
    render(<Button>测试按钮</Button>);
    expect(screen.getByRole('button')).toHaveTextContent('测试按钮');
  });

  it('Card 组件应该正常渲染', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>测试卡片</CardTitle>
        </CardHeader>
        <CardContent>
          <p>卡片内容</p>
        </CardContent>
      </Card>
    );
    expect(screen.getByText('测试卡片')).toBeInTheDocument();
    expect(screen.getByText('卡片内容')).toBeInTheDocument();
  });

  it('Input 组件应该正常渲染', () => {
    render(<Input placeholder="测试输入框" />);
    expect(screen.getByPlaceholderText('测试输入框')).toBeInTheDocument();
  });

  it('Button 变体应该应用正确的样式', () => {
    render(<Button variant="destructive">危险按钮</Button>);
    const button = screen.getByRole('button');
    expect(button).toHaveClass('bg-destructive');
  });
});
