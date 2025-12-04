/**
 * 文字检测模块类型声明
 */

export interface TextArea {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  type?: string;
  order?: number;
  confidence?: number;
  speaker?: string;
  metadata?: {
    readingDirection?: string;
    isProcessed?: boolean;
    detectionMethod?: string;
    [key: string]: any;
  };
}

export interface DetectTextAreasOptions {
  useCache?: boolean;
  debugMode?: boolean;
  preferredOCRMethod?: 'auto' | 'tesseract' | 'api';
  [key: string]: any;
}

/**
 * 检测图像中的文字区域
 */
export function detectTextAreas(
  image: HTMLImageElement,
  options?: DetectTextAreasOptions
): Promise<TextArea[]>;

/**
 * 提取文字区域的内容
 */
export function extractText(
  image: HTMLImageElement,
  textArea: TextArea
): Promise<string>;

/**
 * 释放OCR提供者资源
 */
export function terminateOCRProviders(): Promise<boolean>;

