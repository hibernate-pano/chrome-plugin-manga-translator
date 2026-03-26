from __future__ import annotations

from dataclasses import dataclass
from statistics import median

import numpy as np
from PIL import Image

try:
  from paddleocr import PaddleOCR
except Exception:  # noqa: BLE001
  PaddleOCR = None

try:
  from manga_ocr import MangaOcr
except Exception:  # noqa: BLE001
  MangaOcr = None

from .image_utils import clamp_box


@dataclass
class OCRRegion:
  box: tuple[int, int, int, int]
  text: str
  confidence: float
  source: str


class OCRPipeline:
  def __init__(
    self, low_confidence_threshold: float, languages: list[str] | None = None
  ) -> None:
    self._low_confidence_threshold = low_confidence_threshold
    self._languages = languages or ["japan", "korean", "en"]
    self._paddles: dict[str, PaddleOCR] = {}
    self._manga = None

  def capabilities(self) -> list[str]:
    capabilities: list[str] = []
    if PaddleOCR:
      capabilities.extend(f"paddleocr:{language}" for language in self._languages)
    if MangaOcr:
      capabilities.append("mangaocr")
    return capabilities

  def analyze(self, image: Image.Image) -> list[OCRRegion]:
    if not PaddleOCR:
      raise RuntimeError("PaddleOCR 未安装，无法执行 OCR")

    candidates = [
      self._run_paddle_pass(image, language)
      for language in self._languages
    ]
    scored_candidates = [(score_regions(regions), regions) for regions in candidates]
    best_regions = max(scored_candidates, key=lambda item: item[0])[1] if scored_candidates else []
    return merge_regions(best_regions)

  def _run_paddle_pass(self, image: Image.Image, language: str) -> list[OCRRegion]:
    paddle = self._get_paddle(language)
    if not paddle:
      return []

    result = paddle.ocr(np.asarray(image), cls=False)
    lines = result[0] if result and result[0] else []
    regions: list[OCRRegion] = []
    width, height = image.size

    for line in lines:
      if not line or len(line) < 2:
        continue
      points = line[0]
      text_info = line[1]
      if not points or not text_info:
        continue
      xs = [int(point[0]) for point in points]
      ys = [int(point[1]) for point in points]
      box = clamp_box((min(xs), min(ys), max(xs), max(ys)), width, height)
      text = str(text_info[0]).strip()
      confidence = float(text_info[1]) if len(text_info) > 1 else 0.0
      source = "ocr-mt"

      manga = self._get_manga()
      if manga and (confidence < self._low_confidence_threshold or looks_like_japanese(text)):
        crop = image.crop(box)
        manga_text = manga(crop).strip()
        if manga_text:
          text = manga_text
          source = "ocr-mangaocr"

      if text:
        regions.append(
          OCRRegion(box=box, text=text, confidence=confidence, source=source)
        )

    return regions

  def _get_paddle(self, language: str):
    if language not in self._paddles and PaddleOCR:
      self._paddles[language] = PaddleOCR(
        use_angle_cls=False,
        lang=language,
        show_log=False,
      )
    return self._paddles.get(language)

  def _get_manga(self):
    if self._manga is None and MangaOcr:
      self._manga = MangaOcr()
    return self._manga


def looks_like_japanese(text: str) -> bool:
  return any(
    "\u3040" <= char <= "\u30ff" or "\u4e00" <= char <= "\u9fff"
    for char in text
  )


def score_regions(regions: list[OCRRegion]) -> float:
  if not regions:
    return 0.0

  total = 0.0
  for region in regions:
    text = region.text.strip()
    if not text:
      continue
    confidence = max(region.confidence, 0.15)
    total += len(text) * confidence
    if looks_like_japanese(text):
      total += 0.6
    if any("\uac00" <= char <= "\ud7af" for char in text):
      total += 0.6

  return total


def merge_regions(regions: list[OCRRegion]) -> list[OCRRegion]:
  if len(regions) <= 1:
    return regions

  median_width = median(max(1, region.box[2] - region.box[0]) for region in regions)
  median_height = median(max(1, region.box[3] - region.box[1]) for region in regions)
  horizontal_gap_threshold = max(int(median_width * 0.8), 24)
  vertical_gap_threshold = max(int(median_height * 0.9), 18)

  parents = list(range(len(regions)))

  def find(index: int) -> int:
    while parents[index] != index:
      parents[index] = parents[parents[index]]
      index = parents[index]
    return index

  def union(left: int, right: int) -> None:
    left_root = find(left)
    right_root = find(right)
    if left_root != right_root:
      parents[right_root] = left_root

  for left in range(len(regions)):
    for right in range(left + 1, len(regions)):
      if should_merge(
        regions[left],
        regions[right],
        horizontal_gap_threshold,
        vertical_gap_threshold,
      ):
        union(left, right)

  grouped: dict[int, list[OCRRegion]] = {}
  for index, region in enumerate(regions):
    grouped.setdefault(find(index), []).append(region)

  merged_regions = [
    merge_group(group_regions)
    for group_regions in grouped.values()
  ]

  return sorted(
    merged_regions,
    key=lambda region: (
      region.box[1],
      region.box[0],
    ),
  )


