/**
 * Verdicts for the smoke test's checks.
 *
 * The smoke test drives a real browser, so some of what it checks depends on
 * the machine it runs on. Two rules follow from that, and both come from the
 * file it lives in: a check that could not be run has to say so, and a check
 * that ran and found the thing broken must fail. What must never happen is a
 * check that quietly counts as a pass because the browser made it impossible
 * to tell.
 *
 * The verdicts live here, apart from the browser driving, so that they can be
 * tested without a browser.
 */

/**
 * How the content script answered a message sent to a page.
 *
 * - `answered`: it replied with its state — the content script is alive.
 * - `silent`: it replied, but with nothing in the reply — something else
 *   answered, or the content script is broken.
 * - `refused`: the message had no receiver at all — the browser blocked the
 *   page, or the content script was never injected.
 *
 * @typedef {'answered' | 'silent' | 'refused'} ContentScriptState
 */

/**
 * Did the content script answer on the page?
 *
 * A `file://` page only reaches the content script when the extension has
 * "allow access to file URLs" turned on, so a refusal on such a page has two
 * possible causes that must not be confused:
 *
 * - the extension may load file URLs, and the content script is genuinely
 *   dead — a real failure;
 * - the extension may not load file URLs, and the content script was never
 *   given the chance to answer — the check could not be run at all.
 *
 * The second case used to be reported as a pass, which meant a build whose
 * content script did not answer at all still cleared the smoke test whenever
 * the browser happened to block the page. Both cases fail now, with details
 * that say which one it was: a release gate that cannot tell the difference
 * between "verified" and "not verified" is not a gate.
 *
 * @param {ContentScriptState | string} state how the content script answered.
 * @param {boolean} fileAccessAllowed whether the extension may load file URLs.
 * @returns {{ ok: boolean, detail: string }}
 */
export function judgeContentScript(state, fileAccessAllowed) {
  if (state === 'answered') {
    return { ok: true, detail: '' };
  }

  if (state === 'refused') {
    if (fileAccessAllowed) {
      return {
        ok: false,
        detail:
          'the content script did not answer, although the extension may load file URLs',
      };
    }
    return {
      ok: false,
      detail:
        'could not be verified: the extension has no access to file URLs, so the content script was never reached (chrome://extensions → Details → Allow access to file URLs)',
    };
  }

  return {
    ok: false,
    detail: `the content script did not answer (${state})`,
  };
}
