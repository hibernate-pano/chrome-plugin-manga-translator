/**
 * 内容脚本入口
 */

// 导入必要的模块
import { APIManager } from '../api/api-manager';
import { renderTranslation } from './renderer';
import { detectTextAreas } from './detector';

// 翻译状态接口
interface TranslationState {
  enabled: boolean;
  mode: 'manual' | 'auto';
  targetLanguage: string;
  processing: boolean;
  translatedImages: Map<string, any>;
}

// 存储翻译状态
let translationState: TranslationState = {
  enabled: false,
  mode: 'manual',
  targetLanguage: 'zh-CN',
  processing: false,
  translatedImages: new Map()
};

// 初始化
async function initialize() {
  try {
    // 加载配置
    const config = await getConfig();

    translationState = {
      ...translationState,
      enabled: config.enabled || false,
      mode: config.mode || 'manual',
      targetLanguage: config.targetLanguage || 'zh-CN'
    };

    // 设置事件监听器
    setupEventListeners();

    // 如果启用了自动模式，开始处理页面
    if (translationState.enabled && translationState.mode === 'auto') {
      processPage();
    }

    // 监听来自弹出窗口的消息
    chrome.runtime.onMessage.addListener(handleMessages);

    // 页面卸载时释放资源
    window.addEventListener('beforeunload', cleanup);

    console.log('漫画翻译助手已初始化');
  } catch (error) {
    console.error('初始化失败:', error);
  }
}

// 获取配置
async function getConfig(): Promise<any> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(null, (config) => {
      resolve(config);
    });
  });
}

// 获取完整配置（从Chrome Storage）
async function getFullConfig(): Promise<any> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(null, (config) => {
      resolve(config);
    });
  });
}

// 设置事件监听器
function setupEventListeners() {
  // 监听鼠标点击事件（手动模式）
  document.addEventListener('click', handleClick);
  
  // 监听键盘快捷键
  document.addEventListener('keydown', handleKeydown);
}

// 处理点击事件
function handleClick(event: MouseEvent) {
  if (!translationState.enabled || translationState.mode !== 'manual') {
    return;
  }

  const target = event.target as HTMLElement;
  if (target && target.tagName === 'IMG') {
    event.preventDefault();
    processImage(target as HTMLImageElement);
  }
}

// 处理键盘事件
function handleKeydown(event: KeyboardEvent) {
  // Alt + T: 切换翻译状态
  if (event.altKey && event.key === 't') {
    event.preventDefault();
    toggleTranslation();
  }
}

// 处理消息
function handleMessages(request: any, _sender: any, sendResponse: (response: any) => void) {
  switch (request.action) {
    case 'toggle':
      toggleTranslation();
      sendResponse({ success: true });
      break;
      
    case 'setMode':
      translationState.mode = request.mode;
      sendResponse({ success: true });
      break;
      
    case 'setLanguage':
      translationState.targetLanguage = request.language;
      sendResponse({ success: true });
      break;
      
    case 'getState':
      sendResponse(translationState);
      break;
      
    default:
      sendResponse({ error: 'Unknown action' });
  }
}

// 切换翻译状态
function toggleTranslation() {
  translationState.enabled = !translationState.enabled;
  
  if (translationState.enabled && translationState.mode === 'auto') {
    processPage();
  } else if (!translationState.enabled) {
    clearTranslations();
  }
  
  console.log('翻译状态:', translationState.enabled ? '启用' : '禁用');
}

// 批量处理控制状态
let batchProcessingState = {
  isProcessing: false,
  isPaused: false,
  currentImageIndex: 0,
  totalImages: 0,
  processedImages: 0,
  cancelled: false,
  progressElement: null as HTMLElement | null,
  startTime: 0
};

