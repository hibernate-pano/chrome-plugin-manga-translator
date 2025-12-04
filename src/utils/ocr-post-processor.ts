/**
 * OCR结果后处理模块
 * 对OCR识别结果进行清洗和优化，包括去除噪声、合并分块文字、校正识别错误等
 */

export interface TextArea {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  confidence?: number;
  type?: string;
  order?: number;
  metadata?: any;
}

export interface PostProcessOptions {
  removeNoise?: boolean;
  mergeNearbyAreas?: boolean;
  correctErrors?: boolean;
  minConfidence?: number;
  maxDistance?: number;
  language?: string;
}

/**
 * OCR结果后处理主函数
 * @param textAreas - OCR识别结果数组
 * @param options - 后处理选项
 * @returns 处理后的文字区域数组
 */
export function postProcessOCRResults(
  textAreas: TextArea[],
  options: PostProcessOptions = {}
): TextArea[] {
  const {
    removeNoise = true,
    mergeNearbyAreas = true,
    correctErrors = true,
    minConfidence = 0.3,
    maxDistance = 50,
    language = 'auto'
  } = options;

  let processedAreas = [...textAreas];

  // 1. 去除噪声和低置信度区域
  if (removeNoise) {
    processedAreas = removeNoiseAreas(processedAreas, minConfidence);
  }

  // 2. 合并相近的文字区域
  if (mergeNearbyAreas) {
    processedAreas = mergeNearbyTextAreas(processedAreas, maxDistance);
  }

  // 3. 校正识别错误
  if (correctErrors) {
    processedAreas = correctRecognitionErrors(processedAreas, language);
  }

  // 4. 重新排序和规范化
  processedAreas = normalizeTextAreas(processedAreas);

  return processedAreas;
}

/**
 * 去除噪声和低置信度区域
 * @param textAreas - 文字区域数组
 * @param minConfidence - 最小置信度阈值
 * @returns 过滤后的文字区域数组
 */
function removeNoiseAreas(
  textAreas: TextArea[],
  minConfidence: number
): TextArea[] {
  return textAreas.filter(area => {
    // 过滤低置信度区域
    if (area.confidence !== undefined && area.confidence < minConfidence) {
      return false;
    }

    // 过滤空文本或只有空白字符的文本
    if (!area.text || area.text.trim().length === 0) {
      return false;
    }

    // 过滤过小的区域（可能是噪声）
    if (area.width < 5 || area.height < 5) {
      return false;
    }

    // 过滤文本长度过短的区域（可能是噪声）
    const textLength = area.text.trim().length;
    if (textLength < 1) {
      return false;
    }

    // 过滤只包含特殊字符的区域
    if (/^[^\w\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff]+$/.test(area.text.trim())) {
      return false;
    }

    return true;
  });
}

/**
 * 合并相近的文字区域
 * @param textAreas - 文字区域数组
 * @param maxDistance - 最大合并距离（像素）
 * @returns 合并后的文字区域数组
 */
function mergeNearbyTextAreas(
  textAreas: TextArea[],
  maxDistance: number
): TextArea[] {
  if (textAreas.length === 0) return [];

  // 按位置排序（从上到下，从左到右）
  const sortedAreas = [...textAreas].sort((a, b) => {
    const yDiff = a.y - b.y;
    if (Math.abs(yDiff) > maxDistance) {
      return yDiff;
    }
    return a.x - b.x;
  });

  const mergedAreas: TextArea[] = [];
  const used = new Set<number>();

  for (let i = 0; i < sortedAreas.length; i++) {
    if (used.has(i)) continue;

    let currentArea = { ...sortedAreas[i] };
    used.add(i);

    // 查找可以合并的相邻区域
    for (let j = i + 1; j < sortedAreas.length; j++) {
      if (used.has(j)) continue;

      const otherArea = sortedAreas[j];
      const distance = calculateDistance(currentArea, otherArea);

      // 如果距离足够近，且在同一行或相近行，则合并
      if (distance <= maxDistance && shouldMerge(currentArea, otherArea)) {
        currentArea = mergeTwoAreas(currentArea, otherArea);
        used.add(j);
      }
    }

    mergedAreas.push(currentArea);
  }

  return mergedAreas;
}

/**
 * 计算两个文字区域之间的距离
 * @param area1 - 第一个文字区域
 * @param area2 - 第二个文字区域
 * @returns 距离（像素）
 */
