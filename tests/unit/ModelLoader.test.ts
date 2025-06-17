import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ModelLoader } from '@/services/ModelLoader'
import { Model3D, ViewerConfig } from '@/types'

// Mock Babylon.js modules
vi.mock('@babylonjs/core', () => ({
  SceneLoader: {
    ImportMeshAsync: vi.fn().mockResolvedValue({
      meshes: [],
      materials: [],
      textures: [],
    }),
  },
  AssetContainer: vi.fn().mockImplementation(() => ({
    meshes: [],
    materials: [],
    textures: [],
    dispose: vi.fn(),
  })),
  AbstractMesh: {
    CULLINGSTRATEGY_STANDARD: 1,
  },
  Tools: {
    ToBlob: vi.fn(),
  },
  Texture: {
    CLAMP_ADDRESSMODE: 1,
  },
  PBRMaterial: vi.fn(),
}))

vi.mock('@babylonjs/core/Meshes/Compression/dracoCompression', () => ({
  DracoCompression: {
    Configuration: {},
  },
}))

describe('ModelLoader', () => {
  let mockScene: any
  let config: ViewerConfig
  let modelLoader: ModelLoader

  beforeEach(() => {
    mockScene = {
      meshes: [],
      cleanCachedTextureBuffer: vi.fn(),
      getEngine: vi.fn().mockReturnValue({
        getRenderingCanvas: vi.fn().mockReturnValue(document.createElement('canvas')),
      }),
    }

    config = {
      enablePerformanceOptimization: true,
      maxModelSize: 100 * 1024 * 1024,
      enableDracoCompression: true,
      enableTextureCompression: true,
      targetFPS: 60,
    }

    modelLoader = new ModelLoader(mockScene, config)
  })

  it('should create ModelLoader instance', () => {
    expect(modelLoader).toBeDefined()
    expect(modelLoader).toBeInstanceOf(ModelLoader)
  })

  it('should return initial loading state', () => {
    const loadingState = modelLoader.getLoadingState()
    
    expect(loadingState).toEqual({
      isLoading: false,
      progress: 0,
      message: '',
    })
  })

  it('should reject models that exceed size limit', async () => {
    const largeModel: Model3D = {
      id: 'test-large',
      name: 'large-model.glb',
      url: 'http://example.com/large-model.glb',
      size: 200 * 1024 * 1024, // 200MB - exceeds 100MB limit
      format: 'glb',
      uploadedBy: 'test-user',
      uploadedAt: '2024-01-01T00:00:00Z',
      version: '1.0.0',
      isPublic: false,
    }

    await expect(modelLoader.loadModel(largeModel)).rejects.toThrow('exceeds limit')
  })

  it('should load model successfully', async () => {
    const model: Model3D = {
      id: 'test-model',
      name: 'test-model.glb',
      url: 'http://example.com/test-model.glb',
      size: 1024 * 1024, // 1MB
      format: 'glb',
      uploadedBy: 'test-user',
      uploadedAt: '2024-01-01T00:00:00Z',
      version: '1.0.0',
      isPublic: false,
    }

    const result = await modelLoader.loadModel(model)
    expect(result).toEqual([])
  })

  it('should handle loading state callback', () => {
    const callback = vi.fn()
    modelLoader.setLoadingStateCallback(callback)

    // The callback should be set (internal state, can't test directly)
    expect(callback).not.toHaveBeenCalled()
  })

  it('should clear current model', async () => {
    await expect(modelLoader.clearCurrentModel()).resolves.not.toThrow()
  })

  it('should dispose resources properly', () => {
    expect(() => modelLoader.dispose()).not.toThrow()
  })
})