// 处理页面（自动模式）
async function processPage() {
  // 如果已经在处理中且未暂停，则直接返回
  if (batchProcessingState.isProcessing && !batchProcessingState.isPaused && batchProcessingState.totalImages > 0) {
    return;
  }
  
  // 获取所有候选图像
  let images;
  if (batchProcessingState.totalImages === 0) {
    // 首次调用，初始化图像列表
    images = Array.from(document.querySelectorAll('img'))
      .filter(img => isImageCandidate(img));
    
    if (images.length === 0) {
      console.log('未找到符合条件的图像');
      showNotification('未找到符合条件的图像', 'info');
      return;
    }
    
    // 初始化批量处理状态
    batchProcessingState = {
      isProcessing: true,
      isPaused: false,
      currentImageIndex: 0,
      totalImages: images.length,
      processedImages: 0,
      cancelled: false,
      progressElement: createProgressElement(),
      startTime: Date.now()
    };
    
    // 显示进度条
    document.body.appendChild(batchProcessingState.progressElement!);
    
    // 显示开始通知
    showNotification(`开始处理 ${images.length} 张图像`, 'info');
  } else {
    // 继续处理，使用之前的图像列表
    images = Array.from(document.querySelectorAll('img'))
      .filter(img => isImageCandidate(img));
  }
  
  try {
    // 分批处理图像，每批处理5张，避免同时处理太多图像
    const batchSize = 5;
    const startIndex = batchProcessingState.currentImageIndex;
    
    for (let i = startIndex; i < images.length; i += batchSize) {
      if (batchProcessingState.cancelled) {
        break;
      }
      
      // 暂停检查
      while (batchProcessingState.isPaused) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // 处理当前批次
      const batch = images.slice(i, i + batchSize);
      
      // 使用Promise.allSettled处理，允许单个图像处理失败
      const batchResults = await Promise.allSettled(
        batch.map(img => processImage(img).catch(error => {
          console.error(`处理图像失败: ${img.src}`, error);
          return null;
        }))
      );
      
      // 统计成功处理的图像数量
      const successfulCount = batchResults.filter(result => result.status === 'fulfilled').length;
      
      // 更新进度
      batchProcessingState.processedImages += successfulCount;
      batchProcessingState.currentImageIndex += batch.length;
      updateProgress(images);
      
      // 显示批次完成通知
      showNotification(`已完成批次 ${Math.ceil((i + batch.length) / batchSize)} / ${Math.ceil(images.length / batchSize)}`, 'info');
    }
    
    if (!batchProcessingState.cancelled) {
      const totalTime = (Date.now() - batchProcessingState.startTime!) / 1000;
      const speed = batchProcessingState.processedImages / totalTime;
      showNotification(
        `已成功完成 ${batchProcessingState.processedImages} / ${batchProcessingState.totalImages} 张图像的翻译，平均速度: ${speed.toFixed(2)} 张/秒`, 
        'success'
      );
    }
  } catch (error) {
    console.error('批量处理失败:', error);
    showNotification('批量处理失败，请重试', 'error');
  } finally {
    // 清理
    if (!batchProcessingState.isPaused || batchProcessingState.cancelled) {
      batchProcessingState.isProcessing = false;
      if (batchProcessingState.progressElement && batchProcessingState.progressElement.parentNode) {
        batchProcessingState.progressElement.parentNode.removeChild(batchProcessingState.progressElement);
      }
    }
  }
}

// 暂停批量处理
function pauseBatchProcessing() {
  batchProcessingState.isPaused = true;
  updateProgress();
}

// 继续批量处理
function resumeBatchProcessing() {
  batchProcessingState.isPaused = false;
  updateProgress();
  // 如果暂停后继续，重新调用processPage继续处理
  if (batchProcessingState.isProcessing && !batchProcessingState.cancelled) {
    processPage();
  }
}

// 取消批量处理
function cancelBatchProcessing() {
  batchProcessingState.cancelled = true;
  batchProcessingState.isProcessing = false;
  if (batchProcessingState.progressElement && batchProcessingState.progressElement.parentNode) {
    batchProcessingState.progressElement.parentNode.removeChild(batchProcessingState.progressElement);
  }
  showNotification('批量处理已取消');
}

