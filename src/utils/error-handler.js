/**
 * API错误基类
 */
export class APIError extends Error {
  constructor(message, statusCode, data) {
    super(message);
    this.name = 'APIError';
    this.statusCode = statusCode;
    this.data = data;
  }
}

/**
 * API认证错误
 */
export class APIAuthError extends APIError {
  constructor(message, statusCode, data) {
    super(message, statusCode, data);
    this.name = 'APIAuthError';
  }
}

/**
 * API速率限制错误
 */
export class APIRateLimitError extends APIError {
  constructor(message, statusCode, data) {
    super(message, statusCode, data);
    this.name = 'APIRateLimitError';
  }
}

/**
 * API服务器错误
 */
export class APIServerError extends APIError {
  constructor(message, statusCode, data) {
    super(message, statusCode, data);
    this.name = 'APIServerError';
  }
}

/**
 * API跨域错误
 */
export class APICorsError extends APIError {
  constructor(message, url) {
    super(message, 0, { url });
    this.name = 'APICorsError';
  }
}

/**
 * API调用错误处理器
 */
export class APIErrorHandler {
  /**
   * 处理API响应
   * @param {Response} response - Fetch API响应对象
   * @returns {Promise} - 处理后的结果
   */
  static async handleResponse(response) {
    if (response.ok) {
      return await response.json();
    }
    
    const statusCode = response.status;
    let errorData;
    
    try {
      errorData = await response.json();
    } catch (e) {
      errorData = { error: { message: response.statusText } };
    }
    
    const errorMessage = errorData.error?.message || response.statusText;
    
    // 根据状态码分类处理错误
    switch (true) {
      case statusCode === 401:
        throw new APIAuthError('API密钥无效或已过期', statusCode, errorData);
      case statusCode === 429:
        throw new APIRateLimitError('API请求频率超限', statusCode, errorData);
      case statusCode >= 500:
        throw new APIServerError('服务器错误', statusCode, errorData);
      default:
        throw new APIError(`API错误: ${errorMessage}`, statusCode, errorData);
    }
  }
  
  /**
   * 实现请求重试逻辑
   * @param {Function} requestFn - 请求函数
   * @param {Object} options - 重试选项
   * @returns {Promise} - 请求结果
   */
  static async withRetry(requestFn, options = {}) {
    const { maxRetries = 3, initialDelay = 1000, maxDelay = 10000 } = options;
    let attempt = 0;
    
    while (attempt < maxRetries) {
      try {
        return await requestFn();
      } catch (error) {
        attempt++;
        
        // 如果不是可重试的错误或已达到最大重试次数，则抛出
        if (!(error instanceof APIRateLimitError) || attempt >= maxRetries) {
          throw error;
        }
        
        // 计算退避延迟
        const delay = Math.min(initialDelay * Math.pow(2, attempt - 1), maxDelay);
        console.log(`API请求失败，${delay}毫秒后重试 (${attempt}/${maxRetries})`);
        
        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  /**
   * 用户友好的错误消息
   * @param {Error} error - 错误对象
   * @returns {string} - 友好的错误消息
   */
  static getFriendlyMessage(error) {
    if (error instanceof APIAuthError) {
      return '认证失败: API密钥无效或已过期，请检查您的API配置';
    } else if (error instanceof APIRateLimitError) {
      return '请求频率超限: 请稍后再试或降低请求频率';
    } else if (error instanceof APIServerError) {
      return '服务器错误: API服务暂时不可用，请稍后再试';
    } else if (error instanceof APICorsError) {
      return '跨域请求失败: 无法访问图像资源，请尝试使用CORS代理';
    } else if (error instanceof APIError) {
      return `API错误: ${error.message}`;
    } else {
      return `发生错误: ${error.message}`;
    }
  }
} 