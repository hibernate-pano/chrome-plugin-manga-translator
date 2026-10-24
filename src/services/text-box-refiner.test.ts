import { describe, expect, it } from 'vitest';
import {
  buildInkBitmap,
  refineTextBox,
  refineTextBoxes,
  type InkBitmap,
  type NormalizedBox,
} from './text-box-refiner';

/**
 * A synthetic page the refiner can be measured against.
 *
 * The bitmap is 200x120. It contains:
 *  - a speech bubble outline (a rectangle of dark pixels),
 *  - two lines of "text" inside it, as blocks of dark pixels,
 *  - a second, unrelated block of text to the right.
 *
 * The bubble outline is the important part: a naive ink scan swallows it
 * and stretches the box across the whole bubble, so the refiner has to
 * tell a border from a glyph.
 */
function createPageBitmap(): InkBitmap {
  const width = 200;
  const height = 120;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);

  const setPixel = (x: number, y: number, value: number): void => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const i = (y * width + x) * 4;
    rgba[i] = value;
    rgba[i + 1] = value;
    rgba[i + 2] = value;
    rgba[i + 3] = 255;
  };

  // Bubble outline: a rectangle from (20,15) to (120,80).
  for (let x = 20; x <= 120; x++) {
    setPixel(x, 15, 0);
    setPixel(x, 80, 0);
  }
  for (let y = 15; y <= 80; y++) {
    setPixel(20, y, 0);
    setPixel(120, y, 0);
  }

  // First line of text: a block from (35,30) to (100,42).
  for (let y = 30; y <= 42; y++) {
    for (let x = 35; x <= 100; x++) {
      setPixel(x, y, 0);
    }
  }
  // Second line of text: a block from (30,52) to (95,64).
  for (let y = 52; y <= 64; y++) {
    for (let x = 30; x <= 95; x++) {
      setPixel(x, y, 0);
    }
  }

  // A separate block of text on the right, outside the bubble.
  for (let y = 30; y <= 42; y++) {
    for (let x = 150; x <= 190; x++) {
      setPixel(x, y, 0);
    }
  }

  return buildInkBitmap(rgba, width, height);
}

const box = (
  x: number,
  y: number,
  width: number,
  height: number
): NormalizedBox => ({
  x,
  y,
  width,
  height,
});

describe('buildInkBitmap', () => {
  it('reads luminance from the RGBA buffer', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    const bitmap = buildInkBitmap(rgba, 2, 1);

    expect(bitmap.width).toBe(2);
    expect(bitmap.height).toBe(1);
    expect(bitmap.luminance[0]).toBe(0);
    expect(bitmap.luminance[1]).toBe(255);
  });

  it('weights a saturated colour by perceived brightness', () => {
    // Pure blue is dark to the eye but bright in the blue channel. A plain
    // channel average would call it bright and miss the glyph.
    const rgba = new Uint8ClampedArray([0, 0, 255, 255]);
    const bitmap = buildInkBitmap(rgba, 1, 1);

    expect(bitmap.luminance[0]).toBeLessThan(60);
  });
});

