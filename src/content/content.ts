/**
 * Content Script - Manga Translator v2
 * 
 * Core content script that handles:
 * - Image detection and filtering (Requirements 2.1)
 * - Translation flow control (Requirements 1.2, 1.3)
 * - Integration with translator and renderer services
 * 
 * Requirements: 1.2, 1.3, 2.1
 */

import { TranslatorService, createTranslatorFromConfig } from '@/services/translator';
import { OverlayRenderer, getRenderer, removeAllOverlaysFromDOM } from '@/services/renderer';
import { useAppConfigStore } from '@/stores/config-v2';
import { parseTranslationError } from '@/utils/error-handler';
import { 
  getViewportFirstImages, 
  processInParallel,
  type ParallelProcessingOptions 
} from '@/utils/image-priority';

// ==================== Constants ====================

/** Minimum image width to be considered for translation */
const MIN_IMAGE_WIDTH = 150;

/** Minimum image height to be considered for translation */
const MIN_IMAGE_HEIGHT = 150;

/** CSS class for processed images */
const PROCESSED_CLASS = 'manga-translator-processed';

/** Storage key for config */
const CONFIG_STORAGE_KEY = 'manga-translator-config-v2';

// ==================== Type Definitions ====================

interface ContentScriptState {
  /** Whether translation is enabled */
  enabled: boolean;
  /** Whether currently processing images */
  isProcessing: boolean;
  /** Set of processed image sources */
  processedImages: Set<string>;
  /** Current abort controller for cancellation */
  abortController: AbortController | null;
  /** MutationObserver for dynamic content */
  mutationObserver: MutationObserver | null;
  /** Debounce timer for MutationObserver */
  mutationDebounceTimer: ReturnType<typeof setTimeout> | null;
}

interface TranslationStatus {
  isProcessing: boolean;
  processedCount: number;
  totalCount: number;
  error?: string;
}

interface MessageRequest {
  action: string;
  enabled?: boolean;
  provider?: string;
  targetLanguage?: string;
  [key: string]: unknown;
}

interface MessageResponse {
  success?: boolean;
  error?: string;
  state?: TranslationStatus;
  enabled?: boolean;
}

// ==================== State Management ====================

const state: ContentScriptState = {
  enabled: false,
  isProcessing: false,
  processedImages: new Set(),
  abortController: null,
  mutationObserver: null,
  mutationDebounceTimer: null,
};

let translator: TranslatorService | null = null;
let renderer: OverlayRenderer | null = null;

// ==================== Image Detection ====================

/**
 * Check if an image is a valid candidate for translation
 * 
 * Filters out:
 * - Small images (< 150x150)
 * - Data URL icons
 * - Avatar images
 * - Ad images
 * - Already processed images
 * 
 * Requirements: 2.1
 * 
 * @param img Image element to check
 * @returns True if image should be processed
 */
export function isImageCandidate(img: HTMLImageElement): boolean {
  // Get actual dimensions
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;

  // Filter: Minimum size requirement
  if (width < MIN_IMAGE_WIDTH || height < MIN_IMAGE_HEIGHT) {
    return false;
  }

  // Filter: Small data URL icons
  if (img.src.startsWith('data:') && width < 50 && height < 50) {
    return false;
  }

  // Filter: Avatar images (small and contains 'avatar' in src)
  if (width < 150 && height < 150 && img.src.toLowerCase().includes('avatar')) {
    return false;
  }

  // Filter: Ad images (check alt text)
  const alt = (img.alt || '').toLowerCase();
  if (alt.includes('广告') || alt.includes('ad') || alt.includes('advertisement')) {
    return false;
  }

  // Filter: Ad images (check src)
  const src = img.src.toLowerCase();
  if (src.includes('/ad/') || src.includes('/ads/') || src.includes('advertisement')) {
    return false;
  }

  // Filter: Already processed images
  if (img.classList.contains(PROCESSED_CLASS)) {
    return false;
  }

  // Filter: Images inside translator wrapper
  if (img.closest('.manga-translator-wrapper')) {
    return false;
  }

  return true;
}

/**
 * Find all candidate images on the page
 * 
 * @returns Array of image elements that should be processed
 */
function findCandidateImages(): HTMLImageElement[] {
  const allImages = Array.from(document.querySelectorAll('img'));
  return allImages.filter(isImageCandidate);
}

// ==================== Translation Flow Control ====================

