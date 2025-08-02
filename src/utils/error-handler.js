/**
 * API错误处理模块
 */

/**
 * API错误类
 */
export class APIError extends Error {
  /**
   * 构造函数
   * @param {string} message - 错误消息
   * @param {number} status - HTTP状态码
   * @param {Object} data - 错误数据
   */
  constructor(message, status = null, data = null) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.data = data;
    this.timestamp = Date.now();
  }

  /**
   * 获取人类可读的错误消息
   * @returns {string} - 格式化的错误消息
   */
  getHumanReadableMessage() {
    // 添加HTTP状态码
    let message = this.message;
    if (this.status) {
      message = `[${this.status}] ${message}`;
    }

    // 添加错误码
    if (this.data && this.data.error && this.data.error.code) {
      message = `${message} (错误码: ${this.data.error.code})`;
    }

    return message;
  }
}

/**
 * 错误翻译表 - 将技术错误转换为用户友好的消息
 */
const ERROR_TRANSLATIONS = {
  // 通用API错误
  'Invalid API key': '无效的API密钥，请检查API设置',
  'API key expired': 'API密钥已过期，请更新API密钥',
  'Not Found': 'API资源未找到，可能API地址错误或服务不可用',
  'Too Many Requests': 'API请求超过限制，请稍后再试',
  'Request timeout': '请求超时，请检查网络连接或API服务器状态',
  'Network Error': '网络错误，请检查您的网络连接',
  'Internal Server Error': '服务器内部错误，请稍后再试',
  'Service Unavailable': '服务暂时不可用，请稍后再试',
  'Unauthorized': '未授权，请检查API密钥',
  'Quota exceeded': '配额已用尽，请检查账户余额或提高限制',
  'Bad Request': '请求格式错误，请检查API设置',
  'Forbidden': '请求被拒绝，可能是API密钥权限不足',
  'Rate limit': '请求频率限制，请减慢请求速度',
  'max_tokens': '请求的token数量超出限制',
  'context_length': '上下文长度超出限制',
  'content_filter': '内容被过滤器拦截',
  'model_not_found': '模型不存在或不可用',
  
  // 跨域错误
  'CORS': '跨域资源访问受限，请启用CORS代理',
  'Cross-Origin': '跨域资源访问受限，请启用CORS代理',
  'cors': '跨域资源访问受限，请启用CORS代理',

  // 图像处理错误
  'Image processing': '图像处理失败',
  'Image too large': '图像尺寸过大',
  'Invalid image format': '不支持的图像格式',

  // 解析错误
  'JSON': 'JSON解析错误',
  'Parse': '响应解析错误',
  'Syntax': '语法错误',

  // 网络错误
  'Failed to fetch': '网络请求失败，请检查网络连接',
  'Network request': '网络请求失败',
  'Connection': '连接失败',
  'timeout': '请求超时',
  'offline': '设备处于离线状态'
};

/**
 * API错误处理工具
 */
export class APIErrorHandler {
  /**
   * 处理API响应
   * @param {Response} response - Fetch API响应对象
   * @returns {Promise<Object>} - 处理后的响应数据
   * @throws {APIError} - 如果响应不成功
   */
  static async handleResponse(response) {
    // 检查HTTP状态码
    if (!response.ok) {
      const status = response.status;
      let errorData = null;
      
      try {
        errorData = await response.json();
      } catch (e) {
        // 如果不是JSON，使用文本响应
        const text = await response.text();
        errorData = { error: { message: text } };
      }
      
      // 提取错误消息
      const errorMessage = errorData.error?.message || response.statusText || '未知API错误';
      
      // 转换为人类可读的错误消息
      const humanReadableMessage = APIErrorHandler.translateErrorMessage(errorMessage, status);
      
      throw new APIError(humanReadableMessage, status, errorData);
    }
    
    try {
      return await response.json();
    } catch (error) {
      throw new APIError('解析API响应失败', null, { error: { message: error.message } });
    }
  }

  /**
   * 使用重试机制执行API调用
   * @param {Function} apiCall - API调用函数
   * @param {Object} options - 重试选项
   * @returns {Promise<any>} - API调用结果
   */
  static async withRetry(apiCall, options = {}) {
    const {
      maxRetries = 3,
      delayMs = 1000,
      backoffFactor = 2,
      retryableStatusCodes = [408, 429, 500, 502, 503, 504]
    } = options;
    
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await apiCall();
      } catch (error) {
        lastError = error;
        
        // 检查是否应该重试
        const isRetryable = 
          (error.status && retryableStatusCodes.includes(error.status)) ||
          error.message.includes('timeout') ||
          error.message.includes('network') ||
          error.message.includes('Too Many Requests') ||
          error.message.includes('rate limit');
        
        // 如果是最后一次尝试或错误不可重试，则抛出错误
        if (attempt >= maxRetries || !isRetryable) {
          break;
        }
        
        // 计算延迟时间
        const delay = delayMs * Math.pow(backoffFactor, attempt - 1);
        
        console.log(`API调用失败，第${attempt}次重试，延迟${delay}ms: ${error.message}`);
        
        // 等待延迟时间
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError;
  }

  /**
   * 转换错误消息为人类可读格式
   * @param {string} errorMessage - 原始错误消息
   * @param {number} status - HTTP状态码
   * @returns {string} - 人类可读的错误消息
   */
  static translateErrorMessage(errorMessage, status = null) {
    // 检查是否有匹配的翻译
    for (const [key, translation] of Object.entries(ERROR_TRANSLATIONS)) {
      if (errorMessage.includes(key)) {
        return translation;
      }
    }
    
    // 根据HTTP状态码提供通用翻译
    if (status) {
      switch (true) {
        case status === 400:
          return '请求格式错误，请检查API设置';
        case status === 401:
          return '未授权，请检查API密钥';
        case status === 403:
          return '请求被拒绝，可能是API密钥权限不足';
        case status === 404:
          return 'API资源未找到，可能API地址错误';
        case status === 429:
          return 'API请求超过限制，请稍后再试';
        case status >= 500:
          return '服务器错误，请稍后再试';
      }
    }
    
    // 默认返回原始消息
    return errorMessage;
  }

  /**
   * 处理并记录错误
   * @param {Error} error - 错误对象
   * @param {string} context - 错误上下文
   * @returns {Object} - 错误信息对象
   */
  static logError(error, context = '') {
    const timestamp = new Date().toISOString();
    const errorInfo = {
      timestamp,
      context,
      name: error.name,
      message: error.message,
      stack: error.stack
    };
    
    // 添加API错误特定信息
    if (error instanceof APIError) {
      errorInfo.status = error.status;
      errorInfo.data = error.data;
    }
    
    console.error(`[${timestamp}] ${context ? `${context  }: ` : ''}${error.message}`, errorInfo);
    
    return errorInfo;
  }
} 