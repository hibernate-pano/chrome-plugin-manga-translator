/**
 * OCR提供者智能选择器
 * 根据图像特征和配置自动选择最佳OCR方法
 */

export interface ImageFeatures {
  /** 图像宽度 */
  width: number;
  /** 图像高度 */
  height: number;
  /** 图像总像素数 */
  pixelCount: number;
  /** 平均亮度 (0-255) */
  avgBrightness: number;
  /** 对比度 (标准差) */
  contrast: number;
  /** 噪声水平 */
  noiseLevel: number;
  /** 图像复杂度评分 (0-1) */
  complexity: number;
  /** 是否为漫画风格 */
  isMangaStyle: boolean;
  /** 图像质量评分 (0-1) */
  qualityScore: number;
}

export interface OCRProviderRecommendation {
  /** 推荐的提供者类型: 'tesseract' | 'api' | 'auto' */
  provider: 'tesseract' | 'api' | 'auto';
  /** 推荐理由 */
  reason: string;
  /** 置信度 (0-1) */
  confidence: number;
  /** 预期性能评分 (0-1) */
  expectedPerformance: number;
}

export interface OCRSelectionConfig {
  /** 用户偏好方法 */
  preferredMethod?: 'auto' | 'tesseract' | 'api';
  /** 是否优先考虑速度 */
  prioritizeSpeed?: boolean;
  /** 是否优先考虑准确率 */
  prioritizeAccuracy?: boolean;
  /** API可用性 */
  apiAvailable?: boolean;
  /** Tesseract可用性 */
  tesseractAvailable?: boolean;
  /** 图像大小阈值（像素数），超过此值建议使用API */
  largeImageThreshold?: number;
  /** 低质量图像阈值，低于此值建议使用API */
  lowQualityThreshold?: number;
}

/**
 * 分析图像特征
 * @param image - 图像元素
 * @returns 图像特征对象
 */
export function analyzeImageFeatures(image: HTMLImageElement): ImageFeatures {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      // 返回默认特征
      return getDefaultFeatures(canvas.width, canvas.height);
    }
    
    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    const width = canvas.width;
    const height = canvas.height;
    const pixelCount = width * height;
    
    // 采样分析（每4个像素采样一次以提高性能）
    const sampleStep = 4;
    const samples: number[] = [];
    const colorSamples: Array<{ r: number; g: number; b: number }> = [];
    
    for (let i = 0; i < data.length; i += sampleStep * 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const brightness = (r + g + b) / 3;
      samples.push(brightness);
      colorSamples.push({ r, g, b });
    }
    
    if (samples.length === 0) {
      return getDefaultFeatures(width, height);
    }
    
    // 计算平均亮度
    const avgBrightness = samples.reduce((sum, val) => sum + val, 0) / samples.length;
    
    // 计算对比度（标准差）
    const variance = samples.reduce((sum, val) => {
      const diff = val - avgBrightness;
      return sum + diff * diff;
    }, 0) / samples.length;
    const contrast = Math.sqrt(variance);
    
    // 估算噪声水平
    let noiseSum = 0;
    const noiseSamples = Math.min(200, samples.length);
    for (let i = 0; i < noiseSamples - 1; i++) {
      const current = samples[i];
      const next = samples[i + 1];
      if (current !== undefined && next !== undefined) {
        noiseSum += Math.abs(current - next);
      }
    }
    const noiseLevel = noiseSamples > 1 ? noiseSum / (noiseSamples - 1) : 0;
    
    // 计算图像复杂度（基于颜色变化和边缘）
    let colorVariance = 0;
    let edgeCount = 0;
    const edgeThreshold = 30; // 边缘检测阈值
    
    for (let i = 0; i < Math.min(1000, colorSamples.length - 1); i++) {
      const current = colorSamples[i];
      const next = colorSamples[i + 1];
      
      if (!current || !next) continue;
      
      // 颜色方差
      const colorDiff = Math.sqrt(
        Math.pow(current.r - next.r, 2) +
        Math.pow(current.g - next.g, 2) +
        Math.pow(current.b - next.b, 2)
      );
      colorVariance += colorDiff;
      
      // 边缘检测
      const brightnessDiff = Math.abs(
        (current.r + current.g + current.b) / 3 -
        (next.r + next.g + next.b) / 3
      );
      if (brightnessDiff > edgeThreshold) {
        edgeCount++;
      }
    }
    
    const avgColorVariance = colorVariance / Math.min(1000, colorSamples.length - 1);
    const edgeDensity = edgeCount / Math.min(1000, colorSamples.length - 1);
    const complexity = Math.min(1, (avgColorVariance / 100 + edgeDensity) / 2);
    
    // 判断是否为漫画风格
    // 漫画特征：高对比度、清晰的边缘、相对简单的颜色
    const isMangaStyle = 
      contrast > 50 && 
      edgeDensity > 0.1 && 
      avgColorVariance < 80 &&
      avgBrightness > 150;
    
    // 计算图像质量评分
    // 综合考虑对比度、噪声水平、亮度分布
    const qualityScore = Math.min(1, Math.max(0,
      (contrast / 100) * 0.4 +
      (1 - Math.min(noiseLevel / 50, 1)) * 0.3 +
      (Math.abs(avgBrightness - 128) < 50 ? 1 : 0.5) * 0.3
    ));
    
    return {
      width,
      height,
      pixelCount,
      avgBrightness,
      contrast,
      noiseLevel,
      complexity,
      isMangaStyle,
      qualityScore
    };
  } catch (error) {
    console.warn('图像特征分析失败:', error);
    return getDefaultFeatures(
      image.naturalWidth || image.width,
      image.naturalHeight || image.height
    );
  }
}

