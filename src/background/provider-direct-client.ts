import { createProvider } from '@/providers';
import type { ProviderType, TextArea } from '@/providers/base';
import type { TranslationStylePreset } from '@/utils/translation-style';
import { getErrorMessage } from '@/utils/error-message';
import {
  isAbandonedRequest,
  recordBilledRequest,
} from '@/providers/usage-recording';

interface ProviderDirectTranslationResponse {
  success: boolean;
  error?: string;
  textAreas?: TextArea[];
  /**
   * Bubbles the model found and translated but gave no box for.
   *
   * There is nowhere to draw them, so the page shows fewer bubbles than the
   * model found — and the difference has to be visible to the reader.
   */
  unplacedCount?: number;
  pipeline?: 'full-image-fallback';
  cached?: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
}

/**
 * A translation the worker performs itself.
 *
 * Every field here is resolved by the worker from the authoritative
 * configuration. Nothing in this object comes from a message a content script
 * sent, which is the whole point: the endpoint the API key is sent to is
 * never something the requester can influence.
 */
interface ProviderDirectJob {
  /** The provider the user configured. */
  provider: ProviderType;
  /** The configured API key. Never leaves the worker. */
  apiKey: string;
  /** The configured endpoint. Never leaves the worker. */
  baseUrl: string;
  /** The configured model. */
  model: string;
  imageBase64: string;
  targetLanguage: string;
  translationStylePreset: TranslationStylePreset;
  isHybridRegions?: boolean;
}

function isProviderType(value: unknown): value is ProviderType {
  return (
    value === 'openai-compatible' || value === 'ollama' || value === 'lm-studio'
  );
}

function isTranslationStylePreset(
  value: unknown
): value is TranslationStylePreset {
  return (
    value === 'faithful' ||
    value === 'natural-zh' ||
    value === 'concise-bubble' ||
    value === 'preserve-original'
  );
}

export async function translateImageViaProviderDirect(
  job: ProviderDirectJob
): Promise<ProviderDirectTranslationResponse> {
  if (!isProviderType(job.provider)) {
    return {
      success: false,
      error: '未知 Provider，无法执行直连翻译',
    };
  }

  if (!isTranslationStylePreset(job.translationStylePreset)) {
    return {
      success: false,
      error: '翻译风格配置无效',
    };
  }

  try {
    const provider = await createProvider(job.provider, {
      apiKey: job.apiKey,
      baseUrl: job.baseUrl,
      model: job.model,
    });
    const result = await provider.analyzeAndTranslate(
      job.imageBase64,
      job.targetLanguage,
      job.translationStylePreset,
      job.isHybridRegions
    );

    /*
     * 这一次请求记在这里，不在调用方那边。
     *
     * 记账必须跟着"真的问了一次服务商"这件事走，而 worker 是唯一知道这
     * 一点的层：它的队列会把两个相同的 pageKey 合并成一个 job，两个调用方
     * 拿到同一份结果，而服务商只被问了一次。账只能记一次 —— 在调用方那边
     * 记，就会把一次请求算成两次，把用户没花的钱算成花了。
     *
     * "2xx 但答案读不懂"的那种请求是 provider 自己记的（那一层之后错误就
     * 被拍扁了，usage 再也拿不到），所以这里只在成功时记一笔。
     */
    recordBilledRequest(job.provider, result.usage ?? null);

    return {
      success: true,
      textAreas: result.textAreas,
      unplacedCount: result.unplacedCount,
      pipeline: 'full-image-fallback',
      cached: false,
      usage: result.usage ?? null,
    };
  } catch (error) {
    /*
     * 超时放弃的那一次也要记：请求已经送到，模型已经在算，钱已经花了，
     * 只是答案没等到。服务商拒收的（401 / 429 / 400）不记 —— 模型没有跑。
     */
    if (isAbandonedRequest(error)) {
      recordBilledRequest(job.provider, null);
    }
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
}
