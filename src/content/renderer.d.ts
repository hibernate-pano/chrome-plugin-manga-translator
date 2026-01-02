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
  fontSize?: 'auto' | number | string;
  color?: string;
  fontColor?: string;
  backgroundColor?: string;
  opacity?: number;
  textColor?: string;
  showOriginalText?: boolean;
  textAlignment?: 'left' | 'center' | 'right';
  lineSpacing?: number;
  fontFamily?: string;
  styleLevel?: number;
}

export function renderTranslation(
  image: HTMLImageElement,
  textAreas: TextArea[],
  translatedTexts: string[],
  options?: RenderOptions
): Promise<HTMLElement>;

export function removeTranslation(wrapper: HTMLElement): void;

export function clearAllTranslations(): void;

export function showDebugAreas(
  image: HTMLImageElement,
  textAreas: TextArea[]
): void;
