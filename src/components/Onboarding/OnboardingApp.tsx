import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Info,
  KeyRound,
  Server,
  Sparkles,
  X,
} from 'lucide-react';

import { useAppConfigStore } from '@/stores/config-v2';
import { cn } from '@/lib/utils';

/**
 * First-run onboarding modal.
 *
 * Shown in the Options page when `onboardingCompleted === false`.
 * The extension ships with `enabled=false` and `onboardingCompleted=false`,
 * so new users see this modal the first time they open settings and never
 * get billed for VLM calls until they explicitly opt in.
 *
 * The modal has 3 steps:
 *  1. Welcome — what this is, what data goes where.
 *  2. Provider — pick OpenAI-compatible / Ollama / LM Studio.
 *  3. Ready — finish & enable.
 *
 * Design constraints (matching ConfirmDialog / PopupApp):
 *  - No Radix, no framer-motion — pure React + Tailwind.
 *  - Dark theme consistent with the rest of the extension.
 *  - `Skip` is offered as a secondary action; it sets
 *    `onboardingCompleted=true` without enabling translation.
 */

const STEPS = ['welcome', 'provider', 'ready'] as const;
type Step = (typeof STEPS)[number];

const stepIndex = (step: Step): number => STEPS.indexOf(step);

export interface OnboardingAppProps {
  /** Force display even when onboardingCompleted is true (used for the
   *  "show guide again" affordance in Options). */
  forceOpen?: boolean;
}

