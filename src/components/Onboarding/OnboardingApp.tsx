import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, Info, Sparkles, X } from 'lucide-react';

import { useAppConfigStore } from '@/stores/config-v2';
import { configuredBackends } from '@/shared/env-backends';
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

/**
 * The element each step's description lives in.
 *
 * `aria-modal="true"` says the rest of the page is inert to a screen
 * reader, but it does not make it inert — a reader that lands on the
 * dialog is told what the dialog is, and nothing about what it is about.
 * `aria-describedby` is the other half of the sentence.
 */
const STEP_DESCRIPTION_ID: Record<Step, string> = {
  welcome: 'onboarding-description-welcome',
  ready: 'onboarding-description-ready',
};

/**
 * The elements a keyboard user can Tab to inside the dialog.
 *
 * The list is queried at the moment the key is pressed, so it always reflects
 * what is actually on screen — the wizard's buttons change from step to step.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface OnboardingAppProps {
  forceOpen?: boolean;
  /**
   * Called when the wizard closes, however it closed.
   *
   * `forceOpen` keeps the dialog on screen no matter what
   * `onboardingCompleted` says, so the parent has to be told to take it back
   * down — otherwise the user can only dismiss a re-opened wizard by
   * reloading the page.
   */
  onClose?: () => void;
}

export const OnboardingApp: React.FC<OnboardingAppProps> = ({
  forceOpen,
  onClose,
}) => {
  const onboardingCompleted = useAppConfigStore(
    state => state.onboardingCompleted
  );
  const setEnabled = useAppConfigStore(state => state.setEnabled);
  const setOnboardingCompleted = useAppConfigStore(
    state => state.setOnboardingCompleted
  );
  const providers = useAppConfigStore(state => state.providers);
  const activeProvider = useAppConfigStore(state => state.provider);

  /**
   * Is there something to translate with?
   *
   * The build-time backends are one thing; the user's own configuration is
   * another. A public build ships no credentials, so the honest question is
   * whether *this* user has a key (or has chosen a local provider).
   */
  const hasUsableProvider =
    (providers['openai-compatible']?.apiKey ?? '').trim().length > 0 ||
    activeProvider === 'ollama' ||
    activeProvider === 'lm-studio';

  /**
   * Does the translation happen on this machine?
   *
   * It matters because the two cases cost different things and leak
   * different things: a local backend keeps the images on the machine and
   * costs nothing, a hosted one uploads every page and bills the user.
   * Saying "翻译会调用你配置的服务商并产生费用" to someone running Ollama
   * locally is wrong on both counts — and it is wrong exactly where the
   * user is deciding whether to trust this thing with their comic.
   */
  const isLocalProvider =
    activeProvider === 'ollama' || activeProvider === 'lm-studio';

  const [step, setStep] = useState<Step>('welcome');
  const dialogRef = useRef<HTMLDivElement | null>(null);
  /**
   * The element that had focus before the wizard opened.
   *
   * A modal that swallows the keyboard has to give it back: the user closes
   * it and finds themselves at the top of the page with no idea where the
   * cursor went.
   */
  const previouslyFocused = useRef<HTMLElement | null>(null);
  /**
   * The latest `onClose`.
   *
   * Held in a ref so the handlers below do not have to change identity when
   * the parent re-renders — the keydown effect depends on `close`, and a
   * fresh `close` on every render would tear the listener down and set it up
   * again for nothing.
   */
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const visible = forceOpen === true || onboardingCompleted === false;

  /**
   * Dismiss the wizard without touching the extension's on/off switch.
   *
   * It used to switch the extension off as well, which silently turned off
   * an extension the user had already configured and enabled: pressing Esc
   * to get the dialog out of the way left the extension dead, and nothing
   * on screen said so. A fresh install is off by default anyway
   * (`DEFAULT_CONFIG.enabled` is false), so dropping the call changes
   * nothing for a first run and stops breaking an existing setup.
   */
  const close = useCallback(() => {
    setOnboardingCompleted(true);
    onCloseRef.current?.();
  }, [setOnboardingCompleted]);

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
    onCloseRef.current?.();
  }, [setEnabled, setOnboardingCompleted]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    /**
     * Escape closes; Tab stays inside the dialog.
     *
     * Enter is deliberately *not* handled here. The wizard used to listen for
     * it on `window`, which meant a stray Enter in a field on the settings
     * page behind the modal advanced the wizard — and on the last step it
     * finished the wizard, which enables the extension and starts billing.
     * The primary button is focused when the modal opens, so Enter activates
     * *that* button and nothing else.
     */
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== 'Tab') {
        return;
      }
      const dialog = dialogRef.current;
      if (!dialog) {
        return;
      }
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter(
        element =>
          element.offsetParent !== null || element === document.activeElement
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        return;
      }
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialog.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [close, visible]);

  /**
   * Remember what had focus before the wizard opened, and hand it back when
   * the wizard closes.
   *
   * This is a *separate* job from moving the focus inside the dialog, and it
   * used to be done in the same effect. The consequence was that every step
   * change overwrote the remembered element with the dialog's own button —
   * so by the time the wizard closed, the "previously focused" element was a
   * button that no longer existed, and the keyboard was dropped on the floor
   * instead of being handed back to the button that opened the wizard.
   */
  useEffect(() => {
    if (!visible) {
      const target = previouslyFocused.current;
      previouslyFocused.current = null;
      if (target?.isConnected) {
        target.focus();
      }
      return;
    }
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }, [visible]);

  /**
   * Put the keyboard on the primary action.
   *
   * The focus moves again on every step, because the primary action changes:
   * 「下一步」 becomes 「完成并启用翻译」, and a keyboard user should not have
   * to Tab across the dialog to find it.
   */
  useEffect(() => {
    if (!visible) {
      return;
    }
    const primary = dialogRef.current?.querySelector<HTMLElement>(
      '[data-onboarding-primary]'
    );
    primary?.focus();
  }, [visible, step]);

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
        aria-describedby={STEP_DESCRIPTION_ID[step]}
        ref={dialogRef}
        className='relative w-full max-w-xl rounded-2xl border border-white/25 bg-slate-900 p-6 shadow-2xl'
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

        {step === 'welcome' && (
          <WelcomeStep
            onNext={goNext}
            descriptionId={STEP_DESCRIPTION_ID.welcome}
          />
        )}
        {step === 'ready' && (
          <ReadyStep
            onFinish={finish}
            onConfigure={close}
            hasProvider={hasUsableProvider}
            localProvider={isLocalProvider}
            descriptionId={STEP_DESCRIPTION_ID.ready}
          />
        )}

        <div className='mt-6 flex items-center justify-between border-t border-white/15 pt-4'>
          <button
            type='button'
            onClick={close}
            className='text-xs text-slate-400 underline-offset-2 transition hover:text-slate-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400'
          >
            稍后再设置
          </button>
          <span className='text-xs text-slate-400'>按 Esc 可跳过</span>
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
                  : 'bg-white/5 text-slate-400'
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

