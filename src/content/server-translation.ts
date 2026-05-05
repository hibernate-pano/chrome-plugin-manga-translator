import { loadRuntimeAppConfig } from '@/shared/app-config';
import type {
  TranslateImageBytesViaServerRequest,
  TranslateViaServerRequest,
  TranslateViaServerResponse,
} from '@/shared/runtime-contracts';
import {
  fetchImageBytesFromPage,
  shouldRetryWithPageImageFetch,
} from './image-fetch';

export async function requestServerTranslation(
  imageUrl: string,
  sourcePageUrl: string
): Promise<TranslateViaServerResponse> {
  const config = await loadRuntimeAppConfig();
  const request: TranslateViaServerRequest = {
    type: 'TRANSLATE_VIA_SERVER',
    imageUrl,
    sourcePageUrl,
    targetLanguage: config.targetLanguage,
    translationStylePreset: config.translationStylePreset,
    forceRefresh: false,
  };
  const initialResponse = (await chrome.runtime.sendMessage(
    request
  )) as TranslateViaServerResponse;

  if (
    initialResponse?.success ||
    !shouldRetryWithPageImageFetch(initialResponse?.error)
  ) {
    return initialResponse;
  }

  const image = await fetchImageBytesFromPage(imageUrl, sourcePageUrl);
  const retryRequest: TranslateImageBytesViaServerRequest = {
    type: 'TRANSLATE_IMAGE_BYTES_VIA_SERVER',
    imageUrl,
    sourcePageUrl,
    imageBase64: image.imageBase64,
    mimeType: image.mimeType,
    targetLanguage: config.targetLanguage,
    translationStylePreset: config.translationStylePreset,
    forceRefresh: false,
  };

  return (await chrome.runtime.sendMessage(
    retryRequest
  )) as TranslateViaServerResponse;
}
