/**
 * 后台脚本
 */

// 安装/更新事件
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // 首次安装
    initializeDefaultSettings();
    // 打开选项页面
    chrome.runtime.openOptionsPage();
  } else if (details.reason === 'update') {
    // 更新插件
    updateSettings();
  }
});

// 初始化默认设置
function initializeDefaultSettings() {
  const defaultSettings = {
    apiKey: '',
    targetLanguage: 'zh-CN',
    enabled: false,
    mode: 'manual',
    styleLevel: 50,
    model: 'gpt-3.5-turbo',
    customModel: '',
    useCustomModel: false,
    apiBaseUrl: 'https://api.openai.com/v1',
    useCustomApiUrl: false,
    temperature: 0.7,
    fontFamily: '',
    fontSize: 'auto',
    fontColor: 'auto',
    backgroundColor: 'auto',
    shortcuts: {
      toggleTranslation: 'Alt+T',
      translateSelected: 'Alt+S'
    },
    advancedSettings: {
      useLocalOcr: false,
      cacheResults: true,
      maxCacheSize: 50,
      debugMode: false,
      apiTimeout: 30,
      maxConcurrentRequests: 3,
      imagePreprocessing: 'none',
      showOriginalText: false,
      translationPrompt: '',
      useCorsProxy: false
    }
  };

  chrome.storage.sync.set(defaultSettings);
}

// 更新设置（保留用户设置，添加新选项）
function updateSettings() {
  chrome.storage.sync.get(null, (result) => {
    if (!result) return;

    // 检查并添加新设置项
    const updates = {};

    // 检查自定义API相关设置
    if (result.customModel === undefined) {
      updates.customModel = '';
    }

    if (result.useCustomModel === undefined) {
      updates.useCustomModel = false;
    }

    if (result.apiBaseUrl === undefined) {
      updates.apiBaseUrl = 'https://api.openai.com/v1';
    }

    if (result.useCustomApiUrl === undefined) {
      updates.useCustomApiUrl = false;
    }

    // 检查快捷键
    if (!result.shortcuts) {
      updates.shortcuts = {
        toggleTranslation: 'Alt+T',
        translateSelected: 'Alt+S'
      };
    }

    // 检查高级设置
    if (!result.advancedSettings) {
      updates.advancedSettings = {
        useLocalOcr: false,
        cacheResults: true,
        maxCacheSize: 50,
        debugMode: false,
        apiTimeout: 30,
        maxConcurrentRequests: 3,
        imagePreprocessing: 'none',
        showOriginalText: false,
        translationPrompt: ''
      };
    } else {
      // 检查高级设置中的新选项
      const advancedUpdates = {};

      if (result.advancedSettings.apiTimeout === undefined) {
        advancedUpdates.apiTimeout = 30;
      }

      if (result.advancedSettings.maxConcurrentRequests === undefined) {
        advancedUpdates.maxConcurrentRequests = 3;
      }

      if (result.advancedSettings.imagePreprocessing === undefined) {
        advancedUpdates.imagePreprocessing = 'none';
      }

      if (result.advancedSettings.showOriginalText === undefined) {
        advancedUpdates.showOriginalText = false;
      }

      if (result.advancedSettings.translationPrompt === undefined) {
        advancedUpdates.translationPrompt = '';
      }

      if (result.advancedSettings.useCorsProxy === undefined) {
        advancedUpdates.useCorsProxy = false;
      }

      if (Object.keys(advancedUpdates).length > 0) {
        updates.advancedSettings = {
          ...result.advancedSettings,
          ...advancedUpdates
        };
      }
    }

    // 如果有更新，保存设置
    if (Object.keys(updates).length > 0) {
      chrome.storage.sync.set(updates);
    }
  });
}

// 创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'translateImage',
    title: '翻译此图像',
    contexts: ['image']
  });

  chrome.contextMenus.create({
    id: 'translatePage',
    title: '翻译页面上的漫画',
    contexts: ['page']
  });
});

// 处理右键菜单点击
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'translateImage') {
    // 发送消息到内容脚本，翻译选中的图像
    chrome.tabs.sendMessage(tab.id, {
      type: 'TRANSLATE_IMAGE',
      imageUrl: info.srcUrl
    });
  } else if (info.menuItemId === 'translatePage') {
    // 发送消息到内容脚本，翻译页面上的所有漫画
    chrome.tabs.sendMessage(tab.id, {
      type: 'TRANSLATE_PAGE'
    });
  }
});
