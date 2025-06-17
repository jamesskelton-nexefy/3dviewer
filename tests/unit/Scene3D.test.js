import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { Scene3D } from '@/core/Scene3D';

// Mock Babylon.js
vi.mock('@babylonjs/core', () => ({
  Engine: vi.fn().mockImplementation(() => ({
    runRenderLoop: vi.fn(),
    stopRenderLoop: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    getFps: vi.fn(() => 60)
  })),
  Scene: vi.fn().mockImplementation(() => ({
    useRightHandedSystem: true,
    render: vi.fn(),
    dispose: vi.fn(),
    registerBeforeRender: vi.fn(),
    unregisterBeforeRender: vi.fn(),
    enablePhysics: vi.fn(),
    getActiveMeshes: vi.fn(() => ({ length: 10 })),
    getTotalVertices: vi.fn(() => 1000)
  })),
  ArcRotateCamera: vi.fn().mockImplementation(() => ({
    setTarget: vi.fn(),
    attachControl: vi.fn(),
    attachToMesh: vi.fn(),
    dispose: vi.fn(),
    radius: 10
  })),
  HemisphericLight: vi.fn().mockImplementation(() => ({
    intensity: 0.7,
    dispose: vi.fn()
  })),
  DirectionalLight: vi.fn().mockImplementation(() => ({
    intensity: 0.5,
    dispose: vi.fn()
  })),
  Vector3: Object.assign(
    vi.fn().mockImplementation((x = 0, y = 0, z = 0) => ({ x, y, z })),
    {
      Zero: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
      Center: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
      Distance: vi.fn(() => 10),
      Minimize: vi.fn((a, b, result) => result || { x: -1, y: -1, z: -1 }),
      Maximize: vi.fn((a, b, result) => result || { x: 1, y: 1, z: 1 })
    }
  ),
  CannonJSPlugin: vi.fn(),
  SceneLoader: {
    ImportMeshAsync: vi.fn().mockResolvedValue({
      meshes: [
        {
          getBoundingInfo: () => ({
            minimum: { x: -1, y: -1, z: -1, clone: () => ({ x: -1, y: -1, z: -1 }) },
            maximum: { x: 1, y: 1, z: 1, clone: () => ({ x: 1, y: 1, z: 1 }) }
          }),
          dispose: vi.fn()
        }
      ],
      materials: [{ dispose: vi.fn() }],
      textures: [{ dispose: vi.fn() }],
      animationGroups: []
    })
  }
}));

