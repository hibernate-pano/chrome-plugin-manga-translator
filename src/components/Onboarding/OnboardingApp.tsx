import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Info, Sparkles, X } from 'lucide-react';

import { useAppConfigStore } from '@/stores/config-v2';
import { ENV_CONFIG } from '@/shared/env-config';
import { cn } from '@/lib/utils';

/**
 * First-run onboarding modal.
 *
 * Shown in the Options page when onboardingCompleted is false.
 * Personal builds can preload providers from .env. Public builds ship without
 * credentials and users configure a provider in Settings.
 */

const STEPS = ['welcome', 'ready'] as const;
type Step = (typeof STEPS)[number];

const stepIndex = (step: Step): number => STEPS.indexOf(step);

export interface OnboardingAppProps {
  forceOpen?: boolean;
}

export const OnboardingApp: React.FC<OnboardingAppProps> = ({ forceOpen }) => {
  const onboardingCompleted = useAppConfigStore(
    state => state.onboardingCompleted
  );
  const setEnabled = useAppConfigStore(state => state.setEnabled);
  const setOnboardingCompleted = useAppConfigStore(
    state => state.setOnboardingCompleted
  );

  const [step, setStep] = useState<Step>('welcome');

  const visible = forceOpen === true || onboardingCompleted === false;

  const close = useCallback(() => {
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

  const finish = useCallback(() => {
    setOnboardingCompleted(true);
    setEnabled(true);
  }, [setEnabled, setOnboardingCompleted]);

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
        {step === 'ready' && <ReadyStep onFinish={finish} />}

        <div className='mt-6 flex items-center justify-between border-t border-white/5 pt-4'>
          <button
            type='button'
            onClick={close}
            className='text-xs text-slate-400 underline-offset-2 transition hover:text-slate-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400'
          >
            稍后再设置
          </button>
          <span className='text-xs text-slate-600'>按 Esc 可跳过</span>
        </div>
      </div>
    </div>
  );
};

const Stepper: React.FC<{ currentStep: Step }> = ({ currentStep }) => {
  const idx = stepIndex(currentStep);
  const labels = ['欢迎', '准备就绪'];
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

// v1.1.1: surface every provider that has credentials injected from .env,
// instead of hardcoding MiniMax as "the default".
const configuredBackends = (): Array<{ label: string; detail: string }> => {
  const out: Array<{ label: string; detail: string }> = [];
  if (ENV_CONFIG.minimax.apiKey && ENV_CONFIG.minimax.model) {
    out.push({ label: 'MiniMax', detail: ENV_CONFIG.minimax.model });
  }
  if (ENV_CONFIG.opencode.apiKey && ENV_CONFIG.opencode.model) {
    out.push({
      label: 'OpenCodeGo · DeepSeek',
      detail: ENV_CONFIG.opencode.model,
    });
  }
  if (ENV_CONFIG.ollama.baseUrl && ENV_CONFIG.ollama.model) {
    out.push({ label: 'Ollama（本地）', detail: ENV_CONFIG.ollama.model });
  }
  return out;
};

const WelcomeStep: React.FC<{ onNext: () => void }> = ({ onNext }) => (
  <div className='space-y-4'>
    <div className='flex items-start gap-3'>
      <div className='rounded-xl bg-cyan-500/10 p-2.5 text-cyan-300'>
        <Sparkles className='h-5 w-5' />
      </div>
      <div>
        <h2 id='onboarding-title' className='text-lg font-semibold text-white'>
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
            个人构建可以从{' '}
            <code className='mx-1 rounded bg-slate-800 px-1 py-0.5 text-xs'>
              .env
            </code>
            预置后端；公开构建不包含任何私有 Key，需在设置页填写。 API Key
            只保存在本机，不会同步到 Google 账户。
          </p>
        </div>
      </div>
    </div>

    <div className='rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-sm'>
      <div className='font-medium text-cyan-100'>可用的翻译后端</div>
      {configuredBackends().length > 0 ? (
        <ul className='mt-1 space-y-1 text-slate-300'>
          {configuredBackends().map(b => (
            <li key={b.label} className='flex items-center gap-2'>
              <CheckCircle2 className='h-4 w-4 shrink-0 text-cyan-300' />
              <span>
                {b.label} ·{' '}
                <span className='font-mono text-xs text-slate-400'>
                  {b.detail}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className='mt-1 text-amber-400'>
          尚未预置云端后端：完成后请在设置页填写自己的 API Key。
        </p>
      )}
      <p className='mt-2 text-xs leading-relaxed text-slate-400'>
        本地 Ollama / LM Studio 无需 API Key；云端后端可在设置页配置。
      </p>
    </div>

    <button
      type='button'
      onClick={onNext}
      className='mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900'
    >
      下一步
      <ArrowRight className='h-4 w-4' />
    </button>
  </div>
);

const ReadyStep: React.FC<{ onFinish: () => void }> = ({ onFinish }) => (
  <div className='space-y-4'>
    <div>
      <h2 className='text-lg font-semibold text-white'>准备就绪</h2>
      <p className='mt-1 text-sm text-slate-400'>现在点完成，会启用翻译。</p>
    </div>

    <div className='rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-sm text-slate-300'>
      <p className='leading-relaxed'>
        接下来去你常去的漫画页，点浏览器右上角的 Manga Translator 图标 →
        <span className='font-medium text-white'>「翻译当前页面」</span>。
        第一次建议在测试页试试，确认无误后再翻整本。
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

export default OnboardingApp;
