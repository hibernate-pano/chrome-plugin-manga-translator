/**
 * Pixel-accurate refinement of the boxes a vision model returns.
 *
 * A vision model is good at saying "there is text around here" and bad at
 * saying exactly where its edges are. Measured against a manga panel with
 * known ground truth, the model's box was off by up to 25px vertically and
 * 80px horizontally, and it frequently returned a box that covered only the
 * first line of a two-line bubble. The translation is drawn *on top of* the
 * source text, so an inexact box leaves the source Japanese visible next to
 * the translation — the one thing a manga translator must never do.
 *
 * Asking the model more carefully does not fix it. Thirty-plus measured
 * calls with six different prompt wordings produced the same spread, and a
 * fixed padding is blind to which direction the box was wrong: at +28px the
 * worst sample still leaked 17% of the ink.
 *
 * The pixels know where the ink is, though. This module takes the model's
 * rough box, looks at the ink in that neighbourhood, and snaps the box to
 * the real extent of the glyphs. The model's box is the search window; the
 * ink decides the answer.
 */

/** A box in normalised image coordinates (0-1). */
export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The greyscale bitmap the refiner works on. */
export interface InkBitmap {
  width: number;
  height: number;
  /** One luminance value per pixel, row-major. */
  luminance: Float32Array;
}

/**
 * A pixel is "ink" when it is darker than this.
 *
 * Manga art is mostly light: white bubbles, pale skies, flat tones. Text is
 * the dark stuff. 90/255 catches the black glyphs while leaving the grey
 * panel backgrounds alone.
 */
const INK_THRESHOLD = 90;

/**
 * The smallest number of dark pixels that counts as a glyph.
 *
 * Antialiased edges and JPEG ringing scatter single dark pixels around the
 * page. A real character is a blob of dozens of pixels.
 */
const MIN_COMPONENT_PIXELS = 25;

/**
 * The smallest a glyph is in both directions.
 *
 * Measured on a real manga panel, the individual characters of a line of
 * text are 20-31px wide and 26-29px tall, while the speech bubble's
 * outline is one component 454px wide and 202px tall. A vertical border
 * has a height but no width, a horizontal rule the other way round, and
 * small punctuation marks and radicals are thin in one direction. All of
 * those are borders and stray marks, not the text the box is meant to
 * cover.
 */
const MIN_COMPONENT_SIZE = 8;

/**
 * Components bigger than this are not glyphs.
 *
 * A run of text in a manga panel is smaller than this; a panel border, a
 * speech bubble's outline (with its tail) and a long rule are not.
 */
const MAX_COMPONENT_SIZE = 120;

/**
 * The share of a component's bounding box that has to be ink.
 *
 * This is what separates a letter from a line. Measured on a real manga
 * panel, the characters of a line of text are 20-31px wide and 26-29px tall
 * with about a third of that box inked, while the speech bubble's outline
 * is one 454x202 component with 5% of it inked — it is a rectangle, and a
 * rectangle is mostly empty. A rule that only looked at the size would
 * accept the smaller bubbles; the density does not care how big the bubble
 * is.
 */
const MIN_INK_DENSITY = 0.12;

/**
 * How far outside the model's box the refiner looks for ink, as a fraction
 * of the box's own size.
 *
 * The model's box can be too small (it missed the second line) or too large
 * (it swallowed the bubble border). The search window has to be wide enough
 * to find the real text, and narrow enough not to wander into the next
 * bubble. A fraction of the box scales with the text: a big caption gets a
 * wide window, a small sound effect a narrow one.
 *
 * The ratio is generous because the common failure is a box that covers
 * only the first line of a two-line bubble, and the second line is one
 * line-height below it. A line-height is roughly the height of the box
 * itself, so the window has to reach about that far.
 */
const SEARCH_MARGIN_RATIO = 1.2;

/** The floor on the search margin, in pixels, for very small boxes. */
const MIN_SEARCH_MARGIN = 12;

/** The ceiling on the search margin, in pixels. */
const MAX_SEARCH_MARGIN = 80;

/**
 * How far apart two glyphs can be and still belong to the same text.
 *
 * In a manga panel the characters of a line are 20-31px wide with a few
 * pixels of space between them, and the two lines of a bubble are about
 * 22px apart. Two bubbles are much further apart than that.
 */
const MAX_GROUP_DISTANCE = 40;

/**
 * How much the model's box and the found ink have to contain each other.
 *
 * The refiner may legitimately grow the box (the model clipped the second
 * line) and legitimately shrink it (the model padded with empty space). It
 * must not wander off to a different piece of text. The ink it found is the
 * evidence for the refinement, so when the two barely contain each other the
 * refinement is about a different bubble — and a panel over the wrong bubble
 * hides the neighbour's original text without replacing it.
 */
