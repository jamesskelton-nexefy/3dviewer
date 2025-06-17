import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BabylonEngine } from '@/services/BabylonEngine'
import { ViewerConfig } from '@/types'

// Mock Babylon.js modules
vi.mock('@babylonjs/core', () => ({
  Engine: vi.fn().mockImplementation(() => ({
    runRenderLoop: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    getFps: vi.fn().mockReturnValue(60),
    setHardwareScalingLevel: vi.fn(),
    enableOfflineSupport: false,
    cullBackFaces: true,
  })),
  Scene: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
    render: vi.fn(),
    skipPointerMovePicking: true,
    autoClear: true,
    autoClearDepthAndStencil: true,
    freezeActiveMeshes: false,
    clearColor: null,
    getActiveMeshes: vi.fn().mockReturnValue([]),
    getTotalVertices: vi.fn().mockReturnValue(0),
  })),
  ArcRotateCamera: vi.fn().mockImplementation(() => ({
    attachControls: vi.fn(),
    wheelDeltaPercentage: 0.01,
    pinchDeltaPercentage: 0.01,
    lowerRadiusLimit: 0.1,
    upperRadiusLimit: 100,
    lowerBetaLimit: 0.1,
    upperBetaLimit: Math.PI - 0.1,
    inertia: 0.8,
    angularSensibilityX: 1000,
    angularSensibilityY: 1000,
  })),
  HemisphericLight: vi.fn().mockImplementation(() => ({
    intensity: 0.6,
  })),
  DirectionalLight: vi.fn().mockImplementation(() => ({
    intensity: 0.8,
    position: null,
  })),
  Vector3: Object.assign(
    vi.fn().mockImplementation((x = 0, y = 0, z = 0) => ({ x, y, z })),
    {
      Zero: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0 }),
    }
  ),
  Color3: vi.fn().mockImplementation((r = 0, g = 0, b = 0) => ({ r, g, b })),
  WebGPUEngine: vi.fn(),
}))

describe('BabylonEngine', () => {
  let canvas: HTMLCanvasElement
  let config: ViewerConfig
  let engine: BabylonEngine

  beforeEach(() => {
    // Create a mock canvas
    canvas = document.createElement('canvas')
    Object.defineProperty(canvas, 'getContext', {
      value: vi.fn().mockReturnValue({
        getExtension: vi.fn(),
        createShader: vi.fn(),
        shaderSource: vi.fn(),
        compileShader: vi.fn(),
        getShaderParameter: vi.fn(),
      }),
    })

    config = {
      enablePerformanceOptimization: true,
      maxModelSize: 100 * 1024 * 1024,
      enableDracoCompression: true,
      enableTextureCompression: true,
      targetFPS: 60,
    }

    engine = new BabylonEngine(config)
  })

  afterEach(() => {
    engine.dispose()
  })

  it('should create BabylonEngine instance', () => {
    expect(engine).toBeDefined()
    expect(engine).toBeInstanceOf(BabylonEngine)
  })

  it('should initialize successfully', async () => {
    // Mock navigator.gpu to avoid WebGPU initialization
    Object.defineProperty(navigator, 'gpu', {
      value: undefined,
      configurable: true,
    })

    await expect(engine.initialize(canvas)).resolves.not.toThrow()
  })

  it('should return null for scene and camera before initialization', () => {
    expect(engine.getScene()).toBeNull()
    expect(engine.getCamera()).toBeNull()
    expect(engine.getEngine()).toBeNull()
  })

  it('should return performance metrics', () => {
    const metrics = engine.getPerformanceMetrics()
    
    expect(metrics).toHaveProperty('fps')
    expect(metrics).toHaveProperty('drawCalls')
    expect(metrics).toHaveProperty('triangles')
    expect(metrics).toHaveProperty('memory')
    expect(metrics).toHaveProperty('loadTime')
    
    expect(typeof metrics.fps).toBe('number')
    expect(typeof metrics.drawCalls).toBe('number')
    expect(typeof metrics.triangles).toBe('number')
    expect(typeof metrics.memory).toBe('number')
    expect(typeof metrics.loadTime).toBe('number')
  })

  it('should dispose resources properly', () => {
    engine.dispose()
    
    expect(engine.getScene()).toBeNull()
    expect(engine.getCamera()).toBeNull()
    expect(engine.getEngine()).toBeNull()
  })
})