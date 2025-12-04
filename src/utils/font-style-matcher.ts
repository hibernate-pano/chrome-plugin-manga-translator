/**
 * 字体样式匹配模块
 * 实现自动匹配原文字体样式的功能，包括字体类型、大小、颜色、粗细等的智能识别和匹配
 */

export interface FontStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: string | number;
  fontColor: { r: number; g: number; b: number };
  backgroundColor: { r: number; g: number; b: number };
  fontStyle?: 'normal' | 'italic' | 'oblique';
  letterSpacing?: number;
  lineHeight?: number;
}

export interface TextArea {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  metadata?: Record<string, unknown>;
}

/**
 * 分析并匹配原文字体样式
 * @param image - 图像元素
 * @param textArea - 文字区域信息
 * @param options - 匹配选项
 * @returns 匹配的字体样式
 */
export function matchFontStyle(
  image: HTMLImageElement,
  textArea: TextArea,
  options: {
    styleLevel?: number; // 0-100，样式匹配程度
    preferSystemFonts?: boolean; // 是否优先使用系统字体
    language?: string; // 目标语言
  } = {}
): FontStyle {
  const {
    styleLevel = 50,
    preferSystemFonts = true,
    language = 'zh-CN'
  } = options;

  // 分析原始样式
  const originalStyle = analyzeOriginalStyle(image, textArea);

  // 匹配字体族
  const fontFamily = matchFontFamily(originalStyle, language, preferSystemFonts);

  // 匹配字体大小
  const fontSize = matchFontSize(originalStyle, textArea, styleLevel);

  // 匹配字体粗细
  const fontWeight = matchFontWeight(originalStyle, styleLevel);

  // 匹配字体颜色
  const fontColor = matchFontColor(originalStyle, styleLevel);

  // 匹配背景颜色
  const backgroundColor = matchBackgroundColor(originalStyle, styleLevel);

  // 匹配字体样式（斜体等）
  const fontStyle = matchFontStyleProperty(originalStyle, styleLevel);

  // 计算字间距
  const letterSpacing = calculateLetterSpacing(originalStyle, textArea);

  // 计算行高
  const lineHeight = calculateLineHeight(originalStyle, textArea);

  return {
    fontFamily,
    fontSize,
    fontWeight,
    fontColor,
    backgroundColor,
    fontStyle,
    letterSpacing,
    lineHeight
  };
}

/**
 * 分析原始文字样式
 * @param image - 图像元素
 * @param textArea - 文字区域信息
 * @returns 原始样式信息
 */
function analyzeOriginalStyle(
  image: HTMLImageElement,
  textArea: TextArea
): {
  avgBrightness: number;
  contrast: number;
  dominantColor: { r: number; g: number; b: number };
  backgroundColor: { r: number; g: number; b: number };
  textDensity: number;
  strokeWidth: number;
} {
  const { x, y, width, height } = textArea;

  // 创建临时Canvas来分析样式
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return getDefaultStyle();
  }

  ctx.drawImage(image, x, y, width, height, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // 分析颜色和亮度
  let rSum = 0, gSum = 0, bSum = 0;
  let pixelCount = 0;
  let brightnessSum = 0;

  // 背景色（取四个角和中心的平均值）
  const samplePoints = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: 0, y: height - 1 },
    { x: width - 1, y: height - 1 },
    { x: Math.floor(width / 2), y: Math.floor(height / 2) }
  ];

  let bgR = 0, bgG = 0, bgB = 0;
  samplePoints.forEach(point => {
    const idx = (point.y * width + point.x) * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    if (r !== undefined && g !== undefined && b !== undefined) {
      bgR += r;
      bgG += g;
      bgB += b;
    }
  });

  bgR = Math.round(bgR / samplePoints.length);
  bgG = Math.round(bgG / samplePoints.length);
  bgB = Math.round(bgB / samplePoints.length);

  // 前景色（非背景色的平均值）
  const threshold = 30;
  const foregroundPixels: number[] = [];

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    
    if (r === undefined || g === undefined || b === undefined) continue;
    
    const brightness = (r + g + b) / 3;
    const diff = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);

    if (diff > threshold) {
      rSum += r;
      gSum += g;
      bSum += b;
      pixelCount++;
      brightnessSum += brightness;
      foregroundPixels.push(brightness);
    }
  }

  // 计算前景色
  const fontR: number = pixelCount > 0 
    ? Math.round(rSum / pixelCount)
    : (255 - (bgR ?? 255));
  const fontG: number = pixelCount > 0
    ? Math.round(gSum / pixelCount)
    : (255 - (bgG ?? 255));
  const fontB: number = pixelCount > 0
    ? Math.round(bSum / pixelCount)
    : (255 - (bgB ?? 255));

  // 计算平均亮度
  const avgBrightness = pixelCount > 0 ? brightnessSum / pixelCount : 128;

  // 计算对比度（标准差）
  const variance = foregroundPixels.reduce((sum, val) => {
    const diff = val - avgBrightness;
    return sum + diff * diff;
  }, 0) / (foregroundPixels.length || 1);
  const contrast = Math.sqrt(variance);

  // 估算文本密度（文本像素占总像素的比例）
  const textDensity = pixelCount / (width * height);

  // 估算笔画宽度（基于文本密度和区域大小）
  const strokeWidth = Math.max(1, Math.round(Math.sqrt(width * height) * textDensity * 0.1));

  return {
    avgBrightness,
    contrast,
    dominantColor: { r: fontR, g: fontG, b: fontB },
    backgroundColor: { r: bgR, g: bgG, b: bgB },
    textDensity,
    strokeWidth
  };
}