const MIN_OVERLAP_RATIO = 0.35;

/**
 * How much bigger the recovered text may be than the box the model asked
 * for.
 *
 * A model box for a sound effect is small; a box for a caption is large. If
 * the ink next to an empty model box is much bigger than that box, the ink
 * is a different piece of text that happens to be nearby — a caption next
 * to a misplaced sound effect. Dragging the translation onto it would put
 * the wrong words over the wrong words, which is worse than leaving the
 * translation where the model put it.
 */
const MAX_RECOVERED_SIZE_RATIO = 2;

/**
 * How many glyphs a recovered text has to have.
 *
 * Text is a run of glyphs. A single blob is a drawing: an eye, a window
 * frame, the tail of a speech bubble. On a page whose artwork touches the
 * lettering, the lettering itself can be swallowed by the artwork and stop
 * being visible at all — the model still reads it correctly, but the
 * refiner cannot see it. Recovering from "no ink under the box" then means
 * picking up the nearest blob of artwork instead, which puts the
 * translation over a face. So a recovery needs at least two glyphs.
 */
const MIN_RECOVERED_GLYPHS = 2;

/**
 * A single connected blob of dark pixels.
 */
interface Component {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  pixelCount: number;
}

/**
 * Build a greyscale bitmap from an RGBA buffer.
 *
 * The luminance is the Rec. 709 luma, which tracks perceived brightness
 * better than a plain channel average: a saturated blue glyph has a low
 * blue channel but is still dark, and averaging the channels would let it
 * through as bright.
 */
export function buildInkBitmap(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): InkBitmap {
  const luminance = new Float32Array(width * height);
  for (let i = 0, p = 0; p < width * height; i += 4, p++) {
    luminance[p] =
      0.2126 * (rgba[i] ?? 0) +
      0.7152 * (rgba[i + 1] ?? 0) +
      0.0722 * (rgba[i + 2] ?? 0);
  }
  return { width, height, luminance };
}

/**
 * Find every connected blob of dark pixels in the image.
 *
 * The flood fill is not clipped to any region: a glyph that is cut in half
 * by a region boundary changes its shape and stops looking like a glyph.
 * The whole image is analysed once, and the per-box work afterwards is
 * only filtering.
 *
 * The connectivity is four-way rather than eight-way on purpose. A
 * diagonal chain of pixels would otherwise join a glyph to a bubble
 * border that touches it at one corner, and the merged component would be
 * discarded by the border filter.
 */
export function findInkComponents(bitmap: InkBitmap): Component[] {
  const { width, height, luminance } = bitmap;
  const seen = new Uint8Array(width * height);
  const components: Component[] = [];

  const isInk = (x: number, y: number): boolean =>
    (luminance[y * width + x] ?? 255) < INK_THRESHOLD;

  for (let sy = 0; sy < height; sy++) {
    for (let sx = 0; sx < width; sx++) {
      const startIndex = sy * width + sx;
      if (seen[startIndex] === 1 || !isInk(sx, sy)) {
        continue;
      }

      // Flood fill.
      const stack: number[] = [startIndex];
      seen[startIndex] = 1;
      let minX = sx;
      let maxX = sx;
      let minY = sy;
      let maxY = sy;
      let pixelCount = 0;

      while (stack.length > 0) {
        const packed = stack.pop() as number;
        const cy = Math.floor(packed / width);
        const cx = packed - cy * width;
        pixelCount++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        for (let d = 0; d < 4; d++) {
          const nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
          const ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
            continue;
          }
          const ni = ny * width + nx;
          if (seen[ni] === 1 || !isInk(nx, ny)) {
            continue;
          }
          seen[ni] = 1;
          stack.push(ni);
        }
      }

      components.push({ minX, maxX, minY, maxY, pixelCount });
    }
  }

  return components;
}

/**
 * Keep the components that look like glyphs and drop the ones that look
 * like bubble outlines, panel borders and rules.
 */
function selectGlyphComponents(components: Component[]): Component[] {
  return components.filter(component => {
    const width = component.maxX - component.minX + 1;
    const height = component.maxY - component.minY + 1;
    if (component.pixelCount < MIN_COMPONENT_PIXELS) {
      return false;
    }
    // A glyph has both a width and a height. A bubble's vertical border
    // has a height but no width; a horizontal rule the other way round.
    if (width < MIN_COMPONENT_SIZE || height < MIN_COMPONENT_SIZE) {
      return false;
    }
    if (width > MAX_COMPONENT_SIZE || height > MAX_COMPONENT_SIZE) {
      return false;
    }
    // A letter is mostly ink; a bubble's outline is a rectangle, and a
    // rectangle is mostly empty.
    const density = component.pixelCount / (width * height);
    if (density < MIN_INK_DENSITY) {
      return false;
    }
    return true;
  });
}