def should_merge(
  left: OCRRegion,
  right: OCRRegion,
  horizontal_gap_threshold: int,
  vertical_gap_threshold: int,
) -> bool:
  left_box = left.box
  right_box = right.box

  horizontal_gap = axis_gap(left_box[0], left_box[2], right_box[0], right_box[2])
  vertical_gap = axis_gap(left_box[1], left_box[3], right_box[1], right_box[3])
  overlap_x = overlap_ratio(left_box[0], left_box[2], right_box[0], right_box[2])
  overlap_y = overlap_ratio(left_box[1], left_box[3], right_box[1], right_box[3])

  if intersects(left_box, right_box):
    return True

  close_same_row = overlap_y >= 0.45 and horizontal_gap <= horizontal_gap_threshold
  close_same_column = overlap_x >= 0.45 and vertical_gap <= vertical_gap_threshold
  diagonal_cluster = (
    horizontal_gap <= horizontal_gap_threshold // 2
    and vertical_gap <= vertical_gap_threshold // 2
  )

  return close_same_row or close_same_column or diagonal_cluster


def merge_group(group_regions: list[OCRRegion]) -> OCRRegion:
  ordered_regions = order_regions(group_regions)
  left = min(region.box[0] for region in ordered_regions)
  top = min(region.box[1] for region in ordered_regions)
  right = max(region.box[2] for region in ordered_regions)
  bottom = max(region.box[3] for region in ordered_regions)
  average_confidence = sum(region.confidence for region in ordered_regions) / len(
    ordered_regions
  )
  source = (
    "ocr-mangaocr"
    if any(region.source == "ocr-mangaocr" for region in ordered_regions)
    else ordered_regions[0].source
  )

  return OCRRegion(
    box=(left, top, right, bottom),
    text=merge_group_text(ordered_regions),
    confidence=average_confidence,
    source=source,
  )


def order_regions(group_regions: list[OCRRegion]) -> list[OCRRegion]:
  total_width = max(region.box[2] for region in group_regions) - min(
    region.box[0] for region in group_regions
  )
  total_height = max(region.box[3] for region in group_regions) - min(
    region.box[1] for region in group_regions
  )
  average_width = sum(region.box[2] - region.box[0] for region in group_regions) / len(
    group_regions
  )
  average_height = sum(region.box[3] - region.box[1] for region in group_regions) / len(
    group_regions
  )

  vertical_layout = average_height > average_width * 1.35 and total_height > total_width
  if vertical_layout:
    return sorted(group_regions, key=lambda region: (region.box[0], region.box[1]))

  return sorted(group_regions, key=lambda region: (region.box[1], region.box[0]))


def merge_group_text(group_regions: list[OCRRegion]) -> str:
  if len(group_regions) == 1:
    return group_regions[0].text

  parts: list[str] = []
  previous_region: OCRRegion | None = None
  for region in group_regions:
    if not previous_region:
      parts.append(region.text)
      previous_region = region
      continue

    separator = infer_separator(previous_region, region)
    if separator:
      parts.append(separator)
    parts.append(region.text)
    previous_region = region

  return "".join(parts).replace("\n\n", "\n").strip()


def infer_separator(left: OCRRegion, right: OCRRegion) -> str:
  horizontal_gap = axis_gap(left.box[0], left.box[2], right.box[0], right.box[2])
  vertical_gap = axis_gap(left.box[1], left.box[3], right.box[1], right.box[3])
  overlap_y = overlap_ratio(left.box[1], left.box[3], right.box[1], right.box[3])
  overlap_x = overlap_ratio(left.box[0], left.box[2], right.box[0], right.box[2])

  same_row = overlap_y >= 0.5 and vertical_gap <= 8
  same_column = overlap_x >= 0.5 and horizontal_gap <= 8

  if same_row or same_column:
    if ends_with_ascii_word(left.text) and starts_with_ascii_word(right.text):
      return " "
    return ""

  return "\n"


def ends_with_ascii_word(text: str) -> bool:
  return bool(text) and text[-1].isascii() and text[-1].isalnum()


def starts_with_ascii_word(text: str) -> bool:
  return bool(text) and text[0].isascii() and text[0].isalnum()


def intersects(
  left_box: tuple[int, int, int, int],
  right_box: tuple[int, int, int, int],
) -> bool:
  return not (
    left_box[2] < right_box[0]
    or right_box[2] < left_box[0]
    or left_box[3] < right_box[1]
    or right_box[3] < left_box[1]
  )


def axis_gap(left_start: int, left_end: int, right_start: int, right_end: int) -> int:
  if left_end < right_start:
    return right_start - left_end
  if right_end < left_start:
    return left_start - right_end
  return 0


def overlap_ratio(
  left_start: int, left_end: int, right_start: int, right_end: int
) -> float:
  overlap = max(0, min(left_end, right_end) - max(left_start, right_start))
  base = max(1, min(left_end - left_start, right_end - right_start))
  return overlap / base
