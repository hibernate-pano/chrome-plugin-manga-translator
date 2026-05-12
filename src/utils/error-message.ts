export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException
  ) {
    return error.message || error.name;
  }

  if (typeof error === 'object' && error !== null) {
    const maybeMessage = (error as Record<string, unknown>)['message'];
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage;
    }

    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') {
        return serialized;
      }
    } catch {
      // fall through
    }
  }

  return String(error || 'Unknown error');
}
