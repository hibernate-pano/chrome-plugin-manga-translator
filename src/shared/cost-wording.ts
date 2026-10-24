/**
 * The wording the product uses when it talks about money.
 *
 * Every sentence that tells a user what an action will cost lives here, so
 * the popup and the page cannot drift apart: a user who reads "it will cost
 * this much" in the popup and then presses the keyboard shortcut has to be
 * told the same thing in the page.
 *
 * Every sentence here takes the provider, because "what does this cost" has
 * two answers. A cloud provider charges the reader for every request; a local
 * provider (Ollama, LM Studio) runs on the reader's own machine, where no
 * bill ever appears and no picture ever leaves. Telling a local reader that
 * an action "会产生费用" is not a rounding error — it is the one sentence
 * the extension spends to earn trust about money, being wrong about the one
 * thing that reader cares about.
 */

import { isLocalProvider } from './local-providers';

/**
 * The provider a sentence is written for.
 *
 * Unknown providers are treated as cloud ones: if a provider appears that
 * does charge, the product must not have already promised it was free.
 */
export type CostProvider = string | undefined | null;

/**
 * The half of a sentence that says whether money moves.
 */
export function describeFee(provider: CostProvider): string {
  return isLocalProvider(provider)
    ? '不产生服务商费用，图片也不会离开这台机器'
    : '会产生费用';
}

/**
 * What one image can turn into on the bill.
 *
 * The bill is charged per *request*, but the extension counts *images*: the
 * two numbers are not the same, and a reader who assumes they are will be
 * surprised by the invoice. Three things in this pipeline turn one image into
 * more than one request:
 *
 * - A long webtoon page is cut into tiles before it is sent to the model.
 * - When the model comes back with no text at all, the OCR fallback asks
 *   again, in batches of ten regions. (Cloud providers only: the OCR
 *   fallback is skipped for local models.)
 * - A request that times out or fails is retried, and the retry is a
 *   request too. The provider has usually run the model by then.
 *
 * The number the UI quotes stays the image count — that is what the store
 * review notes promise ("how many images will be requested") and what a
 * reader can check against the page. This sentence is what keeps the
 * request count honest.
 */
export function describeRequestCount(provider: CostProvider): string {
  const ocr = isLocalProvider(provider)
    ? ''
    : '，模型没读出文字时还会用 OCR 再分批试一次';
  return `一张图可能变成多次请求：长条图会拆成多片分别请求${ocr}，请求超时或失败时还会自动重试一次。实际请求次数可能高于图片数。`;
}

/**
 * What re-running the failed images costs.
 *
 * "重新翻译失败项" is the one action on a finished page that asks for money
 * again, so the sentence that goes with it says two things: that a request
 * will be made, and that the images which *did* succeed are not re-sent.
 * The HUD and the popup both offer this action, and they used to word it
 * differently — the HUD's version left out the request note, so a webtoon
 * reader was told less about their bill in the page than in the popup.
 */
export function describeRetryFailedCost(provider: CostProvider): string {
  const fee = isLocalProvider(provider)
    ? '会再次调用本机的 Vision LLM，不产生服务商费用'
    : '会再次调用 Vision LLM 产生费用';
  return `${fee}；已经翻译成功的图片不会重来。${describeRequestCount(provider)}`;
}

/**
 * The images that have not loaded yet, in one sentence — or nothing.
 *
 * A webtoon reader shows two or three pages and keeps forty more in the
 * wings. Those forty are not translated *yet*, and whether they will be is
 * not a fact about the page: it is a fact about the auto-continue switch and
 * the follow-up budget. So there are three forms, and the caller must say
 * which one is true — promising automatic translation that never comes is a
 * lie about a bill the user is not going to be charged, and denying one that
 * does come hides a bill they are.
 *
 * `null` means "we have not heard back from the page yet". It gets its own
 * sentence rather than the `false` one, which would assert something we do
 * not know.
 *
 * The sentence deliberately does not repeat what the translation costs: it
 * always follows a sentence that already said so, and two 「会产生费用」 in a
 * row read like a warning the reader learns to skip.
 */
