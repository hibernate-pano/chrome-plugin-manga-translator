export type AutoTranslateStatus =
  | 'idle'
  | 'scanning'
  | 'translating'
  | 'complete'
  | 'error';

/**
 * Upper bound on follow-up page scans triggered without the user asking again.
 *
 * A reader that keeps mounting images (an infinite-scroll webtoon, or a page
 * that mutates `src` under us) otherwise drives a fresh full-page scan — each
 * one rebuilding the translator and re-paying for every new image — for as long
 * as the tab lives. The budget is a backstop for pathological pages, not for
 * ordinary reading: a normal chapter clears it in a handful of runs.
 */
export const MAX_AUTO_TRANSLATE_FOLLOW_UP_RUNS = 20;

export function shouldAutoTranslateFollowUp(args: {
  enabled: boolean;
  status: AutoTranslateStatus;
  hasPendingImages: boolean;
  runsRemaining?: number;
}): boolean {
  const { enabled, status, hasPendingImages } = args;

  if (!enabled || !hasPendingImages) {
    return false;
  }

  // An omitted budget means the caller does not cap, preserving the original
  // behaviour for callers that have no reason to track runs.
  if (args.runsRemaining !== undefined && args.runsRemaining <= 0) {
    return false;
  }

  return status === 'idle' || status === 'complete' || status === 'error';
}

export function createDebouncedAutoTranslate(
  callback: () => void,
  delay = 800
): {
  schedule: () => void;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule: () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        callback();
      }, delay);
    },
    cancel: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
