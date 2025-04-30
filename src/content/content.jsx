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
      targetLanguage: config.targetLanguage || 'zh-CN',
      // 添加自定义API相关配置
      apiKey: config.apiKey || '',
      apiBaseUrl: config.apiBaseUrl || 'https://api.openai.com/v1',
      useCustomApiUrl: config.useCustomApiUrl || false,
      model: config.model || 'gpt-3.5-turbo',
      customModel: config.customModel || '',
      useCustomModel: config.useCustomModel || false
    };

    // 打印配置，用于调试
    console.log('初始化加载的配置:', config);

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

      // 更新进度提示
      loadingIndicator.updateProgress('detect');

      // 检测文字区域
      const textAreas = await detectTextAreas(image, {
        apiKey: config.apiKey,
        apiBaseUrl: apiBaseUrl,
        model: model,
        useCache: config.advancedSettings?.cacheResults !== false,
        imagePreprocessing: config.advancedSettings?.imagePreprocessing || 'none',
        debugMode: config.advancedSettings?.debugMode || false
      });

      // 如果没有检测到文字，显示提示并返回
      if (!textAreas || textAreas.length === 0) {
        console.log('未检测到文字');

        // 显示友好的提示
        const noTextError = showError(image, '未在图像中检测到文字内容');

        // 添加重试按钮
        const buttonContainer = noTextError.createButtonContainer();

        // 添加重试按钮
        const retryButton = noTextError.createButton('重新检测', '#4CAF50', () => {
          noTextError.remove();
          setTimeout(() => translateImage(image), 500);
        });

        // 添加高级设置按钮
        const settingsButton = noTextError.createButton('高级设置', '#2196F3', () => {
          chrome.runtime.openOptionsPage();
        });

        buttonContainer.appendChild(retryButton);
        buttonContainer.appendChild(settingsButton);

        return;
      }

      // 在调试模式下显示文字区域
      if (config.advancedSettings?.debugMode) {
        showDebugAreas(image, textAreas);
      }

      // 更新进度提示
      loadingIndicator.updateProgress('translate');

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

      // 更新进度提示
      loadingIndicator.updateProgress('render');

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

    // 检查错误类型并提供相应的处理方案
    let errorMessage = error.message;
    let errorType = 'general';

    // 检测CORS错误
    if (
      error.message.includes('InvalidStateError') &&
      error.message.includes('drawImage') &&
      error.message.includes('broken')
    ) {
      errorType = 'cors';
    }
    // 检测API错误
    else if (error.message.includes('API错误')) {
      errorType = 'api';
    }
    // 检测网络错误
    else if (
      error.message.includes('Failed to fetch') ||
      error.message.includes('Network') ||
      error.message.includes('网络')
    ) {
      errorType = 'network';
    }

    // 根据错误类型处理
    switch (errorType) {
      case 'cors':
        // 处理CORS错误
        handleCorsError(image, error);
        break;

      case 'api':
        // 处理API错误
        handleApiError(image, error);
        break;

      case 'network':
        // 处理网络错误
        handleNetworkError(image, error);
        break;

      default:
        // 处理一般错误
        const errorDiv = showError(image, `翻译过程中发生错误: ${errorMessage}`);
        const buttonContainer = errorDiv.createButtonContainer();

        // 添加重试按钮
        const retryButton = errorDiv.createButton('重试', '#4CAF50', () => {
          errorDiv.remove();
          setTimeout(() => translateImage(image), 500);
        });

        // 添加设置按钮
        const settingsButton = errorDiv.createButton('设置', '#2196F3', () => {
          chrome.runtime.openOptionsPage();
        });

        buttonContainer.appendChild(retryButton);
        buttonContainer.appendChild(settingsButton);
    }
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
  // 确保全局只有一个样式定义
  if (!document.getElementById('manga-translator-styles')) {
    const style = document.createElement('style');
    style.id = 'manga-translator-styles';
    style.textContent = `
      @keyframes manga-translator-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }

      @keyframes manga-translator-pulse {
        0% { opacity: 0.6; }
        50% { opacity: 1; }
        100% { opacity: 0.6; }
      }
    `;
    document.head.appendChild(style);
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'manga-translator-loading';
  wrapper.style.position = 'absolute';
  wrapper.style.top = '0';
  wrapper.style.left = '0';
  wrapper.style.width = '100%';
  wrapper.style.height = '100%';
  wrapper.style.display = 'flex';
  wrapper.style.flexDirection = 'column';
  wrapper.style.alignItems = 'center';
  wrapper.style.justifyContent = 'center';
  wrapper.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
  wrapper.style.color = 'white';
  wrapper.style.fontSize = '16px';
  wrapper.style.zIndex = '1000';
  wrapper.style.backdropFilter = 'blur(3px)';
  wrapper.style.transition = 'all 0.3s ease';

  const spinner = document.createElement('div');
  spinner.className = 'manga-translator-spinner';
  spinner.style.border = '4px solid rgba(255, 255, 255, 0.3)';
  spinner.style.borderTop = '4px solid white';
  spinner.style.borderRadius = '50%';
  spinner.style.width = '40px';
  spinner.style.height = '40px';
  spinner.style.animation = 'manga-translator-spin 1s linear infinite';
  spinner.style.marginBottom = '15px';

  const text = document.createElement('div');
  text.textContent = '翻译中...';
  text.style.animation = 'manga-translator-pulse 1.5s infinite';
  text.style.fontWeight = 'bold';

  // 添加进度提示
  const progressText = document.createElement('div');
  progressText.textContent = '正在分析图像文字...';
  progressText.style.fontSize = '14px';
  progressText.style.marginTop = '10px';
  progressText.style.opacity = '0.8';

  // 公开更新进度的方法
  wrapper.updateProgress = (stage) => {
    switch (stage) {
      case 'detect':
        progressText.textContent = '正在分析图像文字...';
        break;
      case 'translate':
        progressText.textContent = '正在翻译文字内容...';
        break;
      case 'render':
        progressText.textContent = '正在渲染翻译结果...';
        break;
      default:
        progressText.textContent = stage; // 支持自定义文本
    }
  };

  wrapper.appendChild(spinner);
  wrapper.appendChild(text);
  wrapper.appendChild(progressText);

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
  // 确保全局只有一个样式定义
  if (!document.getElementById('manga-translator-styles')) {
    const style = document.createElement('style');
    style.id = 'manga-translator-styles';
    style.textContent = `
      @keyframes manga-translator-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }

      @keyframes manga-translator-pulse {
        0% { opacity: 0.6; }
        50% { opacity: 1; }
        100% { opacity: 0.6; }
      }

      @keyframes manga-translator-slide-in {
        0% { transform: translateY(-20px); opacity: 0; }
        100% { transform: translateY(0); opacity: 1; }
      }

      .manga-translator-error-btn {
        padding: 8px 12px;
        border: none;
        border-radius: 4px;
        color: white;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        margin-right: 8px;
        font-size: 13px;
      }

      .manga-translator-error-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.3);
      }
    `;
    document.head.appendChild(style);
  }

  const errorDiv = document.createElement('div');
  errorDiv.className = 'manga-translator-error';
  errorDiv.style.position = 'absolute';
  errorDiv.style.top = '10px';
  errorDiv.style.left = '10px';
  errorDiv.style.right = '10px';
  errorDiv.style.padding = '15px';
  errorDiv.style.backgroundColor = 'rgba(220, 53, 69, 0.95)';
  errorDiv.style.color = 'white';
  errorDiv.style.borderRadius = '8px';
  errorDiv.style.fontSize = '14px';
  errorDiv.style.zIndex = '1000';
  errorDiv.style.maxWidth = '90%';
  errorDiv.style.display = 'flex';
  errorDiv.style.flexDirection = 'column';
  errorDiv.style.boxShadow = '0 4px 15px rgba(0,0,0,0.3)';
  errorDiv.style.animation = 'manga-translator-slide-in 0.3s ease-out';
  errorDiv.style.backdropFilter = 'blur(4px)';
  errorDiv.style.border = '1px solid rgba(255,255,255,0.2)';

  // 创建标题
  const titleDiv = document.createElement('div');
  titleDiv.textContent = '翻译失败';
  titleDiv.style.fontWeight = 'bold';
  titleDiv.style.fontSize = '16px';
  titleDiv.style.marginBottom = '8px';
  titleDiv.style.borderBottom = '1px solid rgba(255,255,255,0.3)';
  titleDiv.style.paddingBottom = '8px';
  errorDiv.appendChild(titleDiv);

  // 创建消息容器
  const messageDiv = document.createElement('div');
  messageDiv.textContent = message;
  messageDiv.style.marginBottom = '12px';
  messageDiv.style.lineHeight = '1.4';
  errorDiv.appendChild(messageDiv);

  // 添加关闭按钮
  const closeButton = document.createElement('button');
  closeButton.textContent = '×';
  closeButton.style.position = 'absolute';
  closeButton.style.top = '8px';
  closeButton.style.right = '8px';
  closeButton.style.backgroundColor = 'transparent';
  closeButton.style.border = 'none';
  closeButton.style.color = 'white';
  closeButton.style.fontSize = '20px';
  closeButton.style.cursor = 'pointer';
  closeButton.style.width = '30px';
  closeButton.style.height = '30px';
  closeButton.style.display = 'flex';
  closeButton.style.alignItems = 'center';
  closeButton.style.justifyContent = 'center';
  closeButton.style.borderRadius = '50%';
  closeButton.style.transition = 'background-color 0.2s';

  closeButton.onmouseover = () => {
    closeButton.style.backgroundColor = 'rgba(255,255,255,0.2)';
  };

  closeButton.onmouseout = () => {
    closeButton.style.backgroundColor = 'transparent';
  };

  closeButton.addEventListener('click', () => {
    errorDiv.style.opacity = '0';
    errorDiv.style.transform = 'translateY(-20px)';
    errorDiv.style.transition = 'all 0.3s ease';

    setTimeout(() => {
      if (errorDiv.parentNode) {
        errorDiv.remove();
      }
    }, 300);
  });

  errorDiv.appendChild(closeButton);

  // 设置相对定位
  const imageStyle = window.getComputedStyle(image);
  if (imageStyle.position === 'static') {
    image.style.position = 'relative';
  }

  image.parentNode.insertBefore(errorDiv, image.nextSibling);

  // 创建按钮容器的辅助方法
  errorDiv.createButtonContainer = () => {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexWrap = 'wrap';
    container.style.gap = '8px';
    container.style.marginTop = '10px';
    errorDiv.appendChild(container);
    return container;
  };

  // 创建按钮的辅助方法
  errorDiv.createButton = (text, color, onClick) => {
    const button = document.createElement('button');
    button.textContent = text;
    button.className = 'manga-translator-error-btn';
    button.style.backgroundColor = color;

    button.addEventListener('click', onClick);
    return button;
  };

  // 15秒后自动消失
  setTimeout(() => {
    if (errorDiv.parentNode) {
      errorDiv.style.opacity = '0';
      errorDiv.style.transform = 'translateY(-20px)';
      errorDiv.style.transition = 'all 0.3s ease';

      setTimeout(() => {
        if (errorDiv.parentNode) {
          errorDiv.remove();
        }
      }, 300);
    }
  }, 15000);

  // 返回错误div，以便可以添加更多元素
  return errorDiv;
}