describe('refineTextBox', () => {
  const bitmap = createPageBitmap();

  it('snaps a short box onto both lines of text', () => {
    // The model returned a box that covered only the first line — the
    // failure that leaves the second line of original visible.
    const modelBox = box(35 / 200, 30 / 120, 65 / 200, 12 / 120);

    const refined = refineTextBox(bitmap, modelBox);

    // The second line ends at y=64, so the box has to reach it.
    expect(refined.y * 120).toBeLessThanOrEqual(52);
    expect((refined.y + refined.height) * 120).toBeGreaterThanOrEqual(64);
  });

  it('does not snap a box onto a different bubble', () => {
    // The model put the box just to the left of the separate block of text
    // on the right, clipping its left edge. Snapping onto that block would
    // put the translation over a bubble the model never mentioned — and the
    // opaque panel would hide that bubble's original text without replacing
    // it. This is the case the overlap guard exists for; it used to be
    // unreachable, because it compared the union (which always contains the
    // model's box) with the model's box.
    const modelBox = box(142 / 200, 30 / 120, 10 / 200, 12 / 120);

    const refined = refineTextBox(bitmap, modelBox);

    // 框必须留在模型给的位置上。
    expect(refined.x).toBeCloseTo(modelBox.x, 5);
    expect(refined.width).toBeCloseTo(modelBox.width, 5);
  });

  it('does not treat the speech bubble outline as text', () => {
    // The bubble spans x 20..120 and y 15..80. The text inside it spans
    // x 30..100 and y 30..64. A refiner that counted the outline as a
    // glyph would reach the bubble's edges and report its extent.
    //
    // The model box is the text's own box, so the refined box must stay
    // inside the text — reaching for the outline is the failure.
    const modelBox = box(30 / 200, 30 / 120, 70 / 200, 34 / 120);

    const refined = refineTextBox(bitmap, modelBox);

    expect(refined.x * 200).toBeGreaterThan(20);
    expect((refined.x + refined.width) * 200).toBeLessThan(120);
    expect(refined.y * 120).toBeGreaterThan(15);
    expect((refined.y + refined.height) * 120).toBeLessThan(80);
  });

  it('never shrinks the box below what the model asked for', () => {
    // The ink is a lower bound on the text, not an exact measure of it: a
    // small stroke or a comma can fall below the detection threshold. A
    // box that shrank to the surviving blobs would be tighter than the
    // text it has to hold, and the translation would be squeezed into a
    // smaller font than it needs.
    const modelBox = box(30 / 200, 30 / 120, 70 / 200, 34 / 120);

    const refined = refineTextBox(bitmap, modelBox);

    expect(refined.x * 200).toBeLessThanOrEqual(modelBox.x * 200);
    expect(refined.y * 120).toBeLessThanOrEqual(modelBox.y * 120);
    expect((refined.x + refined.width) * 200).toBeGreaterThanOrEqual(
      (modelBox.x + modelBox.width) * 200
    );
    expect((refined.y + refined.height) * 120).toBeGreaterThanOrEqual(
      (modelBox.y + modelBox.height) * 120
    );
  });

  it('does not reach for unrelated text outside the bubble', () => {
    // The block on the right sits at x 150..190. A refiner that searched
    // the whole image would pull the box across to it.
    const modelBox = box(35 / 200, 30 / 120, 65 / 200, 12 / 120);

    const refined = refineTextBox(bitmap, modelBox);

    expect((refined.x + refined.width) * 200).toBeLessThan(150);
  });

  it('keeps the model box when there is no ink to find', () => {
    const empty = buildInkBitmap(
      new Uint8ClampedArray(100 * 100 * 4).fill(255),
      100,
      100
    );
    const modelBox = box(0.1, 0.1, 0.2, 0.2);

    expect(refineTextBox(empty, modelBox)).toEqual(modelBox);
  });

  it('keeps the model box when the ink belongs to a different bubble', () => {
    // A model box far from any ink: the refiner must not drag the
    // translation across the page to reach it.
    const modelBox = box(0.05, 0.85, 0.1, 0.1);

    const refined = refineTextBox(bitmap, modelBox);

    expect(refined).toEqual(modelBox);
  });

  it('keeps the model box when the refinement would drift too far', () => {
    // A box that only grazes the text. The refined box would barely
    // overlap it, which means the ink found was something else.
    const modelBox = box(0.5, 0.5, 0.05, 0.05);

    const refined = refineTextBox(bitmap, modelBox);

    expect(refined).toEqual(modelBox);
  });

  it('recovers a box the model put on blank paper', () => {
    // The model read the words and then put the box in the wrong place —
    // measured against a page with known ground truth, its box was off by
    // up to 80px horizontally. A box on blank paper is a box about the
    // words the model read, so the nearest text is the better answer.
    //
    // The box here sits to the right of the bubble, on empty paper, the
    // size of the text it should have pointed at.
    const modelBox = box(102 / 200, 30 / 120, 40 / 200, 34 / 120);

    const refined = refineTextBox(bitmap, modelBox);

    // The text inside the bubble spans x 30..100 and y 30..64.
    expect(refined.x * 200).toBeLessThanOrEqual(30);
    expect((refined.x + refined.width) * 200).toBeGreaterThanOrEqual(100);
    expect(refined.y * 120).toBeLessThanOrEqual(30);
    expect((refined.y + refined.height) * 120).toBeGreaterThanOrEqual(64);
  });

  it('does not drag a small box onto a big block of text', () => {
    // The same situation, but the model asked for something small. A sound
    // effect that landed in the wrong place is not a caption: putting the
    // translation over the caption would cover the wrong words with the
    // wrong words.
    const modelBox = box(102 / 200, 40 / 120, 10 / 200, 10 / 120);

    const refined = refineTextBox(bitmap, modelBox);

    expect(refined).toEqual(modelBox);
  });

  it('does not recover onto a single blob', () => {
    // The block on the right is one solid rectangle, not a run of glyphs.
    // Where artwork touches lettering, the lettering can be swallowed by
    // the artwork and stop being visible at all — the model still reads it,
    // but the refiner cannot. Recovering from "no ink under the box" then
    // means picking up the nearest drawing, and putting the translation
    // over a face.
    const modelBox = box(125 / 200, 30 / 120, 20 / 200, 12 / 120);

    const refined = refineTextBox(bitmap, modelBox);

    expect(refined).toEqual(modelBox);
  });

  it('does not let a small box swallow a whole block of text', () => {
    // 模型给了一个很小的框，落在那块文字**里面** —— 比如一个画在字上的
    // 拟声词。墨迹把模型框整个包住了，于是"包含度"恒等于 1，上面那道闸门
    // 根本不响，精修就把整段文字当成了这个小框该有的样子。
    //
    // 后果：这一小张的译文会盖住整段原文，而那段原文自己的译文还留在别处
    // ——读者既读不到那段话，也拿不到它的翻译。
    const modelBox = box(60 / 200, 33 / 120, 10 / 200, 7 / 120);

    const refined = refineTextBox(bitmap, modelBox);

    expect(refined).toEqual(modelBox);
  });

  it('returns a normalised box inside the image', () => {
    const modelBox = box(0.1, 0.1, 0.3, 0.2);

    const refined = refineTextBox(bitmap, modelBox);

    expect(refined.x).toBeGreaterThanOrEqual(0);
    expect(refined.y).toBeGreaterThanOrEqual(0);
    expect(refined.x + refined.width).toBeLessThanOrEqual(1);
    expect(refined.y + refined.height).toBeLessThanOrEqual(1);
  });
});

describe('refineTextBoxes', () => {
  it('refines every box and keeps the order', () => {
    const bitmap = createPageBitmap();
    const boxes = [
      box(35 / 200, 30 / 120, 65 / 200, 12 / 120),
      box(150 / 200, 30 / 120, 40 / 200, 12 / 120),
    ];

    const refined = refineTextBoxes(bitmap, boxes);

    expect(refined).toHaveLength(2);
    expect(refined[0]?.y).toBeLessThanOrEqual(52 / 120);
    expect(refined[1]?.x).toBeGreaterThanOrEqual(150 / 200);
  });

  it('returns an empty list for no boxes', () => {
    expect(refineTextBoxes(createPageBitmap(), [])).toEqual([]);
  });
});