/**
 * 获取默认图像特征
 */
function getDefaultFeatures(width: number, height: number): ImageFeatures {
  return {
    width,
    height,
    pixelCount: width * height,
    avgBrightness: 128,
    contrast: 50,
    noiseLevel: 10,
    complexity: 0.5,
    isMangaStyle: false,
    qualityScore: 0.7
  };
}

/**
 * 智能选择OCR提供者
 * @param image - 图像元素
 * @param config - 选择配置
 * @returns OCR提供者推荐
 */
export function selectOptimalOCRProvider(
  image: HTMLImageElement,
  config: OCRSelectionConfig = {}
): OCRProviderRecommendation {
  const {
    preferredMethod = 'auto',
    prioritizeSpeed = false,
    prioritizeAccuracy = true,
    apiAvailable = true,
    tesseractAvailable = true,
    largeImageThreshold = 2000000, // 200万像素
    lowQualityThreshold = 0.5
  } = config;
  
  // 如果用户明确指定了方法，直接返回
  if (preferredMethod !== 'auto') {
    const available = preferredMethod === 'api' ? apiAvailable : tesseractAvailable;
    return {
      provider: available ? preferredMethod : (apiAvailable ? 'api' : 'tesseract'),
      reason: available 
        ? `使用用户指定的方法: ${preferredMethod}`
        : `用户指定的方法不可用，使用备选方法`,
      confidence: available ? 1.0 : 0.7,
      expectedPerformance: 0.8
    };
  }
  
  // 分析图像特征
  const features = analyzeImageFeatures(image);
  
  // 检查提供者可用性
  if (!apiAvailable && !tesseractAvailable) {
    return {
      provider: 'tesseract',
      reason: '没有可用的OCR提供者，使用默认方法',
      confidence: 0.5,
      expectedPerformance: 0.5
    };
  }
  
  if (!apiAvailable) {
    return {
      provider: 'tesseract',
      reason: 'API OCR不可用，使用Tesseract',
      confidence: 0.9,
      expectedPerformance: 0.7
    };
  }
  
  if (!tesseractAvailable) {
    return {
      provider: 'api',
      reason: 'Tesseract不可用，使用API OCR',
      confidence: 0.9,
      expectedPerformance: 0.8
    };
  }
  
  // 根据图像特征和配置进行智能选择
  let provider: 'tesseract' | 'api' = 'tesseract';
  let reason = '';
  let confidence = 0.7;
  let expectedPerformance = 0.7;
  
  // 1. 图像大小考虑
  if (features.pixelCount > largeImageThreshold) {
    // 大图像：API通常更快且更准确
    provider = 'api';
    reason = `图像较大(${Math.round(features.pixelCount / 10000) / 100}万像素)，API OCR处理更快`;
    confidence = 0.8;
    expectedPerformance = 0.85;
  }
  
  // 2. 图像质量考虑
  else if (features.qualityScore < lowQualityThreshold) {
    // 低质量图像：API通常更准确
    provider = 'api';
    reason = `图像质量较低(评分: ${features.qualityScore.toFixed(2)})，API OCR识别更准确`;
    confidence = 0.85;
    expectedPerformance = 0.8;
  }
  
  // 3. 漫画风格考虑
  else if (features.isMangaStyle) {
    // 漫画图像：Tesseract通常表现更好（针对日文优化）
    provider = 'tesseract';
    reason = `检测到漫画风格，Tesseract对日文识别更准确`;
    confidence = 0.8;
    expectedPerformance = 0.85;
  }
  
  // 4. 复杂度考虑
  else if (features.complexity > 0.7) {
    // 高复杂度图像：API通常更准确
    provider = 'api';
    reason = `图像复杂度较高，API OCR识别更准确`;
    confidence = 0.75;
    expectedPerformance = 0.8;
  }
  
  // 5. 噪声水平考虑
  else if (features.noiseLevel > 20) {
    // 高噪声图像：API通常更准确
    provider = 'api';
    reason = `图像噪声较高(${features.noiseLevel.toFixed(1)})，API OCR降噪能力更强`;
    confidence = 0.8;
    expectedPerformance = 0.75;
  }
  
  // 6. 速度和准确率优先级
  else {
    if (prioritizeSpeed) {
      // 优先速度：小图像使用Tesseract（本地处理更快）
      if (features.pixelCount < 500000) {
        provider = 'tesseract';
        reason = `优先速度，小图像使用本地Tesseract更快`;
        confidence = 0.75;
        expectedPerformance = 0.8;
      } else {
        provider = 'api';
        reason = `优先速度，大图像API处理更快`;
        confidence = 0.7;
        expectedPerformance = 0.75;
      }
    } else if (prioritizeAccuracy) {
      // 优先准确率：API通常更准确
      provider = 'api';
      reason = `优先准确率，API OCR识别更准确`;
      confidence = 0.8;
      expectedPerformance = 0.85;
    } else {
      // 平衡：中等大小、质量较好的图像使用Tesseract
      if (features.pixelCount < 1000000 && features.qualityScore > 0.6) {
        provider = 'tesseract';
        reason = `平衡考虑，使用本地Tesseract`;
        confidence = 0.7;
        expectedPerformance = 0.75;
      } else {
        provider = 'api';
        reason = `平衡考虑，使用API OCR`;
        confidence = 0.7;
        expectedPerformance = 0.8;
      }
    }
  }
  
  return {
    provider,
    reason,
    confidence,
    expectedPerformance
  };
}