export function describePendingImages(
  pending: number,
  autoContinueArmed: boolean | null
): string {
  if (pending <= 0) {
    return '';
  }
  if (autoContinueArmed === null) {
    return `另有 ${pending} 张还在加载；它们会不会被自动翻译，取决于自动续翻设置。`;
  }
  return autoContinueArmed
    ? `另有 ${pending} 张还在加载，加载后会自动翻译。`
    : `另有 ${pending} 张还在加载；自动续翻是关着的，它们不会自动翻译。`;
}

/**
 * What "force retranslate" is about to cost.
 *
 * This is the most expensive action in the product: it ignores the cache and
 * re-requests the whole page, including the images that already translated
 * fine. A count turns "it will cost money" into "it will cost this much".
 *
 * Two things the count must not leave out:
 *
 * - The number is *images*, not billed requests — a long webtoon page is cut
 *   into tiles, so one image can be several requests.
 * - The count of *loaded* images is not the count of images that will be
 *   requested. The ones still loading are picked up afterwards (when
 *   auto-continue is armed) and billed too. Saying 「本页全部 N 张」 while
 *   forty more are on their way is wrong in the user's favour, which is the
 *   one direction a price must never be wrong in.
 *
 * `count === null` means the scan did not answer; that is not the same as
 * "zero images", and it must not be reported as either.
 *
 * The page's in-page confirmation and the popup's dialog both read this, so
 * the shortcut and the button cannot be told different prices.
 */
export function describeForceRetranslate(
  count: number | null,
  provider?: CostProvider,
  pending: number | null = null,
  autoContinueArmed: boolean | null = true
): string {
  const fee = describeFee(provider);
  const pendingCount = pending ?? 0;
  const pendingNote = describePendingImages(pendingCount, autoContinueArmed);

  if (typeof count === 'number' && count > 0) {
    return `忽略缓存，对本页 ${count} 张图片重新调用 Vision LLM 翻译。已经翻译成功的图片也会重新翻译，${fee}。${pendingNote}${describeRequestCount(provider)}`;
  }

  if (pendingCount > 0) {
    /*
     * 一张加载好的图都没有（或者根本没数出来），但还有 N 张在路上。
     * 这时说「本页没有可翻译的图片，本次操作不会产生费用」是错的：
     * 打开自动续翻的人，图片一加载就会被送去翻译并计费。
     */
    const subject =
      count === 0 ? '现在还没有加载好的图片' : '本页的图片数量还没数出来';
    if (autoContinueArmed === false) {
      return `${subject}；另有 ${pendingCount} 张还在加载，自动续翻是关着的，它们不会自动翻译。`;
    }
    if (autoContinueArmed === null) {
      return `${subject}；另有 ${pendingCount} 张还在加载，它们会不会被自动翻译取决于自动续翻设置。`;
    }
    return `${subject}；另有 ${pendingCount} 张还在加载，加载后会自动翻译，${fee}。${describeRequestCount(provider)}`;
  }

  if (count === 0) {
    // 数出来了，是零张。这不是"不知道"，所以不能退回「本页全部图片」。
    return '本页没有可翻译的图片，本次操作不会产生费用。';
  }

  return `忽略缓存，对本页全部图片重新调用 Vision LLM 翻译。已经翻译成功的图片也会重新翻译，${fee}。${describeRequestCount(provider)}`;
}

/**
 * The short form, for a sentence that already says what happened.
 *
 * The long form carries the "the picture does not leave the machine" half,
 * which matters the first time a reader sees it and is noise after that.
 */
export function describeFeeShort(provider: CostProvider): string {
  return isLocalProvider(provider) ? '不产生服务商费用' : '会产生费用';
}

/**
 * The short form, for a button label.
 *
 * The long sentences do not fit on a button in the corner of a page.
 */
export function describeRetryFee(provider: CostProvider): string {
  return isLocalProvider(provider) ? '会再次调用本机模型' : '会再次计费';
}

/**
 * Why an image was not translated.
 *
 * The popup counts what it filtered out and says why; the HUD says it too,
 * in its own words, until the two were made to share this string. A reader
 * who is told "skipped" in one place and "ignored" in another has to work
 * out whether those are the same set.
 */
export const SKIPPED_IMAGES_REASON =
  '太小、不在正文区域，或地址看起来不是漫画页';
