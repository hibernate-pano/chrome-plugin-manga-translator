from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any


class CacheStore:
  def __init__(self, db_path: Path, cache_dir: Path) -> None:
    self._db_path = db_path
    self._cache_dir = cache_dir
    self._lock = threading.Lock()
    self._cache_dir.mkdir(parents=True, exist_ok=True)
    self._init_db()

  def _init_db(self) -> None:
    with sqlite3.connect(self._db_path) as connection:
      connection.execute(
        """
        CREATE TABLE IF NOT EXISTS cache_entries (
          cache_key TEXT PRIMARY KEY,
          cache_type TEXT NOT NULL,
          payload_path TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """
      )
      connection.execute(
        """
        CREATE TABLE IF NOT EXISTS metrics (
          name TEXT PRIMARY KEY,
          value INTEGER NOT NULL DEFAULT 0
        )
        """
      )

  def get_json(self, cache_type: str, cache_key: str) -> dict[str, Any] | None:
    with sqlite3.connect(self._db_path) as connection:
      row = connection.execute(
        """
        SELECT payload_path
        FROM cache_entries
        WHERE cache_type = ? AND cache_key = ?
        """,
        (cache_type, cache_key),
      ).fetchone()

    if not row:
      return None

    payload_path = Path(row[0])
    if not payload_path.exists():
      return None

    return json.loads(payload_path.read_text(encoding="utf-8"))

  def set_json(self, cache_type: str, cache_key: str, payload: dict[str, Any]) -> None:
    with self._lock:
      target = self._cache_dir / f"{cache_type}-{cache_key}.json"
      target.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
      )
      with sqlite3.connect(self._db_path) as connection:
        connection.execute(
          """
          INSERT INTO cache_entries (cache_key, cache_type, payload_path)
          VALUES (?, ?, ?)
          ON CONFLICT(cache_key) DO UPDATE SET
            cache_type = excluded.cache_type,
            payload_path = excluded.payload_path,
            created_at = CURRENT_TIMESTAMP
          """,
          (cache_key, cache_type, str(target)),
        )

  def increment(self, metric_name: str, amount: int = 1) -> None:
    with sqlite3.connect(self._db_path) as connection:
      connection.execute(
        """
        INSERT INTO metrics (name, value)
        VALUES (?, ?)
        ON CONFLICT(name) DO UPDATE SET value = value + excluded.value
        """,
        (metric_name, amount),
      )

  def get_metrics(self) -> dict[str, int]:
    with sqlite3.connect(self._db_path) as connection:
      rows = connection.execute("SELECT name, value FROM metrics").fetchall()
    return {name: int(value) for name, value in rows}
