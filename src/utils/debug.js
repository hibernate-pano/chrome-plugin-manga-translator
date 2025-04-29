/**
 * 调试工具函数
 */

/**
 * 打印当前配置到控制台
 * @returns {Promise<void>}
 */
export async function printCurrentConfig() {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.sync.get(null, (result) => {
        if (chrome.runtime.lastError) {
          console.error('获取配置失败:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
          return;
        }
        
        console.log('当前配置:', result);
        resolve(result);
      });
    } catch (error) {
      console.error('打印配置失败:', error);
      reject(error);
    }
  });
}

/**
 * 重置所有配置
 * @returns {Promise<void>}
 */
export async function resetAllConfig() {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.sync.clear(() => {
        if (chrome.runtime.lastError) {
          console.error('重置配置失败:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
          return;
        }
        
        console.log('所有配置已重置');
        resolve();
      });
    } catch (error) {
      console.error('重置配置失败:', error);
      reject(error);
    }
  });
}

/**
 * 检查API配置是否有效
 * @returns {Promise<boolean>}
 */
export async function checkApiConfig() {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.sync.get(['apiKey', 'apiBaseUrl', 'useCustomApiUrl', 'model', 'customModel', 'useCustomModel'], (result) => {
        if (chrome.runtime.lastError) {
          console.error('获取API配置失败:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
          return;
        }
        
        const apiKey = result.apiKey || '';
        const apiBaseUrl = result.useCustomApiUrl ? (result.apiBaseUrl || 'https://api.openai.com/v1') : 'https://api.openai.com/v1';
        const model = result.useCustomModel ? (result.customModel || 'gpt-3.5-turbo') : (result.model || 'gpt-3.5-turbo');
        
        console.log('API配置检查结果:');
        console.log('- API密钥:', apiKey ? '已设置' : '未设置');
        console.log('- API地址:', apiBaseUrl);
        console.log('- 使用自定义API地址:', result.useCustomApiUrl ? '是' : '否');
        console.log('- 模型:', model);
        console.log('- 使用自定义模型:', result.useCustomModel ? '是' : '否');
        
        resolve(!!apiKey);
      });
    } catch (error) {
      console.error('检查API配置失败:', error);
      reject(error);
    }
  });
}
