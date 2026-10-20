import { createProvider } from '@/providers';
import type { ProviderType, TextArea } from '@/providers/base';
import type { TranslationStylePreset } from '@/utils/translation-style';
import { getErrorMessage } from '@/utils/error-message';

interface ProviderDirectTranslationResponse {
  success: boolean;
  error?: string;
  textAreas?: TextArea[];
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
export interface ProviderDirectJob {
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

    return {
      success: true,
      textAreas: result.textAreas,
      pipeline: 'full-image-fallback',
      cached: false,
      usage: result.usage ?? null,
    };
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
}
