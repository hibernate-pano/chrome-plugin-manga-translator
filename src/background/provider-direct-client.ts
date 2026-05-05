import { createProvider } from '@/providers';
import type { ProviderType, TextArea } from '@/providers/base';
import type { TranslationTransportRequest } from '@/services/translation-transport';
import type { TranslationStylePreset } from '@/utils/translation-style';

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
  return (
    value === 'openai' ||
    value === 'claude' ||
    value === 'deepseek' ||
    value === 'nvidia' ||
    value === 'ollama' ||
    value === 'siliconflow' ||
    value === 'dashscope'
  );
}

function isTranslationStylePreset(
  value: unknown
): value is TranslationStylePreset {
  return (
    value === 'faithful' ||
    value === 'natural-zh' ||
    value === 'concise-bubble'
  );
}

export async function translateImageViaProviderDirect(
  request: TranslationTransportRequest
): Promise<ProviderDirectTranslationResponse> {
  if (!isProviderType(request.provider)) {
    return {
      success: false,
      error: '未知 Provider，无法执行兼容翻译',
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
      error: error instanceof Error ? error.message : '兼容翻译失败',
    };
  }
}
