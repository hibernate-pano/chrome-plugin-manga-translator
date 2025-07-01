/**
 * 后台脚本
 */
import { terminateOCRProviders } from '../content/detector';
import { DEFAULT_CONFIG } from '../utils/default-config';
import { initConfigManager, cleanup } from '../utils/config-manager';

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

// 浏览器关闭或插件禁用时释放资源
chrome.runtime.onSuspend.addListener(async () => {
  console.log('插件被挂起，释放资源...');
  try {
    await cleanup();
  } catch (error) {
    console.error('释放资源失败:', error);
  }
});

// 初始化配置管理器
initConfigManager().then(config => {
  console.log('配置管理器初始化完成:', config);
});

// 初始化默认设置
function initializeDefaultSettings() {
  // 使用导入的默认配置
  chrome.storage.sync.set(DEFAULT_CONFIG, () => {
    console.log('默认配置已设置');
  });
}

// 更新设置（保留用户设置，添加新选项）
function updateSettings() {
  chrome.storage.sync.get(null, (result) => {
    if (!result) return;

    // 检查并添加新设置项
    const updates = {};

    // 检查是否需要迁移到新的配置结构
    if (result.apiKey && !result.providerConfig) {
      // 检测是否使用Qwen模型
      const usingQwen = 
        (result.customModel && result.customModel.toLowerCase().includes('qwen')) || 
        (result.apiBaseUrl && result.apiBaseUrl.includes('siliconflow.cn')) ||
        (result.useCustomModel && result.useCustomApiUrl);
      
      // 设置提供者类型
      updates.providerType = usingQwen ? 'qwen' : 'openai';
      
      // 创建提供者配置
      updates.providerConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG.providerConfig));
      
      if (usingQwen) {
        // 迁移到Qwen提供者
        updates.providerConfig.qwen.apiKey = result.apiKey || '';
        
        if (result.apiBaseUrl) {
          updates.providerConfig.qwen.apiBaseUrl = result.apiBaseUrl;
        }
        
        if (result.customModel) {
          updates.providerConfig.qwen.model = result.customModel;
        }
        
        if (result.temperature !== undefined) {
          updates.providerConfig.qwen.temperature = result.temperature;
        }
      } else {
        // 迁移到OpenAI提供者
        updates.providerConfig.openai.apiKey = result.apiKey || '';
        
        if (result.apiBaseUrl) {
          updates.providerConfig.openai.apiBaseUrl = result.apiBaseUrl;
        }
        
        if (result.model) {
          updates.providerConfig.openai.chatModel = result.model;
        }
        
        if (result.temperature !== undefined) {
          updates.providerConfig.openai.temperature = result.temperature;
        }
      }
    }

    // 检查OCR设置
    if (!result.ocrSettings) {
      updates.ocrSettings = DEFAULT_CONFIG.ocrSettings;
    }

    // 检查快捷键
    if (!result.shortcuts) {
      updates.shortcuts = DEFAULT_CONFIG.shortcuts;
    }

    // 检查高级设置
    if (!result.advancedSettings) {
      updates.advancedSettings = DEFAULT_CONFIG.advancedSettings;
    } else {
      // 检查高级设置中的新选项
      const advancedUpdates = {};

      // 遍历默认高级设置的所有键
      for (const key in DEFAULT_CONFIG.advancedSettings) {
        if (result.advancedSettings[key] === undefined) {
          advancedUpdates[key] = DEFAULT_CONFIG.advancedSettings[key];
        }
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
      chrome.storage.sync.set(updates, () => {
        console.log('配置已更新:', updates);
      });
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
    // 检查是否需要设置默认配置
    if (!result || Object.keys(result).length === 0) {
      console.log('没有找到配置，设置默认配置...');
      
      // 使用导入的默认配置
      chrome.storage.sync.set(DEFAULT_CONFIG, () => {
        console.log('默认配置已设置');
      });
      return;
    }

    // 如果已有配置，检查是否有缺失的配置项
    const updates = {};
    let needsUpdate = false;

    // 检查顶级属性
    for (const key in DEFAULT_CONFIG) {
      if (result[key] === undefined && 
          key !== 'providerConfig' && 
          key !== 'apiKey' && 
          key !== 'model' && 
          key !== 'customModel' && 
          key !== 'apiBaseUrl' && 
          key !== 'useCustomModel' && 
          key !== 'useCustomApiUrl') {
        updates[key] = DEFAULT_CONFIG[key];
        needsUpdate = true;
      }
    }

    // 检查提供者配置
    if (!result.providerConfig) {
      updates.providerConfig = DEFAULT_CONFIG.providerConfig;
      needsUpdate = true;
    }

    // 检查OCR设置
    if (!result.ocrSettings) {
      updates.ocrSettings = DEFAULT_CONFIG.ocrSettings;
      needsUpdate = true;
    }

    // 检查快捷键
    if (!result.shortcuts) {
      updates.shortcuts = DEFAULT_CONFIG.shortcuts;
      needsUpdate = true;
    }

    // 检查高级设置
    if (!result.advancedSettings) {
      updates.advancedSettings = DEFAULT_CONFIG.advancedSettings;
      needsUpdate = true;
    } else {
      // 检查高级设置中的各个属性
      const advancedUpdates = {};
      for (const key in DEFAULT_CONFIG.advancedSettings) {
        if (result.advancedSettings[key] === undefined) {
          advancedUpdates[key] = DEFAULT_CONFIG.advancedSettings[key];
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
