/**
 * Tesseract OCR提供者
 * 基于Tesseract.js实现OCR文字识别功能
 */
import { createWorker, createScheduler, OEM, PSM } from 'tesseract.js';
import { BaseOCRProvider } from './base-ocr-provider';

export class TesseractProvider extends BaseOCRProvider {
  /**
   * 构造函数
   * @param {Object} config - 配置对象
   */
  constructor(config = {}) {
    super(config);
    this.name = 'Tesseract OCR';
    this.worker = null;
    this.scheduler = null;
    this.defaultConfig = {
      language: 'jpn', // 默认日语，适合漫画
      preprocess: true,
      oem: OEM.LSTM_ONLY,  // 使用LSTM引擎
      psm: PSM.AUTO,       // 自动页面分割模式
      workerCount: 1,      // 默认使用1个工作线程
      cachePath: './tesseract-cache' // 缓存路径
    };
    
    // 合并默认配置和用户配置
    this.config = { ...this.defaultConfig, ...config };
  }

  /**
   * 初始化提供者
   * @returns {Promise<boolean>} - 初始化是否成功
   */
  async initialize() {
    try {
      if (this.initialized) {
        return true;
      }

      // 根据配置的worker数量创建调度器
      const workerCount = this.config.workerCount || 1;
      
      if (workerCount > 1) {
        // 多线程模式
        this.scheduler = createScheduler();
        
        for (let i = 0; i < workerCount; i++) {
          const worker = await this._createWorker();
          this.scheduler.addWorker(worker);
        }
      } else {
        // 单线程模式
        this.worker = await this._createWorker();
      }

      this.initialized = true;
      return true;
    } catch (error) {
      console.error('Tesseract初始化失败:', error);
      throw error;
    }
  }

  /**
   * 创建并初始化Tesseract worker
   * @private
   * @returns {Promise<Worker>} - 初始化后的worker
   */
  async _createWorker() {
    const worker = await createWorker({
      logger: m => console.debug('Tesseract:', m),
      errorHandler: err => console.error('Tesseract错误:', err),
      cachePath: this.config.cachePath
    });
    
    // 加载语言数据
    await worker.loadLanguage(this.config.language);
    
    // 初始化API
    await worker.initialize(this.config.language, {
      oem: this.config.oem,
      psm: this.config.psm
    });
    
    return worker;
  }

  /**
   * 检测图像中的文字区域
   * @param {string|Blob} imageData - 图像数据
   * @param {Object} options - 检测选项
   * @returns {Promise<Array>} - 文字区域数组
   */
  async detectText(imageData, options = {}) {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      // 根据需要预处理图像
      let processedImage = imageData;
      if (this.config.preprocess || options.preprocess) {
        processedImage = await this.preprocessImage(imageData, options);
      }

      // 识别文字
      let result;
      if (this.scheduler) {
        // 使用调度器（多线程模式）
        result = await this.scheduler.addJob('recognize', processedImage);
      } else {
        // 使用单个worker
        result = await this.worker.recognize(processedImage);
      }

      // 格式化结果
      return this._formatResult(result);
    } catch (error) {
      console.error('Tesseract文字检测失败:', error);
      throw error;
    }
  }

  /**
   * 格式化Tesseract识别结果
   * @private
   * @param {Object} result - Tesseract结果对象
   * @returns {Array} - 格式化后的文字区域数组
   */
  _formatResult(result) {
    const { data } = result;
    
    // 提取段落
    const textAreas = data.paragraphs.map((paragraph, index) => {
      // 计算段落边界
      const { x0, y0, x1, y1 } = paragraph.bbox;
      
      // 提取文本内容
      const text = paragraph.text.trim();
      
      // 计算可信度（平均字符可信度）
      const confidence = paragraph.confidence;
      
      return {
        x: x0,
        y: y0,
        width: x1 - x0,
        height: y1 - y0,
        text,
        confidence,
        type: 'paragraph',
        order: index,
        metadata: {
          readingDirection: this._detectReadingDirection(text),
          isProcessed: true,
          detectionMethod: 'tesseract'
        }
      };
    }).filter(area => area.text && area.text.trim() !== '');
    
    return textAreas;
  }

  /**
   * 检测文本阅读方向
   * @private
   * @param {string} text - 文本内容
   * @returns {string} - 阅读方向，'rtl'或'ltr'
   */
  _detectReadingDirection(text) {
    // 简单启发式方法：
    // 检查日语/中文等常用字符，这些语言通常是从右到左阅读的
    const hasJapaneseOrChinese = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(text);
    return hasJapaneseOrChinese ? 'rtl' : 'ltr';
  }

  /**
   * 预处理图像以提高OCR准确率
   * @param {string|Blob} imageData - 图像数据
   * @param {Object} options - 预处理选项
   * @returns {Promise<string|Blob>} - 预处理后的图像数据
   */
  async preprocessImage(imageData, options = {}) {
    // 基本实现，可在后续版本中增强
    // 这里可以添加图像增强、二值化、降噪等预处理步骤
    return imageData;
  }

  /**
   * 释放资源
   * @returns {Promise<void>}
   */
  async terminate() {
    try {
      if (this.scheduler) {
        await this.scheduler.terminate();
        this.scheduler = null;
      } else if (this.worker) {
        await this.worker.terminate();
        this.worker = null;
      }
      
      this.initialized = false;
    } catch (error) {
      console.error('Tesseract资源释放失败:', error);
    }
  }

  /**
   * 获取支持的语言列表
   * @returns {Promise<Array<Object>>} - 语言对象数组
   */
  async getSupportedLanguages() {
    return [
      { code: 'eng', name: '英语' },
      { code: 'jpn', name: '日语' },
      { code: 'chi_sim', name: '简体中文' },
      { code: 'chi_tra', name: '繁体中文' },
      { code: 'kor', name: '韩语' },
      { code: 'fra', name: '法语' },
      { code: 'deu', name: '德语' },
      { code: 'spa', name: '西班牙语' },
      { code: 'rus', name: '俄语' }
    ];
  }

  /**
   * 获取提供者配置模式
   * @returns {Object} - 配置字段定义
   */
  getConfigSchema() {
    return {
      language: { 
        type: 'string', 
        required: true, 
        label: '识别语言',
        options: [
          { value: 'jpn', label: '日语' },
          { value: 'eng', label: '英语' },
          { value: 'chi_sim', label: '简体中文' },
          { value: 'chi_tra', label: '繁体中文' }
        ],
        default: 'jpn'
      },
      preprocess: { 
        type: 'boolean', 
        required: false, 
        label: '启用图像预处理',
        default: true
      },
      workerCount: {
        type: 'number',
        required: false,
        label: '工作线程数',
        min: 1,
        max: 4,
        default: 1
      },
      psm: {
        type: 'number',
        required: false,
        label: '页面分割模式',
        options: [
          { value: PSM.AUTO, label: '自动' },
          { value: PSM.SINGLE_BLOCK, label: '单个文本块' },
          { value: PSM.SINGLE_WORD, label: '单个词' },
          { value: PSM.SINGLE_LINE, label: '单行文本' }
        ],
        default: PSM.AUTO
      }
    };
  }
} 