import { describe, expect, it } from 'vitest';

import { getErrorMessage } from './error-message';

describe('getErrorMessage', () => {
  it('returns the message of an Error', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns a plain string as-is', () => {
    expect(getErrorMessage('plain failure')).toBe('plain failure');
  });

  it('uses a DOMException message or name', () => {
    const error = new DOMException('nope', 'AbortError');
    expect(getErrorMessage(error)).toBe('nope');
    const nameless = new DOMException('', 'SecurityError');
    expect(getErrorMessage(nameless)).toBe('SecurityError');
  });

  it('reads message from a plain object', () => {
    expect(getErrorMessage({ message: 'from object' })).toBe('from object');
  });

  it('serializes structured objects without a message', () => {
    expect(getErrorMessage({ code: 42 })).toBe('{"code":42}');
  });

  it('falls back to Unknown error for empty values', () => {
    expect(getErrorMessage(undefined)).toBe('Unknown error');
    expect(getErrorMessage(null)).toBe('Unknown error');
    expect(getErrorMessage(0)).toBe('Unknown error');
  });
});