/**
 * A box in pixel coordinates, with explicit edges.
 */
interface PixelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The area of the intersection of two boxes.
 */
function intersectionArea(a: NormalizedBox, b: NormalizedBox): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  if (x1 <= x0 || y1 <= y0) {
    return 0;
  }
  return (x1 - x0) * (y1 - y0);
}

/**
 * The area of the intersection of two pixel boxes.
 */
function pixelIntersectionArea(a: PixelBox, b: PixelBox): number {
  const x0 = Math.max(a.left, b.left);
  const y0 = Math.max(a.top, b.top);
  const x1 = Math.min(a.right, b.right);
  const y1 = Math.min(a.bottom, b.bottom);
  if (x1 <= x0 || y1 <= y0) {
    return 0;
  }
  return (x1 - x0) * (y1 - y0);
}

/**
 * The distance between two components, in pixels.
 *
 * Zero when they touch. A glyph and the glyph next to it in the same line
 * are a few pixels apart; a glyph and the next bubble's glyph are far
 * apart.
 */
function componentDistance(a: Component, b: Component): number {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  return Math.hypot(dx, dy);
}

/**
 * Group the glyphs into the pieces of text they belong to.
 *
 * Two glyphs are in the same group when they are close enough to be
 * neighbours on the page: the characters of a line, or the lines of a
 * bubble. The grouping is transitive, so a chain of neighbours ends up in
 * one group.
 */
function groupGlyphs(glyphs: Component[]): Component[][] {
  const groups: Component[][] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < glyphs.length; i++) {
    if (assigned.has(i)) {
      continue;
    }
    const seed = glyphs[i] as Component;
    const group: Component[] = [seed];
    assigned.add(i);

    // Grow the group, absorbing any glyph that is close to one already
    // in it. A queue keeps the growth transitive.
    const queue: Component[] = [seed];
    while (queue.length > 0) {
      const current = queue.pop() as Component;
      for (let j = 0; j < glyphs.length; j++) {
        if (assigned.has(j)) {
          continue;
        }
        const candidate = glyphs[j] as Component;
        if (componentDistance(current, candidate) <= MAX_GROUP_DISTANCE) {
          assigned.add(j);
          group.push(candidate);
          queue.push(candidate);
        }
      }
    }

    groups.push(group);
  }

  return groups;
}

/**
 * The extent of a group of glyphs, in pixels.
 */
function groupExtent(group: Component[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  return {
    minX: Math.min(...group.map(glyph => glyph.minX)),
    minY: Math.min(...group.map(glyph => glyph.minY)),
    maxX: Math.max(...group.map(glyph => glyph.maxX)),
    maxY: Math.max(...group.map(glyph => glyph.maxY)),
  };
}

/**
 * The gap between two boxes. Zero when they touch or overlap.
 */
function boxGap(a: PixelBox, b: PixelBox): number {
  const dx = Math.max(0, Math.max(a.left - b.right, b.left - a.right));
  const dy = Math.max(0, Math.max(a.top - b.bottom, b.top - a.bottom));
  return Math.hypot(dx, dy);
}

/**
 * A group of glyphs, and how it stands to the model's box.
 */
interface GroupSelection {
  group: Component[];
  /** How much of the group's extent falls inside the model's box. */
  coverage: number;
  /** The gap between the group's extent and the model's box. */
  distance: number;
}

/**
 * Pick the group of glyphs the model's box is about.
 *
 * The group that covers the most of the model's box wins. A model box
 * that sits on one line of a two-line bubble still selects that bubble's
 * group, because the group is what the text is — and the group's extent
 * is what the translation has to cover.
 *
 * When no group overlaps the model's box at all, the box is sitting on
 * blank paper, and the nearest group is the better answer: the model read
 * the words and then put the box in the wrong place, and where the box is
 * is the only clue left about which words it meant.
 *
 * Both boxes are in pixels here. The group's extent comes out of the
 * bitmap in pixels, and comparing it against a normalised box would put
 * the two in different coordinate systems and make every comparison
 * meaningless.
 */
function selectGroupForModelBox(
  groups: Component[][],
  modelBoxInPixels: PixelBox
): GroupSelection | null {
  let best: Component[] | null = null;
  let bestCoverage = 0;
  let nearest: Component[] | null = null;
  let nearestDistance = Infinity;

  for (const group of groups) {
    const extent = groupExtent(group);
    const groupBox: PixelBox = {
      left: extent.minX,
      top: extent.minY,
      right: extent.maxX,
      bottom: extent.maxY,
    };
    const groupArea =
      (groupBox.right - groupBox.left) * (groupBox.bottom - groupBox.top);
    if (groupArea <= 0) {
      continue;
    }
    // How much of the group falls inside the model's box.
    const coverage =
      pixelIntersectionArea(groupBox, modelBoxInPixels) / groupArea;
    if (coverage > bestCoverage) {
      bestCoverage = coverage;
      best = group;
    }
    const distance = boxGap(groupBox, modelBoxInPixels);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = group;
    }
  }

  if (best) {
    return { group: best, coverage: bestCoverage, distance: 0 };
  }
  if (nearest) {
    return { group: nearest, coverage: 0, distance: nearestDistance };
  }
  return null;
}