/**
 * Start the translation process
 * 
 * Requirements: 1.2 - When user turns on the switch, start detecting and translating
 * Requirements: 4.1, 4.2 - Debug logging at key positions
 * Requirements: 9.2 - Support parallel processing with limits
 * Requirements: 9.4 - Prioritize viewport images
 */
async function startTranslation(): Promise<void> {
  if (state.isProcessing) {
    console.log('[ContentScript] 翻译已在进行中');
    return;
  }

  // Requirements 4.1 - Log when translation is enabled
  console.log('[ContentScript] 翻译开关已打开');
  state.enabled = true;
  state.isProcessing = true;
  state.abortController = new AbortController();

  try {
    // Initialize services if needed
    if (!translator) {
      console.log('[ContentScript] 初始化翻译服务...');
      translator = createTranslatorFromConfig();
      await translator.initialize();
      console.log('[ContentScript] 翻译服务初始化完成');
    }

    if (!renderer) {
      renderer = getRenderer();
    }

    // Find candidate images
    const candidateImages = findCandidateImages();
    
    if (candidateImages.length === 0) {
      console.log('[ContentScript] 未找到候选图片');
      notifyPopup('noImages', {});
      return;
    }

    // Sort images by viewport priority (Requirements 9.4)
    const images = getViewportFirstImages(candidateImages);

    // Requirements 4.2 - Log candidate image count
    console.log(`[ContentScript] 找到候选图片: ${images.length} 张 (按视口优先排序)`);
    notifyPopup('processingStart', { total: images.length });

    // Get parallel limit from config (Requirements 9.2)
    const config = useAppConfigStore.getState();
    const parallelLimit = config.parallelLimit || 3;

    let processedCount = 0;
    let errorCount = 0;
    const total = images.length;

    // Process images with parallel limits
    const processingOptions: ParallelProcessingOptions = {
      maxConcurrent: parallelLimit,
      signal: state.abortController.signal,
      onItemComplete: (completed) => {
        processedCount = completed;
        // Requirements 4.2 - Log progress for each image
        console.log(`[ContentScript] 处理进度: ${processedCount}/${total}`);
        notifyPopup('processingUpdate', {
          current: processedCount,
          total,
        });
      },
      onError: (error) => {
        errorCount++;
        const friendlyError = parseTranslationError(error);
        console.error(`[ContentScript] 处理图片失败:`, friendlyError.message);
      },
    };

    await processInParallel(
      images,
      async (img) => {
        // Check for cancellation
        if (state.abortController?.signal.aborted || !state.enabled) {
          throw new Error('Translation cancelled');
        }

        await processImage(img);
        state.processedImages.add(getImageKey(img));
      },
      processingOptions
    );

    console.log(`[ContentScript] 翻译完成: 成功 ${processedCount} 张, 失败 ${errorCount} 张`);
    notifyPopup('complete', {
      processedCount,
      errorCount,
      total: images.length,
    });

    // Start observing for dynamically loaded images
    startMutationObserver();

  } catch (error) {
    const friendlyError = parseTranslationError(error);
    console.error('[ContentScript] 翻译流程失败:', friendlyError.message);
    notifyPopup('error', { error: friendlyError });
  } finally {
    state.isProcessing = false;
    state.abortController = null;
  }
}

/**
 * Stop translation and remove all overlays
 * 
 * Requirements: 1.3 - When user turns off the switch, remove all overlays
 */
function stopTranslation(): void {
  console.log('[ContentScript] 翻译开关已关闭');

  // Cancel ongoing processing
  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
  }

  // Stop mutation observer
  stopMutationObserver();

  // Remove all overlays
  if (renderer) {
    renderer.removeAll();
  }
  
  // Also clean up any orphaned overlays
  removeAllOverlaysFromDOM();

  // Reset state
  state.enabled = false;
  state.isProcessing = false;
  state.processedImages.clear();

  // Remove processed class from all images
  document.querySelectorAll(`.${PROCESSED_CLASS}`).forEach(img => {
    img.classList.remove(PROCESSED_CLASS);
  });

  console.log('[ContentScript] 翻译已停止，所有覆盖层已移除');
}

/**
 * Process a single image
 * 
 * Requirements: 2.1, 2.2, 2.5, 4.1, 4.2
 * 
 * @param img Image element to process
 */