// 创建进度条元素
function createProgressElement(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'manga-translator-progress-container';
  container.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    width: 300px;
    background-color: rgba(255, 255, 255, 0.95);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 9999;
    padding: 16px;
    font-family: Arial, sans-serif;
  `;
  
  // 标题
  const title = document.createElement('div');
  title.textContent = '漫画翻译处理中...';
  title.style.cssText = `
    font-weight: bold;
    margin-bottom: 12px;
    color: #333;
    font-size: 14px;
  `;
  container.appendChild(title);
  
  // 进度条
  const progressBar = document.createElement('div');
  progressBar.className = 'manga-translator-progress-bar';
  progressBar.style.cssText = `
    height: 6px;
    background-color: #e9ecef;
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 8px;
  `;
  
  const progressFill = document.createElement('div');
  progressFill.className = 'manga-translator-progress-fill';
  progressFill.style.cssText = `
    height: 100%;
    background-color: #007bff;
    width: 0%;
    transition: width 0.3s ease;
    border-radius: 3px;
  `;
  progressBar.appendChild(progressFill);
  container.appendChild(progressBar);
  
  // 进度文本
  const progressText = document.createElement('div');
  progressText.className = 'manga-translator-progress-text';
  progressText.textContent = '0 / 0 张图像';
  progressText.style.cssText = `
    font-size: 12px;
    color: #666;
    margin-bottom: 12px;
    text-align: center;
  `;
  container.appendChild(progressText);
  
  // 控制按钮
  const controls = document.createElement('div');
  controls.style.cssText = `
    display: flex;
    justify-content: center;
    gap: 8px;
  `;
  
  // 暂停/继续按钮
  const pauseButton = document.createElement('button');
  pauseButton.textContent = '暂停';
  pauseButton.className = 'manga-translator-progress-button';
  pauseButton.style.cssText = `
    padding: 6px 12px;
    border: 1px solid #007bff;
    background-color: #fff;
    color: #007bff;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.2s;
  `;
  pauseButton.onmouseover = () => {
    pauseButton.style.backgroundColor = '#f0f4f8';
  };
  pauseButton.onmouseout = () => {
    pauseButton.style.backgroundColor = '#fff';
  };
  pauseButton.onclick = () => {
    if (batchProcessingState.isPaused) {
      resumeBatchProcessing();
      pauseButton.textContent = '暂停';
    } else {
      pauseBatchProcessing();
      pauseButton.textContent = '继续';
    }
  };
  controls.appendChild(pauseButton);
  
  // 取消按钮
  const cancelButton = document.createElement('button');
  cancelButton.textContent = '取消';
  cancelButton.className = 'manga-translator-progress-button';
  cancelButton.style.cssText = `
    padding: 6px 12px;
    border: 1px solid #dc3545;
    background-color: #fff;
    color: #dc3545;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.2s;
  `;
  cancelButton.onmouseover = () => {
    cancelButton.style.backgroundColor = '#fff5f5';
  };
  cancelButton.onmouseout = () => {
    cancelButton.style.backgroundColor = '#fff';
  };
  cancelButton.onclick = cancelBatchProcessing;
  controls.appendChild(cancelButton);
  
  container.appendChild(controls);
  
  return container;
}

// 更新进度条
function updateProgress(images?: HTMLImageElement[]) {
  if (!batchProcessingState.progressElement) {
    return;
  }
  
  const progress = (batchProcessingState.processedImages / batchProcessingState.totalImages) * 100;
  
  // 计算统计信息
  const currentTime = Date.now();
  const elapsedTime = currentTime - batchProcessingState.startTime;
  const speed = elapsedTime > 0 ? batchProcessingState.processedImages / (elapsedTime / 1000) : 0;
  const remainingImages = batchProcessingState.totalImages - batchProcessingState.processedImages;
  const estimatedRemainingTime = speed > 0 ? Math.ceil(remainingImages / speed) : 0;
  
  // 格式化剩余时间
  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}秒`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}分${remainingSeconds}秒`;
  };
  
  // 更新进度条
  const progressFill = batchProcessingState.progressElement.querySelector('.manga-translator-progress-fill') as HTMLElement;
  if (progressFill) {
    progressFill.style.width = `${progress}%`;
    
    // 根据进度更新颜色
    let progressColor = '#007bff';
    if (progress < 30) progressColor = '#007bff';
    else if (progress < 70) progressColor = '#28a745';
    else progressColor = '#ffc107';
    
    progressFill.style.backgroundColor = progressColor;
  }
  
  // 更新进度文本
  const progressText = batchProcessingState.progressElement.querySelector('.manga-translator-progress-text');
  if (progressText) {
    const status = batchProcessingState.isPaused ? '（已暂停）' : '';
    const remainingTimeStr = estimatedRemainingTime > 0 ? `，预计剩余 ${formatTime(estimatedRemainingTime)}` : '';
    const speedStr = speed > 0 ? `，速度：${speed.toFixed(1)} 张/秒` : '';
    
    progressText.textContent = 
      `${batchProcessingState.processedImages} / ${batchProcessingState.totalImages} 张图像 ` +
      `${Math.round(progress)}%${status}${speedStr}${remainingTimeStr}`;
  }
  
  // 更新暂停/继续按钮文本
  const pauseButton = batchProcessingState.progressElement.querySelector('.manga-translator-progress-button') as HTMLElement;
  if (pauseButton) {
    pauseButton.textContent = batchProcessingState.isPaused ? '继续' : '暂停';
  }
}

// 通知类型枚举
type NotificationType = 'success' | 'error' | 'warning' | 'info';

// 通知队列管理
const notificationQueue: HTMLElement[] = [];
const MAX_NOTIFICATIONS = 3;
let notificationCounter = 0;

// 显示通知
function showNotification(message: string, type: NotificationType = 'info', duration = 3000) {
  notificationCounter++;
  const notificationId = `manga-translator-notification-${notificationCounter}`;
  
  // 创建通知容器
  const notification = document.createElement('div');
  notification.id = notificationId;
  notification.className = `manga-translator-notification manga-translator-${type}`;
  
  // 根据类型设置图标
  const iconMap = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };
  
  notification.innerHTML = `
    <div class="manga-translator-notification-content">
      <span class="manga-translator-notification-icon">${iconMap[type]}</span>
      <span class="manga-translator-notification-message">${message}</span>
      <button class="manga-translator-notification-close" title="关闭">×</button>
    </div>
  `;
  
  // 添加现代化样式
  notification.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 16px 20px;
    border-radius: 8px;
    z-index: 99999;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    animation: manga-translator-notification-slide-in 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    transition: all 0.3s ease;
    max-width: 350px;
    min-width: 280px;
    overflow: hidden;
  `;
  
  // 根据类型设置颜色
  const typeStyles = {
    success: {
      backgroundColor: 'rgba(34, 197, 94, 0.95)',
      color: 'white',
      borderLeft: '4px solid #16a34a'
    },
    error: {
      backgroundColor: 'rgba(239, 68, 68, 0.95)',
      color: 'white',
      borderLeft: '4px solid #dc2626'
    },
    warning: {
      backgroundColor: 'rgba(251, 191, 36, 0.95)',
      color: 'white',
      borderLeft: '4px solid #f59e0b'
    },
    info: {
      backgroundColor: 'rgba(59, 130, 246, 0.95)',
      color: 'white',
      borderLeft: '4px solid #2563eb'
    }
  };
  
  const styles = typeStyles[type];
  Object.entries(styles).forEach(([key, value]) => {
    notification.style[key as any] = value;
  });
  
  // 添加内部样式
  const contentStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  };
  
  const iconStyle = {
    fontSize: '18px',
    flexShrink: '0'
  };
  
  const messageStyle = {
    flexGrow: '1',
    lineHeight: '1.4',
    wordBreak: 'break-word'
  };
  
  const closeStyle = {
    background: 'transparent',
    border: 'none',
    color: 'inherit',
    fontSize: '18px',
    cursor: 'pointer',
    padding: '0',
    width: '20px',
    height: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    transition: 'background-color 0.2s ease'
  };
  
  // 添加基础样式到页面
  if (!document.getElementById('manga-translator-notification-styles')) {
    const style = document.createElement('style');
    style.id = 'manga-translator-notification-styles';
    style.textContent = `
      @keyframes manga-translator-notification-slide-in {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      
      @keyframes manga-translator-notification-slide-out {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(100%);
          opacity: 0;
        }
      }
      
      .manga-translator-notification-content {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      
      .manga-translator-notification-icon {
        font-size: 18px;
        flex-shrink: 0;
      }
      
      .manga-translator-notification-message {
        flex-grow: 1;
        line-height: 1.4;
        word-break: break-word;
      }
      
      .manga-translator-notification-close {
        background: transparent;
        border: none;
        color: inherit;
        font-size: 18px;
        cursor: pointer;
        padding: 0;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background-color 0.2s ease;
      }
      
      .manga-translator-notification-close:hover {
        background-color: rgba(255, 255, 255, 0.2);
      }
      
      .manga-translator-notification-close:active {
        background-color: rgba(255, 255, 255, 0.3);
      }
    `;
    document.head.appendChild(style);
  }
  
  // 添加关闭按钮事件
  const closeBtn = notification.querySelector('.manga-translator-notification-close') as HTMLButtonElement;
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      removeNotification(notification);
    });
  }
  
  // 添加到页面
  document.body.appendChild(notification);
  
  // 管理通知队列
  notificationQueue.push(notification);
  
  // 如果通知数量超过限制，移除最旧的通知
  if (notificationQueue.length > MAX_NOTIFICATIONS) {
    const oldestNotification = notificationQueue.shift();
    if (oldestNotification && oldestNotification.parentNode) {
      removeNotification(oldestNotification);
    }
  }
  
  // 更新通知位置
  updateNotificationPositions();
  
  // 自动移除通知
  if (duration > 0) {
    setTimeout(() => {
      removeNotification(notification);
    }, duration);
  }
}

