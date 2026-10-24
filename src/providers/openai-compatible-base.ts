/**
 * OpenAI-Compatible Provider Base
 *
 * 所有兼容 OpenAI Chat Completions API 的 provider 共享基类。
 * 子类只需提供 name/type/defaults 和是否强制要求 auth。
 */

import {
  VisionProvider,
  VisionResponse,
  ValidationResult,
  parseImageData,
  createApiError,
  getMangaTranslationPrompt,
  parseVisionResponse,
  BaseVisionProvider,
} from './base';
import type { TokenUsageInfo } from './base';
import { recordBilledRequest } from './usage-recording';
import { REQUEST_LIMITS } from './constants';
import { httpRequest } from '@/utils/http-client';
import type { TranslationStylePreset } from '@/utils/translation-style';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentPart[];
}

interface ChatContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'low' | 'high' | 'auto';
  };
}

interface ChatResponse {
  choices: Array<{
    message: { content: string };
  }>;
  /**
   * The token counts the service reports.
   *
   * Every OpenAI-compatible service returns this, and it is the only number
   * the extension has that says what a request actually cost. It used to be
   * dropped on the floor here: the response was parsed and the usage was
   * thrown away, so the usage store never received a record, and the popup's
   * 「本月 N 次 API 调用」 said zero for the rest of the user's life no
   * matter how much they were billed.
   */
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message: string;
    type: string;
    code: string;
  };
}

const MINIMAX_M3_MODEL_PATTERN = /^minimax-m3(?:$|[-.:/])/i;

/**
 * The token counts, in the shape the usage store records them.
 *
 * A service that reports no usage at all returns null, and the caller
 * records nothing — the alternative would be recording a zero, which would
 * make a request that cost real money look like a free one.
 *
 * The rule is all-or-nothing: if one of the three numbers is not a number,
 * none of them are recorded. A half-trusted total is worse than no total,
 * because it is the number the user reads as their bill.
 */
function normalizeUsage(usage: ChatResponse['usage']): TokenUsageInfo | null {
  if (!usage) {
    return null;
  }
  const promptTokens = Number(usage.prompt_tokens ?? 0);
  const completionTokens = Number(usage.completion_tokens ?? 0);
  const totalTokens = Number(
    usage.total_tokens ?? promptTokens + completionTokens
  );
  if (
    !Number.isFinite(promptTokens) ||
    !Number.isFinite(completionTokens) ||
    !Number.isFinite(totalTokens)
  ) {
    return null;
  }
  return { promptTokens, completionTokens, totalTokens };
}

/**
 * Default timeout for a cloud translation request.
 *
 * 30 s used to be the ceiling, and it was too low for what this client asks
 * for: the image goes out with `detail: 'high'` and the model may produce up
 * to MAX_TOKENS of JSON, so a dense page realistically needs 40-90 s. When
 * the client gave up first, the user saw "translation failed" and the
 * provider still billed for the request — the worst of both outcomes.
 *
 * 90 s is the p95 of a dense page and stays below the local providers' own
 * 120 s budget (a local model is slower, a cloud model is not that slow).
 * The cost of waiting too long is a slower failure; the cost of giving up
 * too early is money spent for nothing, so the timeout errs long.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 90_000;

/**
 * 记下一次「服务商已经计费」的请求。
 *
 * 响应是 200，说明模型跑了、服务商也扣了钱，坏掉的只是我们读不懂这个
 * 回答（截断的 JSON、纯文字说明、没按格式返回）。后台会把错误拍平成
 * 一个字符串再交给内容脚本，所以这里是最后一个还知道「这次请求花了钱」
 * 的地方；在这里补记一次，账单才不会是假的。
 *
 * 实现放在 `./usage-recording`，因为 Ollama 走的是另一条路，但「回答
 * 读不懂」这件事是一样的，两个服务商对「什么算一次请求」不能各说各话。
 */

function isMiniMaxM3Model(model: string | undefined): boolean {
  return Boolean(model && MINIMAX_M3_MODEL_PATTERN.test(model.trim()));
}