/**
 * Whether a component touches a rectangle.
 */
function overlapsRange(
  component: Component,
  left: number,
  top: number,
  right: number,
  bottom: number
): boolean {
  return !(
    component.maxX < left ||
    component.minX > right ||
    component.maxY < top ||
    component.minY > bottom
  );
}

/**
 * Refine one box against an already-computed set of glyphs.
 */
function refineAgainstGlyphs(
  glyphs: Component[],
  modelBox: NormalizedBox,
  imageWidth: number,
  imageHeight: number
): NormalizedBox {
  const modelLeft = modelBox.x * imageWidth;
  const modelTop = modelBox.y * imageHeight;
  const modelRight = (modelBox.x + modelBox.width) * imageWidth;
  const modelBottom = (modelBox.y + modelBox.height) * imageHeight;

  // The search window scales with the box: the model clipped a line, so
  // the window has to reach past the box to find the missing text, but a
  // small sound effect must not be allowed to reach into the next bubble.
  const marginX = Math.min(
    MAX_SEARCH_MARGIN,
    Math.max(MIN_SEARCH_MARGIN, (modelRight - modelLeft) * SEARCH_MARGIN_RATIO)
  );
  const marginY = Math.min(
    MAX_SEARCH_MARGIN,
    Math.max(MIN_SEARCH_MARGIN, (modelBottom - modelTop) * SEARCH_MARGIN_RATIO)
  );

  const nearby = glyphs.filter(glyph =>
    overlapsRange(
      glyph,
      modelLeft - marginX,
      modelTop - marginY,
      modelRight + marginX,
      modelBottom + marginY
    )
  );
  if (nearby.length === 0) {
    return modelBox;
  }

  // Keep only the glyphs that belong to the model's text.
  //
  // The search window is wide enough to reach a line the model clipped,
  // and a page often has another bubble right next to it. Collecting
  // every glyph in the window would merge the two and stretch the box
  // across both. So the glyphs are grouped, and only the group the
  // model's box actually sits in is used.
  const selection = selectGroupForModelBox(groupGlyphs(nearby), {
    left: modelLeft,
    top: modelTop,
    right: modelRight,
    bottom: modelBottom,
  });
  if (!selection) {
    return modelBox;
  }

  const extent = groupExtent(selection.group);

  // The model's box holds no text at all.
  //
  // Measured against a page with known ground truth, the model's box was
  // off by up to 80px horizontally. A box that lands on blank paper is not
  // a box about that blank paper: it is a box about the words the model
  // read, put in the wrong place. Where the box is the only clue left
  // about which words it meant, so the nearest text wins.
  //
  // Two guards keep the recovery honest. The nearest text has to be the
  // size of text the model asked for — a small box next to a long caption
  // is a sound effect that landed in the wrong place, not a caption. And
  // it has to be a run of glyphs, because a single blob is artwork: on a
  // page where the artwork touches the lettering, the lettering can be
  // swallowed whole and the only blob nearby is an eye.
  if (selection.coverage === 0) {
    const modelWidth = modelRight - modelLeft;
    const modelHeight = modelBottom - modelTop;
    const groupWidth = extent.maxX - extent.minX;
    const groupHeight = extent.maxY - extent.minY;
    if (
      selection.group.length < MIN_RECOVERED_GLYPHS ||
      groupWidth > modelWidth * MAX_RECOVERED_SIZE_RATIO ||
      groupHeight > modelHeight * MAX_RECOVERED_SIZE_RATIO
    ) {
      return modelBox;
    }
    return {
      x: extent.minX / imageWidth,
      y: extent.minY / imageHeight,
      width: groupWidth / imageWidth,
      height: groupHeight / imageHeight,
    };
  }

  /*
   * 找到的墨迹本身。
   *
   * 这是"精修"的依据：模型给的框是猜测，这些墨迹才是页面上真的字。
   */
  const inkBox: NormalizedBox = {
    x: extent.minX / imageWidth,
    y: extent.minY / imageHeight,
    width: (extent.maxX - extent.minX) / imageWidth,
    height: (extent.maxY - extent.minY) / imageHeight,
  };

  // The refined box is the union of the model's box and the ink, never
  // smaller than the model asked for.
  //
  // The union is what fixes the common failure: the model drew a box that
  // stopped short of the last line, and the ink reaches further. But the
  // union also protects the other direction. The ink is a lower bound on
  // the text, not an exact measure of it — a small stroke, a dakuten, a
  // comma — and a box that shrank to the surviving blobs would be tighter
  // than the text it has to hold, which squeezes the translation into a
  // smaller font than it needs.
  const refined: NormalizedBox = {
    x: Math.min(modelLeft, extent.minX) / imageWidth,
    y: Math.min(modelTop, extent.minY) / imageHeight,
    width:
      (Math.max(modelRight, extent.maxX) - Math.min(modelLeft, extent.minX)) /
      imageWidth,
    height:
      (Math.max(modelBottom, extent.maxY) - Math.min(modelTop, extent.minY)) /
      imageHeight,
  };

  /*
   * 精修必须还是同一段文字。
   *
   * 拿"并集"去比是没用的：并集一定包含模型给的框，重叠比恒等于 1，这道
   * 闸门永远不会响（所以它以前是一段死代码）。真正会走偏的是**墨迹**——
   * 找到的字如果和模型给的框几乎不搭，精修就跑到隔壁那个气泡上去了。
   *
   * 跑偏的后果很具体：不透明的译文面板盖住了邻居的原文，而译文还留在原处，
   * 读者既读不到邻居那句日文，也拿不到它的翻译。
   *
   * 比的是"包含度"：两个框里小的那个有多大比例落在大的里面。模型框比墨迹
   * 矮（模型少框了一行）时包含度是 1，墨迹比模型框小（模型多框了空白）时
   * 也是 1——这两种都是精修该干的事。只有两者几乎不搭时，包含度才会掉下来。
   */
  const modelArea = modelBox.width * modelBox.height;
  const inkArea = inkBox.width * inkBox.height;
  const smaller = Math.min(modelArea, inkArea);
  if (smaller > 0) {
    const overlap = intersectionArea(inkBox, modelBox) / smaller;
    if (overlap < MIN_OVERLAP_RATIO) {
      return modelBox;
    }
  }

  // A degenerate box (no ink at all in one axis) is not usable.
  if (refined.width <= 0 || refined.height <= 0) {
    return modelBox;
  }

  return refined;
}