/**
 * 获取OCR提供者选择的详细说明
 */
export function getOCRProviderSelectionInfo(
  image: HTMLImageElement,
  config: OCRSelectionConfig = {}
): {
  recommendation: OCRProviderRecommendation;
  features: ImageFeatures;
  comparison: {
    tesseract: { pros: string[]; cons: string[]; score: number };
    api: { pros: string[]; cons: string[]; score: number };
  };
} {
  const {
    largeImageThreshold = 2000000,
    lowQualityThreshold = 0.5
  } = config;
  
  const features = analyzeImageFeatures(image);
  const recommendation = selectOptimalOCRProvider(image, config);
  
  // Tesseract评估
  const tesseractPros: string[] = [];
  const tesseractCons: string[] = [];
  let tesseractScore = 0.5;
  
  if (features.isMangaStyle) {
    tesseractPros.push('对日文漫画识别准确');
    tesseractScore += 0.2;
  }
  if (features.pixelCount < 500000) {
    tesseractPros.push('小图像本地处理速度快');
    tesseractScore += 0.1;
  }
  if (features.qualityScore > 0.7) {
    tesseractPros.push('高质量图像识别效果好');
    tesseractScore += 0.1;
  }
  if (features.pixelCount > largeImageThreshold) {
    tesseractCons.push('大图像处理速度慢');
    tesseractScore -= 0.2;
  }
  if (features.qualityScore < lowQualityThreshold) {
    tesseractCons.push('低质量图像识别准确率低');
    tesseractScore -= 0.2;
  }
  if (features.noiseLevel > 20) {
    tesseractCons.push('高噪声图像识别效果差');
    tesseractScore -= 0.15;
  }
  
  // API评估
  const apiPros: string[] = [];
  const apiCons: string[] = [];
  let apiScore = 0.5;
  
  if (features.pixelCount > largeImageThreshold) {
    apiPros.push('大图像处理速度快');
    apiScore += 0.2;
  }
  if (features.qualityScore < lowQualityThreshold) {
    apiPros.push('低质量图像识别准确');
    apiScore += 0.2;
  }
  if (features.noiseLevel > 20) {
    apiPros.push('高噪声图像降噪能力强');
    apiScore += 0.15;
  }
  if (features.complexity > 0.7) {
    apiPros.push('复杂图像识别准确');
    apiScore += 0.1;
  }
  if (features.pixelCount < 500000) {
    apiCons.push('小图像网络延迟影响速度');
    apiScore -= 0.1;
  }
  if (!config.apiAvailable) {
    apiCons.push('API不可用');
    apiScore = 0;
  }
  
  return {
    recommendation,
    features,
    comparison: {
      tesseract: {
        pros: tesseractPros.length > 0 ? tesseractPros : ['无特殊优势'],
        cons: tesseractCons.length > 0 ? tesseractCons : ['无特殊劣势'],
        score: Math.max(0, Math.min(1, tesseractScore))
      },
      api: {
        pros: apiPros.length > 0 ? apiPros : ['无特殊优势'],
        cons: apiCons.length > 0 ? apiCons : ['无特殊劣势'],
        score: Math.max(0, Math.min(1, apiScore))
      }
    }
  };
}

