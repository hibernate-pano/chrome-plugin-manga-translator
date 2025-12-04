/**
 * 图像预处理工具模块
 * 提供智能预处理选择和质量评估功能
 */

import { preprocessImage as preprocessImageCore } from './imageProcess';

export interface PreprocessingOptions {
  method?: string | string[];
  adaptive?: boolean;
  qualityThreshold?: number;
  autoOptimize?: boolean;
}

export interface PreprocessingResult {
  canvas: HTMLCanvasElement;
  method: string;
  quality: number;
  processingTime: number;
}

/**
 * 预处理方法配置
 */
const PREPROCESSING_PRESETS = {
  none: {
    name: '无预处理',
    description: '不进行任何预处理',
    methods: []
  },
  light: {
    name: '轻度预处理',
    description: '轻微对比度增强',
    methods: ['enhance']
  },
  standard: {
    name: '标准预处理',
    description: '对比度增强 + 降噪',
    methods: ['enhance', 'denoise']
  },
  aggressive: {
    name: '激进预处理',
    description: '完整预处理流程（增强、降噪、锐化）',
    methods: ['enhance', 'denoise', 'sharpen']
  },
  manga: {
    name: '漫画优化',
    description: '针对漫画图像的优化预处理',
    methods: ['enhance', 'adaptive', 'sharpen']
  },
  lowQuality: {
    name: '低质量图像',
    description: '针对低质量图像的强化预处理',
    methods: ['denoise', 'enhance', 'equalize', 'sharpen']
  }
};

/**
 * 智能选择预处理方法
 * @param image - 图像元素
 * @param options - 预处理选项
 * @returns 推荐的预处理方法
 */
export function selectOptimalPreprocessing(
  image: HTMLImageElement,
  options: PreprocessingOptions = {}
): string {
  // 如果用户指定了方法，直接使用
  if (options.method && options.method !== 'auto') {
    return Array.isArray(options.method) ? options.method[0] : options.method;
  }

  // 分析图像特征
  const analysis = analyzeImageQuality(image);

  // 根据图像特征选择预处理方法
  if (analysis.isLowQuality) {
    return 'lowQuality';
  } else if (analysis.isManga) {
    return 'manga';
  } else if (analysis.needsEnhancement) {
    return 'aggressive';
  } else if (analysis.needsDenoising) {
    return 'standard';
  } else {
    return 'light';
  }
}

/**
 * 分析图像质量
 * @param image - 图像元素
 * @returns 质量分析结果
 */
function analyzeImageQuality(image: HTMLImageElement): {
  isLowQuality: boolean;
  isManga: boolean;
  needsEnhancement: boolean;
  needsDenoising: boolean;
} {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      isLowQuality: false,
      isManga: false,
      needsEnhancement: false,
      needsDenoising: false
    };
  }

  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // 计算图像统计信息
  let brightnessSum = 0;
  let contrastSum = 0;
  let noiseLevel = 0;
  
  const samples: number[] = [];
  
  // 采样分析（每10个像素采样一次以提高性能）
  for (let i = 0; i < data.length; i += 40) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const brightness = (r + g + b) / 3;
    brightnessSum += brightness;
    samples.push(brightness);
  }

  const avgBrightness = brightnessSum / (samples.length || 1);
  
  // 计算对比度（标准差）
  const variance = samples.reduce((sum, val) => {
    const diff = val - avgBrightness;
    return sum + diff * diff;
  }, 0) / samples.length;
  
  const contrast = Math.sqrt(variance);

  // 估算噪声水平（通过局部方差）
  let noiseSum = 0;
  const noiseSamples = Math.min(100, samples.length);
  for (let i = 0; i < noiseSamples - 1; i++) {
    noiseSum += Math.abs(samples[i] - samples[i + 1]);
  }
  noiseLevel = noiseSum / (noiseSamples - 1);

  // 判断图像特征
  const isLowQuality = contrast < 30 || noiseLevel > 15;
  const isManga = contrast > 50 && avgBrightness > 200; // 高对比度、高亮度通常是漫画
  const needsEnhancement = contrast < 40;
  const needsDenoising = noiseLevel > 10;

  return {
    isLowQuality,
    isManga,
    needsEnhancement,
    needsDenoising
  };
}

/**
 * 智能预处理图像
 * @param image - 图像元素
 * @param options - 预处理选项
 * @returns 预处理结果
 */
export async function smartPreprocessImage(
  image: HTMLImageElement,
  options: PreprocessingOptions = {}
): Promise<PreprocessingResult> {
  const startTime = performance.now();

  // 选择预处理方法
  const method = options.adaptive !== false
    ? selectOptimalPreprocessing(image, options)
    : (options.method || 'none');

  // 获取预设配置
  const preset = PREPROCESSING_PRESETS[method as keyof typeof PREPROCESSING_PRESETS] || PREPROCESSING_PRESETS.none;
  const methods = preset.methods.length > 0 ? preset.methods : (Array.isArray(method) ? method : [method]);

  // 执行预处理
  let canvas: HTMLCanvasElement;
  if (methods.length === 0 || methods[0] === 'none') {
    // 无预处理，直接创建canvas
    canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(image, 0, 0);
    }
  } else {
    // 执行预处理
    canvas = await preprocessImageCore(image, methods, {});
  }

  // 评估预处理质量
  const quality = options.qualityThreshold 
    ? evaluatePreprocessingQuality(canvas)
    : 1.0;

  const processingTime = performance.now() - startTime;

  return {
    canvas,
    method: Array.isArray(methods) ? methods.join('+') : methods[0] || 'none',
    quality,
    processingTime
  };
}

/**
 * 评估预处理质量
 * @param canvas - 预处理后的Canvas
 * @returns 质量评分 (0-1)
 */
function evaluatePreprocessingQuality(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0.5;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // 计算对比度
  let brightnessSum = 0;
  const brightnesses: number[] = [];
  
  for (let i = 0; i < data.length; i += 40) {
    const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
    brightnessSum += brightness;
    brightnesses.push(brightness);
  }

  const avgBrightness = brightnessSum / brightnesses.length;
  
  // 计算标准差作为对比度指标
  const variance = brightnesses.reduce((sum, val) => {
    const diff = val - avgBrightness;
    return sum + diff * diff;
  }, 0) / brightnesses.length;
  
  const contrast = Math.sqrt(variance);

  // 归一化质量评分 (对比度越高，质量越好)
  const normalizedContrast = Math.min(contrast / 100, 1.0);
  
  return normalizedContrast;
}

/**
 * 获取预处理预设列表
 */
export function getPreprocessingPresets() {
  return PREPROCESSING_PRESETS;
}

/**
 * 批量预处理图像
 * @param images - 图像元素数组
 * @param options - 预处理选项
 * @returns 预处理结果数组
 */
export async function batchPreprocessImages(
  images: HTMLImageElement[],
  options: PreprocessingOptions = {}
): Promise<PreprocessingResult[]> {
  const results: PreprocessingResult[] = [];
  
  // 并行处理（限制并发数）
  const concurrency = 3;
  for (let i = 0; i < images.length; i += concurrency) {
    const batch = images.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(img => smartPreprocessImage(img, options))
    );
    results.push(...batchResults);
  }
  
  return results;
}

