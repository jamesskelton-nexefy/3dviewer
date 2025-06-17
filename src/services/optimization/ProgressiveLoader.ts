import * as BABYLON from '@babylonjs/core';
import { Scene, Mesh, Material, StandardMaterial, Texture, Observable } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

export interface LoadingProgress {
  loaded: number;
  total: number;
  percentage: number;
  currentAsset: string;
  phase: 'geometry' | 'textures' | 'materials' | 'complete';
}

export interface ProgressiveLoadConfig {
  enablePlaceholders: boolean;
  placeholderColor: BABYLON.Color3;
  loadTexturesAsync: boolean;
  textureQualitySteps: number[];
  geometryChunkSize: number;
  priorityRadius: number;
}

export interface AssetPriority {
  url: string;
  priority: number;
  distance?: number;
  size?: number;
}

export class ProgressiveLoader {
  private scene: Scene;
  private config: ProgressiveLoadConfig;
  private loadingQueue: AssetPriority[] = [];
  private activeLoads: Map<string, AbortController> = new Map();
  private placeholders: Map<string, Mesh> = new Map();
  private loadedAssets: Map<string, Mesh | Mesh[]> = new Map();
  private textureCache: Map<string, Texture> = new Map();
  
  public onProgress = new Observable<LoadingProgress>();
  public onAssetLoaded = new Observable<{ url: string; asset: Mesh | Mesh[] }>();
  public onError = new Observable<{ url: string; error: Error }>();

  constructor(scene: Scene, config?: Partial<ProgressiveLoadConfig>) {
    this.scene = scene;
    this.config = {
      enablePlaceholders: config?.enablePlaceholders ?? true,
      placeholderColor: config?.placeholderColor ?? new BABYLON.Color3(0.7, 0.7, 0.7),
      loadTexturesAsync: config?.loadTexturesAsync ?? true,
      textureQualitySteps: config?.textureQualitySteps ?? [0.25, 0.5, 1.0],
      geometryChunkSize: config?.geometryChunkSize ?? 1024 * 1024, // 1MB chunks
      priorityRadius: config?.priorityRadius ?? 100,
      ...config
    };
  }

  /**
   * Load model with progressive enhancement
   */
  public async loadModel(
    url: string, 
    position?: BABYLON.Vector3,
    priority: number = 0
  ): Promise<Mesh | Mesh[]> {
    // Check if already loaded
    if (this.loadedAssets.has(url)) {
      return this.loadedAssets.get(url)!;
    }

    // Create placeholder if enabled
    let placeholder: Mesh | undefined;
    if (this.config.enablePlaceholders) {
      placeholder = this.createPlaceholder(url, position);
    }

    // Add to loading queue
    const assetPriority: AssetPriority = {
      url,
      priority,
      distance: position ? BABYLON.Vector3.Distance(
        this.scene.activeCamera!.position,
        position
      ) : undefined
    };

    this.addToQueue(assetPriority);

    try {
      const result = await this.processLoadQueue();
      const asset = result.find(r => r.url === url)?.asset;
      
      if (!asset) {
        throw new Error(`Failed to load asset: ${url}`);
      }

      // Remove placeholder
      if (placeholder) {
        placeholder.dispose();
        this.placeholders.delete(url);
      }

      return asset;
    } catch (error) {
      this.onError.notifyObservers({ url, error: error as Error });
      throw error;
    }
  }

  /**
   * Create placeholder mesh
   */
  private createPlaceholder(url: string, position?: BABYLON.Vector3): Mesh {
    // Create bounding box placeholder
    const placeholder = BABYLON.MeshBuilder.CreateBox(
      `placeholder_${url}`,
      { size: 1 },
      this.scene
    );

    // Apply placeholder material
    const material = new StandardMaterial(`placeholder_mat_${url}`, this.scene);
    material.diffuseColor = this.config.placeholderColor;
    material.alpha = 0.5;
    placeholder.material = material;

    if (position) {
      placeholder.position = position;
    }

    // Add loading animation
    this.animatePlaceholder(placeholder);

    this.placeholders.set(url, placeholder);
    return placeholder;
  }

  /**
   * Animate placeholder during loading
   */
  private animatePlaceholder(placeholder: Mesh): void {
    const animationRotation = new BABYLON.Animation(
      'placeholderRotation',
      'rotation.y',
      30,
      BABYLON.Animation.ANIMATIONTYPE_FLOAT,
      BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
    );

    animationRotation.setKeys([
      { frame: 0, value: 0 },
      { frame: 60, value: Math.PI * 2 }
    ]);

    placeholder.animations.push(animationRotation);
    this.scene.beginAnimation(placeholder, 0, 60, true);

    // Pulsing effect
    const animationScale = new BABYLON.Animation(
      'placeholderScale',
      'scaling',
      30,
      BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
      BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
    );

    animationScale.setKeys([
      { frame: 0, value: new BABYLON.Vector3(1, 1, 1) },
      { frame: 30, value: new BABYLON.Vector3(1.1, 1.1, 1.1) },
      { frame: 60, value: new BABYLON.Vector3(1, 1, 1) }
    ]);

    placeholder.animations.push(animationScale);
  }