export const OnboardingApp: React.FC<OnboardingAppProps> = ({ forceOpen }) => {
  const onboardingCompleted = useAppConfigStore(
    state => state.onboardingCompleted
  );
  const provider = useAppConfigStore(state => state.provider);
  const setProvider = useAppConfigStore(state => state.setProvider);
  const setEnabled = useAppConfigStore(state => state.setEnabled);
  const setOnboardingCompleted = useAppConfigStore(
    state => state.setOnboardingCompleted
  );

  const [step, setStep] = useState<Step>('welcome');

  const visible = forceOpen === true || onboardingCompleted === false;

  const close = useCallback(() => {
    // Skipping marks onboarding as done so we don't pester again, but does
    // NOT enable translation. The user can still flip the switch manually.
    setOnboardingCompleted(true);
    setEnabled(false);
  }, [setEnabled, setOnboardingCompleted]);

  const goNext = useCallback(() => {
    const idx = stepIndex(step);
    if (idx < STEPS.length - 1) {
      const nextStep = STEPS[idx + 1];
      if (nextStep) {
        setStep(nextStep);
      }
    }
  }, [step]);

  const goBack = useCallback(() => {
    const idx = stepIndex(step);
    if (idx > 0) {
      const prevStep = STEPS[idx - 1];
      if (prevStep) {
        setStep(prevStep);
      }
    }
  }, [step]);

  const finish = useCallback(() => {
    setOnboardingCompleted(true);
    setEnabled(true);
  }, [setEnabled, setOnboardingCompleted]);

  // Keyboard navigation: Enter advances, Escape skips.
  useEffect(() => {
    if (!visible) {
      return;
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      } else if (e.key === 'Enter') {
        if (step === 'ready') {
          finish();
        } else {
          goNext();
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [close, finish, goNext, step, visible]);

  if (!visible) {
    return null;
  }

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4'
      role='presentation'
    >
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby='onboarding-title'
        className='relative w-full max-w-xl rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl'
      >
        <button
          type='button'
          onClick={close}
          className='absolute right-4 top-4 rounded-md p-1 text-slate-400 transition hover:bg-white/[0.05] hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400'
          aria-label='跳过引导'
        >
          <X className='h-4 w-4' />
        </button>

        <Stepper currentStep={step} />

        {step === 'welcome' && <WelcomeStep onNext={goNext} />}
        {step === 'provider' && (
          <ProviderStep
            currentProvider={provider}
            onSelect={type => setProvider(type)}
            onNext={goNext}
            onBack={goBack}
          />
        )}
        {step === 'ready' && (
          <ReadyStep
            provider={provider}
            onFinish={finish}
            onBack={goBack}
          />
        )}

        <div className='mt-6 flex items-center justify-between border-t border-white/5 pt-4'>
          <button
            type='button'
            onClick={close}
            className='text-xs text-slate-400 underline-offset-2 transition hover:text-slate-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400'
          >
            稍后再设置
          </button>
          {step !== 'welcome' && (
            <button
              type='button'
              onClick={goBack}
              className='rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-200 transition hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400'
            >
              上一步
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const Stepper: React.FC<{ currentStep: Step }> = ({ currentStep }) => {
  const idx = stepIndex(currentStep);
  const labels = ['欢迎', '选择后端', '准备就绪'];
  return (
    <div className='mb-5 flex items-center gap-2'>
      {STEPS.map((s, i) => (
        <React.Fragment key={s}>
          <div
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition',
              i < idx
                ? 'bg-cyan-500/20 text-cyan-300'
                : i === idx
                  ? 'bg-cyan-500 text-white'
                  : 'bg-white/5 text-slate-500'
            )}
          >
            {i < idx ? <CheckCircle2 className='h-3.5 w-3.5' /> : i + 1}
          </div>
          {i < STEPS.length - 1 && (
            <div
              className={cn(
                'h-px flex-1 transition',
                i < idx ? 'bg-cyan-500/40' : 'bg-white/10'
              )}
            />
          )}
        </React.Fragment>
      ))}
      <span className='sr-only'>{labels[idx]}</span>
    </div>
  );
};

const WelcomeStep: React.FC<{ onNext: () => void }> = ({ onNext }) => (
  <div className='space-y-4'>
    <div className='flex items-start gap-3'>
      <div className='rounded-xl bg-cyan-500/10 p-2.5 text-cyan-300'>
        <Sparkles className='h-5 w-5' />
      </div>
      <div>
        <h2
          id='onboarding-title'
          className='text-lg font-semibold text-white'
        >
          欢迎使用 Manga Translator
        </h2>
        <p className='mt-1 text-sm text-slate-400'>
          网页漫画的实时翻译阅读体验。译文覆盖在原图上，保留画风与排版。
        </p>
      </div>
    </div>

    <div className='rounded-xl border border-white/5 bg-white/[0.02] p-4'>
      <div className='flex items-start gap-3'>
        <Info className='mt-0.5 h-4 w-4 shrink-0 text-cyan-300' />
        <div className='text-sm text-slate-300'>
          <p className='font-medium text-white'>数据流向</p>
          <p className='mt-1 leading-relaxed text-slate-400'>
            你的 API Key 和配置只保存在本机
            <code className='mx-1 rounded bg-slate-800 px-1 py-0.5 text-xs'>
              chrome.storage.local
            </code>
            ，不随 Google 账户跨设备同步，也不发给本扩展作者。
            翻译时漫画图片会直接发到你配置的 Vision LLM 服务（OpenAI /
            Ollama / LM Studio），由该服务处理。
          </p>
        </div>
      </div>
    </div>

    <ul className='space-y-2 text-sm text-slate-300'>
      <li className='flex items-start gap-2'>
        <CheckCircle2 className='mt-0.5 h-4 w-4 shrink-0 text-cyan-300' />
        <span>翻译需要调用 VLM API，会产生相应费用（按 provider 计费）</span>
      </li>
      <li className='flex items-start gap-2'>
        <CheckCircle2 className='mt-0.5 h-4 w-4 shrink-0 text-cyan-300' />
        <span>本地模型（Ollama / LM Studio）可完全离线、零费用运行</span>
      </li>
      <li className='flex items-start gap-2'>
        <CheckCircle2 className='mt-0.5 h-4 w-4 shrink-0 text-cyan-300' />
        <span>所有配置可以稍后在设置页调整</span>
      </li>
    </ul>

    <button
      type='button'
      onClick={onNext}
      className='mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900'
    >
      下一步：选择后端
      <ArrowRight className='h-4 w-4' />
    </button>
  </div>
);

const PROVIDER_CARDS = [
  {
    type: 'openai-compatible' as const,
    name: 'OpenAI 兼容',
    description: '任何 OpenAI Chat Completions 端点。OpenAI 官方、SiliconFlow、OpenRouter 等都支持。',
    icon: Sparkles,
    requiresApiKey: true,
  },
  {
    type: 'ollama' as const,
    name: 'Ollama',
    description: '本地运行，隐私优先，零费用。需要本机有 GPU 或较强的 CPU。',
    icon: Server,
    requiresApiKey: false,
  },
  {
    type: 'lm-studio' as const,
    name: 'LM Studio',
    description: '本地 OpenAI 兼容服务器。LM Studio 提供图形界面，方便加载模型。',
    icon: Server,
    requiresApiKey: false,
  },
];

const ProviderStep: React.FC<{
  currentProvider: 'openai-compatible' | 'ollama' | 'lm-studio';
  onSelect: (type: 'openai-compatible' | 'ollama' | 'lm-studio') => void;
  onNext: () => void;
  onBack: () => void;
}> = ({ currentProvider, onSelect, onNext }) => (
  <div className='space-y-4'>
    <div>
      <h2 className='text-lg font-semibold text-white'>选择一个翻译后端</h2>
      <p className='mt-1 text-sm text-slate-400'>
        之后可以在设置页随时更换。先选一个最合适的。
      </p>
    </div>

    <div className='space-y-2'>
      {PROVIDER_CARDS.map(card => {
        const Icon = card.icon;
        const selected = currentProvider === card.type;
        return (
          <button
            key={card.type}
            type='button'
            onClick={() => onSelect(card.type)}
            className={cn(
              'flex w-full items-start gap-3 rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400',
              selected
                ? 'border-cyan-500/50 bg-cyan-500/10'
                : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
            )}
          >
            <div
              className={cn(
                'rounded-lg p-2',
                selected ? 'bg-cyan-500/20 text-cyan-200' : 'bg-white/5 text-slate-300'
              )}
            >
              <Icon className='h-4 w-4' />
            </div>
            <div className='flex-1'>
              <div className='flex items-center gap-2'>
                <span className='text-sm font-semibold text-white'>{card.name}</span>
                {card.requiresApiKey && (
                  <span className='inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300'>
                    <KeyRound className='h-3 w-3' />
                    需要 API Key
                  </span>
                )}
              </div>
              <p className='mt-0.5 text-xs leading-relaxed text-slate-400'>
                {card.description}
              </p>
            </div>
            {selected && (
              <CheckCircle2 className='h-5 w-5 shrink-0 text-cyan-300' />
            )}
          </button>
        );
      })}
    </div>

    <div className='rounded-lg border border-white/5 bg-white/[0.02] p-3 text-xs text-slate-400'>
      <p className='leading-relaxed'>
        💡 完成引导后，设置页会按你选的后端展开对应的配置（Base URL、模型名称、API Key）。
      </p>
    </div>

    <button
      type='button'
      onClick={onNext}
      className='inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900'
    >
      我选好了
      <ArrowRight className='h-4 w-4' />
    </button>
  </div>
);

const ReadyStep: React.FC<{
  provider: 'openai-compatible' | 'ollama' | 'lm-studio';
  onFinish: () => void;
  onBack: () => void;
}> = ({ provider, onFinish }) => {
  const activeCard = PROVIDER_CARDS.find(c => c.type === provider);
  return (
    <div className='space-y-4'>
      <div>
        <h2 className='text-lg font-semibold text-white'>准备就绪</h2>
        <p className='mt-1 text-sm text-slate-400'>
          现在点完成，会打开扩展并启用翻译。
        </p>
      </div>

      <div className='rounded-xl border border-white/10 bg-white/[0.02] p-4'>
        <div className='text-xs uppercase tracking-wide text-slate-500'>
          当前选择
        </div>
        <div className='mt-2 flex items-center gap-2'>
          <CheckCircle2 className='h-4 w-4 text-cyan-300' />
          <span className='text-sm font-medium text-white'>
            {activeCard?.name ?? provider}
          </span>
        </div>
        <a
          href='chrome://extensions/'
          target='_blank'
          rel='noreferrer'
          className='mt-3 inline-flex items-center gap-1 text-xs text-cyan-300 underline-offset-2 hover:underline'
        >
          打开扩展管理（确认已开启）
          <ExternalLink className='h-3 w-3' />
        </a>
      </div>

      <div className='rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-sm text-slate-300'>
        <p className='leading-relaxed'>
          接下来去你常去的漫画页，点浏览器右上角的 Manga Translator 图标 →
          <span className='font-medium text-white'>「翻译当前页面」</span>
          。第一次建议在测试页试试，确认无误后再翻整本。
        </p>
      </div>

      <button
        type='button'
        onClick={onFinish}
        className='inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900'
      >
        完成并启用翻译
        <CheckCircle2 className='h-4 w-4' />
      </button>
    </div>
  );
};

export default OnboardingApp;
