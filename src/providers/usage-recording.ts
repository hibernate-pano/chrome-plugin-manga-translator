import { useUsageStore } from '@/stores/usage-store';
import type { ProviderType, TokenUsageInfo } from './base';

/**
 * Record one request the provider has already billed for.
 *
 * A 2xx means the model ran and the service billed for it. Everything that
 * goes wrong *after* that — a body we cannot read, a truncated answer, a
 * model that ignored the format — is a request the user already paid for.
 * The error is flattened into a string on its way back to the content
 * script, so the provider is the last place that still knows what the
 * request cost; recording it here is what keeps the bill honest.
 *
 * Every provider family uses this one function. When only the
 * OpenAI-compatible one had it, a local model and a cloud model disagreed
 * about what counts as a request, and the usage panel — which is the number
 * the user reads as their bill — under-counted for half of them.
 *
 * ## What counts as a request
 *
 * The rule has to be written down, because the shape of a response does not
 * say it:
 *
 * - **A 4xx is not recorded.** The provider refused; the model did not run.
 * - **A 2xx that carries an *error* is not recorded.** The service is
 *   reporting a refusal under a success status. The model did not run.
 * - **A 2xx that carries a *model answer* is recorded**, even when the
 *   answer cannot be read — an empty body, a truncated body, prose where
 *   JSON was asked for. The model ran and the tokens were spent.
 * - **A 408 is recorded** when the request ran a model: the provider may
 *   well have run it and answered too late for us to hear, and the user
 *   paid for it whether or not we ever saw the answer. A 408 on a request
 *   that never ran a model — listing the models a gateway has — is not
 *   recorded: there was nothing to run and nothing to pay for.
 * - **A network error is not recorded.** The client cannot tell a connection
 *   that died before the request was sent (a DNS failure, a refused port)
 *   from one that died after the provider had already run the model. Not
 *   counting it under-reports in the rare second case; counting it would
 *   over-report in the common first one. The number is an upper bound on
 *   what the provider charged, never a guess in the user's favour.
 *
 * Between them, the provider and the worker record every request that
 * cost money exactly once, and nothing else. Two records for one request
 * would over-report the bill; none would hide it.
 *
 * The bookkeeping must never turn a translation failure into a crash, so a
 * failure here is logged and swallowed.
 */
export function recordBilledRequest(
  provider: ProviderType,
  usage: TokenUsageInfo | null
): void {
  try {
    useUsageStore.getState().addRecord({
      provider,
      usage: usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      cached: false,
    });
  } catch (error) {
    console.error('[Usage] failed to record a billed request:', error);
  }
}

/**
 * 这次失败的请求，服务商还会收钱吗？
 *
 * 只有超时算。请求已经送到服务商手里，模型已经在算这张图，客户端只是
 * 不想再等了 —— 这笔钱已经花掉，不记就是少报。
 *
 * 其余情况都不记：
 * - 401 / 429 / 400 之类的拒绝：模型没有跑，没有计费；
 * - 根本没有发出去的失败（后台无响应、断网、DNS 失败）：钱没有花。
 *
 * 5xx 也不记：服务端自己出错时，模型通常没有产出，主流服务商不计费。
 * 宁可少记一次 5xx，也不要把「服务商拒绝的请求」也记成用户花了钱。
 */
export function isAbandonedRequest(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  return (error as { status?: unknown }).status === 408;
}
