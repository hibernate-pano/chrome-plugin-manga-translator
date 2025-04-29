/**
 * 内容脚本入口
 */
import { detectTextAreas } from './detector';
import { translateImageText } from './translator';
import { renderTranslation, removeTranslation, showDebugAreas } from './renderer';
import { getConfig } from '../utils/storage';

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

    // 设置事件监听器
    setupEventListeners();

    // 如果启用了自动模式，开始处理页面
    if (translationState.enabled && translationState.mode === 'auto') {
      processPage();
    }

    // 监听来自弹出窗口的消息
    chrome.runtime.onMessage.addListener(handleMessages);

    console.log('漫画翻译助手已初始化');
  } catch (error) {
    console.error('初始化失败:', error);
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
  let target = e.target;
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
    // 检查图像是否已加载
    if (!image.complete) {
      await new Promise(resolve => {
        image.onload = resolve;
        image.onerror = resolve;
      });
    }

    // 获取配置
    const config = await getConfig();

    // 检查API密钥
    if (!config.apiKey) {
      console.error('未配置API密钥');
      return;
    }

    // 显示加载指示器
    const loadingIndicator = showLoadingIndicator(image);

    try {
      // 获取API模型和URL
      const useCustomModel = config.useCustomModel || false;
      const model = useCustomModel ? config.customModel : (config.model || 'gpt-3.5-turbo');
      const apiBaseUrl = config.apiBaseUrl || 'https://api.openai.com/v1';

      // 检测文字区域
      const textAreas = await detectTextAreas(image, {
        apiKey: config.apiKey,
        apiBaseUrl: apiBaseUrl,
        model: model,
        useCache: config.advancedSettings?.cacheResults !== false,
        imagePreprocessing: config.advancedSettings?.imagePreprocessing || 'none',
        debugMode: config.advancedSettings?.debugMode || false
      });

      // 如果没有检测到文字，直接返回
      if (!textAreas || textAreas.length === 0) {
        console.log('未检测到文字');
        return;
      }

      // 在调试模式下显示文字区域
      if (config.advancedSettings?.debugMode) {
        showDebugAreas(image, textAreas);
      }

      // 翻译文字
      const translatedTexts = await translateImageText(image, textAreas, config.targetLanguage, {
        apiKey: config.apiKey,
        apiBaseUrl: apiBaseUrl,
        model: model,
        temperature: config.temperature || 0.7,
        translationPrompt: config.advancedSettings?.translationPrompt || '',
        useCache: config.advancedSettings?.cacheResults !== false,
        maxConcurrentRequests: config.advancedSettings?.maxConcurrentRequests || 3,
        debugMode: config.advancedSettings?.debugMode || false
      });

      // 渲染翻译结果
      const wrapper = renderTranslation(image, textAreas, translatedTexts, {
        styleLevel: config.styleLevel || 50,
        fontFamily: config.fontFamily || '',
        fontSize: config.fontSize || 'auto',
        fontColor: config.fontColor || 'auto',
        backgroundColor: config.backgroundColor || 'auto',
        showOriginalText: config.advancedSettings?.showOriginalText || false
      });

      // 保存翻译状态
      translationState.translatedImages.set(image, wrapper);
    } finally {
      // 移除加载指示器
      if (loadingIndicator) {
        loadingIndicator.remove();
      }
    }
  } catch (error) {
    console.error('翻译图像失败:', error);
    showError(image, error.message);
  }
}

// 移除所有翻译
function removeAllTranslations() {
  translationState.translatedImages.forEach((wrapper, image) => {
    removeTranslation(wrapper);
  });

  translationState.translatedImages.clear();
}

// 显示加载指示器
function showLoadingIndicator(image) {
  const wrapper = document.createElement('div');
  wrapper.className = 'manga-translator-loading';
  wrapper.style.position = 'absolute';
  wrapper.style.top = '0';
  wrapper.style.left = '0';
  wrapper.style.width = '100%';
  wrapper.style.height = '100%';
  wrapper.style.display = 'flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.justifyContent = 'center';
  wrapper.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  wrapper.style.color = 'white';
  wrapper.style.fontSize = '16px';
  wrapper.style.zIndex = '1000';

  const spinner = document.createElement('div');
  spinner.className = 'manga-translator-spinner';
  spinner.style.border = '4px solid rgba(255, 255, 255, 0.3)';
  spinner.style.borderTop = '4px solid white';
  spinner.style.borderRadius = '50%';
  spinner.style.width = '30px';
  spinner.style.height = '30px';
  spinner.style.animation = 'manga-translator-spin 1s linear infinite';

  const style = document.createElement('style');
  style.textContent = `
    @keyframes manga-translator-spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);

  const text = document.createElement('div');
  text.textContent = '翻译中...';
  text.style.marginLeft = '10px';

  wrapper.appendChild(spinner);
  wrapper.appendChild(text);

  // 设置相对定位
  const imageStyle = window.getComputedStyle(image);
  if (imageStyle.position === 'static') {
    image.style.position = 'relative';
  }

  image.parentNode.insertBefore(wrapper, image.nextSibling);

  return wrapper;
}

// 显示错误信息
function showError(image, message) {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'manga-translator-error';
  errorDiv.style.position = 'absolute';
  errorDiv.style.top = '10px';
  errorDiv.style.left = '10px';
  errorDiv.style.padding = '10px';
  errorDiv.style.backgroundColor = 'rgba(255, 0, 0, 0.8)';
  errorDiv.style.color = 'white';
  errorDiv.style.borderRadius = '5px';
  errorDiv.style.fontSize = '14px';
  errorDiv.style.zIndex = '1000';
  errorDiv.style.maxWidth = '80%';

  errorDiv.textContent = `翻译错误: ${message}`;

  // 添加关闭按钮
  const closeButton = document.createElement('button');
  closeButton.textContent = '×';
  closeButton.style.position = 'absolute';
  closeButton.style.top = '5px';
  closeButton.style.right = '5px';
  closeButton.style.backgroundColor = 'transparent';
  closeButton.style.border = 'none';
  closeButton.style.color = 'white';
  closeButton.style.fontSize = '16px';
  closeButton.style.cursor = 'pointer';

  closeButton.addEventListener('click', () => {
    errorDiv.remove();
  });

  errorDiv.appendChild(closeButton);

  // 设置相对定位
  const imageStyle = window.getComputedStyle(image);
  if (imageStyle.position === 'static') {
    image.style.position = 'relative';
  }

  image.parentNode.insertBefore(errorDiv, image.nextSibling);

  // 5秒后自动消失
  setTimeout(() => {
    if (errorDiv.parentNode) {
      errorDiv.remove();
    }
  }, 5000);
}

// 处理来自弹出窗口的消息
function handleMessages(message, sender, sendResponse) {
  if (message.type === 'CONFIG_UPDATED') {
    // 更新翻译状态
    translationState = {
      ...translationState,
      enabled: message.config.enabled,
      mode: message.config.mode,
      targetLanguage: message.config.targetLanguage
    };

    // 如果禁用了翻译，移除所有翻译
    if (!translationState.enabled) {
      removeAllTranslations();
    }
    // 如果启用了自动模式，开始处理页面
    else if (translationState.mode === 'auto') {
      processPage();
    }

    sendResponse({ success: true });
    return true;
  }
}

// 保存配置
async function saveConfig(config) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.sync.set(config, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

// 初始化
initialize();