/*
 * v1.1.1: surface every provider that has credentials injected from .env,
 * instead of hardcoding MiniMax as "the default".
 *
 * The list itself lives in `@/shared/env-backends`, because the settings
 * page has to answer the same question — "does this build come with a
 * backend?" — and it used to answer it wrongly.
 */

const WelcomeStep: React.FC<{
  onNext: () => void;
  descriptionId: string;
}> = ({ onNext, descriptionId }) => (
  <div className='space-y-4'>
    <div className='flex items-start gap-3'>
      <div className='rounded-xl bg-cyan-500/10 p-2.5 text-cyan-300'>
        <Sparkles className='h-5 w-5' />
      </div>
      <div>
        <h2 id='onboarding-title' className='text-lg font-semibold text-white'>
          欢迎使用漫画翻译助手
        </h2>
        <p className='mt-1 text-sm text-slate-400'>
          网页漫画的实时翻译阅读体验。译文覆盖在原图上，保留画风与排版。
        </p>
      </div>
    </div>

    {/*
      The disclosure that has to be here.

      The settings page carries a dismissible banner about data leaving the
      machine, and the store listing spells it out. But the banner is easy to
      dismiss and this is the one screen the user reads *at the moment they
      enable the extension* — so the facts belong here, in the same breath as
      the button that turns it on. A user who does not know their comic pages
      are being sent to a paid API has no way to find out later.
    */}
    <div
      id={descriptionId}
      className='rounded-xl border border-white/20 bg-slate-950 p-4'
    >
      <div className='flex items-start gap-3'>
        <Info className='mt-0.5 h-4 w-4 shrink-0 text-cyan-300' />
        <div className='text-sm text-slate-300'>
          <p className='font-medium text-white'>数据流向与费用</p>
          {/*
            两句话，两种情况。

            这一屏在用户还没选服务商时出现，所以不能按"当前后端"分岔 ——
            但那两条旧文案是无条件陈述的：「图片会离开这台机器」「这会产生
            费用」。用 Ollama / LM Studio 的用户读到的每一个字都是假的，
            而"若希望图片不离开本机…"只是补丁，不是陈述。分岔写在条件句
            里，选哪种后端都为真。
          */}
          <ul className='mt-2 space-y-1.5 leading-relaxed text-slate-400'>
            <li>
              用云端服务时：你正在阅读的页面上的漫画图片会被发送给你选择的 AI
              服务，图片会离开这台机器，并按该服务的计费标准产生费用。
            </li>
            <li>
              用本地服务（Ollama / LM Studio）时：翻译在你自己的电脑上完成，
              图片不离开这台机器，也不产生服务商费用。
            </li>
            <li>
              扩展开发者不收集、不接收、不存储任何数据，也不架设服务器； 你的
              API Key 只保存在本机，不会同步到 Google 账户。
            </li>
          </ul>
        </div>
      </div>
    </div>

    <div className='rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-sm'>
      <div className='font-medium text-cyan-100'>已预置的后端</div>
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
          还没有预置任何后端：最后一步会带你去设置页填写自己的 API Key。
        </p>
      )}
      <p className='mt-2 text-xs leading-relaxed text-slate-400'>
        本地 Ollama / LM Studio 无需 API Key，但需要你自己启动服务并拉好模型；
        云端后端可在设置页配置。
      </p>
    </div>

    <button
      type='button'
      onClick={onNext}
      data-onboarding-primary='true'
      className='mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-cyan-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900'
    >
      下一步
      <ArrowRight className='h-4 w-4' />
    </button>
  </div>
);

