/**
 * TranslationController - 翻译控制器
 * 
 * 负责管理翻译流程的启动和停止，监听开关状态变化
 * 
 * Requirements:
 * - 1.2: 用户打开开关时，开始检测当前页面的漫画图片并进行翻译
 * - 1.3: 用户关闭开关时，移除所有翻译覆盖层并恢复原始图片显示
 * - 2.1: 翻译功能开启时，自动检测页面中的漫画图片
 * - 2.2: 检测到漫画图片时，识别图片中的文字区域
 * - 2.3: 识别到文字区域时，将文字翻译成目标语言
 * - 2.4: 图片中没有检测到文字时，不做任何处理
 * - 3.1: 翻译完成时，在原文字区域位置显示翻译结果
 * - 5.1: 将检测到的任何外语文字翻译成简体中文
 * - 5.2: 自动识别源语言（日语、英语、韩语等），无需用户手动选择
 * 
 * TODO: 此文件将在后续任务中使用 Vision LLM 重新实现
 * 当前版本暂时禁用 OCR 相关功能
 */

// TODO: detector.js 已删除，将在后续任务中使用 Vision LLM 替代
// import { detectTextAreas, terminateOCRProviders } from './detector';
import { renderTranslation, removeTranslation } from './renderer';
import { APIManager } from '../api/api-manager';
import { 
  TARGET_LANGUAGE, 
  getMangaTranslationOptions 
} from '../utils/manga-translation-prompt';
import { 
  parseAPIError
} from '../utils/api-error-messages';

// 临时占位函数，将在后续任务中实现
async function detectTextAreas(_img: HTMLImageElement, _options?: unknown): Promise<TextArea[]> {
  console.log('[TranslationController] detectTextAreas 暂时禁用，等待 Vision LLM 实现');
  return [];
}

async function terminateOCRProviders(): Promise<void> {
  console.log('[TranslationController] terminateOCRProviders 暂时禁用');
}

// 在模块加载时验证 Provider 注册状态
const verifyProviders = () => {
  const registrationStatus = APIManager.checkProviderRegistration();
  console.log('[TranslationController] Provider 注册验证', {
    isValid: registrationStatus.isValid,
    registered: registrationStatus.registered,
    missing: registrationStatus.missing
  });
  
  if (!registrationStatus.isValid) {
    console.warn('[TranslationController] 警告: 部分 Provider 未注册', {
      missing: registrationStatus.missing
    });
  }
  
  return registrationStatus.isValid;
};

// 立即执行验证（结果用于模块加载时的日志输出）
verifyProviders();

// 翻译控制器配置接口
export interface TranslationControllerConfig {
  targetLanguage: string;
  debugMode: boolean;
  minImageWidth: number;
  minImageHeight: number;
  // 样式配置
  fontSize: string;
  fontColor: string;
  backgroundColor: string;
}

// 默认配置
const DEFAULT_CONFIG: TranslationControllerConfig = {
  targetLanguage: 'zh-CN',
  debugMode: false,
  minImageWidth: 150,
  minImageHeight: 150,
  fontSize: 'auto',
  fontColor: '#000000',
  backgroundColor: 'rgba(255, 255, 255, 0.8)',
};

// 文字区域接口
interface TextArea {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  confidence?: number;
  type?: string;
  order?: number;
  metadata?: {
    readingDirection?: string;
    isProcessed?: boolean;
    detectionMethod?: string;
  };
}

// 处理状态接口
interface ProcessingState {
  isProcessing: boolean;
  processedImages: Set<string>;
  activeOverlays: Map<string, HTMLElement>;
  abortController: AbortController | null;
}

// 消息接口
interface TranslationMessage {
  action: string;
  enabled?: boolean;
  [key: string]: unknown;
}

// 响应接口
interface MessageResponse {
  success?: boolean;
  error?: string;
  isProcessing?: boolean;
  processedCount?: number;
  overlayCount?: number;
}

/**
 * TranslationController 类
 * 
 * 管理页面翻译的启动、停止和状态
 */
