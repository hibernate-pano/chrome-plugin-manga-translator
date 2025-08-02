import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock Chrome APIs
const mockChrome = {
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
        hasListener: vi.fn()
      }
    },
    sync: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
        hasListener: vi.fn()
      }
    }
  },
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({}),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn()
    },
    getURL: vi.fn((path: string) => `chrome-extension://test-id/${path}`),
    id: 'test-extension-id'
  },
  tabs: {
    query: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn().mockResolvedValue({}),
    onUpdated: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn()
    }
  },
  action: {
    setBadgeText: vi.fn(),
    setBadgeBackgroundColor: vi.fn(),
    setIcon: vi.fn()
  }
};

// 设置全局 chrome 对象
Object.defineProperty(globalThis, 'chrome', {
  value: mockChrome,
  writable: true
});

// Mock fetch
global.fetch = vi.fn();

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock HTMLCanvasElement.getContext
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  getImageData: vi.fn(() => ({
    data: new Uint8ClampedArray(4)
  })),
  putImageData: vi.fn(),
  createImageData: vi.fn(() => ({
    data: new Uint8ClampedArray(4)
  })),
  setTransform: vi.fn(),
  drawImage: vi.fn(),
  save: vi.fn(),
  fillText: vi.fn(),
  restore: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  stroke: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  rotate: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  measureText: vi.fn(() => ({ width: 0 })),
  transform: vi.fn(),
  rect: vi.fn(),
  clip: vi.fn(),
});

// Mock HTMLCanvasElement.toDataURL
HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,test');

// 清理函数
beforeEach(() => {
  vi.clearAllMocks();
});