  /**
   * Add asset to loading queue with priority
   */
  private addToQueue(asset: AssetPriority): void {
    this.loadingQueue.push(asset);
    this.loadingQueue.sort((a, b) => {
      // Sort by priority first, then by distance
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      if (a.distance !== undefined && b.distance !== undefined) {
        return a.distance - b.distance;
      }
      return 0;
    });
  }

  /**
   * Process loading queue
   */
  private async processLoadQueue(): Promise<{ url: string; asset: Mesh | Mesh[] }[]> {
    const results: { url: string; asset: Mesh | Mesh[] }[] = [];
    const maxConcurrent = 3;
    
    while (this.loadingQueue.length > 0 || this.activeLoads.size > 0) {
      // Start new loads up to max concurrent
      while (this.activeLoads.size < maxConcurrent && this.loadingQueue.length > 0) {
        const asset = this.loadingQueue.shift()!;
        this.startLoad(asset).then(result => {
          results.push(result);
        });
      }

      // Wait for at least one load to complete
      if (this.activeLoads.size > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  /**
   * Start loading an asset
   */
  private async startLoad(asset: AssetPriority): Promise<{ url: string; asset: Mesh | Mesh[] }> {
    const abortController = new AbortController();
    this.activeLoads.set(asset.url, abortController);

    try {
      // Load geometry first
      this.notifyProgress({
        loaded: 0,
        total: 100,
        percentage: 0,
        currentAsset: asset.url,
        phase: 'geometry'
      });

      const meshes = await this.loadGeometry(asset.url, abortController.signal);
      
      // Load textures progressively
      if (this.config.loadTexturesAsync) {
        this.loadTexturesProgressive(meshes);
      }

      this.loadedAssets.set(asset.url, meshes);
      this.onAssetLoaded.notifyObservers({ url: asset.url, asset: meshes });

      return { url: asset.url, asset: meshes };
    } finally {
      this.activeLoads.delete(asset.url);
    }
  }

  /**
   * Load geometry with streaming
   */
  private async loadGeometry(
    url: string, 
    signal: AbortSignal
  ): Promise<Mesh[]> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('Load aborted'));
        return;
      }

      BABYLON.SceneLoader.LoadAssetContainer(
        '',
        url,
        this.scene,
        (container) => {
          if (signal.aborted) {
            container.dispose();
            reject(new Error('Load aborted'));
            return;
          }

          // Add all meshes to scene
          container.addAllToScene();
          
          const meshes = container.meshes.filter(m => m instanceof Mesh) as Mesh[];
          
          // Apply initial low-quality materials
          if (this.config.loadTexturesAsync) {
            meshes.forEach(mesh => {
              if (mesh.material) {
                this.applyLowQualityMaterial(mesh);
              }
            });
          }

          resolve(meshes);
        },
        (event) => {
          // Progress callback
          const progress = event.lengthComputable 
            ? (event.loaded / event.total) * 100 
            : 0;
            
          this.notifyProgress({
            loaded: event.loaded,
            total: event.total,
            percentage: progress,
            currentAsset: url,
            phase: 'geometry'
          });
        },
        (scene, message, exception) => {
          reject(new Error(`Failed to load ${url}: ${message}`));
        }
      );
    });
  }

  /**
   * Apply low quality material for initial display
   */
  private applyLowQualityMaterial(mesh: Mesh): void {
    if (!mesh.material) return;

    const originalMaterial = mesh.material;
    const lowQualityMat = new StandardMaterial(
      `${mesh.material.name}_lowquality`,
      this.scene
    );

    // Copy basic properties
    if (originalMaterial instanceof StandardMaterial) {
      lowQualityMat.diffuseColor = originalMaterial.diffuseColor;
      lowQualityMat.specularColor = originalMaterial.specularColor;
      lowQualityMat.emissiveColor = originalMaterial.emissiveColor;
      lowQualityMat.ambientColor = originalMaterial.ambientColor;
    }

    // Store original material for later
    mesh.metadata = { ...mesh.metadata, originalMaterial };
    mesh.material = lowQualityMat;
  }

  /**
   * Load textures progressively
   */
  private async loadTexturesProgressive(meshes: Mesh[]): Promise<void> {
    const textureUrls = new Set<string>();
    
    // Collect all texture URLs
    meshes.forEach(mesh => {
      const material = mesh.metadata?.originalMaterial || mesh.material;
      if (material instanceof StandardMaterial) {
        if (material.diffuseTexture?.name) {
          textureUrls.add(material.diffuseTexture.name);
        }
        if (material.bumpTexture?.name) {
          textureUrls.add(material.bumpTexture.name);
        }
        if (material.specularTexture?.name) {
          textureUrls.add(material.specularTexture.name);
        }
      }
    });

    // Load textures in quality steps
    for (const quality of this.config.textureQualitySteps) {
      await Promise.all(
        Array.from(textureUrls).map(url => 
          this.loadTextureAtQuality(url, quality)
        )
      );

      // Apply textures to meshes
      this.applyTexturesToMeshes(meshes, quality);
    }
  }

  /**
   * Load texture at specific quality level
   */
  private async loadTextureAtQuality(
    url: string, 
    quality: number
  ): Promise<Texture> {
    const cacheKey = `${url}_${quality}`;
    
    if (this.textureCache.has(cacheKey)) {
      return this.textureCache.get(cacheKey)!;
    }

    return new Promise((resolve, reject) => {
      const texture = new Texture(url, this.scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
      
      // Apply quality reduction
      if (quality < 1) {
        texture.onLoadObservable.addOnce(() => {
          const size = texture.getSize();
          const newWidth = Math.floor(size.width * quality);
          const newHeight = Math.floor(size.height * quality);
          
          // Resize texture (in production, this would be done server-side)
          texture.updateSamplingMode(Texture.BILINEAR_SAMPLINGMODE);
        });
      }

      texture.onLoadObservable.addOnce(() => {
        this.textureCache.set(cacheKey, texture);
        resolve(texture);
      });

      texture.onErrorObservable.addOnce((error) => {
        reject(error);
      });
    });
  }

  /**
   * Apply loaded textures to meshes
   */
  private applyTexturesToMeshes(meshes: Mesh[], quality: number): void {
    meshes.forEach(mesh => {
      const originalMaterial = mesh.metadata?.originalMaterial;
      if (!originalMaterial || !(originalMaterial instanceof StandardMaterial)) {
        return;
      }

      const currentMaterial = mesh.material as StandardMaterial;
      
      // Apply textures at current quality
      if (originalMaterial.diffuseTexture?.name) {
        const texture = this.textureCache.get(
          `${originalMaterial.diffuseTexture.name}_${quality}`
        );
        if (texture) {
          currentMaterial.diffuseTexture = texture;
        }
      }

      // Update progress
      this.notifyProgress({
        loaded: quality * 100,
        total: 100,
        percentage: quality * 100,
        currentAsset: mesh.name,
        phase: quality === 1 ? 'complete' : 'textures'
      });
    });
  }

  /**
   * Notify progress observers
   */
  private notifyProgress(progress: LoadingProgress): void {
    this.onProgress.notifyObservers(progress);
  }

  /**
   * Cancel loading of specific asset
   */
  public cancelLoad(url: string): void {
    const controller = this.activeLoads.get(url);
    if (controller) {
      controller.abort();
      this.activeLoads.delete(url);
    }

    // Remove from queue
    this.loadingQueue = this.loadingQueue.filter(asset => asset.url !== url);
    
    // Remove placeholder
    const placeholder = this.placeholders.get(url);
    if (placeholder) {
      placeholder.dispose();
      this.placeholders.delete(url);
    }
  }

  /**
   * Preload assets based on camera position
   */
  public preloadNearbyAssets(assets: { url: string; position: BABYLON.Vector3 }[]): void {
    const cameraPos = this.scene.activeCamera!.position;
    
    assets.forEach(asset => {
      const distance = BABYLON.Vector3.Distance(cameraPos, asset.position);
      if (distance < this.config.priorityRadius && !this.loadedAssets.has(asset.url)) {
        const priority = Math.max(0, 1 - (distance / this.config.priorityRadius));
        this.loadModel(asset.url, asset.position, priority);
      }
    });
  }

  /**
   * Clear cache and dispose resources
   */
  public dispose(): void {
    // Cancel all active loads
    this.activeLoads.forEach((controller, url) => {
      controller.abort();
    });
    this.activeLoads.clear();

    // Dispose placeholders
    this.placeholders.forEach(placeholder => {
      placeholder.dispose();
    });
    this.placeholders.clear();

    // Dispose cached textures
    this.textureCache.forEach(texture => {
      texture.dispose();
    });
    this.textureCache.clear();

    // Clear observers
    this.onProgress.clear();
    this.onAssetLoaded.clear();
    this.onError.clear();
  }
}