async function processImage(img: HTMLImageElement): Promise<void> {
  const imgSrc = img.src.substring(0, 50) + (img.src.length > 50 ? '...' : '');
  console.log('[ContentScript] 开始处理图片', { src: imgSrc });

  if (!translator || !renderer) {
    console.error('[ContentScript] 服务未初始化');
    throw new Error('Services not initialized');
  }

  // Mark as being processed
  img.classList.add(PROCESSED_CLASS);

  // Call TranslatorService to translate the image (Requirements 2.1, 2.2)
  console.log('[ContentScript] 调用 Vision LLM 翻译');
  const result = await translator.translateImage(img);

  if (!result.success) {
    console.error('[ContentScript] 翻译失败:', result.error);
    throw new Error(result.error || 'Translation failed');
  }

  // Skip if no text areas detected (Requirements 2.5)
  if (result.textAreas.length === 0) {
    console.log('[ContentScript] 图片中未检测到文字，跳过渲染');
    return;
  }

  console.log('[ContentScript] 检测到文字区域:', result.textAreas.length);

  // Render overlays
  console.log('[ContentScript] 渲染翻译覆盖层');
  renderer.render(img, result.textAreas);
}

/**
 * Get unique key for an image
 */
function getImageKey(img: HTMLImageElement): string {
  return img.src || `img-${img.offsetLeft}-${img.offsetTop}-${img.width}-${img.height}`;
}

// ==================== Message Handling ====================

/**
 * Handle messages from popup or background script
 */
function handleMessage(
  request: MessageRequest,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: MessageResponse) => void
): boolean {
  console.log('[ContentScript] Received message:', request.action);

  switch (request.action) {
    case 'toggleTranslation':
      handleToggleTranslation(request.enabled, sendResponse);
      break;

    case 'getState':
      sendResponse({
        success: true,
        enabled: state.enabled,
        state: {
          isProcessing: state.isProcessing,
          processedCount: state.processedImages.size,
          totalCount: 0,
        },
      });
      break;

    case 'checkState':
      // Called when page loads to check if translation should be active
      sendResponse({
        success: true,
        enabled: state.enabled,
      });
      break;

    case 'configUpdated':
      // Configuration was updated, reset translator
      translator = null;
      sendResponse({ success: true });
      break;

    case 'translateSingleImage':
      handleTranslateSingleImage(request['imageUrl'] as string, sendResponse);
      break;

    default:
      sendResponse({ error: `Unknown action: ${request.action}` });
  }

  return true; // Keep message channel open for async response
}

/**
 * Handle toggle translation message
 */
function handleToggleTranslation(
  enabled: boolean | undefined,
  sendResponse: (response: MessageResponse) => void
): void {
  if (enabled === undefined) {
    // Toggle current state
    enabled = !state.enabled;
  }

  if (enabled) {
    startTranslation()
      .then(() => sendResponse({ success: true }))
      .catch(error => {
        const friendlyError = parseTranslationError(error);
        sendResponse({ success: false, error: friendlyError.message });
      });
  } else {
    stopTranslation();
    sendResponse({ success: true });
  }
}

/**
 * Handle translate single image message (from context menu)
 */
function handleTranslateSingleImage(
  imageUrl: string | undefined,
  sendResponse: (response: MessageResponse) => void
): void {
  if (!imageUrl) {
    sendResponse({ success: false, error: 'No image URL provided' });
    return;
  }

  (async () => {
    try {
      // Find matching image on page
      const images = Array.from(document.querySelectorAll('img'));
      const targetImg = images.find(
        (img) => img.src === imageUrl || img.currentSrc === imageUrl
      );

      if (!targetImg) {
        sendResponse({ success: false, error: 'Image not found on page' });
        return;
      }

      // Initialize services if needed
      if (!translator) {
        translator = createTranslatorFromConfig();
        await translator.initialize();
      }
      if (!renderer) {
        renderer = getRenderer();
      }

      await processImage(targetImg);
      state.processedImages.add(getImageKey(targetImg));
      sendResponse({ success: true });
    } catch (error) {
      const friendlyError = parseTranslationError(error);
      sendResponse({ success: false, error: friendlyError.message });
    }
  })();
}

// ==================== MutationObserver ====================

/**
 * Start observing DOM for dynamically added images
 */
function startMutationObserver(): void {
  if (state.mutationObserver) return;

  state.mutationObserver = new MutationObserver((mutations) => {
    let hasNewImages = false;

    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (node instanceof HTMLImageElement && isImageCandidate(node)) {
          hasNewImages = true;
          break;
        }
        if (node instanceof HTMLElement) {
          const imgs = node.querySelectorAll('img');
          if (imgs.length > 0) {
            hasNewImages = true;
            break;
          }
        }
      }
      if (hasNewImages) break;
    }

    if (hasNewImages) {
      // Debounce: wait 500ms before processing new images
      if (state.mutationDebounceTimer) {
        clearTimeout(state.mutationDebounceTimer);
      }
      state.mutationDebounceTimer = setTimeout(() => {
        processNewImages();
      }, 500);
    }
  });

  state.mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  console.log('[ContentScript] MutationObserver started');
}

