from __future__ import annotations

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile

from .cache_store import CacheStore
from .config import Settings, load_settings
from .pipeline import TranslationPipeline
from .schemas import HealthResponse, MetricsResponse, TranslateImageResponse


settings = load_settings()
cache_store = CacheStore(settings.db_path, settings.cache_dir)
pipeline = TranslationPipeline(settings, cache_store)
app = FastAPI(title="Manga OCR-First Translation Server", version="0.1.0")


def require_auth(authorization: str | None = Header(default=None)) -> None:
  if not settings.server_auth_token:
    return

  expected = f"Bearer {settings.server_auth_token}"
  if authorization != expected:
    raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/api/v1/health", response_model=HealthResponse)
async def health(_: None = Depends(require_auth)) -> HealthResponse:
  return HealthResponse(status="ok", capabilities=pipeline.capabilities())


@app.get("/api/v1/metrics", response_model=MetricsResponse)
async def metrics(_: None = Depends(require_auth)) -> MetricsResponse:
  snapshot = cache_store.get_metrics()
  return MetricsResponse(
    imageCacheHits=snapshot.get("image_cache_hits", 0),
    imageCacheMisses=snapshot.get("image_cache_misses", 0),
    translationCacheHits=snapshot.get("translation_cache_hits", 0),
    translationCacheMisses=snapshot.get("translation_cache_misses", 0),
    regionFallbackCount=snapshot.get("region_fallback_count", 0),
    fullImageFallbackCount=snapshot.get("full_image_fallback_count", 0),
  )


@app.post("/api/v1/translate-image", response_model=TranslateImageResponse)
async def translate_image(
  image: UploadFile = File(...),
  imageKey: str = Form(default=""),
  pageUrl: str = Form(default=""),
  imageUrl: str = Form(default=""),
  targetLanguage: str = Form(default="zh-CN"),
  translationStylePreset: str = Form(default="natural-zh"),
  renderMode: str = Form(default="strong-overlay-compat"),
  forceRefresh: bool = Form(default=False),
  _: None = Depends(require_auth),
) -> TranslateImageResponse:
  _ = pageUrl, imageUrl, renderMode
  image_bytes = await image.read()
  if not image_bytes:
    raise HTTPException(status_code=400, detail="No image uploaded")

  return await pipeline.translate_image(
    image_bytes=image_bytes,
    image_key=imageKey,
    target_language=targetLanguage,
    style_preset=translationStylePreset,
    force_refresh=forceRefresh,
  )
