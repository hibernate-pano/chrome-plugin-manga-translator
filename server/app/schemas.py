from __future__ import annotations

from pydantic import BaseModel, Field


class TextAreaModel(BaseModel):
  x: float
  y: float
  width: float
  height: float
  originalText: str
  translatedText: str
  confidence: float | None = None
  source: str = Field(
    default="ocr-mt",
    pattern="^(ocr-mt|ocr-mangaocr|region-vlm|full-image-vlm)$",
  )


class DiagnosticsModel(BaseModel):
  detectedRegions: int = 0
  fallbackRegions: int = 0
  ocrMs: int = 0
  translateMs: int = 0
  totalMs: int = 0


class TranslateImageResponse(BaseModel):
  success: bool
  textAreas: list[TextAreaModel]
  pipeline: str = Field(
    default="ocr-first",
    pattern="^(ocr-first|region-fallback|full-image-fallback)$",
  )
  cached: bool = False
  diagnostics: DiagnosticsModel | None = None
  error: str | None = None


class HealthResponse(BaseModel):
  status: str
  capabilities: list[str]


class MetricsResponse(BaseModel):
  imageCacheHits: int
  imageCacheMisses: int
  translationCacheHits: int
  translationCacheMisses: int
  regionFallbackCount: int
  fullImageFallbackCount: int
