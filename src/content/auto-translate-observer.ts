export type AutoTranslateStatus =
  | 'idle'
  | 'scanning'
  | 'translating'
  | 'complete'
  | 'hover-select'
  | 'error';

export function shouldAutoTranslateFollowUp(args: {
  enabled: boolean;
  status: AutoTranslateStatus;
  hasPendingImages: boolean;
}): boolean {
  const { enabled, status, hasPendingImages } = args;

  if (!enabled || !hasPendingImages) {
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