/**
 * 匹配字体族
 * @param originalStyle - 原始样式
 * @param language - 目标语言
 * @param preferSystemFonts - 是否优先使用系统字体
 * @returns 匹配的字体族
 */
function matchFontFamily(
  originalStyle: ReturnType<typeof analyzeOriginalStyle>,
  language: string,
  preferSystemFonts: boolean
): string {
  // 根据语言选择字体族
  const fontMap: Record<string, string[]> = {
    'zh-CN': [
      'Microsoft YaHei',
      'PingFang SC',
      'Hiragino Sans GB',
      'WenQuanYi Micro Hei',
      'SimHei',
      'sans-serif'
    ],
    'zh-TW': [
      'Microsoft JhengHei',
      'PingFang TC',
      'Hiragino Sans GB',
      'sans-serif'
    ],
    'ja': [
      'Hiragino Kaku Gothic ProN',
      'Hiragino Sans',
      'Yu Gothic',
      'Meiryo',
      'sans-serif'
    ],
    'ko': [
      'Malgun Gothic',
      'Apple SD Gothic Neo',
      'Nanum Gothic',
      'sans-serif'
    ],
    'en': [
      'Arial',
      'Helvetica',
      'Verdana',
      'sans-serif'
    ]
  };

  const fonts = fontMap[language] || fontMap['zh-CN'] || ['sans-serif'];

  if (preferSystemFonts) {
    return fonts.join(', ');
  }

  // 如果不优先系统字体，可以尝试匹配原始字体的特征
  // 这里简化处理，直接返回默认字体
  return fonts[0] || 'sans-serif';
}

/**
 * 匹配字体大小
 * @param originalStyle - 原始样式
 * @param textArea - 文字区域
 * @param styleLevel - 样式匹配程度
 * @returns 匹配的字体大小
 */
function matchFontSize(
  originalStyle: ReturnType<typeof analyzeOriginalStyle>,
  textArea: TextArea,
  styleLevel: number
): number {
  // 基于区域大小估算字体大小
  const baseSize = Math.min(textArea.width, textArea.height) * 0.6;

  // 根据文本密度调整
  const densityFactor = Math.max(0.5, Math.min(1.5, originalStyle.textDensity * 10));
  const adjustedSize = baseSize * densityFactor;

  // 根据styleLevel调整（0-100，50为基准）
  const levelFactor = styleLevel / 50;
  const finalSize = adjustedSize * levelFactor;

  // 限制字体大小范围
  return Math.max(10, Math.min(72, Math.round(finalSize)));
}

/**
 * 匹配字体粗细
 * @param originalStyle - 原始样式
 * @param styleLevel - 样式匹配程度
 * @returns 匹配的字体粗细
 */
