/**
 * 翻译结果渲染工具类型定义
 */

export interface TextArea {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number;
}

export interface RenderOptions {
  fontSize?: 'auto' | number;
  color?: string;
  backgroundColor?: string;
  opacity?: number;
  textColor?: string;
  showOriginalText?: boolean;
  textAlignment?: 'left' | 'center' | 'right';
  lineSpacing?: number;
}

export function renderTranslation(
  image: HTMLImageElement,
  textAreas: TextArea[],
  translatedTexts: string[],
  options?: RenderOptions
): void;

export function removeTranslation(image: HTMLImageElement): void;

export function clearAllTranslations(): void;
