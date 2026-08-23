import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { OnboardingApp } from './OnboardingApp';
import { useAppConfigStore } from '@/stores/config-v2';

/**
 * The store keeps a single shared instance across the test runner, so each
 * test must reset the persisted slice to a known initial state. The Zustand
 * `persist` middleware reads chrome.storage.local which is also shared —
 * the global `beforeEach` in src/test/setup.ts wipes that for us.
 */
function resetStore() {
  useAppConfigStore.setState({
    enabled: false,
    provider: 'openai-compatible',
    onboardingCompleted: false,
    openaiCompatible: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
    ollama: { apiKey: '', baseUrl: 'http://localhost:11434', model: 'llava' },
    lmStudio: { apiKey: '', baseUrl: 'http://localhost:1234/v1', model: '' },
  } as never);
}

describe('OnboardingApp', () => {
  beforeEach(() => {
    resetStore();
  });

  it('renders when onboardingCompleted is false', () => {
    render(<OnboardingApp />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/欢迎使用 Manga Translator/)).toBeInTheDocument();
  });

  it('does not render when onboardingCompleted is true', () => {
    useAppConfigStore.setState({ onboardingCompleted: true } as never);
    const { container } = render(<OnboardingApp />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders even when onboardingCompleted is true if forceOpen', () => {
    useAppConfigStore.setState({ onboardingCompleted: true } as never);
    render(<OnboardingApp forceOpen />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('advances through provider and ready steps', async () => {
    const user = userEvent.setup();
    render(<OnboardingApp />);

    // Step 1: welcome → next
    expect(screen.getByText(/欢迎使用 Manga Translator/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /下一步：选择后端/ }));

    // Step 2: provider — pick Ollama
    expect(screen.getByRole('heading', { name: '选择一个翻译后端' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Ollama/ }));
    expect(useAppConfigStore.getState().provider).toBe('ollama');
    await user.click(screen.getByRole('button', { name: /我选好了/ }));

    // Step 3: ready → finish
    expect(screen.getByRole('heading', { name: '准备就绪' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /完成并启用翻译/ }));

    const state = useAppConfigStore.getState();
    expect(state.onboardingCompleted).toBe(true);
    expect(state.enabled).toBe(true);
  });

  it('skip dismisses the modal without enabling translation', async () => {
    const user = userEvent.setup();
    render(<OnboardingApp />);

    await user.click(screen.getByRole('button', { name: /稍后再设置/ }));

    const state = useAppConfigStore.getState();
    expect(state.onboardingCompleted).toBe(true);
    expect(state.enabled).toBe(false);
  });

  it('Escape key dismisses the modal (acts like skip)', async () => {
    const user = userEvent.setup();
    render(<OnboardingApp />);

    await user.keyboard('{Escape}');

    const state = useAppConfigStore.getState();
    expect(state.onboardingCompleted).toBe(true);
    expect(state.enabled).toBe(false);
  });
});