describe('Scene3D', () => {
  let canvas;
  let scene3D;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    scene3D = new Scene3D(canvas);
  });

  afterEach(() => {
    if (scene3D && !scene3D.isDisposed) {
      scene3D.dispose();
    }
  });

  describe('Constructor', () => {
    test('should initialize with correct default values', () => {
      expect(scene3D.canvas).toBe(canvas);
      expect(scene3D.engine).toBeNull();
      expect(scene3D.scene).toBeNull();
      expect(scene3D.camera).toBeNull();
      expect(scene3D.lights).toEqual([]);
      expect(scene3D.models).toBeInstanceOf(Map);
      expect(scene3D.annotations).toBeInstanceOf(Map);
      expect(scene3D.isDisposed).toBe(false);
      expect(scene3D.performanceMetrics).toEqual({
        frameRate: 0,
        drawCalls: 0,
        triangles: 0,
        loadTime: 0
      });
    });
  });

  describe('initialize()', () => {
    test('should initialize successfully', async () => {
      const result = await scene3D.initialize();
      
      expect(result).toBe(true);
      expect(scene3D.engine).toBeTruthy();
      expect(scene3D.scene).toBeTruthy();
      expect(scene3D.camera).toBeTruthy();
      expect(scene3D.lights).toHaveLength(2);
    });

    test('should handle initialization errors', async () => {
      const { Engine } = await import('@babylonjs/core');
      vi.mocked(Engine).mockImplementationOnce(() => {
        throw new Error('WebGL not supported');
      });

      await expect(scene3D.initialize()).rejects.toThrow('WebGL not supported');
    });
  });

  describe('loadModel()', () => {
    beforeEach(async () => {
      await scene3D.initialize();
    });

    test('should load model successfully', async () => {
      const mockUrl = 'test-model.glb';
      const result = await scene3D.loadModel(mockUrl);

      expect(result).toHaveProperty('modelId');
      expect(result).toHaveProperty('meshes');
      expect(result).toHaveProperty('loadTime');
      expect(scene3D.models.has(result.modelId)).toBe(true);
    });

    test('should load model with custom options', async () => {
      const mockUrl = 'test-model.glb';
      const options = {
        id: 'custom-model-id',
        autoFitCamera: false,
        metadata: { name: 'Test Model' }
      };

      const result = await scene3D.loadModel(mockUrl, options);

      expect(result.modelId).toBe('custom-model-id');
      expect(scene3D.models.get('custom-model-id').metadata).toEqual({ name: 'Test Model' });
    });

    test('should throw error when disposed', async () => {
      scene3D.dispose();

      await expect(scene3D.loadModel('test.glb')).rejects.toThrow('Scene has been disposed');
    });

    test('should handle model loading errors', async () => {
      const { SceneLoader } = await import('@babylonjs/core');
      vi.mocked(SceneLoader.ImportMeshAsync).mockRejectedValueOnce(new Error('Failed to load model'));

      await expect(scene3D.loadModel('invalid-model.glb')).rejects.toThrow('Failed to load model');
    });

    test('should track loading performance', async () => {
      const startMetrics = scene3D.getPerformanceMetrics();
      await scene3D.loadModel('test-model.glb');
      const endMetrics = scene3D.getPerformanceMetrics();

      expect(endMetrics.loadTime).toBeGreaterThan(0);
    });
  });

  describe('Annotations', () => {
    beforeEach(async () => {
      await scene3D.initialize();
    });

    test('should add annotation successfully', () => {
      const annotation = scene3D.addAnnotation('test-1', { x: 1, y: 2, z: 3 }, 'Test annotation');

      expect(annotation).toHaveProperty('id', 'test-1');
      expect(annotation).toHaveProperty('content', 'Test annotation');
      expect(annotation).toHaveProperty('type', 'note');
      expect(annotation).toHaveProperty('timestamp');
      expect(scene3D.annotations.size).toBe(1);
    });

    test('should remove annotation successfully', () => {
      scene3D.addAnnotation('test-1', { x: 1, y: 2, z: 3 }, 'Test annotation');
      const removed = scene3D.removeAnnotation('test-1');

      expect(removed).toBe(true);
      expect(scene3D.annotations.size).toBe(0);
    });

    test('should get all annotations', () => {
      scene3D.addAnnotation('test-1', { x: 1, y: 2, z: 3 }, 'Test annotation 1');
      scene3D.addAnnotation('test-2', { x: 2, y: 3, z: 4 }, 'Test annotation 2');

      const annotations = scene3D.getAnnotations();

      expect(annotations).toHaveLength(2);
      expect(annotations[0]).toHaveProperty('id', 'test-1');
      expect(annotations[1]).toHaveProperty('id', 'test-2');
    });

    test('should throw error when adding annotation to disposed scene', () => {
      scene3D.dispose();

      expect(() => {
        scene3D.addAnnotation('test', { x: 0, y: 0, z: 0 }, 'Test');
      }).toThrow('Scene has been disposed');
    });
  });

  describe('Performance Monitoring', () => {
    beforeEach(async () => {
      await scene3D.initialize();
    });

    test('should return performance metrics', () => {
      const metrics = scene3D.getPerformanceMetrics();

      expect(metrics).toHaveProperty('frameRate');
      expect(metrics).toHaveProperty('drawCalls');
      expect(metrics).toHaveProperty('triangles');
      expect(metrics).toHaveProperty('loadTime');
    });

    test('should track frame rate', () => {
      scene3D.updatePerformanceMetrics();
      const metrics = scene3D.getPerformanceMetrics();

      expect(typeof metrics.frameRate).toBe('number');
    });
  });

  describe('Camera Management', () => {
    beforeEach(async () => {
      await scene3D.initialize();
    });

    test('should fit camera to model', () => {
      const mockMeshes = [
        {
          getBoundingInfo: () => ({
            minimum: { x: -1, y: -1, z: -1, clone: () => ({ x: -1, y: -1, z: -1 }) },
            maximum: { x: 1, y: 1, z: 1, clone: () => ({ x: 1, y: 1, z: 1 }) }
          })
        }
      ];

      scene3D.fitCameraToModel(mockMeshes);

      expect(scene3D.camera.setTarget).toHaveBeenCalled();
      expect(scene3D.camera.radius).toBeGreaterThan(0);
    });

    test('should handle empty meshes array', () => {
      expect(() => scene3D.fitCameraToModel([])).not.toThrow();
      expect(() => scene3D.fitCameraToModel(null)).not.toThrow();
    });
  });

  describe('Disposal', () => {
    test('should dispose all resources', async () => {
      await scene3D.initialize();
      await scene3D.loadModel('test-model.glb');
      scene3D.addAnnotation('test', { x: 0, y: 0, z: 0 }, 'Test');

      scene3D.dispose();

      expect(scene3D.isDisposed).toBe(true);
      expect(scene3D.models.size).toBe(0);
      expect(scene3D.annotations.size).toBe(0);
      expect(scene3D.scene).toBeNull();
      expect(scene3D.engine).toBeNull();
    });

    test('should handle multiple dispose calls', async () => {
      await scene3D.initialize();
      
      scene3D.dispose();
      expect(() => scene3D.dispose()).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    test('should handle canvas context errors gracefully', () => {
      const invalidCanvas = {};
      const scene = new Scene3D(invalidCanvas);

      expect(scene.canvas).toBe(invalidCanvas);
    });

    test('should handle missing WebGL support', async () => {
      const { Engine } = await import('@babylonjs/core');
      vi.mocked(Engine).mockImplementationOnce(() => {
        throw new Error('WebGL not available');
      });

      await expect(scene3D.initialize()).rejects.toThrow('WebGL not available');
    });
  });
});