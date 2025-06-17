// Performance Optimization Services
export * from './LODSystem';
export * from './CullingSystem';
export * from './ProgressiveLoader';
export * from './TextureCompression';
export * from './MeshSimplification';
export * from './MemoryManager';
export * from './AdaptiveQuality';

// Optimization Manager that orchestrates all services
import { Scene } from '@babylonjs/core';
import { LODSystem, LODConfig } from './LODSystem';
import { CullingSystem, CullingConfig } from './CullingSystem';
import { ProgressiveLoader, ProgressiveLoadConfig } from './ProgressiveLoader';
import { TextureCompressionPipeline, CompressionConfig } from './TextureCompression';
import { MeshSimplification, SimplificationOptions } from './MeshSimplification';
import { MemoryManager, MemoryConfig } from './MemoryManager';
import { AdaptiveQualitySystem, AdaptiveConfig } from './AdaptiveQuality';

export interface OptimizationConfig {
  lod?: Partial<LODConfig>;
  culling?: Partial<CullingConfig>;
  progressive?: Partial<ProgressiveLoadConfig>;
  compression?: Partial<CompressionConfig>;
  simplification?: Partial<SimplificationOptions>;
  memory?: Partial<MemoryConfig>;
  adaptive?: Partial<AdaptiveConfig>;
}

export class OptimizationManager {
  private scene: Scene;
  public lod: LODSystem;
  public culling: CullingSystem;
  public progressiveLoader: ProgressiveLoader;
  public textureCompression: TextureCompressionPipeline;
  public meshSimplification: MeshSimplification;
  public memoryManager: MemoryManager;
  public adaptiveQuality: AdaptiveQualitySystem;

  constructor(scene: Scene, config?: OptimizationConfig) {
    this.scene = scene;

    // Initialize all optimization services
    this.lod = new LODSystem(scene, config?.lod);
    this.culling = new CullingSystem(scene, config?.culling);
    this.progressiveLoader = new ProgressiveLoader(scene, config?.progressive);
    this.textureCompression = new TextureCompressionPipeline(scene, config?.compression);
    this.meshSimplification = new MeshSimplification(config?.simplification);
    this.memoryManager = new MemoryManager(scene, config?.memory);
    this.adaptiveQuality = new AdaptiveQualitySystem(scene, config?.adaptive);

    this.setupIntegration();
  }

  /**
   * Setup integration between optimization services
   */
  private setupIntegration(): void {
    // Integrate LOD with culling
    this.lod.onLODChanged.add(({ meshId, level }) => {
      // Update culling based on LOD level
      // Higher LOD levels might have different culling distances
    });

    // Integrate progressive loading with texture compression
    this.progressiveLoader.onAssetLoaded.add(({ url, asset }) => {
      // Compress textures after loading
      if (Array.isArray(asset)) {
        asset.forEach(mesh => this.processMeshTextures(mesh));
      } else {
        this.processMeshTextures(asset);
      }
    });

    // Integrate memory manager with adaptive quality
    this.adaptiveQuality.onQualityChanged.add(({ profile }) => {
      // Adjust memory limits based on quality profile
      const memoryMultiplier = profile.name === 'ultra' ? 2 : 
                              profile.name === 'high' ? 1.5 : 
                              profile.name === 'medium' ? 1 : 
                              profile.name === 'low' ? 0.75 : 0.5;
      
      this.memoryManager.setMemoryLimit(
        this.memoryManager.getMemoryStats().totalMemoryMB * memoryMultiplier
      );
    });

    // Auto-start services
    this.lod.startAutoUpdate();
    this.culling.startAutoUpdate();
  }

  /**
   * Process mesh textures for compression
   */
  private async processMeshTextures(mesh: BABYLON.Mesh): Promise<void> {
    if (!mesh.material) return;

    const material = mesh.material;
    if ('diffuseTexture' in material && material.diffuseTexture) {
      const compressed = await this.textureCompression.loadCompressedTexture(
        material.diffuseTexture.name
      );
      material.diffuseTexture = compressed;
    }
  }

  /**
   * Optimize a mesh with all available techniques
   */
  public async optimizeMesh(
    mesh: BABYLON.Mesh,
    options?: {
      simplify?: boolean;
      simplificationTarget?: number;
      generateLODs?: boolean;
      compressTextures?: boolean;
    }
  ): Promise<void> {
    // Simplify mesh if requested
    if (options?.simplify) {
      const { mesh: simplified } = await this.meshSimplification.simplifyMesh(mesh, {
        targetPercentage: options.simplificationTarget || 0.5
      });
      
      // Replace original mesh
      mesh.dispose();
      mesh = simplified;
    }

    // Generate LODs
    if (options?.generateLODs) {
      this.lod.registerMesh(mesh.uniqueId.toString(), mesh);
    }

    // Register for culling
    this.culling.registerMesh(mesh);

    // Compress textures
    if (options?.compressTextures) {
      await this.processMeshTextures(mesh);
    }

    // Track memory
    this.memoryManager.performCleanup();
  }

  /**
   * Get optimization statistics
   */
  public getStatistics(): {
    lod: ReturnType<LODSystem['getStatistics']>;
    culling: ReturnType<CullingSystem['getStatistics']>;
    memory: ReturnType<MemoryManager['getMemoryStats']>;
    quality: ReturnType<AdaptiveQualitySystem['getPerformanceMetrics']>;
  } {
    return {
      lod: this.lod.getStatistics(),
      culling: this.culling.getStatistics(),
      memory: this.memoryManager.getMemoryStats(),
      quality: this.adaptiveQuality.getPerformanceMetrics()
    };
  }

  /**
   * Enable/disable all optimizations
   */
  public setEnabled(enabled: boolean): void {
    if (enabled) {
      this.lod.startAutoUpdate();
      this.culling.startAutoUpdate();
      this.adaptiveQuality.setAutoAdjust(true);
    } else {
      this.lod.stopAutoUpdate();
      this.culling.stopAutoUpdate();
      this.adaptiveQuality.setAutoAdjust(false);
    }
  }

  /**
   * Dispose all optimization services
   */
  public dispose(): void {
    this.lod.dispose();
    this.culling.dispose();
    this.progressiveLoader.dispose();
    this.textureCompression.dispose();
    this.memoryManager.dispose();
    this.adaptiveQuality.dispose();
  }
}