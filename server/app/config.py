from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def _split_csv(value: str) -> list[str]:
  return [item.strip() for item in value.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
  server_host: str
  server_port: int
  server_auth_token: str
  cache_dir: Path
  db_path: Path
  mt_provider_order: list[str]
  deepl_api_key: str
  deepl_base_url: str
  google_translate_api_key: str
  google_translate_base_url: str
  baidu_app_id: str
  baidu_secret_key: str
  baidu_base_url: str
  vlm_provider: str
  vlm_base_url: str
  vlm_api_key: str
  vlm_model: str
  text_llm_base_url: str
  text_llm_api_key: str
  text_llm_model: str
  ocr_languages: list[str]
  ocr_low_confidence_threshold: float
  max_fallback_region_ratio: float


def load_settings() -> Settings:
  cache_dir = Path(os.getenv("CACHE_DIR", "./data/cache")).resolve()
  db_path = Path(os.getenv("DB_PATH", str(cache_dir / "translator.sqlite3"))).resolve()

  cache_dir.mkdir(parents=True, exist_ok=True)
  db_path.parent.mkdir(parents=True, exist_ok=True)

  return Settings(
    server_host=os.getenv("SERVER_HOST", "127.0.0.1"),
    server_port=int(os.getenv("SERVER_PORT", "8000")),
    server_auth_token=os.getenv("SERVER_AUTH_TOKEN", "").strip(),
    cache_dir=cache_dir,
    db_path=db_path,
    mt_provider_order=_split_csv(
      os.getenv("MT_PROVIDER_ORDER", "deepl,google,baidu")
    ),
    deepl_api_key=os.getenv("DEEPL_API_KEY", "").strip(),
    deepl_base_url=os.getenv(
      "DEEPL_BASE_URL", "https://api-free.deepl.com/v2/translate"
    ).strip(),
    google_translate_api_key=os.getenv("GOOGLE_TRANSLATE_API_KEY", "").strip(),
    google_translate_base_url=os.getenv(
      "GOOGLE_TRANSLATE_BASE_URL",
      "https://translation.googleapis.com/language/translate/v2",
    ).strip(),
    baidu_app_id=os.getenv("BAIDU_APP_ID", "").strip(),
    baidu_secret_key=os.getenv("BAIDU_SECRET_KEY", "").strip(),
    baidu_base_url=os.getenv(
      "BAIDU_BASE_URL",
      "https://fanyi-api.baidu.com/api/trans/vip/translate",
    ).strip(),
    vlm_provider=os.getenv("VLM_PROVIDER", "openai-compatible").strip(),
    vlm_base_url=os.getenv("VLM_BASE_URL", "https://api.openai.com/v1").strip(),
    vlm_api_key=os.getenv("VLM_API_KEY", "").strip(),
    vlm_model=os.getenv("VLM_MODEL", "gpt-4o-mini").strip(),
    text_llm_base_url=os.getenv(
      "TEXT_LLM_BASE_URL", os.getenv("VLM_BASE_URL", "https://api.openai.com/v1")
    ).strip(),
    text_llm_api_key=os.getenv(
      "TEXT_LLM_API_KEY", os.getenv("VLM_API_KEY", "")
    ).strip(),
    text_llm_model=os.getenv(
      "TEXT_LLM_MODEL", os.getenv("VLM_MODEL", "gpt-4o-mini")
    ).strip(),
    ocr_languages=_split_csv(os.getenv("OCR_LANGUAGES", "japan,korean,en")),
    ocr_low_confidence_threshold=float(
      os.getenv("OCR_LOW_CONFIDENCE_THRESHOLD", "0.72")
    ),
    max_fallback_region_ratio=float(
      os.getenv("MAX_FALLBACK_REGION_RATIO", "0.35")
    ),
  )