// 移除通知
function removeNotification(notification: HTMLElement) {
  // 查找通知在队列中的索引
  const index = notificationQueue.indexOf(notification);
  if (index > -1) {
    notificationQueue.splice(index, 1);
  }
  
  // 添加退出动画
  notification.style.animation = 'manga-translator-notification-slide-out 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards';
  
  // 动画结束后移除元素
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
      // 更新剩余通知位置
      updateNotificationPositions();
    }
  }, 300);
}

// 更新通知位置
function updateNotificationPositions() {
  notificationQueue.forEach((notification, index) => {
    const offset = index * 80; // 每个通知高度约为70px，加10px间距
    notification.style.bottom = `${20 + offset}px`;
  });
}

// 判断图片是否是候选图片
function isImageCandidate(img: HTMLImageElement): boolean {
  // 排除某些类型的图像
  if (img.src.includes('data:image') && img.width < 50 && img.height < 50) {
    return false; // 排除小图标
  }
  
  // 排除可能是广告的图像
  if (img.alt && (img.alt.includes('广告') || img.alt.includes('AD') || img.alt.includes('ad'))) {
    return false;
  }
  
  // 排除可能是头像的图像
  if (img.width < 150 && img.height < 150 && img.src.includes('avatar')) {
    return false;
  }
  
  // 简单的启发式规则：宽度和高度都大于150px，适合漫画图像
  return img.width > 150 && img.height > 150;
}

