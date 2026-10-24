/**
 * The smoke test drives a real browser, so its verdicts are the only part of
 * it that can be tested without one. They are also the part that can lie: a
 * verdict that counts an unverifiable situation as a pass turns the release
 * gate into a rubber stamp.
 *
 * The case that matters: a `file://` page only reaches the content script
 * when the extension may load file URLs. A refusal therefore has two causes
 * that must not be confused — a browser that blocked the page (the check could
 * not be run) and a content script that is dead (the check ran and found a
 * real failure). The old smoke test counted the first as a pass, so a build
 * whose content script never answered still cleared the gate.
 */
import { describe, expect, it } from 'vitest';

import { judgeContentScript } from '../lib/smoke-verdicts.mjs';

describe('the content script liveness verdict', () => {
  it('passes when the content script answers', () => {
    const verdict = judgeContentScript('answered', true);

    expect(verdict.ok).toBe(true);
    expect(verdict.detail).toBe('');
  });

  it('fails when the content script is refused although the browser would have delivered the message', () => {
    // The extension may load file URLs, so the browser had no reason to
    // refuse. The content script is dead, and that is a real failure.
    const verdict = judgeContentScript('refused', true);

    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain('did not answer');
  });

  it('reports a content script that could not be reached as unverified rather than as a pass', () => {
    // The browser blocked the page, so nothing was verified. It must not
    // count as a pass — but it is a different failure from a dead content
    // script, and the detail has to say which one it was.
    const verdict = judgeContentScript('refused', false);

    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain('could not be verified');
    expect(verdict.detail).toContain('Allow access to file URLs');
  });

  it('fails when something else answers instead of the content script', () => {
    const verdict = judgeContentScript('silent', true);

    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain('did not answer');
  });
});
