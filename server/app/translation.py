from __future__ import annotations

import hashlib
import json
import random
from abc import ABC, abstractmethod
from typing import Any

import httpx

from .config import Settings


class TranslationProvider(ABC):
  name: str

  @abstractmethod
  async def translate_batch(
    self, texts: list[str], target_language: str, style_preset: str
  ) -> list[str]:
    raise NotImplementedError


class ContextTranslationProvider(ABC):
  name: str

  @abstractmethod
  async def translate_blocks(
    self, texts: list[str], target_language: str, style_preset: str
  ) -> list[str]:
    raise NotImplementedError


class DeepLProvider(TranslationProvider):
  name = "deepl"

  def __init__(self, settings: Settings) -> None:
    self._settings = settings

  async def translate_batch(
    self, texts: list[str], target_language: str, style_preset: str
  ) -> list[str]:
    if not self._settings.deepl_api_key:
      raise RuntimeError("DEEPL_API_KEY 未配置")

    data: list[tuple[str, str]] = [("target_lang", normalize_target_lang(target_language))]
    for text in texts:
      data.append(("text", text))

    async with httpx.AsyncClient(timeout=30.0) as client:
      response = await client.post(
        self._settings.deepl_base_url,
        headers={"Authorization": f"DeepL-Auth-Key {self._settings.deepl_api_key}"},
        data=data,
      )
      response.raise_for_status()
      payload = response.json()
      translations = payload.get("translations", [])
      return [item.get("text", "") for item in translations]


class GoogleProvider(TranslationProvider):
  name = "google"

  def __init__(self, settings: Settings) -> None:
    self._settings = settings

  async def translate_batch(
    self, texts: list[str], target_language: str, style_preset: str
  ) -> list[str]:
    if not self._settings.google_translate_api_key:
      raise RuntimeError("GOOGLE_TRANSLATE_API_KEY 未配置")

    async with httpx.AsyncClient(timeout=30.0) as client:
      response = await client.post(
        self._settings.google_translate_base_url,
        params={"key": self._settings.google_translate_api_key},
        data={"target": target_language, "format": "text", "q": texts},
      )
      response.raise_for_status()
      payload = response.json()
      translations = payload.get("data", {}).get("translations", [])
      return [item.get("translatedText", "") for item in translations]


class BaiduProvider(TranslationProvider):
  name = "baidu"

  def __init__(self, settings: Settings) -> None:
    self._settings = settings

  async def translate_batch(
    self, texts: list[str], target_language: str, style_preset: str
  ) -> list[str]:
    if not self._settings.baidu_app_id or not self._settings.baidu_secret_key:
      raise RuntimeError("百度翻译未配置")

    translated: list[str] = []
    async with httpx.AsyncClient(timeout=30.0) as client:
      for text in texts:
        salt = str(random.randint(10000, 99999))
        sign = hashlib.md5(
          f"{self._settings.baidu_app_id}{text}{salt}{self._settings.baidu_secret_key}".encode(
            "utf-8"
          )
        ).hexdigest()
        response = await client.post(
          self._settings.baidu_base_url,
          data={
            "q": text,
            "from": "auto",
            "to": normalize_baidu_target_lang(target_language),
            "appid": self._settings.baidu_app_id,
            "salt": salt,
            "sign": sign,
          },
        )
        response.raise_for_status()
        payload = response.json()
        rows = payload.get("trans_result", [])
        translated.append(rows[0]["dst"] if rows else "")
    return translated


