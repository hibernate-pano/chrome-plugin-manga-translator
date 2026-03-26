/**
 * Services Index
 * 
 * Exports all service modules for manga translation.
 */

// Image Processor
export {
  processImage,
  processImageFromUrl,
  compressImage,
  imageToBase64,
  calculateHash,
  shouldPreserveTallMangaPage,
  loadImage,
  meetsMinimumSize,
  getImageDimensions,
  base64ToDataUrl,
  dataUrlToBase64,
  type ImageProcessingOptions,
  type ProcessedImage,
} from './image-processor';

// Translator Service
export {
  TranslatorService,
  createTranslatorFromConfig,
  getTranslator,
  resetTranslator,
  type TranslatorConfig,
  type TranslationProgress,
  type ProgressCallback,
  type TranslationResult,
  type TextArea,
} from './translator';

// Overlay Renderer
export {
  OverlayRenderer,
  getRenderer,
  resetRenderer,
  calculateFontSize,
  findAllWrappers,
  findAllOverlays,
  removeAllOverlaysFromDOM,
  type OverlayStyle,
  type RenderedOverlay,
} from './renderer';
