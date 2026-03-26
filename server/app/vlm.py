from __future__ import annotations

import base64
import json
from typing import Any

import httpx

from .config import Settings


class VLMFallbackError(RuntimeError):
  pass


class VLMFallbackProvider:
  def __init__(self, settings: Settings) -> None:
    self._settings = settings

  def enabled(self) -> bool:
    return bool(self._settings.vlm_api_key and self._settings.vlm_base_url)

  async def translate_region(
    self, image_bytes: bytes, target_language: str, style_preset: str
  ) -> tuple[str, str]:
    if not self.enabled():
      raise RuntimeError("VLM fallback 未配置")

    payload = {
      "model": self._settings.vlm_model,
      "messages": [
        {
          "role": "user",
          "content": [
            {
              "type": "text",
              "text": (
                f"Read the text in this manga crop and translate it to {target_language}. "
                "Return JSON only: "
                '{"originalText":"...","translatedText":"..."}'
              ),
            },
            {
              "type": "image_url",
              "image_url": {
                "url": f"data:image/jpeg;base64,{base64.b64encode(image_bytes).decode('utf-8')}"
              },
            },
          ],
        }
      ],
      "temperature": 0.1,
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
      response = await client.post(
        f"{self._settings.vlm_base_url.rstrip('/')}/chat/completions",
        headers={
          "Authorization": f"Bearer {self._settings.vlm_api_key}",
          "Content-Type": "application/json",
        },
        json=payload,
      )
      if not response.is_success:
        detail = safe_error_detail(response)
        raise VLMFallbackError(
          f"VLM fallback failed ({response.status_code}): {detail}"
        )
      data = response.json()

    content = extract_message_content(data)
    parsed = parse_json_block(content)
    return parsed.get("originalText", ""), parsed.get("translatedText", "")


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


def parse_json_block(content: str) -> dict[str, str]:
  cleaned = content.strip()
  if cleaned.startswith("```"):
    cleaned = cleaned.split("```", 2)[1].replace("json", "", 1).strip()
  start = cleaned.find("{")
  end = cleaned.rfind("}")
  if start >= 0 and end > start:
    cleaned = cleaned[start : end + 1]
  try:
    return json.loads(cleaned)
  except json.JSONDecodeError:
    return {"originalText": "", "translatedText": cleaned}


def safe_error_detail(response: httpx.Response) -> str:
  try:
    data = response.json()
    if isinstance(data, dict):
      error = data.get("error")
      if isinstance(error, dict):
        return str(error.get("message") or error)
      return str(data)
  except Exception:  # noqa: BLE001
    pass

  try:
    return response.text
  except Exception:  # noqa: BLE001
    return "unknown error"