/**
 * Snap one model-reported box to the ink around it.
 *
 * Returns the model's box unchanged when the pixels do not support a
 * refinement: no glyphs found, only borders found, or the refinement drifts
 * too far from what the model asked for. A wrong refinement is worse than
 * no refinement, because it can move the translation off the text.
 *
 * The one case where the box does move is a box that holds no text at all:
 * the model read the words and put the box in the wrong place, and the
 * nearest text is the only thing that can say which words it meant.
 *
 * @param bitmap The greyscale image the box refers to.
 * @param modelBox The box the vision model reported, normalised.
 * @returns The refined box, normalised.
 */
export function refineTextBox(
  bitmap: InkBitmap,
  modelBox: NormalizedBox
): NormalizedBox {
  const glyphs = selectGlyphComponents(findInkComponents(bitmap));
  return refineAgainstGlyphs(glyphs, modelBox, bitmap.width, bitmap.height);
}

/**
 * Refine every box of a translation.
 *
 * The image is analysed once and every box is refined against the same
 * analysis, because a manga page has a handful of bubbles and the
 * analysis is the expensive part.
 *
 * @param bitmap The greyscale image the boxes refer to.
 * @param boxes The boxes the vision model reported, normalised.
 * @returns The refined boxes, in the same order.
 */
export function refineTextBoxes(
  bitmap: InkBitmap,
  boxes: readonly NormalizedBox[]
): NormalizedBox[] {
  if (boxes.length === 0) {
    return [];
  }
  const glyphs = selectGlyphComponents(findInkComponents(bitmap));
  return boxes.map(box =>
    refineAgainstGlyphs(glyphs, box, bitmap.width, bitmap.height)
  );
}
