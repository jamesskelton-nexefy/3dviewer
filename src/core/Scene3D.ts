import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  DirectionalLight,
  Vector3,
  SceneLoader,
  AbstractMesh,
  ISceneLoaderAsyncResult,
} from '@babylonjs/core';
import '@babylonjs/loaders';

interface Annotation {
  id: string;
  position: { x: number; y: number; z: number };
  content: string;
  type: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

interface ModelData {
  id: string;
  meshes: AbstractMesh[];
  materials: any[];
  textures: any[];
  animationGroups: any[];
  metadata?: Record<string, any>;
}

interface LoadModelOptions {
  id?: string;
  autoFitCamera?: boolean;
  metadata?: Record<string, any>;
}

interface LoadModelResult {
  modelId: string;
  meshes: AbstractMesh[];
  loadTime: number;
}

interface PerformanceMetrics {
  frameRate: number;
  drawCalls: number;
  triangles: number;
  loadTime: number;
}

export class Scene3D {
  public canvas: HTMLCanvasElement;
  public engine: Engine | null = null;
  public scene: Scene | null = null;
  public camera: ArcRotateCamera | null = null;
  public lights: (HemisphericLight | DirectionalLight)[] = [];
  public models: Map<string, ModelData> = new Map();
  public annotations: Map<string, Annotation> = new Map();
  public isDisposed: boolean = false;
  public performanceMetrics: PerformanceMetrics = {
    frameRate: 0,
    drawCalls: 0,
    triangles: 0,
    loadTime: 0,
  };

  private renderLoopHandler: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async initialize(): Promise<boolean> {
    try {
      // Create engine
      this.engine = new Engine(this.canvas, true, {
        preserveDrawingBuffer: true,
        stencil: true,
      });

      // Create scene
      this.scene = new Scene(this.engine);
      this.scene.useRightHandedSystem = true;

      // Create camera
      this.camera = new ArcRotateCamera(
        'camera',
        Math.PI / 2,
        Math.PI / 3,
        10,
        Vector3.Zero(),
        this.scene
      );
      this.camera.attachControl(this.canvas, true);

      // Create lights
      const hemisphericLight = new HemisphericLight(
        'hemisphericLight',
        new Vector3(0, 1, 0),
        this.scene
      );
      hemisphericLight.intensity = 0.7;
      this.lights.push(hemisphericLight);

      const directionalLight = new DirectionalLight(
        'directionalLight',
        new Vector3(-1, -2, -1),
        this.scene
      );
      directionalLight.intensity = 0.5;
      this.lights.push(directionalLight);

      // Start render loop
      this.renderLoopHandler = () => {
        if (this.scene) {
          this.scene.render();
          this.updatePerformanceMetrics();
        }
      };
      this.engine.runRenderLoop(this.renderLoopHandler);

      // Handle window resize
      window.addEventListener('resize', () => {
        if (this.engine) {
          this.engine.resize();
        }
      });

      return true;
    } catch (error) {
      throw error;
    }
  }

  async loadModel(url: string, options?: LoadModelOptions): Promise<LoadModelResult> {
    if (this.isDisposed) {
      throw new Error('Scene has been disposed');
    }

    if (!this.scene) {
      throw new Error('Scene not initialized');
    }

    const startTime = performance.now();

    try {
      const result: ISceneLoaderAsyncResult = await SceneLoader.ImportMeshAsync(
        '',
        '',
        url,
        this.scene
      );

      const modelId = options?.id || `model-${Date.now()}`;
      
      // Store model data
      const modelData: ModelData = {
        id: modelId,
        meshes: result.meshes,
        materials: [],  // ISceneLoaderAsyncResult doesn't include materials/textures
        textures: [],
        animationGroups: result.animationGroups,
        metadata: options?.metadata,
      };
      
      this.models.set(modelId, modelData);

      // Auto-fit camera if requested (default is true)
      if (options?.autoFitCamera !== false && result.meshes.length > 0) {
        this.fitCameraToModel(result.meshes);
      }

      const loadTime = performance.now() - startTime;
      this.performanceMetrics.loadTime = loadTime;

      return {
        modelId,
        meshes: result.meshes,
        loadTime,
      };
    } catch (error) {
      throw error;
    }
  }

  addAnnotation(
    id: string,
    position: { x: number; y: number; z: number },
    content: string,
    type: string = 'note',
    metadata?: Record<string, any>
  ): Annotation {
    if (this.isDisposed) {
      throw new Error('Scene has been disposed');
    }

    const annotation: Annotation = {
      id,
      position,
      content,
      type,
      timestamp: Date.now(),
      metadata,
    };

    this.annotations.set(id, annotation);
    return annotation;
  }

  removeAnnotation(id: string): boolean {
    return this.annotations.delete(id);
  }

  getAnnotations(): Annotation[] {
    return Array.from(this.annotations.values());
  }

  getPerformanceMetrics(): PerformanceMetrics {
    return { ...this.performanceMetrics };
  }

  updatePerformanceMetrics(): void {
    if (this.engine) {
      this.performanceMetrics.frameRate = this.engine.getFps();
    }

    if (this.scene) {
      const activeMeshes = this.scene.getActiveMeshes();
      this.performanceMetrics.drawCalls = activeMeshes.length;
      this.performanceMetrics.triangles = this.scene.getTotalVertices();
    }
  }

  fitCameraToModel(meshes: AbstractMesh[] | null): void {
    if (!meshes || meshes.length === 0 || !this.camera || !this.scene) {
      return;
    }

    // Calculate bounding box
    let minVector = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
    let maxVector = new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);

    meshes.forEach(mesh => {
      if (mesh.getBoundingInfo) {
        const boundingInfo = mesh.getBoundingInfo();
        const min = boundingInfo.minimum.clone();
        const max = boundingInfo.maximum.clone();

        minVector = Vector3.Minimize(minVector, min);
        maxVector = Vector3.Maximize(maxVector, max);
      }
    });

    // Calculate center and radius
    const center = Vector3.Center(minVector, maxVector);
    const radius = Vector3.Distance(minVector, maxVector) / 2;

    // Set camera target and radius
    this.camera.setTarget(center);
    this.camera.radius = radius * 2; // Add some padding
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }

    // Stop render loop
    if (this.engine && this.renderLoopHandler) {
      this.engine.stopRenderLoop(this.renderLoopHandler);
    }

    // Dispose models
    this.models.forEach(model => {
      model.meshes.forEach(mesh => mesh.dispose());
      model.materials.forEach(material => material?.dispose?.());
      model.textures.forEach(texture => texture?.dispose?.());
    });
    this.models.clear();

    // Clear annotations
    this.annotations.clear();

    // Dispose lights
    this.lights.forEach(light => light.dispose());
    this.lights = [];

    // Dispose camera
    if (this.camera) {
      this.camera.dispose();
      this.camera = null;
    }

    // Dispose scene
    if (this.scene) {
      this.scene.dispose();
      this.scene = null;
    }

    // Dispose engine
    if (this.engine) {
      this.engine.dispose();
      this.engine = null;
    }

    this.isDisposed = true;
  }
}