// 处理来自弹出窗口的消息
function handleMessages(message, sender, sendResponse) {
  if (message.type === 'CONFIG_UPDATED') {
    // 更新翻译状态
    translationState = {
      ...translationState,
      enabled: message.config.enabled,
      mode: message.config.mode,
      targetLanguage: message.config.targetLanguage,
      // 添加自定义API相关配置
      apiKey: message.config.apiKey,
      apiBaseUrl: message.config.apiBaseUrl,
      useCustomApiUrl: message.config.useCustomApiUrl,
      model: message.config.model,
      customModel: message.config.customModel,
      useCustomModel: message.config.useCustomModel
    };

    // 打印配置，用于调试
    console.log('内容脚本收到的配置:', message.config);

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

// 处理CORS错误
async function handleCorsError(image, error) {
  // 获取配置
  const config = await getConfig();
  const useCorsProxy = config.advancedSettings?.useCorsProxy || false;

  if (!useCorsProxy) {
    // 如果未启用CORS代理，显示错误并提供启用选项
    const errorDiv = showError(image, '跨域资源共享(CORS)错误: 无法访问图像数据。需要启用CORS代理服务来解决此问题。');
    const buttonContainer = errorDiv.createButtonContainer();

    // 添加启用代理按钮
    const enableButton = errorDiv.createButton('启用CORS代理', '#4CAF50', async () => {
      // 更新配置
      const advancedSettings = {
        ...(config.advancedSettings || {}),
        useCorsProxy: true,
        corsProxyType: 'corsproxy'  // 默认使用corsproxy.io
      };

      await saveConfig({ advancedSettings });

      // 关闭错误消息
      errorDiv.remove();

      // 显示成功消息
      const successDiv = showError(image, '已启用CORS代理，正在重新尝试翻译...');
      successDiv.style.backgroundColor = 'rgba(76, 175, 80, 0.9)';

      // 3秒后自动关闭
      setTimeout(() => {
        if (successDiv.parentNode) {
          successDiv.remove();
        }
        // 重新尝试翻译
        translateImage(image);
      }, 2000);
    });

    // 添加设置按钮
    const settingsButton = errorDiv.createButton('高级设置', '#2196F3', () => {
      chrome.runtime.openOptionsPage();
    });

    buttonContainer.appendChild(enableButton);
    buttonContainer.appendChild(settingsButton);
  } else {
    // 如果已启用CORS代理但仍然失败，提供更多选项
    const errorDiv = showError(image, '跨域资源共享(CORS)错误: 当前代理服务无法访问图像数据。请尝试更换代理服务。');
    const buttonContainer = errorDiv.createButtonContainer();

    // 获取当前代理类型
    const currentProxyType = config.advancedSettings?.corsProxyType || 'corsproxy';

    // 添加尝试其他代理按钮
    const tryOtherButton = errorDiv.createButton('尝试其他代理', '#FF9800', async () => {
      // 选择一个不同的代理
      let newProxyType = 'allorigins';
      if (currentProxyType === 'allorigins') {
        newProxyType = 'corsproxy';
      }

      // 更新配置
      const advancedSettings = {
        ...(config.advancedSettings || {}),
        corsProxyType: newProxyType
      };

      await saveConfig({ advancedSettings });

      // 关闭错误消息
      errorDiv.remove();

      // 显示成功消息
      const successDiv = showError(image, `已切换到 ${newProxyType} 代理，正在重新尝试翻译...`);
      successDiv.style.backgroundColor = 'rgba(76, 175, 80, 0.9)';

      // 2秒后自动关闭
      setTimeout(() => {
        if (successDiv.parentNode) {
          successDiv.remove();
        }
        // 重新尝试翻译
        translateImage(image);
      }, 2000);
    });

    // 添加设置按钮
    const settingsButton = errorDiv.createButton('高级设置', '#2196F3', () => {
      chrome.runtime.openOptionsPage();
    });

    buttonContainer.appendChild(tryOtherButton);
    buttonContainer.appendChild(settingsButton);
  }
}

// 处理API错误
async function handleApiError(image, error) {
  const errorDiv = showError(image, `API调用失败: ${error.message}`);
  const buttonContainer = errorDiv.createButtonContainer();

  // 添加检查API设置按钮
  const checkApiButton = errorDiv.createButton('检查API设置', '#2196F3', () => {
    chrome.runtime.openOptionsPage();
    // 可以添加一个消息，告诉选项页面打开API设置标签
  });

  // 添加重试按钮
  const retryButton = errorDiv.createButton('重试', '#4CAF50', () => {
    errorDiv.remove();
    setTimeout(() => translateImage(image), 500);
  });

  buttonContainer.appendChild(checkApiButton);
  buttonContainer.appendChild(retryButton);
}

// 处理网络错误
function handleNetworkError(image, error) {
  const errorDiv = showError(image, `网络连接错误: ${error.message}`);
  const buttonContainer = errorDiv.createButtonContainer();

  // 添加重试按钮
  const retryButton = errorDiv.createButton('重试', '#4CAF50', () => {
    errorDiv.remove();
    setTimeout(() => translateImage(image), 1000);
  });

  // 添加设置按钮
  const settingsButton = errorDiv.createButton('设置', '#2196F3', () => {
    chrome.runtime.openOptionsPage();
  });

  buttonContainer.appendChild(retryButton);
  buttonContainer.appendChild(settingsButton);
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
