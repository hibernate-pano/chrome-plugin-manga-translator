/**
 * Vitest Test Setup
 * 
 * This file is loaded before each test file runs.
 * It sets up the testing environment with necessary mocks and configurations.
 */

import '@testing-library/jest-dom';

// Mock Chrome Storage API for testing
const mockStorage: Record<string, unknown> = {};

const createStorageMock = () => ({
  get: vi.fn((keys: string | string[]) => {
    const keyArray = Array.isArray(keys) ? keys : [keys];
    const result: Record<string, unknown> = {};
    keyArray.forEach((key) => {
      if (key in mockStorage) {
        result[key] = mockStorage[key];
      }
    });
    return Promise.resolve(result);
  }),
  set: vi.fn((items: Record<string, unknown>) => {
    Object.assign(mockStorage, items);
    return Promise.resolve();
  }),
  remove: vi.fn((keys: string | string[]) => {
    const keyArray = Array.isArray(keys) ? keys : [keys];
    keyArray.forEach((key) => {
      delete mockStorage[key];
    });
    return Promise.resolve();
  }),
  clear: vi.fn(() => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
    return Promise.resolve();
  }),
});

// Mock chrome global
const chromeMock = {
  storage: {
    sync: createStorageMock(),
    local: createStorageMock(),
  },
  runtime: {
    id: 'test-extension-id',
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
};

// Assign to global
Object.assign(globalThis, { chrome: chromeMock });

// Mock fetch for API tests
globalThis.fetch = vi.fn();

// Minimal canvas text measurement mock for jsdom-based layout tests
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: vi.fn(() => ({
    font: '',
    measureText: (text: string) => ({ width: text.length * 10 }),
    drawImage: vi.fn(),
    toDataURL: vi.fn(),
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
  })),
});

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
});

// Export for use in tests
export { mockStorage, chromeMock };
