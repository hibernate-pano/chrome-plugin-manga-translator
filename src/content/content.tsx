/**
 * 内容脚本入口
 */

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

// 处理页面（自动模式）
function processPage() {
  const images = document.querySelectorAll('img');
  images.forEach(img => {
    if (isImageCandidate(img)) {
      processImage(img);
    }
  });
}

// 判断图片是否是候选图片
function isImageCandidate(img: HTMLImageElement): boolean {
  // 简单的启发式规则
  return img.width > 100 && img.height > 100;
}

// 处理单个图片
async function processImage(img: HTMLImageElement) {
  if (translationState.processing) {
    return;
  }

  try {
    translationState.processing = true;
    console.log('处理图片:', img.src);
    
    // 这里应该调用OCR和翻译API
    // 暂时只是模拟
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('图片处理完成');
  } catch (error) {
    console.error('图片处理失败:', error);
  } finally {
    translationState.processing = false;
  }
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