export class TranslationController {
  private config: TranslationControllerConfig;
  private state: ProcessingState;
  private storageListener: ((changes: { [key: string]: chrome.storage.StorageChange }) => void) | null = null;
  private messageListener: ((message: TranslationMessage, sender: chrome.runtime.MessageSender, sendResponse: (response?: MessageResponse) => void) => void) | null = null;

  constructor(config: Partial<TranslationControllerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = {
      isProcessing: false,
      processedImages: new Set(),
      activeOverlays: new Map(),
      abortController: null,
    };
  }

  /**
   * 初始化控制器，设置监听器
   */
  public async initialize(): Promise<void> {
    // 监听来自 Popup 的消息
    this.messageListener = (message, _sender, sendResponse) => {
      this.handleMessage(message, sendResponse);
      return true; // 保持消息通道开放
    };
    chrome.runtime.onMessage.addListener(this.messageListener);

    // 监听存储变化（开关状态）
    this.storageListener = (changes) => {
      this.handleStorageChange(changes);
    };
    chrome.storage.onChanged.addListener(this.storageListener);

    // 检查初始状态
    await this.checkInitialState();
  }

  /**
   * 检查初始状态，如果已启用则开始翻译
   */
  private async checkInitialState(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(['manga-translator-translation']);
      const translationState = result['manga-translator-translation'];
      
      if (translationState?.state?.enabled) {
        await this.start();
      }
    } catch (error) {
      console.error('检查初始状态失败:', error);
    }
  }

  /**
   * 处理来自 Popup 的消息
   */
  private handleMessage(message: TranslationMessage, sendResponse: (response?: MessageResponse) => void): void {
    switch (message.action) {
      case 'toggleTranslation':
        if (message.enabled) {
          this.start().then(() => sendResponse({ success: true }));
        } else {
          this.stop();
          sendResponse({ success: true });
        }
        break;

      case 'getState':
        sendResponse({
          isProcessing: this.state.isProcessing,
          processedCount: this.state.processedImages.size,
          overlayCount: this.state.activeOverlays.size,
        });
        break;

      default:
        sendResponse({ error: 'Unknown action' });
    }
  }

  /**
   * 处理存储变化
   */
  private handleStorageChange(changes: { [key: string]: chrome.storage.StorageChange }): void {
    // 检查翻译状态变化
    if (changes['manga-translator-translation']) {
      const newValue = changes['manga-translator-translation'].newValue;
      const oldValue = changes['manga-translator-translation'].oldValue;

      const newEnabled = newValue?.state?.enabled ?? newValue?.enabled ?? false;
      const oldEnabled = oldValue?.state?.enabled ?? oldValue?.enabled ?? false;

      if (newEnabled !== oldEnabled) {
        if (newEnabled) {
          this.start();
        } else {
          this.stop();
        }
      }
    }
  }

  /**
   * 启动翻译流程
   * 
   * Requirements:
   * - 1.2: 开始检测当前页面的漫画图片并进行翻译
   * - 2.1: 自动检测页面中的漫画图片
   */
  public async start(): Promise<void> {
    if (this.state.isProcessing) {
      console.log('[TranslationController] 翻译已在进行中，跳过重复启动');
      return;
    }

    console.log('[TranslationController] ==========================================');
    console.log('[TranslationController] 启动翻译流程');
    console.log('[TranslationController] ==========================================');
    console.log('[TranslationController] 配置信息', {
      targetLanguage: this.config.targetLanguage,
      debugMode: this.config.debugMode,
      minImageSize: `${this.config.minImageWidth}x${this.config.minImageHeight}`,
      styleConfig: {
        fontSize: this.config.fontSize,
        fontColor: this.config.fontColor,
        backgroundColor: this.config.backgroundColor
      }
    });
    
    // 验证 Provider 注册状态
    const registrationStatus = APIManager.checkProviderRegistration();
    console.log('[TranslationController] Provider 注册状态', registrationStatus);
    
    if (!registrationStatus.isValid) {
      console.error('[TranslationController] Provider 注册验证失败，无法启动翻译');
      this.notifyPopup('error', { 
        message: `Provider 未正确注册: 缺少 ${registrationStatus.missing.join(', ')}` 
      });
      return;
    }
    
    this.state.isProcessing = true;
    this.state.abortController = new AbortController();

    try {
      // 获取页面中的所有候选图片 (Requirements 2.1)
      const images = this.findCandidateImages();
      
      if (images.length === 0) {
        console.log('[TranslationController] 未找到符合条件的图片');
        this.notifyPopup('noImages');
        return;
      }

      console.log('[TranslationController] 找到候选图片', {
        count: images.length,
        images: images.slice(0, 5).map((img, i) => ({
          index: i,
          src: img.src.substring(0, 80) + (img.src.length > 80 ? '...' : ''),
          size: `${img.naturalWidth || img.width}x${img.naturalHeight || img.height}`
        })),
        hasMore: images.length > 5 ? `还有 ${images.length - 5} 张...` : undefined
      });
      
      this.notifyPopup('processingStart', { total: images.length });

      // 逐个处理图片
      let successCount = 0;
      let errorCount = 0;
      const startTime = performance.now();

      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (!img) continue;
        
        // 检查是否已取消
        if (this.state.abortController?.signal.aborted) {
          console.log('[TranslationController] 翻译已取消');
          break;
        }

        // 跳过已处理的图片
        const imageKey = this.getImageKey(img);
        if (this.state.processedImages.has(imageKey)) {
          console.log(`[TranslationController] 跳过已处理的图片 [${i + 1}/${images.length}]`);
          continue;
        }

        console.log(`[TranslationController] 处理图片 [${i + 1}/${images.length}]`);

        try {
          await this.processImage(img);
          this.state.processedImages.add(imageKey);
          successCount++;
          
          // 通知 Popup 更新进度
          this.notifyPopup('processingUpdate', {
            count: this.state.processedImages.size,
            total: images.length,
            success: successCount,
            errors: errorCount,
          });
        } catch (error) {
          errorCount++;
          console.error(`[TranslationController] 处理图片失败 [${i + 1}/${images.length}]`, {
            src: img.src.substring(0, 80),
            error: error instanceof Error ? error.message : String(error)
          });
          // 继续处理下一张图片
        }
      }

      const totalDuration = ((performance.now() - startTime) / 1000).toFixed(2);
      console.log('[TranslationController] ==========================================');
      console.log('[TranslationController] 翻译流程完成');
      console.log('[TranslationController] ==========================================');
      console.log('[TranslationController] 处理统计', {
        totalImages: images.length,
        successCount,
        errorCount,
        totalDuration: `${totalDuration}s`,
        averageTime: successCount > 0 ? `${(parseFloat(totalDuration) / successCount).toFixed(2)}s/张` : 'N/A'
      });
      
      this.notifyPopup('complete', {
        processedCount: this.state.processedImages.size,
        successCount,
        errorCount,
      });
    } catch (error) {
      // 使用用户友好的错误消息
      const friendlyError = parseAPIError(error);
      console.error('[TranslationController] 翻译流程出错:', {
        code: friendlyError.code,
        message: friendlyError.userMessage,
        suggestion: friendlyError.suggestion
      });
      this.notifyPopup('error', { 
        message: friendlyError.userMessage,
        error: friendlyError.toJSON()
      });
    } finally {
      this.state.isProcessing = false;
      this.state.abortController = null;
    }
  }

  /**
   * 停止翻译并清理所有覆盖层
   * 
   * Requirements:
   * - 1.3: 移除所有翻译覆盖层并恢复原始图片显示
   */
  public stop(): void {
    console.log('[TranslationController] 停止翻译流程');

    // 取消正在进行的处理
    if (this.state.abortController) {
      this.state.abortController.abort();
      this.state.abortController = null;
    }

    // 移除所有覆盖层
    const overlayCount = this.state.activeOverlays.size;
    this.clearAllOverlays();

    // 重置状态
    this.state.isProcessing = false;
    this.state.processedImages.clear();

    console.log(`[TranslationController] 翻译流程已停止，已清理 ${overlayCount} 个覆盖层`);
  }

  /**
   * 清理所有翻译覆盖层
   * 
   * Requirements:
   * - 1.3: 移除所有翻译覆盖层并恢复原始图片显示
   */
  private clearAllOverlays(): void {
    let removedCount = 0;

    // 方法1: 通过记录的覆盖层清理
    this.state.activeOverlays.forEach((wrapper, _key) => {
      try {
        removeTranslation(wrapper);
        removedCount++;
      } catch (error) {
        console.error('[TranslationController] 移除覆盖层失败:', error);
      }
    });
    this.state.activeOverlays.clear();

    // 方法2: 通过 CSS 类名查找并清理（兜底）
    const wrappers = document.querySelectorAll('.manga-translator-wrapper');
    wrappers.forEach((wrapper) => {
      try {
        removeTranslation(wrapper as HTMLElement);
        removedCount++;
      } catch (error) {
        console.error('[TranslationController] 移除覆盖层失败:', error);
      }
    });

    // 方法3: 清理旧版覆盖层
    const overlays = document.querySelectorAll('.manga-translation-overlay');
    overlays.forEach((overlay) => {
      overlay.remove();
      removedCount++;
    });

    if (this.config.debugMode) {
      console.log(`[TranslationController] 已清理 ${removedCount} 个覆盖层`);
    }
  }

  /**
   * 查找页面中的候选图片
   * 
   * Requirements:
   * - 2.1: 自动检测页面中的漫画图片
   */
  private findCandidateImages(): HTMLImageElement[] {
    const allImages = Array.from(document.querySelectorAll('img'));
    
    return allImages.filter((img) => {
      // 检查图片尺寸 - 漫画图片通常较大
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      
      if (width < this.config.minImageWidth || height < this.config.minImageHeight) {
        return false;
      }

      // 排除 data URL 小图标
      if (img.src.startsWith('data:') && width < 50 && height < 50) {
        return false;
      }

      // 排除可能是广告的图片
      const alt = img.alt?.toLowerCase() || '';
      if (alt.includes('广告') || alt.includes('ad')) {
        return false;
      }

      // 排除头像
      if (width < 150 && height < 150 && img.src.includes('avatar')) {
        return false;
      }

      // 排除已处理的图片
      if (img.closest('.manga-translator-wrapper')) {
        return false;
      }

      return true;
    });
  }

  /**
   * 处理单张图片
   * 
   * Requirements:
   * - 2.1: 自动检测页面中的漫画图片
   * - 2.2: 识别图片中的文字区域
   * - 2.3: 将文字翻译成目标语言
   * - 2.4: 图片中没有检测到文字时，不做任何处理
   * - 3.1: 翻译完成时，在原文字区域位置显示翻译结果
   */
  private async processImage(img: HTMLImageElement): Promise<void> {
    const imageKey = this.getImageKey(img);
    const startTime = performance.now();
    
    console.log('[TranslationController] ========== 开始处理图片 ==========');
    console.log('[TranslationController] 图片信息', {
      src: img.src.substring(0, 100) + (img.src.length > 100 ? '...' : ''),
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      imageKey: imageKey.substring(0, 50)
    });

    try {
      // 1. 检测文字区域 (Requirements 2.2)
      console.log('[TranslationController] 步骤 1: 开始 OCR 文字检测');
      const ocrStartTime = performance.now();
      
      const textAreas: TextArea[] = await detectTextAreas(img, {
        useCache: true,
        debugMode: this.config.debugMode,
      });
      
      const ocrDuration = (performance.now() - ocrStartTime).toFixed(2);
      console.log('[TranslationController] OCR 检测完成', {
        duration: `${ocrDuration}ms`,
        textAreasCount: textAreas?.length || 0
      });

      // 2. 如果没有检测到文字，跳过 (Requirements 2.4)
      if (!textAreas || textAreas.length === 0) {
        console.log('[TranslationController] 未检测到文字区域，跳过此图片');
        return;
      }

      console.log('[TranslationController] 检测到的文字区域', {
        count: textAreas.length,
        areas: textAreas.map((area, i) => ({
          index: i,
          text: area.text?.substring(0, 30) + (area.text?.length > 30 ? '...' : ''),
          position: { x: area.x, y: area.y, w: area.width, h: area.height }
        }))
      });

      // 3. 提取文本内容
      console.log('[TranslationController] 步骤 2: 提取文本内容');
      const texts = textAreas
        .map((area: TextArea) => area.text)
        .filter((text: string) => text && text.trim().length > 0);

      if (texts.length === 0) {
        console.log('[TranslationController] 提取的文本为空，跳过此图片');
        return;
      }

      console.log('[TranslationController] 提取的文本', {
        count: texts.length,
        texts: texts.map((t, i) => `[${i}] ${t.substring(0, 50)}${t.length > 50 ? '...' : ''}`)
      });

      // 4. 初始化 API Manager 并翻译文本 (Requirements 2.3, 5.1, 5.2)
      console.log('[TranslationController] 步骤 3: 初始化 API Manager');
      const apiManager = APIManager.getInstance();
      
      // 验证 Provider 可用性
      const registrationStatus = APIManager.checkProviderRegistration();
      console.log('[TranslationController] Provider 注册状态', registrationStatus);
      
      if (!registrationStatus.isValid) {
        console.error('[TranslationController] Provider 未正确注册', {
          registered: registrationStatus.registered,
          missing: registrationStatus.missing
        });
        throw new Error(`Provider 未正确注册: 缺少 ${registrationStatus.missing.join(', ')}`);
      }
      
      try {
        const initStartTime = performance.now();
        await apiManager.initialize();
        const initDuration = (performance.now() - initStartTime).toFixed(2);
        
        const providerInfo = apiManager.getCurrentProviderInfo();
        console.log('[TranslationController] API Manager 初始化成功', {
          duration: `${initDuration}ms`,
          provider: providerInfo?.name,
          features: providerInfo?.features
        });
      } catch (initError) {
        // 使用用户友好的错误消息
        const friendlyError = parseAPIError(initError);
        console.error('[TranslationController] API Manager 初始化失败', {
          error: friendlyError.userMessage,
          code: friendlyError.code,
          suggestion: friendlyError.suggestion,
          originalError: initError instanceof Error ? initError.message : String(initError)
        });
        this.notifyPopup('error', { 
          message: friendlyError.userMessage,
          error: friendlyError.toJSON()
        });
        throw friendlyError;
      }

      // 使用漫画翻译专用选项 (Requirements 5.1, 5.2)
      console.log('[TranslationController] 步骤 4: 调用翻译 API');
      const mangaTranslationOptions = getMangaTranslationOptions();
      
      console.log('[TranslationController] 翻译请求参数', {
        textCount: texts.length,
        targetLanguage: TARGET_LANGUAGE,
        options: {
          ...mangaTranslationOptions,
          translationPrompt: `${mangaTranslationOptions.translationPrompt?.substring(0, 100) ?? ''}...`
        },
        firstTextPreview: texts[0]?.substring(0, 50)
      });
      
      const translateStartTime = performance.now();
      const translatedTexts = await apiManager.translateText(
        texts,
        TARGET_LANGUAGE, // 固定为简体中文 (Requirements 5.1)
        mangaTranslationOptions // 使用漫画翻译专用提示词
      );
      const translateDuration = (performance.now() - translateStartTime).toFixed(2);
      
      console.log('[TranslationController] 翻译完成', {
        duration: `${translateDuration}ms`,
        inputCount: texts.length,
        outputCount: Array.isArray(translatedTexts) ? translatedTexts.length : 1,
        results: Array.isArray(translatedTexts) 
          ? translatedTexts.map((t, i) => `[${i}] ${t?.substring(0, 50)}${t?.length > 50 ? '...' : ''}`)
          : [(translatedTexts as string)?.substring(0, 50)]
      });

      // 5. 渲染翻译结果 (Requirements 3.1)
      console.log('[TranslationController] 步骤 5: 渲染翻译结果');
      const translatedTextsArray = Array.isArray(translatedTexts) 
        ? translatedTexts 
        : [translatedTexts];

      const styleOptions = {
        fontSize: this.config.fontSize,
        color: this.config.fontColor,
        backgroundColor: this.config.backgroundColor,
      };

      const renderStartTime = performance.now();
      const wrapper = await renderTranslation(img, textAreas, translatedTextsArray, styleOptions);
      const renderDuration = (performance.now() - renderStartTime).toFixed(2);

      // 6. 记录覆盖层
      if (wrapper) {
        this.state.activeOverlays.set(imageKey, wrapper);
        console.log('[TranslationController] 渲染完成', {
          duration: `${renderDuration}ms`,
          overlayCreated: true,
          totalOverlays: this.state.activeOverlays.size
        });
      }

      const totalDuration = (performance.now() - startTime).toFixed(2);
      console.log('[TranslationController] ========== 图片处理完成 ==========');
      console.log('[TranslationController] 处理统计', {
        totalDuration: `${totalDuration}ms`,
        textAreasCount: textAreas.length,
        translatedCount: translatedTextsArray.length,
        ocrTime: `${ocrDuration}ms`,
        translateTime: `${translateDuration}ms`,
        renderTime: `${renderDuration}ms`
      });
    } catch (error) {
      const totalDuration = (performance.now() - startTime).toFixed(2);
      // 使用用户友好的错误消息
      const friendlyError = parseAPIError(error);
      console.error('[TranslationController] ========== 图片处理失败 ==========');
      console.error('[TranslationController] 错误详情', {
        duration: `${totalDuration}ms`,
        imageSrc: img.src.substring(0, 100),
        errorCode: friendlyError.code,
        userMessage: friendlyError.userMessage,
        suggestion: friendlyError.suggestion,
        retryable: friendlyError.retryable,
        originalError: error instanceof Error ? error.message : String(error)
      });
      // 通知 Popup 显示用户友好的错误
      this.notifyPopup('error', {
        message: friendlyError.userMessage,
        error: friendlyError.toJSON()
      });
      throw friendlyError;
    }
  }

  /**
   * 获取图片的唯一标识
   */
  private getImageKey(img: HTMLImageElement): string {
    return img.src || `img-${img.offsetLeft}-${img.offsetTop}-${img.width}-${img.height}`;
  }

  /**
   * 通知 Popup 状态更新
   */
  private notifyPopup(action: string, data?: Record<string, unknown>): void {
    try {
      // 如果是错误消息，解析为用户友好的格式
      if (action === 'error' && data && data['message']) {
        const friendlyError = parseAPIError(new Error(data['message'] as string));
        chrome.runtime.sendMessage({
          action,
          error: friendlyError.toJSON(),
          message: friendlyError.userMessage,
          ...data,
        });
      } else {
        chrome.runtime.sendMessage({
          action,
          ...data,
        });
      }
    } catch (_error) {
      // Popup 可能未打开，静默处理
    }
  }

  /**
   * 销毁控制器，清理资源
   */
  public async destroy(): Promise<void> {
    console.log('[TranslationController] 开始销毁控制器');

    // 停止翻译
    this.stop();

    // 移除监听器
    if (this.messageListener) {
      chrome.runtime.onMessage.removeListener(this.messageListener);
      this.messageListener = null;
    }

    if (this.storageListener) {
      chrome.storage.onChanged.removeListener(this.storageListener);
      this.storageListener = null;
    }

    // 释放 OCR 资源
    try {
      await terminateOCRProviders();
    } catch (error) {
      console.error('[TranslationController] 释放 OCR 资源失败:', error);
    }

    console.log('[TranslationController] 控制器已销毁');
  }

  /**
   * 获取当前状态
   */
  public getState(): {
    isProcessing: boolean;
    processedCount: number;
    overlayCount: number;
  } {
    return {
      isProcessing: this.state.isProcessing,
      processedCount: this.state.processedImages.size,
      overlayCount: this.state.activeOverlays.size,
    };
  }

  /**
   * 更新配置
   */
  public updateConfig(config: Partial<TranslationControllerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// 导出单例实例
let controllerInstance: TranslationController | null = null;

/**
 * 获取 TranslationController 单例
 */
export function getTranslationController(): TranslationController {
  if (!controllerInstance) {
    controllerInstance = new TranslationController();
  }
  return controllerInstance;
}

/**
 * 初始化并返回 TranslationController
 */
export async function initializeTranslationController(
  config?: Partial<TranslationControllerConfig>
): Promise<TranslationController> {
  const controller = getTranslationController();
  
  if (config) {
    controller.updateConfig(config);
  }
  
  await controller.initialize();
  return controller;
}
