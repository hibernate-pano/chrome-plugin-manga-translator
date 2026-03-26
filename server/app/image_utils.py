from __future__ import annotations

import hashlib
import io
from typing import Iterable

from PIL import Image, ImageOps


def compute_sha256(data: bytes) -> str:
  return hashlib.sha256(data).hexdigest()


def normalize_image(image_bytes: bytes) -> Image.Image:
  image = Image.open(io.BytesIO(image_bytes))
  image = ImageOps.exif_transpose(image)
  return image.convert("RGB")


def image_to_bytes(image: Image.Image, format_name: str = "JPEG") -> bytes:
  buffer = io.BytesIO()
  image.save(buffer, format=format_name, quality=92)
  return buffer.getvalue()


def crop_box(image: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
  left, top, right, bottom = box
  return image.crop((left, top, right, bottom))


def normalize_text_key(text: str) -> str:
  lines = [" ".join(line.split()) for line in text.strip().splitlines()]
  return "\n".join(line for line in lines if line).strip()


def clamp_box(
  box: tuple[int, int, int, int], width: int, height: int
) -> tuple[int, int, int, int]:
  left, top, right, bottom = box
  return (
    max(0, min(left, width)),
    max(0, min(top, height)),
    max(0, min(right, width)),
    max(0, min(bottom, height)),
  )


def average(values: Iterable[float]) -> float:
  values = list(values)
  if not values:
    return 0.0
  return sum(values) / len(values)