export abstract class OpenAICompatibleProvider
  extends BaseVisionProvider
  implements VisionProvider
{
  override async analyzeAndTranslate(
    imageBase64: string,
    targetLanguage: string,
    translationStylePreset?: TranslationStylePreset,
    isHybridRegions?: boolean
  ): Promise<VisionResponse> {
    this.ensureConfigured();

    const prompt = getMangaTranslationPrompt(
      targetLanguage,
      translationStylePreset,
      isHybridRegions
    );
    const imageData = parseImageData(imageBase64);
    const imageUrl = `data:${imageData.mediaType};base64,${imageData.base64}`;

    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
        ],
      },
    ];

    const headers: Record<string, string> = {};
    const apiKey = this.config.apiKey;
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else if (this.requiresAuth()) {
      throw new Error(`请配置 ${this.name} API 密钥`);
    }

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      temperature: REQUEST_LIMITS.TEMPERATURE,
    };

    if (isMiniMaxM3Model(this.config.model)) {
      // Manga translation is structured extraction, not open-ended reasoning.
      // M3's default thinking mode can spend the whole completion budget on
      // <think> text without returning the required JSON.
      body['max_completion_tokens'] = REQUEST_LIMITS.MAX_TOKENS;
      body['reasoning_split'] = true;
      body['thinking'] = { type: 'disabled' };
    } else {
      body['max_tokens'] = REQUEST_LIMITS.MAX_TOKENS;
    }

    const httpResponse = await httpRequest<ChatResponse>(
      `${this.config.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers,
        body,
        timeout: this.getRequestTimeoutMs(),
      }
    );

    if (!httpResponse.ok) {
      // The status is what turns "翻译失败" into "API 密钥无效" (401),
      // "请求过于频繁" (429) or "图片被内容审核拦截" (422). Dropping it
      // here made every one of those mappings unreachable for provider
      // errors.
      throw createApiError(
        httpResponse.error || httpResponse.statusText,
        this.name,
        httpResponse.status
      );
    }

    const data = httpResponse.data;
    if (!data) {
      // A 2xx with a body we cannot read. The model ran and the service
      // billed for it; all we lost is the answer. This branch is the same
      // kind of failure as the two below it — a response that arrived and
      // could not be used — so it is recorded the same way. It used to be
      // the one 2xx that was not, and a gateway answering with an HTML
      // error page under a 200 therefore cost the user a request that the
      // usage panel never showed.
      recordBilledRequest(this.type, null);
      throw new Error(`${this.name} API returned no data`);
    }

    if (data.error) {
      /*
       * A 2xx that carries an error is the service reporting a refusal,
       * not the model answering badly. The request was refused, the model
       * did not run, and nothing was billed — so, unlike the branches
       * above, this one is NOT recorded.
       *
       * The distinction is not obvious from the shape of the response, so
       * it is written down here: a 2xx that carries a *model answer* is
       * billed (even when the answer cannot be read), and a 2xx that
       * carries an *error* is a refusal and is not. Without this rule the
       * next reader would have had to guess, and guessing wrong in either
       * direction shows up as a bill that does not match the provider's.
       */
      throw new Error(`${this.name} API error: ${data.error.message}`);
    }

    // A 2xx means the model ran and the service billed for it. Everything
    // below that fails is therefore a request the user already paid for.
    const usage = normalizeUsage(data.usage);

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      recordBilledRequest(this.type, usage);
      throw new Error(`${this.name} API returned empty response`);
    }

    let parsed: VisionResponse;
    try {
      parsed = parseVisionResponse(content);
    } catch (error) {
      // The model answered and was billed; we just cannot read the answer
      // (truncated JSON, plain text, a model that ignored the format).
      recordBilledRequest(this.type, usage);
      throw error;
    }
    return usage ? { ...parsed, usage } : parsed;
  }

  override async validateConfig(): Promise<ValidationResult> {
    if (this.requiresAuth()) {
      if (!this.config.apiKey) {
        return { valid: false, message: `请配置 ${this.name} API 密钥` };
      }
      if (this.config.apiKey.length < 20) {
        return { valid: false, message: `${this.name} API 密钥格式无效` };
      }
    }
    return { valid: true, message: `${this.name} 配置有效` };
  }

  /**
   * Probe the endpoint for real.
   *
   * `validateConfig` can only inspect strings, so the Settings "test
   * connection" button used to report success for a wrong base URL, a revoked
   * key, or a model that does not exist. That is worse than no button: it
   * sends the user looking for the fault somewhere else.
   *
   * This asks the OpenAI-compatible `/models` endpoint, which every
   * implementation of this API is expected to expose. Only call it from an
   * extension page: a content script's request would be blocked by the page's
   * CORS rules.
   */
  async testConnection(options?: {
    allowBillableProbe?: boolean;
  }): Promise<ValidationResult> {
    const local = await this.validateConfig();
    if (!local.valid) {
      return local;
    }

    const headers: Record<string, string> = {};
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const response = await httpRequest<unknown>(
      `${this.config.baseUrl}/models`,
      { method: 'GET', headers, timeout: 10_000 }
    );

    if (response.ok) {
      return { valid: true, message: `已连接 ${this.name}` };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        valid: false,
        message: `${this.name} 拒绝了该 API 密钥（${response.status}）`,
      };
    }

    // Some gateways implement chat completions but not `/models`. A 404 there
    // says nothing about whether translation works, so fall back to a minimal
    // completion before reporting a problem — a false "wrong base URL" would
    // send the user chasing a working endpoint.
    //
    // That fallback is a real completion, and the provider bills for it. A
    // background poll that ran it every fifteen minutes would be spending
    // the user's money to keep a status dot green, so the poll stops here:
    // a 404 or 405 on `/models` has already proved the endpoint is
    // reachable and the key was not rejected, which is most of what the dot
    // claims. The explicit 「测试配置」 button asks for the full check, and
    // the page says that it costs a request.
    if (response.status === 404 || response.status === 405) {
      if (options?.allowBillableProbe === false) {
        return {
          valid: true,
          message: `已连接 ${this.name}（该网关不提供 /models，未做会计费的完整测试）`,
        };
      }
      return this.probeChatCompletion(headers);
    }

    if (response.status === 408 || response.status === 0) {
      /*
       * A 408 is an abandoned request: the provider had it, and the model
       * may well have run. The usage rule counts it, because the user paid
       * for it. The probe is a real completion, so it counts the same way a
       * translation does.
       *
       * A network error (status 0) is not recorded: the client cannot tell
       * a connection that died before the request was sent from one that
       * died after the provider had already run the model. Counting it would
       * over-report; not counting it under-reports in the rare case. The
       * rule is written down in `usage-recording.ts` for the same reason.
       */
      if (response.status === 408) {
        recordBilledRequest(this.type, null);
      }
      return {
        valid: false,
        message: `无法连接 ${this.config.baseUrl}：${response.error ?? '网络错误'}`,
      };
    }
    return {
      valid: false,
      message: `${this.name} 返回 ${response.status}: ${
        response.error ?? response.statusText
      }`,
    };
  }

  /**
   * Last-resort probe: the smallest possible chat completion.
   *
   * Costs one request with a one-token reply. Used only when the endpoint does
   * not expose `/models`.
   */
  private async probeChatCompletion(
    headers: Record<string, string>
  ): Promise<ValidationResult> {
    const response = await httpRequest<{
      error?: { message?: string };
    }>(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      timeout: 20_000,
      body: {
        model: this.config.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        temperature: 0,
      },
    });

    if (response.ok) {
      /*
       * This probe is a real completion and the provider bills it. The
       * usage panel is the number the user reads as their bill, so a
       * request they triggered by pressing 「测试配置」 belongs in it —
       * otherwise the counter under-reports by one every time they check
       * their configuration, which is exactly when they are watching the
       * number.
       */
      recordBilledRequest(this.type, null);
      return {
        valid: true,
        message: `已连接 ${this.name}（模型 ${this.config.model} 可用）`,
      };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        valid: false,
        message: `${this.name} 拒绝了该 API 密钥（${response.status}）`,
      };
    }
    if (response.status === 404) {
      return {
        valid: false,
        message: `${this.name} 未找到 Base URL：${this.config.baseUrl}（404）`,
      };
    }
    if (response.status === 408 || response.status === 0) {
      return {
        valid: false,
        message: `无法连接 ${this.config.baseUrl}：${response.error ?? '网络错误'}`,
      };
    }

    // A 400 here usually means the model name is wrong, which is exactly the
    // kind of mistake this button should surface.
    const detail = response.data?.error?.message ?? response.error;
    return {
      valid: false,
      message: `${this.name} 返回 ${response.status}${
        detail ? `：${detail}` : ''
      }`,
    };
  }

  protected ensureConfigured(): void {
    if (this.requiresAuth()) {
      if (!this.config.apiKey) {
        throw new Error(`请配置 ${this.name} API 密钥`);
      }
      if (this.config.apiKey.length < 20) {
        throw new Error(`${this.name} API 密钥格式无效`);
      }
    }
  }

  /** 子类覆写：是否强制要求 apiKey（云端 API=true，本地服务=false） */
  protected abstract requiresAuth(): boolean;

  /**
   * Timeout for a translation request.
   *
   * Cloud APIs answer in seconds; a local model can take a minute or two,
   * especially the first time it has to load its weights. Local providers
   * override this so a slow-but-healthy local model is not reported as a
   * network failure.
   */
  protected getRequestTimeoutMs(): number {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }
}
