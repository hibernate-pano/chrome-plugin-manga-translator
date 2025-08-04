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

// 浏览器关闭或插件禁用时释放资源
chrome.runtime.onSuspend.addListener(async () => {
  console.log('插件被挂起，释放资源...');
  try {
    // 清理资源
    console.log('资源清理完成');
  } catch (error) {
    console.error('释放资源失败:', error);
  }
});

// 初始化默认设置
function initializeDefaultSettings() {
  const defaultConfig = {
    enabled: false,
    mode: 'manual',
    targetLanguage: 'zh-CN',
    providerType: 'openai',
    styleLevel: 50,
  };

  chrome.storage.sync.set(defaultConfig, () => {
    console.log('默认配置已设置');
  });
}

// 更新设置（保留用户设置，添加新选项）
function updateSettings() {
  chrome.storage.sync.get(null, (currentConfig) => {
    // 这里可以添加版本更新逻辑
    console.log('插件已更新，当前配置:', currentConfig);
  });
}

// 检查并设置默认配置
function checkAndSetDefaultConfig() {
  chrome.storage.sync.get(null, (config) => {
    if (Object.keys(config).length === 0) {
      initializeDefaultSettings();
    }
  });
}

// 处理来自内容脚本和弹出窗口的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('收到消息:', request);

  switch (request.action) {
    case 'getConfig':
      chrome.storage.sync.get(null, (config) => {
        sendResponse(config);
      });
      return true; // 保持消息通道开放

    case 'setConfig':
      chrome.storage.sync.set(request.config, () => {
        sendResponse({ success: true });
      });
      return true;

    default:
      sendResponse({ error: 'Unknown action' });
      return false;
  }
});

console.log('漫画翻译助手后台脚本已加载');