function matchFontWeight(
  originalStyle: ReturnType<typeof analyzeOriginalStyle>,
  styleLevel: number
): string | number {
  // 基于对比度和笔画宽度估算字体粗细
  const isBold = originalStyle.contrast > 40 || originalStyle.strokeWidth > 2;

  if (styleLevel < 30) {
    // 低匹配度，使用默认
    return 'normal';
  } else if (styleLevel > 70) {
    // 高匹配度，精确匹配
    return isBold ? 'bold' : 'normal';
  } else {
    // 中等匹配度，根据特征调整
    return isBold ? 600 : 400;
  }
}

/**
 * 匹配字体颜色
 * @param originalStyle - 原始样式
 * @param styleLevel - 样式匹配程度
 * @returns 匹配的字体颜色
 */
function matchFontColor(
  originalStyle: ReturnType<typeof analyzeOriginalStyle>,
  styleLevel: number
): { r: number; g: number; b: number } {
  if (styleLevel < 30) {
    // 低匹配度，使用默认颜色
    return { r: 0, g: 0, b: 0 };
  }

  // 根据匹配程度混合原始颜色和默认颜色
  const ratio = styleLevel / 100;
  const defaultColor = { r: 0, g: 0, b: 0 };
  const originalColor = originalStyle.dominantColor;

  return {
    r: Math.round(defaultColor.r * (1 - ratio) + originalColor.r * ratio),
    g: Math.round(defaultColor.g * (1 - ratio) + originalColor.g * ratio),
    b: Math.round(defaultColor.b * (1 - ratio) + originalColor.b * ratio)
  };
}

/**
 * 匹配背景颜色
 * @param originalStyle - 原始样式
 * @param styleLevel - 样式匹配程度
 * @returns 匹配的背景颜色
 */
function matchBackgroundColor(
  originalStyle: ReturnType<typeof analyzeOriginalStyle>,
  styleLevel: number
): { r: number; g: number; b: number } {
  if (styleLevel < 30) {
    // 低匹配度，使用默认背景
    return { r: 255, g: 255, b: 255 };
  }

  // 根据匹配程度调整背景透明度
  const originalBg = originalStyle.backgroundColor;
  return originalBg;
}

/**
 * 匹配字体样式属性（斜体等）
 * @param _originalStyle - 原始样式（未使用）
 * @param _styleLevel - 样式匹配程度（未使用）
 * @returns 匹配的字体样式
 */
function matchFontStyleProperty(
  _originalStyle: ReturnType<typeof analyzeOriginalStyle>,
  _styleLevel: number
): 'normal' | 'italic' | 'oblique' {
  // 简化处理，默认返回normal
  // 可以基于图像分析来检测斜体
  return 'normal';
}

/**
 * 计算字间距
 * @param originalStyle - 原始样式
 * @param textArea - 文字区域
 * @returns 字间距（像素）
 */
function calculateLetterSpacing(
  originalStyle: ReturnType<typeof analyzeOriginalStyle>,
  textArea: TextArea
): number {
  // 基于区域大小和文本密度估算字间距
  const baseSpacing = Math.min(textArea.width, textArea.height) * 0.05;
  return Math.max(0, Math.min(5, baseSpacing));
}

/**
 * 计算行高
 * @param originalStyle - 原始样式
 * @param textArea - 文字区域
 * @returns 行高（相对于字体大小的倍数）
 */
function calculateLineHeight(
  originalStyle: ReturnType<typeof analyzeOriginalStyle>,
  textArea: TextArea
): number {
  // 基于区域高度估算行高
  const estimatedFontSize = Math.min(textArea.width, textArea.height) * 0.6;
  const lineHeight = textArea.height / estimatedFontSize;
  return Math.max(1.0, Math.min(2.0, lineHeight));
}

/**
 * 获取默认样式
 */
function getDefaultStyle(): ReturnType<typeof analyzeOriginalStyle> {
  return {
    avgBrightness: 128,
    contrast: 50,
    dominantColor: { r: 0, g: 0, b: 0 },
    backgroundColor: { r: 255, g: 255, b: 255 },
    textDensity: 0.3,
    strokeWidth: 1
  };
}

