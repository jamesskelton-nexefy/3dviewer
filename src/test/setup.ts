import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

// Extend Vitest's expect with testing-library matchers
expect.extend(matchers);

// Cleanup after each test case
afterEach(() => {
  cleanup();
});

// Mock WebGL context for testing
const mockWebGLContext = {
  getParameter: vi.fn(),
  getSupportedExtensions: vi.fn(() => []),
  getExtension: vi.fn(),
  createShader: vi.fn(),
  createProgram: vi.fn(),
  // Add other WebGL methods as needed
};

// Mock canvas.getContext to return our mock WebGL context
HTMLCanvasElement.prototype.getContext = vi.fn((contextType) => {
  if (contextType === 'webgl' || contextType === 'webgl2') {
    return mockWebGLContext;
  }
  return null;
});

// Mock ResizeObserver
global.ResizeObserver = vi.fn(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock window.matchMedia
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

// Mock Babylon.js if needed in tests
vi.mock('@babylonjs/core', () => ({
  Engine: vi.fn(),
  Scene: vi.fn(),
  Vector3: vi.fn(),
  Camera: vi.fn(),
  // Add other Babylon.js mocks as needed
}));