// 取消批量处理的外部接口
export function cancelBatchProcess() {
  cancelBatchProcessing();
}

// 暂停/继续批量处理的外部接口
export function toggleBatchProcess() {
  if (batchProcessingState.isPaused) {
    resumeBatchProcessing();
  } else {
    pauseBatchProcessing();
  }
}

// 处理单个图片
async function processImage(img: HTMLImageElement) {
  // 防止重复处理
  if (translationState.processing) {
    console.log('正在处理其他图片，跳过本次处理');
    return;
  }

  // 检查是否已处理过此图片
  if (translationState.translatedImages.has(img.src)) {
    const cached = translationState.translatedImages.get(img.src);
    const CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24小时
    if (cached && Date.now() - cached.timestamp < CACHE_MAX_AGE) {
      console.log('使用缓存的翻译结果');
      renderTranslation(img, cached.textAreas, cached.translatedTexts, {
        fontSize: 'auto',
        color: '#000000',
        backgroundColor: 'rgba(255, 255, 255, 0.8)'
      });
      return;
    }
  }

  try {
    translationState.processing = true;
    const startTime = performance.now();
    console.log('开始处理图片:', img.src);
    
    // 获取当前配置
    const fullConfig = await getFullConfig();
    const configState = fullConfig['manga-translator-config'] || {};
    const debugMode = configState.advancedSettings?.debugMode || false;
    
    // 显示处理中通知
    if (debugMode) {
      showNotification('开始检测文字...', 'info', 2000);
    }
    
    // 1. 检测图像中的文字区域（使用优化的OCR检测）
    let textAreas;
    try {
      textAreas = await detectTextAreas(img, {
        useCache: configState.advancedSettings?.cacheResults !== false,
        debugMode: debugMode,
        preferredOCRMethod: configState.ocrSettings?.preferredMethod || 'auto'
      });
      
      if (debugMode) {
        console.log('检测到的文字区域:', textAreas);
      }
    } catch (ocrError) {
      console.error('OCR检测失败:', ocrError);
      const errorMessage = ocrError instanceof Error ? ocrError.message : '未知错误';
      showErrorNotification(`文字检测失败: ${errorMessage}`);
      throw new Error('OCR检测失败');
    }
    
    // 2. 如果没有检测到文字，直接返回
    if (!textAreas || textAreas.length === 0) {
      console.log('未检测到文字区域');
      if (debugMode) {
        showNotification('未检测到文字区域', 'warning', 3000);
      }
      return;
    }
    
    // 显示翻译中通知
    if (debugMode) {
      showNotification(`检测到 ${textAreas.length} 个文字区域，开始翻译...`, 'info', 2000);
    }
    
    // 3. 调用API管理器进行翻译
    const apiManager = APIManager.getInstance();
    
    // 确保API管理器已初始化
    try {
      await apiManager.initialize();
    } catch (initError) {
      console.error('API管理器初始化失败:', initError);
      showErrorNotification('API初始化失败，请检查配置');
      throw initError;
    }
    
    // 提取文本内容
    const texts = textAreas
      .map((area: any) => area.text)
      .filter((text: string) => text && text.trim().length > 0);
    
    if (texts.length === 0) {
      console.log('提取的文本为空');
      if (debugMode) {
        showNotification('提取的文本为空', 'warning', 3000);
      }
      return;
    }
    
    // 翻译文本
    let translatedTexts: string | string[];
    try {
      // 获取目标语言（优先使用同步的配置，否则使用本地状态）
      const translationConfig = fullConfig['manga-translator-storage'] || {};
      const targetLanguage = translationConfig.targetLanguage || translationState.targetLanguage || 'zh-CN';
      translatedTexts = await apiManager.translateText(
        texts,
        targetLanguage,
        {
          sourceLanguage: 'auto',
          context: 'manga'
        }
      );
      
      if (debugMode) {
        console.log('翻译结果:', translatedTexts);
      }
    } catch (translateError) {
      console.error('翻译失败:', translateError);
      const errorMessage = translateError instanceof Error ? translateError.message : '未知错误';
      showErrorNotification(`翻译失败: ${errorMessage}`);
      throw new Error(`翻译失败: ${errorMessage}`);
    }
    
    // 4. 准备样式选项
    const styleOptions = {
      fontSize: configState.fontSize || 'auto',
      fontColor: configState.fontColor || 'auto',
      backgroundColor: configState.backgroundColor || 'auto',
      fontFamily: configState.fontFamily || '',
      styleLevel: configState.styleLevel || 50,
      showOriginalText: configState.advancedSettings?.showOriginalText || false
    };
    
    // 5. 渲染翻译结果
    const translatedTextsArray = Array.isArray(translatedTexts) ? translatedTexts : [translatedTexts];
    
    try {
      renderTranslation(img, textAreas, translatedTextsArray, styleOptions);
    } catch (renderError) {
      console.error('渲染失败:', renderError);
      showErrorNotification('渲染翻译结果失败');
      throw renderError;
    }
    
    // 6. 将处理结果添加到状态管理
    translationState.translatedImages.set(img.src, {
      textAreas,
      translatedTexts: translatedTextsArray,
      timestamp: Date.now()
    });
    
    // 显示成功通知
    const processingTime = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`图片处理完成，耗时: ${processingTime}秒`);
    
    if (debugMode) {
      showNotification(`翻译完成 (${processingTime}秒)`, 'success', 2000);
    }
  } catch (error) {
    console.error('图片处理失败:', error);
    
    // 提供更详细的错误信息
    let errorMessage = '图片处理失败，请重试';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    
    showErrorNotification(errorMessage);
  } finally {
    translationState.processing = false;
  }
}

// 显示错误通知 - 使用新的通知系统
function showErrorNotification(message: string) {
  showNotification(message, 'error', 4000); // 错误通知显示4秒
}

// 清除所有翻译
function clearTranslations() {
  translationState.translatedImages.clear();
  // 移除所有翻译覆盖层
  const overlays = document.querySelectorAll('.manga-translation-overlay');
  overlays.forEach(overlay => overlay.remove());
}

// 清理资源
function cleanup() {
  document.removeEventListener('click', handleClick);
  document.removeEventListener('keydown', handleKeydown);
  clearTranslations();
}

// 启动初始化
initialize();
