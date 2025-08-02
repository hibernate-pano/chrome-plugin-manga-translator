import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TranslationToggle from '../components/Popup/TranslationToggle';
import LanguageSelector from '../components/Popup/LanguageSelector';
import StyleSlider from '../components/Popup/StyleSlider';
import ModeSelector from '../components/Popup/ModeSelector';
import ApiKeyInput from '../components/Popup/ApiKeyInput';

describe('重构后的组件测试', () => {
  describe('TranslationToggle', () => {
    it('应该正确渲染和响应点击', () => {
      const mockOnChange = vi.fn();
      render(<TranslationToggle enabled={false} onChange={mockOnChange} />);

      expect(screen.getByText('启用翻译')).toBeInTheDocument();

      const toggle = screen.getByRole('switch');
      fireEvent.click(toggle);

      expect(mockOnChange).toHaveBeenCalledWith(true);
    });
  });

  describe('LanguageSelector', () => {
    it('应该正确渲染语言选项', () => {
      const mockOnChange = vi.fn();
      render(<LanguageSelector language="zh-CN" onChange={mockOnChange} />);

      expect(screen.getByText('目标语言')).toBeInTheDocument();
      expect(screen.getByText('简体中文')).toBeInTheDocument();
    });
  });

  describe('StyleSlider', () => {
    it('应该正确显示当前值', () => {
      const mockOnChange = vi.fn();
      render(<StyleSlider value={75} onChange={mockOnChange} />);

      expect(screen.getByText('样式保持程度')).toBeInTheDocument();
      expect(screen.getByText('75%')).toBeInTheDocument();
      expect(screen.getByText('更清晰')).toBeInTheDocument();
      expect(screen.getByText('更美观')).toBeInTheDocument();
    });
  });

  describe('ModeSelector', () => {
    it('应该正确渲染模式选项', () => {
      const mockOnChange = vi.fn();
      render(<ModeSelector mode="manual" onChange={mockOnChange} />);

      expect(screen.getByText('翻译模式')).toBeInTheDocument();
      expect(screen.getByText('手动翻译')).toBeInTheDocument();
      expect(screen.getByText('自动翻译')).toBeInTheDocument();
      expect(screen.getByText('手动模式：点击漫画图像进行翻译')).toBeInTheDocument();
    });
  });

  describe('ApiKeyInput', () => {
    it('应该正确渲染API密钥输入', () => {
      const mockOnChange = vi.fn();
      render(<ApiKeyInput apiKey="" onChange={mockOnChange} providerType="openai" />);

      expect(screen.getByText('OpenAI 密钥')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('输入您的OpenAI密钥')).toBeInTheDocument();
    });

    it('应该验证OpenAI密钥格式', () => {
      const mockOnChange = vi.fn();
      render(<ApiKeyInput apiKey="invalid-key" onChange={mockOnChange} providerType="openai" />);

      expect(screen.getByText('OpenAI API密钥应以"sk-"开头')).toBeInTheDocument();
    });

    it('应该显示有效密钥状态', async () => {
      const mockOnChange = vi.fn();
      const validKey = 'sk-' + 'x'.repeat(40);
      render(<ApiKeyInput apiKey={validKey} onChange={mockOnChange} providerType="openai" />);

      // 等待异步验证完成
      await screen.findByText('✓ 密钥格式正确');
    });
  });
});