/**
 * Stop the MutationObserver
 */
function stopMutationObserver(): void {
  if (state.mutationObserver) {
    state.mutationObserver.disconnect();
    state.mutationObserver = null;
  }
  if (state.mutationDebounceTimer) {
    clearTimeout(state.mutationDebounceTimer);
    state.mutationDebounceTimer = null;
  }
}

/**
 * Process newly added images detected by MutationObserver
 */
async function processNewImages(): Promise<void> {
  if (!state.enabled || !translator || !renderer) return;

  const newImages = findCandidateImages().filter(
    (img) => !state.processedImages.has(getImageKey(img))
  );

  if (newImages.length === 0) return;

  console.log(`[ContentScript] MutationObserver: 发现 ${newImages.length} 张新图片`);

  for (const img of newImages) {
    if (!state.enabled) break;
    try {
      await processImage(img);
      state.processedImages.add(getImageKey(img));
    } catch (error) {
      const friendlyError = parseTranslationError(error);
      console.error('[ContentScript] 处理新图片失败:', friendlyError.message);
    }
  }
}

// ==================== Popup Communication ====================

/**
 * Notify popup of status updates
 */
function notifyPopup(action: string, data: Record<string, unknown>): void {
  try {
    chrome.runtime.sendMessage({
      action,
      ...data,
    }).catch(() => {
      // Popup might not be open, ignore error
    });
  } catch {
    // Extension context might be invalid
  }
}

// ==================== Storage Listener ====================

/**
 * Listen for configuration changes in storage
 */
function handleStorageChange(
  changes: { [key: string]: chrome.storage.StorageChange },
  _areaName: string
): void {
  if (changes[CONFIG_STORAGE_KEY]) {
    const newValue = changes[CONFIG_STORAGE_KEY].newValue;
    const oldValue = changes[CONFIG_STORAGE_KEY].oldValue;

    // Check if enabled state changed
    const newEnabled = newValue?.state?.enabled ?? newValue?.enabled ?? false;
    const oldEnabled = oldValue?.state?.enabled ?? oldValue?.enabled ?? false;

    if (newEnabled !== oldEnabled) {
      if (newEnabled && !state.enabled) {
        startTranslation();
      } else if (!newEnabled && state.enabled) {
        stopTranslation();
      }
    }

    // Reset translator if provider or settings changed
    if (newValue?.provider !== oldValue?.provider ||
        JSON.stringify(newValue?.providers) !== JSON.stringify(oldValue?.providers)) {
      translator = null;
    }
  }
}

// ==================== Initialization ====================

/**
 * Initialize the content script
 */
async function initialize(): Promise<void> {
  console.log('[ContentScript] Initializing Manga Translator v2');

  try {
    // Load initial configuration
    const config = useAppConfigStore.getState();
    state.enabled = config.enabled;

    // Set up message listener
    chrome.runtime.onMessage.addListener(handleMessage);

    // Set up storage change listener
    chrome.storage.onChanged.addListener(handleStorageChange);

    // Set up cleanup on page unload
    window.addEventListener('beforeunload', cleanup);

    // If translation was enabled, start it
    if (state.enabled) {
      console.log('[ContentScript] Translation was enabled, starting...');
      await startTranslation();
    }

    console.log('[ContentScript] Initialization complete');
  } catch (error) {
    console.error('[ContentScript] Initialization failed:', error);
  }
}

/**
 * Clean up resources on page unload
 */
function cleanup(): void {
  console.log('[ContentScript] Cleaning up');
  
  // Stop any ongoing translation
  if (state.abortController) {
    state.abortController.abort();
  }

  // Remove all overlays
  if (renderer) {
    renderer.removeAll();
  }

  // Clear state
  state.processedImages.clear();
}

// ==================== Start ====================

// Initialize when script loads
initialize();

// ==================== Exports for Testing ====================

export {
  state,
  startTranslation,
  stopTranslation,
  findCandidateImages,
  handleMessage,
  MIN_IMAGE_WIDTH,
  MIN_IMAGE_HEIGHT,
};
