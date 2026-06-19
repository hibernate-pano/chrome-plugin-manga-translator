import { createProvider } from '@/providers';
import type { ProviderType, TextArea } from '@/providers/base';
import type { TranslationTransportRequest } from '@/services/translation-transport';
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

function isProviderType(value: unknown): value is ProviderType {
  return value === 'openai-compatible' || value === 'ollama' || value === 'lm-studio';
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
  request: TranslationTransportRequest
): Promise<ProviderDirectTranslationResponse> {
  if (!isProviderType(request.provider)) {
    return {
      success: false,
      error: '未知 Provider，无法执行直连翻译',
    };
  }

  if (!isTranslationStylePreset(request.translationStylePreset)) {
    return {
      success: false,
      error: '翻译风格配置无效',
    };
  }

  try {
    const provider = await createProvider(request.provider, {
      apiKey: request.apiKey,
      baseUrl: request.baseUrl,
      model: request.model,
    });
    const result = await provider.analyzeAndTranslate(
      request.imageBase64,
      request.targetLanguage,
      request.translationStylePreset
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
