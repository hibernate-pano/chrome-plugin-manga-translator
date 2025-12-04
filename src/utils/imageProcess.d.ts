/**
 * 图像处理工具类型定义
 */

export interface ImageProcessOptions {
  grayscale?: boolean;
  denoise?: boolean;
  sharpen?: boolean;
  histogramEqualization?: boolean;
  binarize?: boolean;
  threshold?: number;
}

export function imageToBase64(image: HTMLImageElement): Promise<string>;
export function preprocessImage(imageData: string, options: ImageProcessOptions): Promise<string>;
export function binarizeImage(imageData: string, threshold?: number): Promise<string>;
export function denoiseImage(imageData: string): Promise<string>;
export function sharpenImage(imageData: string): Promise<string>;
export function histogramEqualization(imageData: string): Promise<string>;
export function grayscaleImage(imageData: string): Promise<string>;