class ContextLLMProvider(ContextTranslationProvider):
  name = "context-llm"

  def __init__(self, settings: Settings) -> None:
    self._settings = settings

  def enabled(self) -> bool:
    return bool(self._settings.text_llm_api_key and self._settings.text_llm_base_url)

  async def translate_blocks(
    self, texts: list[str], target_language: str, style_preset: str
  ) -> list[str]:
    if not self.enabled():
      raise RuntimeError("TEXT_LLM 未配置")

    items = [{"id": index + 1, "sourceText": text} for index, text in enumerate(texts)]
    prompt = (
      "You are translating manga dialogue blocks into natural Chinese. "
      f"Target language: {target_language}. Style preset: {style_preset}. "
      "Use neighboring blocks as context so the translated lines read naturally together. "
      "Do not explain. Do not omit items. Preserve each id exactly. "
      "Return JSON only in the format: "
      '{"items":[{"id":1,"translatedText":"..."}]}.'
    )

    payload = {
      "model": self._settings.text_llm_model,
      "messages": [
        {"role": "system", "content": prompt},
        {
          "role": "user",
          "content": json.dumps({"items": items}, ensure_ascii=False),
        },
      ],
      "temperature": 0.2,
      "response_format": {"type": "json_object"},
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
      response = await client.post(
        f"{self._settings.text_llm_base_url.rstrip('/')}/chat/completions",
        headers={
          "Authorization": f"Bearer {self._settings.text_llm_api_key}",
          "Content-Type": "application/json",
        },
        json=payload,
      )
      response.raise_for_status()
      data = response.json()

    content = extract_message_content(data)
    parsed_items = parse_context_translation_response(content)
    translated_lookup = {item["id"]: item["translatedText"] for item in parsed_items}
    return [translated_lookup.get(index + 1, text) for index, text in enumerate(texts)]


class ProviderChain:
  def __init__(
    self,
    providers: list[TranslationProvider],
    context_provider: ContextTranslationProvider | None = None,
  ) -> None:
    self._providers = providers
    self._context_provider = context_provider

  async def translate_batch(
    self, texts: list[str], target_language: str, style_preset: str
  ) -> tuple[list[str], str]:
    last_error: Exception | None = None
    for provider in self._providers:
      try:
        translated = await provider.translate_batch(
          texts, target_language, style_preset
        )
        return translated, provider.name
      except Exception as error:  # noqa: BLE001
        last_error = error

    raise RuntimeError(f"没有可用的文本翻译 provider: {last_error}")

  async def translate_with_context(
    self, texts: list[str], target_language: str, style_preset: str
  ) -> tuple[list[str], str]:
    if self._context_provider and len(texts) > 1:
      try:
        translated = await self._context_provider.translate_blocks(
          texts, target_language, style_preset
        )
        return translated, self._context_provider.name
      except Exception:  # noqa: BLE001
        pass

    return await self.translate_batch(texts, target_language, style_preset)


def build_translation_chain(settings: Settings) -> ProviderChain:
  registry = {
    "deepl": DeepLProvider(settings),
    "google": GoogleProvider(settings),
    "baidu": BaiduProvider(settings),
  }
  providers = [registry[name] for name in settings.mt_provider_order if name in registry]
  context_provider = ContextLLMProvider(settings)
  return ProviderChain(
    providers,
    context_provider=context_provider if context_provider.enabled() else None,
  )


def normalize_target_lang(target_language: str) -> str:
  return target_language.replace("-", "_").upper()


def normalize_baidu_target_lang(target_language: str) -> str:
  mapping = {
    "zh-CN": "zh",
    "zh-TW": "cht",
    "en": "en",
    "ja": "jp",
    "ko": "kor",
  }
  return mapping.get(target_language, "zh")


def extract_message_content(payload: dict[str, Any]) -> str:
  choices = payload.get("choices", [])
  if not choices:
    return ""
  message = choices[0].get("message", {})
  content = message.get("content", "")
  if isinstance(content, list):
    return "".join(
      item.get("text", "") for item in content if isinstance(item, dict)
    )
  return str(content)


def parse_context_translation_response(content: str) -> list[dict[str, str | int]]:
  cleaned = content.strip()
  if cleaned.startswith("```"):
    cleaned = cleaned.split("```", 2)[1].replace("json", "", 1).strip()

  start = cleaned.find("{")
  end = cleaned.rfind("}")
  if start >= 0 and end > start:
    cleaned = cleaned[start : end + 1]

  try:
    payload = json.loads(cleaned)
  except json.JSONDecodeError:
    return []

  items = payload.get("items", []) if isinstance(payload, dict) else []
  parsed_items: list[dict[str, str | int]] = []
  for item in items:
    if not isinstance(item, dict):
      continue
    item_id = item.get("id")
    translated_text = str(item.get("translatedText", "")).strip()
    if isinstance(item_id, int):
      parsed_items.append({"id": item_id, "translatedText": translated_text})
  return parsed_items
