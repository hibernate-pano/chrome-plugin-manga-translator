import type {
  BackgroundRequest,
  BackgroundResponse,
} from '@/shared/runtime-contracts';
import {
  fetchImageBytesResponse,
  testServerConnection,
  translateViaServer,
} from './server-client';

export async function handleBackgroundMessage(
  request: BackgroundRequest
): Promise<BackgroundResponse> {
  switch (request.type) {
    case 'FETCH_IMAGE_BYTES':
      return fetchImageBytesResponse(request.imageUrl);
    case 'TRANSLATE_VIA_SERVER':
      return translateViaServer(request);
    case 'TEST_SERVER_CONNECTION':
      return testServerConnection();
    default:
      return {
        success: false,
        message: '未知后台请求',
      };
  }
}

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onMessage.addListener(
  (
    request: BackgroundRequest,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: BackgroundResponse) => void
  ): boolean => {
    void handleBackgroundMessage(request)
      .then(sendResponse)
      .catch(error => {
        const message =
          error instanceof Error ? error.message : '后台请求失败';

        sendResponse({
          success: false,
          message,
          error: message,
          textAreas: [],
          pipeline: 'full-image-fallback',
          cached: false,
        } as BackgroundResponse);
      });

    return true;
  }
);