function calculateDistance(area1: TextArea, area2: TextArea): number {
  // 计算两个区域中心点之间的距离
  const center1 = {
    x: area1.x + area1.width / 2,
    y: area1.y + area1.height / 2
  };
  const center2 = {
    x: area2.x + area2.width / 2,
    y: area2.y + area2.height / 2
  };

  const dx = center1.x - center2.x;
  const dy = center1.y - center2.y;

  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 判断两个区域是否应该合并
 * @param area1 - 第一个文字区域
 * @param area2 - 第二个文字区域
 * @returns 是否应该合并
 */
function shouldMerge(area1: TextArea, area2: TextArea): boolean {
  // 检查是否在同一行（Y坐标相近）
  const yDiff = Math.abs(area1.y - area2.y);
  const avgHeight = (area1.height + area2.height) / 2;
  const isSameLine = yDiff < avgHeight * 0.5;

  // 检查是否水平相邻（X坐标相近）
  const xDiff = Math.abs(
    (area1.x + area1.width) - area2.x
  );
  const isAdjacent = xDiff < avgHeight * 2;

  return isSameLine && isAdjacent;
}

/**
 * 合并两个文字区域
 * @param area1 - 第一个文字区域
 * @param area2 - 第二个文字区域
 * @returns 合并后的文字区域
 */
function mergeTwoAreas(area1: TextArea, area2: TextArea): TextArea {
  const minX = Math.min(area1.x, area2.x);
  const minY = Math.min(area1.y, area2.y);
  const maxX = Math.max(area1.x + area1.width, area2.x + area2.width);
  const maxY = Math.max(area1.y + area1.height, area2.y + area2.height);

  // 合并文本（添加空格分隔）
  const text1 = area1.text.trim();
  const text2 = area2.text.trim();
  const mergedText = text1 && text2 ? `${text1} ${text2}` : text1 || text2;

  // 计算平均置信度
  const confidence1 = area1.confidence ?? 0.8;
  const confidence2 = area2.confidence ?? 0.8;
  const avgConfidence = (confidence1 + confidence2) / 2;

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    text: mergedText,
    confidence: avgConfidence,
    type: area1.type || area2.type || 'text',
    order: Math.min(area1.order ?? 0, area2.order ?? 0),
    metadata: {
      ...area1.metadata,
      ...area2.metadata,
      merged: true,
      originalAreas: [area1, area2]
    }
  };
}

/**
 * 校正识别错误
 * @param textAreas - 文字区域数组
 * @param language - 语言代码
 * @returns 校正后的文字区域数组
 */
function correctRecognitionErrors(
  textAreas: TextArea[],
  language: string
): TextArea[] {
  return textAreas.map(area => {
    let correctedText = area.text;

    // 常见OCR错误校正
    const commonCorrections: Record<string, string> = {
      // 数字识别错误
      'O': '0', // 在某些字体中，O和0容易混淆
      'l': '1', // 小写L和数字1
      'I': '1', // 大写I和数字1
      // 标点符号
      '，': ',',
      '。': '.',
      '！': '!',
      '？': '?',
      // 空格处理
      '  ': ' ', // 多个空格合并为一个
    };

    // 应用常见校正
    for (const [wrong, correct] of Object.entries(commonCorrections)) {
      correctedText = correctedText.replace(new RegExp(wrong, 'g'), correct);
    }

    // 去除首尾空白
    correctedText = correctedText.trim();

    // 去除重复字符（可能是识别错误）
    correctedText = removeDuplicateChars(correctedText);

    return {
      ...area,
      text: correctedText
    };
  });
}

/**
 * 去除重复字符
 * @param text - 文本
 * @returns 处理后的文本
 */
function removeDuplicateChars(text: string): string {
  // 去除连续重复的字符（超过3个）
  return text.replace(/(.)\1{3,}/g, '$1$1$1');
}

/**
 * 规范化文字区域
 * @param textAreas - 文字区域数组
 * @returns 规范化后的文字区域数组
 */
function normalizeTextAreas(textAreas: TextArea[]): TextArea[] {
  // 按位置重新排序
  const sorted = [...textAreas].sort((a, b) => {
    const yDiff = a.y - b.y;
    if (Math.abs(yDiff) > 20) {
      return yDiff; // 不同行，按Y坐标排序
    }
    return a.x - b.x; // 同一行，按X坐标排序
  });

  // 重新分配order
  return sorted.map((area, index) => ({
    ...area,
    order: index,
    // 确保所有必要字段存在
    confidence: area.confidence ?? 0.8,
    type: area.type || 'text',
    metadata: {
      ...area.metadata,
      isProcessed: true
    }
  }));
}

/**
 * 评估OCR结果质量
 * @param textAreas - 文字区域数组
 * @returns 质量评分（0-1）
 */
export function evaluateOCRQuality(textAreas: TextArea[]): number {
  if (textAreas.length === 0) return 0;

  // 计算平均置信度
  const avgConfidence = textAreas.reduce((sum, area) => {
    return sum + (area.confidence ?? 0.5);
  }, 0) / textAreas.length;

  // 计算文本覆盖率（有文本的区域比例）
  const textCoverage = textAreas.filter(area => 
    area.text && area.text.trim().length > 0
  ).length / textAreas.length;

  // 综合评分
  return (avgConfidence * 0.7 + textCoverage * 0.3);
}

/**
 * 提取文本内容（用于翻译）
 * @param textAreas - 文字区域数组
 * @returns 文本数组
 */
export function extractTexts(textAreas: TextArea[]): string[] {
  return textAreas
    .map(area => area.text?.trim())
    .filter(text => text && text.length > 0);
}

