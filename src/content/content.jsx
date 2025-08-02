/**
 * 内容脚本入口
 */
import { detectTextAreas, terminateOCRProviders } from './detector';
import { translateImageText } from './translator';
import { renderTranslation, removeTranslation, showDebugAreas } from './renderer';
import { getConfig } from '../utils/storage';
import { initializeProvider } from '../utils/api';

// 存储翻译状态
let translationState = {
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

    // 初始化API提供者
    await initializeProvider();

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

// 清理资源
async function cleanup() {
  try {
    console.log('释放OCR资源...');
    await terminateOCRProviders();
  } catch (error) {
    console.error('释放OCR资源失败:', error);
  }
}

// 设置事件监听器
function setupEventListeners() {
  // 图像点击事件（手动模式）
  document.addEventListener('click', handleImageClick);

  // 监听页面变化（自动模式）
  if (MutationObserver) {
    const observer = new MutationObserver(mutations => {
      if (translationState.enabled && translationState.mode === 'auto') {
        // 检查是否有新图像添加
        const hasNewImages = mutations.some(mutation => {
          return Array.from(mutation.addedNodes).some(node => {
            return node.nodeName === 'IMG' ||
              (node.nodeType === Node.ELEMENT_NODE && node.querySelector('img'));
          });
        });

        if (hasNewImages) {
          processPage();
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // 快捷键
  document.addEventListener('keydown', async (e) => {
    const config = await getConfig();
    const shortcuts = config.shortcuts || {};

    // 解析快捷键
    const pressedKeys = [];
    if (e.ctrlKey) pressedKeys.push('Ctrl');
    if (e.altKey) pressedKeys.push('Alt');
    if (e.shiftKey) pressedKeys.push('Shift');
    if (!['Control', 'Alt', 'Shift'].includes(e.key)) {
      pressedKeys.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
    }

    const pressedShortcut = pressedKeys.join('+');

    // 切换翻译
    if (pressedShortcut === shortcuts.toggleTranslation) {
      e.preventDefault();
      translationState.enabled = !translationState.enabled;

      // 更新配置
      await saveConfig({ enabled: translationState.enabled });

      // 如果启用了自动模式，开始处理页面
      if (translationState.enabled && translationState.mode === 'auto') {
        processPage();
      } else if (!translationState.enabled) {
        // 移除所有翻译
        removeAllTranslations();
      }
    }

    // 翻译选中区域
    if (pressedShortcut === shortcuts.translateSelected) {
      e.preventDefault();
      translateSelectedImage();
    }
  });
}

// 处理图像点击事件
async function handleImageClick(e) {
  if (!translationState.enabled || translationState.mode !== 'manual') {
    return;
  }

  // 检查是否点击了图像
  const target = e.target;
  if (target.nodeName !== 'IMG') {
    return;
  }

  // 检查图像是否足够大（避免处理小图标）
  if (target.width < 100 || target.height < 100) {
    return;
  }

  // 检查是否已经翻译过
  if (target.closest('.manga-translator-wrapper')) {
    return;
  }

  // 阻止事件冒泡
  e.preventDefault();
  e.stopPropagation();

  // 翻译图像
  await translateImage(target);
}

// 翻译选中的图像
async function translateSelectedImage() {
  // 获取当前选中的元素
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;

  // 查找选中区域内的图像
  let images = [];

  if (container.nodeName === 'IMG') {
    images.push(container);
  } else if (container.nodeType === Node.ELEMENT_NODE) {
    images = Array.from(container.querySelectorAll('img'));
  }

  // 过滤掉小图像
  images = images.filter(img => img.width >= 100 && img.height >= 100);

  // 翻译找到的图像
  for (const image of images) {
    if (!image.closest('.manga-translator-wrapper')) {
      await translateImage(image);
    }
  }
}

// 处理页面上的所有图像（自动模式）
async function processPage() {
  if (!translationState.enabled || translationState.mode !== 'auto' || translationState.processing) {
    return;
  }

  translationState.processing = true;

  try {
    // 获取页面上的所有图像
    const images = Array.from(document.querySelectorAll('img'));

    // 过滤掉小图像和已翻译的图像
    const validImages = images.filter(img =>
      img.width >= 100 &&
      img.height >= 100 &&
      !img.closest('.manga-translator-wrapper')
    );

    // 翻译图像
    for (const image of validImages) {
      await translateImage(image);
    }
  } catch (error) {
    console.error('处理页面失败:', error);
  } finally {
    translationState.processing = false;
  }
}

// 翻译单个图像
async function translateImage(image) {
  try {
    // 尝试设置crossOrigin属性以处理跨域图像
    try {
      // 只对非data和非blob URL设置crossOrigin
      if (!image.src.startsWith('data:') && !image.src.startsWith('blob:')) {
        image.crossOrigin = 'anonymous';
      }
    } catch (corsError) {
      console.warn('无法设置crossOrigin属性:', corsError);
    }

    // 检查图像是否已加载
    if (!image.complete) {
      await new Promise(resolve => {
        image.onload = resolve;
        image.onerror = resolve;
      });
    }

    // 获取配置
    const config = await getConfig();

    // 显示加载指示器
    const loadingIndicator = showLoadingIndicator(image);

    // 获取目标语言
    const targetLanguage = translationState.targetLanguage || config.targetLanguage;

    // 检测文字区域
    const textAreas = await detectTextAreas(image);

    // 没有检测到文字区域
    if (!textAreas || textAreas.length === 0) {
      removeLoadingIndicator(loadingIndicator);
      showError(image, '未检测到文字区域');
      return;
    }

    // 如果开启了调试模式，显示检测到的区域
    if (config.advancedSettings?.debugMode) {
      showDebugAreas(image, textAreas);
    }

    // 翻译文本
    const translatedTexts = await translateImageText(image, textAreas, targetLanguage);

    // 渲染翻译
    const styleOptions = {
      styleLevel: config.styleLevel || 50,
      fontFamily: config.fontFamily || '',
      fontSize: config.fontSize || 'auto',
      fontColor: config.fontColor || 'auto',
      backgroundColor: config.backgroundColor || 'auto',
      showOriginalText: config.advancedSettings?.showOriginalText || false,
      renderType: config.advancedSettings?.renderType || 'overlay'
    };

    // 渲染翻译
    renderTranslation(image, textAreas, translatedTexts, styleOptions);

    // 记录已翻译的图像
    translationState.translatedImages.set(image, {
      textAreas,
      translatedTexts,
      targetLanguage
    });

    // 移除加载指示器
    removeLoadingIndicator(loadingIndicator);
  } catch (error) {
    console.error('翻译图像失败:', error);
    
    // 处理特定类型的错误
    if (error.name === 'CrossOriginError' || error.message.includes('cross-origin')) {
      await handleCorsError(image, error);
    } else if (error.message.includes('API') || error.status) {
      await handleApiError(image, error);
    } else if (error.name === 'NetworkError' || error.message.includes('network')) {
      handleNetworkError(image, error);
    } else {
      // 通用错误处理
      const loadingIndicator = document.querySelector(`.manga-translator-loading[data-image-id="${image.dataset.translatorId}"]`);
      if (loadingIndicator) {
        removeLoadingIndicator(loadingIndicator);
      }
      showError(image, `翻译失败: ${error.message}`);
    }
  }
}

// 移除所有翻译
function removeAllTranslations() {
  const wrappers = document.querySelectorAll('.manga-translator-wrapper');
  wrappers.forEach(wrapper => {
    wrapper.remove();
  });
  translationState.translatedImages.clear();
}

// 显示加载指示器
function showLoadingIndicator(image) {
  // 为图像分配一个唯一ID
  if (!image.dataset.translatorId) {
    image.dataset.translatorId = `${Date.now()  }-${  Math.random().toString(36).substring(2, 9)}`;
  }

  // 创建加载指示器
  const wrapper = document.createElement('div');
  wrapper.className = 'manga-translator-loading';
  wrapper.dataset.imageId = image.dataset.translatorId;
  wrapper.style.position = 'absolute';
  wrapper.style.top = '0';
  wrapper.style.left = '0';
  wrapper.style.width = '100%';
  wrapper.style.height = '100%';
  wrapper.style.display = 'flex';
  wrapper.style.justifyContent = 'center';
  wrapper.style.alignItems = 'center';
  wrapper.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  wrapper.style.color = 'white';
  wrapper.style.fontSize = '16px';
  wrapper.style.zIndex = '9999';

  // 创建动画
  const loadingText = document.createElement('div');
  loadingText.textContent = '翻译中...';
  loadingText.style.padding = '10px 20px';
  loadingText.style.borderRadius = '5px';
  loadingText.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';

  wrapper.appendChild(loadingText);

  // 放置加载指示器
  const rect = image.getBoundingClientRect();
  const container = document.createElement('div');
  container.style.position = 'relative';
  container.style.width = `${image.width}px`;
  container.style.height = `${image.height}px`;
  container.style.display = 'inline-block';

  // 替换图像
  image.parentNode.insertBefore(container, image);
  container.appendChild(image);
  container.appendChild(wrapper);

  return wrapper;
}

// 移除加载指示器
function removeLoadingIndicator(loadingIndicator) {
  if (loadingIndicator && loadingIndicator.parentNode) {
    loadingIndicator.remove();
  }
}

// 显示错误信息
function showError(image, message) {
  // 创建错误提示
  const errorElement = document.createElement('div');
  errorElement.className = 'manga-translator-error';
  errorElement.style.position = 'absolute';
  errorElement.style.top = '10px';
  errorElement.style.left = '10px';
  errorElement.style.padding = '5px 10px';
  errorElement.style.backgroundColor = 'rgba(255, 0, 0, 0.7)';
  errorElement.style.color = 'white';
  errorElement.style.borderRadius = '3px';
  errorElement.style.fontSize = '12px';
  errorElement.style.maxWidth = 'calc(100% - 20px)';
  errorElement.style.zIndex = '9999';
  errorElement.textContent = message;

  // 添加到图像容器
  const container = image.parentNode;
  if (container && container.style.position === 'relative') {
    container.appendChild(errorElement);

    // 自动隐藏错误信息
    setTimeout(() => {
      if (errorElement.parentNode) {
        errorElement.remove();
      }
    }, 5000);
  }
}

// 处理消息
function handleMessages(message, sender, sendResponse) {
  if (message.action === 'getState') {
    sendResponse({
      enabled: translationState.enabled,
      mode: translationState.mode,
      targetLanguage: translationState.targetLanguage
    });
  } else if (message.action === 'setState') {
    // 更新状态
    if (message.state.enabled !== undefined) {
      translationState.enabled = message.state.enabled;
    }

    if (message.state.mode !== undefined) {
      translationState.mode = message.state.mode;
    }

    if (message.state.targetLanguage !== undefined) {
      translationState.targetLanguage = message.state.targetLanguage;
    }

    // 保存配置
    saveConfig({
      enabled: translationState.enabled,
      mode: translationState.mode,
      targetLanguage: translationState.targetLanguage
    });

    // 处理启用/禁用状态变化
    if (message.state.enabled !== undefined) {
      if (message.state.enabled && translationState.mode === 'auto') {
        processPage();
      } else if (!message.state.enabled) {
        removeAllTranslations();
      }
    }

    sendResponse({ success: true });
  } else if (message.action === 'translate') {
    processPage();
    sendResponse({ success: true });
  } else if (message.action === 'clear') {
    removeAllTranslations();
    sendResponse({ success: true });
  }
}

// 处理跨域错误
async function handleCorsError(image, error) {
  console.warn('跨域错误，尝试使用代理:', error);

  // 获取配置
  const config = await getConfig();
  
  if (!config.advancedSettings?.useCorsProxy) {
    showError(image, '跨域资源访问受限，请在高级设置中启用CORS代理');
    return;
  }

  // 确定代理类型
  const proxyType = config.advancedSettings?.corsProxyType || 'corsproxy';
  const customProxy = config.advancedSettings?.customCorsProxy || '';

  // 构建代理URL
  let proxyUrl = '';
  const originalUrl = image.src;

  if (proxyType === 'custom' && customProxy) {
    // 使用自定义代理
    proxyUrl = customProxy.replace('{url}', encodeURIComponent(originalUrl));
  } else if (proxyType === 'corsproxy') {
    // 使用corsproxy.io
    proxyUrl = `https://corsproxy.io/?${encodeURIComponent(originalUrl)}`;
  } else if (proxyType === 'allorigins') {
    // 使用allorigins
    proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(originalUrl)}`;
  } else {
    showError(image, '无效的CORS代理配置');
    return;
  }

  try {
    // 创建一个新的图像并通过代理加载
    const proxyImage = new Image();
    proxyImage.crossOrigin = 'anonymous';
    
    // 复制原始图像的属性
    proxyImage.width = image.width;
    proxyImage.height = image.height;
    proxyImage.alt = image.alt;
    proxyImage.title = image.title;
    proxyImage.className = image.className;
    
    // 设置代理URL
    proxyImage.src = proxyUrl;
    
    // 等待图像加载
    await new Promise((resolve, reject) => {
      proxyImage.onload = resolve;
      proxyImage.onerror = () => reject(new Error('通过代理加载图像失败'));
      
      // 设置超时
      setTimeout(() => reject(new Error('代理请求超时')), 10000);
    });
    
    // 替换原始图像
    image.parentNode.replaceChild(proxyImage, image);
    
    // 翻译新图像
    await translateImage(proxyImage);
  } catch (proxyError) {
    console.error('使用代理加载图像失败:', proxyError);
    showError(image, `使用代理加载图像失败: ${proxyError.message}`);
  }
}

// 处理API错误
async function handleApiError(image, error) {
  console.error('API错误:', error);
  
  const errorMessage = error.message || '未知API错误';
  const statusCode = error.status || '';
  
  let userFriendlyMessage = `API错误${statusCode ? ` (${statusCode})` : ''}: ${errorMessage}`;
  
  if (errorMessage.includes('API key')) {
    userFriendlyMessage = 'API密钥无效或已过期，请在设置中更新';
  } else if (errorMessage.includes('rate limit')) {
    userFriendlyMessage = 'API请求频率超限，请稍后再试';
  }
  
  showError(image, userFriendlyMessage);
}

// 处理网络错误
function handleNetworkError(image, error) {
  console.error('网络错误:', error);
  
  const errorMessage = error.message || '未知网络错误';
  let userFriendlyMessage = `网络错误: ${errorMessage}`;
  
  if (errorMessage.includes('timeout')) {
    userFriendlyMessage = '网络请求超时，请检查网络连接';
  } else if (errorMessage.includes('offline')) {
    userFriendlyMessage = '当前处于离线状态，请连接网络后重试';
  }
  
  showError(image, userFriendlyMessage);
}

// 保存配置
async function saveConfig(config) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(config, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

// 初始化
initialize();
