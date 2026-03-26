from __future__ import annotations

import time
from collections import OrderedDict
from dataclasses import dataclass

from PIL import Image

from .cache_store import CacheStore
from .config import Settings
from .image_utils import (
  compute_sha256,
  crop_box,
  image_to_bytes,
  normalize_image,
  normalize_text_key,
)
from .ocr import OCRPipeline, OCRRegion
from .schemas import DiagnosticsModel, TextAreaModel, TranslateImageResponse
from .translation import build_translation_chain
from .vlm import VLMFallbackError, VLMFallbackProvider

PIPELINE_CACHE_VERSION = "v2-context-ocr"


@dataclass
class RegionResult:
  box: tuple[int, int, int, int]
  original_text: str
  translated_text: str
  confidence: float
  source: str


class TranslationPipeline:
  def __init__(self, settings: Settings, cache_store: CacheStore) -> None:
    self._settings = settings
    self._cache_store = cache_store
    self._ocr = OCRPipeline(
      settings.ocr_low_confidence_threshold,
      settings.ocr_languages,
    )
    self._translator = build_translation_chain(settings)
    self._vlm = VLMFallbackProvider(settings)

  def capabilities(self) -> list[str]:
    capabilities = ["ocr-first", *self._ocr.capabilities()]
    if self._settings.text_llm_api_key and self._settings.text_llm_base_url:
      capabilities.append("context-llm")
    if self._settings.mt_provider_order:
      capabilities.append(f"mt:{','.join(self._settings.mt_provider_order)}")
    if self._vlm.enabled():
      capabilities.append("vlm-fallback")
    return capabilities

  async def translate_image(
    self,
    image_bytes: bytes,
    image_key: str,
    target_language: str,
    style_preset: str,
    force_refresh: bool = False,
  ) -> TranslateImageResponse:
    total_start = time.perf_counter()
    image_hash = compute_sha256(image_bytes)
    cache_key = (
      f"{PIPELINE_CACHE_VERSION}::{image_hash}::{target_language}::{style_preset}"
    )
    cached = None if force_refresh else self._cache_store.get_json("image", cache_key)
    if cached:
      self._cache_store.increment("image_cache_hits")
      return TranslateImageResponse.model_validate({**cached, "cached": True})

    self._cache_store.increment("image_cache_misses")
    image = normalize_image(image_bytes)
    ocr_start = time.perf_counter()
    regions = self._ocr.analyze(image)
    ocr_ms = int((time.perf_counter() - ocr_start) * 1000)

    if not regions:
      fallback = await self._fallback_full_image(
        image_bytes, image, target_language, style_preset
      )
      payload = fallback.model_dump()
      self._cache_store.set_json("image", cache_key, payload)
      return fallback

    translate_start = time.perf_counter()
    response = await self._translate_regions(
      image=image,
      regions=regions,
      target_language=target_language,
      style_preset=style_preset,
      force_refresh=force_refresh,
    )
    response.diagnostics = DiagnosticsModel(
      detectedRegions=len(regions),
      fallbackRegions=sum(1 for area in response.textAreas if area.source.endswith("vlm")),
      ocrMs=ocr_ms,
      translateMs=int((time.perf_counter() - translate_start) * 1000),
      totalMs=int((time.perf_counter() - total_start) * 1000),
    )
    payload = response.model_dump()
    self._cache_store.set_json("image", cache_key, payload)
    return response

  async def _translate_regions(
    self,
    image: Image.Image,
    regions: list[OCRRegion],
    target_language: str,
    style_preset: str,
    force_refresh: bool = False,
  ) -> TranslateImageResponse:
    normal_regions = [r for r in regions if r.text and r.confidence >= self._settings.ocr_low_confidence_threshold]
    fallback_regions = [r for r in regions if r not in normal_regions]

    if regions and len(fallback_regions) / len(regions) > self._settings.max_fallback_region_ratio:
      return await self._fallback_full_image(
        image_to_bytes(image), image, target_language, style_preset
      )

    unique_texts: "OrderedDict[str, str]" = OrderedDict()
    for region in normal_regions:
      key = normalize_text_key(region.text)
      if key and key not in unique_texts:
        unique_texts[key] = region.text

    translated_lookup: dict[str, str] = {}
    if unique_texts:
      cache_misses: list[str] = []
      cache_miss_keys: list[str] = []
      for normalized, raw_text in unique_texts.items():
        cached = None if force_refresh else self._cache_store.get_json(
          "translation",
          f"{PIPELINE_CACHE_VERSION}::{normalized}::{target_language}::{style_preset}",
        )
        if cached:
          self._cache_store.increment("translation_cache_hits")
          translated_lookup[normalized] = str(cached.get("translatedText", ""))
        else:
          self._cache_store.increment("translation_cache_misses")
          cache_misses.append(raw_text)
          cache_miss_keys.append(normalized)

      if cache_misses:
        use_context_translation = len(normal_regions) > 1
        if use_context_translation:
          ordered_texts = [region.text for region in normal_regions]
          translated_batch, provider_name = await self._translator.translate_with_context(
            ordered_texts, target_language, style_preset
          )
          for index, region in enumerate(normal_regions):
            normalized = normalize_text_key(region.text)
            if not normalized:
              continue
            translated_text = (
              translated_batch[index] if index < len(translated_batch) else ""
            )
            translated_lookup[normalized] = translated_text
            self._cache_store.set_json(
              "translation",
              f"{PIPELINE_CACHE_VERSION}::{normalized}::{target_language}::{style_preset}",
              {
                "translatedText": translated_text,
                "provider": provider_name,
              },
            )
        else:
          translated_batch, provider_name = await self._translator.translate_batch(
            cache_misses, target_language, style_preset
          )
          for index, normalized in enumerate(cache_miss_keys):
            translated_text = (
              translated_batch[index] if index < len(translated_batch) else ""
            )
            translated_lookup[normalized] = translated_text
            self._cache_store.set_json(
              "translation",
              f"{PIPELINE_CACHE_VERSION}::{normalized}::{target_language}::{style_preset}",
              {
                "translatedText": translated_text,
                "provider": provider_name,
              },
            )

    region_results: list[RegionResult] = []

    for region in normal_regions:
      normalized = normalize_text_key(region.text)
      translated_text = normalize_translated_output(
        translated_lookup.get(normalized, "")
      )
      region_results.append(
        RegionResult(
          box=region.box,
          original_text=region.text,
          translated_text=translated_text,
          confidence=region.confidence,
          source=region.source,
        )
      )

    for region in fallback_regions:
      translated_text = ""
      original_text = region.text
      source = region.source
      if self._vlm.enabled():
        try:
          crop = crop_box(image, region.box)
          if crop.width >= 8 and crop.height >= 8:
            original_text, translated_text = await self._vlm.translate_region(
              image_to_bytes(crop), target_language, style_preset
            )
            translated_text = normalize_translated_output(translated_text)
            self._cache_store.increment("region_fallback_count")
            source = "region-vlm"
        except VLMFallbackError as error:
          print(f"[pipeline] region fallback skipped: {error}")

      region_results.append(
        RegionResult(
          box=region.box,
          original_text=original_text or region.text,
          translated_text=translated_text or region.text,
          confidence=region.confidence,
          source=source,
        )
      )

    text_areas = [
      to_text_area(image.size, region_result) for region_result in region_results
    ]

    pipeline = (
      "region-fallback"
      if any(area.source == "region-vlm" for area in text_areas)
      else "ocr-first"
    )

    return TranslateImageResponse(
      success=True,
      textAreas=text_areas,
      pipeline=pipeline,
      cached=False,
    )

  async def _fallback_full_image(
    self,
    image_bytes: bytes,
    image: Image.Image,
    target_language: str,
    style_preset: str,
  ) -> TranslateImageResponse:
    self._cache_store.increment("full_image_fallback_count")
    if not self._vlm.enabled():
      return TranslateImageResponse(
        success=False,
        textAreas=[],
        pipeline="full-image-fallback",
        error="OCR 未识别到文本，且 VLM fallback 未配置",
      )

    try:
      original_text, translated_text = await self._vlm.translate_region(
        image_bytes, target_language, style_preset
      )
      translated_text = normalize_translated_output(translated_text)
    except VLMFallbackError as error:
      return TranslateImageResponse(
        success=False,
        textAreas=[],
        pipeline="full-image-fallback",
        error=str(error),
      )
    return TranslateImageResponse(
      success=True,
      textAreas=[
        TextAreaModel(
          x=0,
          y=0,
          width=1,
          height=1,
          originalText=original_text,
          translatedText=translated_text,
          confidence=1,
          source="full-image-vlm",
        )
      ],
      pipeline="full-image-fallback",
      cached=False,
    )


def to_text_area(
  image_size: tuple[int, int], region_result: RegionResult
) -> TextAreaModel:
  width, height = image_size
  left, top, right, bottom = region_result.box
  return TextAreaModel(
    x=left / width,
    y=top / height,
    width=max(1, right - left) / width,
    height=max(1, bottom - top) / height,
    originalText=region_result.original_text,
    translatedText=region_result.translated_text,
    confidence=region_result.confidence,
    source=region_result.source,
  )


def normalize_translated_output(text: str) -> str:
  lines = [line.strip() for line in text.splitlines() if line.strip()]
  if not lines:
    return text.strip()
  if len(lines) == 1:
    return lines[0]

  contains_cjk = any(
    "\u3000" <= char <= "\u9fff" or "\uf900" <= char <= "\ufaff"
    for char in "".join(lines)
  )
  separator = "" if contains_cjk else " "
  merged = separator.join(lines)
  merged = merged.replace(" ，", "，").replace(" 。", "。")
  merged = merged.replace(" ！", "！").replace(" ？", "？")
  return merged.strip()
