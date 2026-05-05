from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
import sys

SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
  sys.path.insert(0, str(SERVER_DIR))

from app.cache_store import CacheStore


class CacheStoreTests(unittest.TestCase):
  def test_set_json_handles_unsafe_cache_keys(self) -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
      base_dir = Path(temp_dir)
      store = CacheStore(base_dir / "cache.db", base_dir / "cache")

      cache_key = (
        "translation-v2-context-ocr::Close as Neighbors STORY / ART ::"
        "zh-CN::natural-zh"
      )
      payload = {"translatedText": "测试文本", "provider": "test"}

      store.set_json("translation", cache_key, payload)
      cached = store.get_json("translation", cache_key)

      self.assertEqual(cached, payload)

      written_files = list((base_dir / "cache").glob("*.json"))
      self.assertEqual(len(written_files), 1)
      self.assertTrue(written_files[0].is_file())
      self.assertNotIn("/", written_files[0].name)


if __name__ == "__main__":
  unittest.main()
