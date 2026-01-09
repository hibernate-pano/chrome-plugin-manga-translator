/**
 * Input Validation Utilities
 *
 * Provides defensive programming utilities for input validation.
 */

/**
 * Validate that a value is not null or undefined
 */
export function assertNotNull<T>(
  value: T | null | undefined,
  message = 'Value cannot be null or undefined'
): T {
  if (value == null) {
    throw new Error(message);
  }
  return value;
}

/**
 * Validate that a string is not empty
 */
export function assertNotEmpty(
  value: string,
  message = 'String cannot be empty'
): string {
  if (!value || value.trim().length === 0) {
    throw new Error(message);
  }
  return value.trim();
}

/**
 * Validate that a number is within a range
 */
export function assertInRange(
  value: number,
  min: number,
  max: number,
  message = `Value must be between ${min} and ${max}`
): number {
  if (value < min || value > max) {
    throw new Error(message);
  }
  return value;
}

/**
 * Safely access array elements with bounds checking
 */
export function safeArrayAccess<T>(
  array: T[],
  index: number,
  defaultValue?: T
): T | undefined {
  if (index < 0 || index >= array.length) {
    return defaultValue;
  }
  return array[index];
}

/**
 * Validate HTMLImageElement is loaded and valid
 */
export function validateImageElement(image: HTMLImageElement): void {
  if (!image.complete) {
    throw new Error('Image is not fully loaded');
  }

  if (image.naturalWidth === 0 || image.naturalHeight === 0) {
    throw new Error('Image has invalid dimensions');
  }
}
