/**
 * Which providers run on the reader's own machine.
 *
 * Two questions sound alike and are not the same:
 *
 * - "does this provider need an API key?" — `providerRequiresApiKey`
 * - "does this provider charge the reader?" — only the cloud ones do.
 *
 * A local provider (Ollama, LM Studio) runs on the reader's own hardware: the
 * picture never leaves the machine and no bill ever appears. The extension
 * used to tell those readers that every action "会产生费用", which is the one
 * sentence a person using a local model most needs to be *wrong* about — it
 * is the sentence the extension spends to earn trust about money.
 *
 * The list lives in its own module because three different layers need it —
 * the provider layer, the popup and the content script — and the content
 * script must not import the provider layer (it is not a type-only import,
 * and the provider layer is not something every page should pull in).
 */

/**
 * The providers that run locally.
 *
 * One list: a new local provider lands here, and every surface that talks
 * about money learns about it at the same time.
 */
export const LOCAL_PROVIDER_TYPES = ['ollama', 'lm-studio'] as const;

export type LocalProviderType = (typeof LOCAL_PROVIDER_TYPES)[number];

/**
 * Is this provider one that runs on the reader's own machine?
 *
 * The answer decides what the product says about money, so an unknown
 * provider is treated as a cloud one: if a new provider appears that does
 * charge, the product must not have already promised it is free.
 */
export function isLocalProvider(
  type: string | undefined | null
): type is LocalProviderType {
  return type === 'ollama' || type === 'lm-studio';
}

/**
 * Does this provider need an API key?
 *
 * The one that runs on the reader's own machine does not: there is nobody
 * to bill and no key to keep. Everything else does.
 *
 * This question used to be answered inside the provider layer
 * (`providers/base.ts`), and the content script had to import that layer to
 * ask it — which dragged the provider base class, the prompt builders and
 * the response parsers into the script that is injected into every page the
 * user opens. The list of local providers was already here; so is the
 * answer.
 */
export function providerRequiresApiKey(
  type: string | undefined | null
): boolean {
  return !isLocalProvider(type);
}
