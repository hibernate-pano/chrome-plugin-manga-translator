/**
 * 内容脚本入口
 */

// 导入必要的模块
import { APIManager } from '../api/api-manager';
import { imageToBase64 } from '../utils/imageProcess';
import { renderTranslation, removeTranslation } from './renderer';

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
  progressElement: null as HTMLElement | null
};

// 处理页面（自动模式）
async function processPage() {
  if (batchProcessingState.isProcessing) {
    return;
  }
  
  // 获取所有候选图像
  const images = Array.from(document.querySelectorAll('img'))
    .filter(img => isImageCandidate(img));
  
  if (images.length === 0) {
    console.log('未找到符合条件的图像');
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
    progressElement: createProgressElement()
  };
  
  // 显示进度条
  document.body.appendChild(batchProcessingState.progressElement!);
  
  try {
    // 分批处理图像，每批处理5张，避免同时处理太多图像
    const batchSize = 5;
    for (let i = 0; i < images.length; i += batchSize) {
      if (batchProcessingState.cancelled) {
        break;
      }
      
      // 暂停检查
      while (batchProcessingState.isPaused) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // 处理当前批次
      const batch = images.slice(i, i + batchSize);
      const batchPromises = batch.map(img => processImage(img));
      
      // 等待当前批次完成
      await Promise.all(batchPromises);
      
      // 更新进度
      batchProcessingState.processedImages += batch.length;
      batchProcessingState.currentImageIndex += batch.length;
      updateProgress();
    }
    
    if (!batchProcessingState.cancelled) {
      showNotification(`已成功完成 ${batchProcessingState.processedImages} 张图像的翻译`, 'success');
    }
  } catch (error) {
    console.error('批量处理失败:', error);
    showNotification('批量处理失败，请重试', 'error');
  } finally {
    // 清理
    batchProcessingState.isProcessing = false;
    if (batchProcessingState.progressElement && batchProcessingState.progressElement.parentNode) {
      batchProcessingState.progressElement.parentNode.removeChild(batchProcessingState.progressElement);
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
function updateProgress() {
  if (!batchProcessingState.progressElement) {
    return;
  }
  
  const progress = (batchProcessingState.processedImages / batchProcessingState.totalImages) * 100;
  
  // 更新进度条
  const progressFill = batchProcessingState.progressElement.querySelector('.manga-translator-progress-fill') as HTMLElement;
  if (progressFill) {
    progressFill.style.width = `${progress}%`;
  }
  
  // 更新进度文本
  const progressText = batchProcessingState.progressElement.querySelector('.manga-translator-progress-text');
  if (progressText) {
    const status = batchProcessingState.isPaused ? '（已暂停）' : '';
    progressText.textContent = `${batchProcessingState.processedImages} / ${batchProcessingState.totalImages} 张图像 ${status}`;
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
  if (translationState.processing) {
    return;
  }

  try {
    translationState.processing = true;
    console.log('处理图片:', img.src);
    
    // 1. 将图像转换为Base64格式
    const base64Image = await imageToBase64(img);
    
    // 2. 调用API管理器进行文字检测
    const apiManager = APIManager.getInstance();
    const textAreas = await apiManager.detectText(base64Image, {
      language: 'jpn', // 默认为日语，可根据配置调整
      preprocess: true
    });
    
    console.log('检测到的文字区域:', textAreas);
    
    // 3. 如果没有检测到文字，直接返回
    if (!textAreas || textAreas.length === 0) {
      console.log('未检测到文字区域');
      return;
    }
    
    // 4. 调用API管理器进行翻译
    const texts = textAreas.map((area: any) => area.text);
    const translatedTexts = await apiManager.translateText(
      texts,
      translationState.targetLanguage
    );
    
    console.log('翻译结果:', translatedTexts);
    
    // 5. 渲染翻译结果
    const translatedTextsArray = Array.isArray(translatedTexts) ? translatedTexts : [translatedTexts];
    renderTranslation(img, textAreas, translatedTextsArray, {
      fontSize: 'auto',
      color: '#000000',
      backgroundColor: 'rgba(255, 255, 255, 0.8)'
    });
    
    // 6. 将处理结果添加到状态管理
    translationState.translatedImages.set(img.src, {
      textAreas,
      translatedTexts,
      timestamp: Date.now()
    });
    
    console.log('图片处理完成');
  } catch (error) {
    console.error('图片处理失败:', error);
    // 显示错误提示
    showErrorNotification('图片处理失败，请重试');
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