const ReadyStep: React.FC<{
  onFinish: () => void;
  /**
   * Take the user to the configuration instead of finishing.
   *
   * The wizard is a modal on top of the Settings page, so "go and fill in
   * your API key" is one click away — but only if the wizard gets out of the
   * way first.
   */
  onConfigure: () => void;
  hasProvider: boolean;
  /**
   * Whether the translation runs on this machine.
   *
   * The last thing the wizard says before the button that turns the
   * extension on has to be true about the thing the button does. A local
   * backend keeps the images here and costs nothing; a hosted one uploads
   * every page and bills the user. One sentence cannot be true for both.
   */
  localProvider: boolean;
  descriptionId: string;
}> = ({ onFinish, onConfigure, hasProvider, localProvider, descriptionId }) => (
  <div className='space-y-4'>
    <div>
      <h2 id='onboarding-title' className='text-lg font-semibold text-white'>
        {hasProvider ? '准备就绪' : '还差一步'}
      </h2>
      {/*
        The disclosure, on the screen where the user turns the extension on.

        The settings page carries a dismissible banner about data leaving
        the machine, and the store listing spells it out. But the banner is
        easy to dismiss and this is the one screen the user reads *at the
        moment they enable the extension* — so the facts belong here, in
        the same breath as the button that turns it on.
      */}
      <div id={descriptionId} className='mt-1 space-y-2 text-sm text-slate-400'>
        {hasProvider ? (
          localProvider ? (
            <p>
              现在点完成，会启用翻译。翻译会在你的电脑上完成，图片不会离开本机，
              也不产生服务商费用。
            </p>
          ) : (
            <>
              <p>
                现在点完成，会启用翻译。你的漫画图片会原样上传到你配置的 Vision
                LLM 服务进行识别与翻译，图片内容会离开你的浏览器，
                并按该服务的计费规则产生费用。
              </p>
              <p>
                如果页面内容敏感，请改用本地 Ollama / LM
                Studio（图片不离开本机，也不产生服务商费用）。
              </p>
            </>
          )
        ) : (
          <p>
            还没有可以用的翻译后端。关掉这一步，页面会自动跳到「翻译后端」——
            在那里选一个服务商，填上它给你的 API Key（本地 Ollama / LM Studio
            不需要 Key）就能开始。
          </p>
        )}
      </div>
    </div>

    <div className='rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-sm text-slate-300'>
      <p className='leading-relaxed'>
        接下来去你常去的漫画页，点浏览器右上角的{' '}
        <span className='font-medium text-white'>扩展图标</span>
        （一个带地球的对话气泡）→ 打开弹窗 → 点
        <span className='font-medium text-white'>「翻译当前页面」</span>。
        工具栏上找不到它？点地址栏右侧的
        <span className='font-medium text-white'>拼图按钮</span>
        ，在列表里把它固定住。 译文会直接覆盖在原图上；按住 Alt
        键可临时切回原文。
      </p>
      <p className='mt-3 leading-relaxed'>
        不想点按钮？页面上右键就有
        <span className='font-medium text-white'>「翻译当前页面」</span>和
        <span className='font-medium text-white'>「翻译这张图片」</span>；键盘
        快捷键是 Ctrl/⌘+Shift+Y（翻译）、+X（忽略缓存重翻）、+E（清除覆盖层）、
        +S（开关译文阅读面板）。
      </p>
    </div>

    {/*
      Finishing with no provider behind it turns the extension on with
      nothing to translate with, and the popup's primary button then says
      「还没有配置 MiniMax」 — so the user is left with an enabled extension
      that does nothing and a dead button.
    */}
    <button
      type='button'
      onClick={hasProvider ? onFinish : onConfigure}
      data-onboarding-primary='true'
      className='inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900'
    >
      {hasProvider ? '完成并启用翻译' : '去填写 API Key'}
      {hasProvider ? (
        <CheckCircle2 className='h-4 w-4' />
      ) : (
        <ArrowRight className='h-4 w-4' />
      )}
    </button>
  </div>
);

export default OnboardingApp;
