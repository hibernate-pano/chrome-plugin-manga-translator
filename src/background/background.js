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

// 在浏览器启动时检查并设置默认配置
chrome.runtime.onStartup.addListener(() => {
  checkAndSetDefaultConfig();
});

// 立即执行一次检查，确保配置正确
checkAndSetDefaultConfig();

// 初始化默认设置
function initializeDefaultSettings() {
  const defaultSettings = {
    apiKey: 'sk-bpbqulqtsmbywglsemzqantxqhmilksogyeitgcpkbvwioix',
    targetLanguage: 'zh-CN',
    enabled: false,
    mode: 'manual',
    styleLevel: 50,
    model: 'gpt-3.5-turbo',
    customModel: 'Qwen/Qwen2.5-VL-32B-Instruct',
    useCustomModel: true,
    apiBaseUrl: 'https://api.siliconflow.cn/v1',
    useCustomApiUrl: true,
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
      useCorsProxy: true,
      corsProxyType: 'corsproxy',
      customCorsProxy: ''
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

      if (result.advancedSettings.corsProxyType === undefined) {
        advancedUpdates.corsProxyType = 'corsproxy';
      }

      if (result.advancedSettings.customCorsProxy === undefined) {
        advancedUpdates.customCorsProxy = '';
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

// 检查并设置默认配置
function checkAndSetDefaultConfig() {
  chrome.storage.sync.get(null, (result) => {
    // 默认配置
    const defaultSettings = {
      apiKey: 'sk-bpbqulqtsmbywglsemzqantxqhmilksogyeitgcpkbvwioix',
      targetLanguage: 'zh-CN',
      enabled: false,
      mode: 'manual',
      styleLevel: 50,
      model: 'gpt-3.5-turbo',
      customModel: 'Qwen/Qwen2.5-VL-32B-Instruct',
      useCustomModel: true,
      apiBaseUrl: 'https://api.siliconflow.cn/v1',
      useCustomApiUrl: true,
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
        useCorsProxy: true,
        corsProxyType: 'corsproxy',
        customCorsProxy: ''
      }
    };

    // 检查是否需要设置默认配置
    if (!result || Object.keys(result).length === 0) {
      console.log('没有找到配置，设置默认配置...');

      chrome.storage.sync.set(defaultSettings, () => {
        console.log('默认配置已设置');
      });
      return;
    }

    // 如果已有配置，检查是否有缺失的配置项
    const updates = {};
    let needsUpdate = false;

    // 检查所有顶级属性（除了API相关的设置）
    for (const key in defaultSettings) {
      if (result[key] === undefined &&
        key !== 'apiKey' &&
        key !== 'customModel' &&
        key !== 'apiBaseUrl' &&
        key !== 'useCustomModel' &&
        key !== 'useCustomApiUrl') {
        updates[key] = defaultSettings[key];
        needsUpdate = true;
      }
    }

    // 检查快捷键
    if (!result.shortcuts) {
      updates.shortcuts = defaultSettings.shortcuts;
      needsUpdate = true;
    }

    // 检查高级设置
    if (!result.advancedSettings) {
      updates.advancedSettings = defaultSettings.advancedSettings;
      needsUpdate = true;
    } else {
      // 检查高级设置中的各个属性
      const advancedUpdates = {};
      for (const key in defaultSettings.advancedSettings) {
        if (result.advancedSettings[key] === undefined) {
          advancedUpdates[key] = defaultSettings.advancedSettings[key];
        }
      }

      if (Object.keys(advancedUpdates).length > 0) {
        updates.advancedSettings = {
          ...result.advancedSettings,
          ...advancedUpdates
        };
        needsUpdate = true;
      }
    }

    // 如果用户没有设置API密钥，使用默认的API设置
    if (!result.apiKey) {
      updates.apiKey = defaultSettings.apiKey;
      updates.apiBaseUrl = defaultSettings.apiBaseUrl;
      updates.useCustomApiUrl = defaultSettings.useCustomApiUrl;
      updates.customModel = defaultSettings.customModel;
      updates.useCustomModel = defaultSettings.useCustomModel;
      needsUpdate = true;
    }

    if (needsUpdate) {
      console.log('更新缺失的配置项...');
      chrome.storage.sync.set(updates, () => {
        console.log('配置已更新');
      });
    }
  });
}

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
