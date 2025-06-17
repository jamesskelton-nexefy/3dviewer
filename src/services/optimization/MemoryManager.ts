import * as BABYLON from '@babylonjs/core';
import { Scene, Mesh, Texture, Material, VertexBuffer } from '@babylonjs/core';

export interface MemoryConfig {
  maxMemoryMB: number;
  enableBufferPooling: boolean;
  enableTexturePooling: boolean;
  enableAutomaticCleanup: boolean;
  cleanupThresholdPercentage: number;
  bufferPoolSize: number;
  texturePoolSize: number;
}

export interface MemoryStats {
  totalMemoryMB: number;
  usedMemoryMB: number;
  availableMemoryMB: number;
  bufferMemoryMB: number;
  textureMemoryMB: number;
  meshCount: number;
  textureCount: number;
  materialCount: number;
  pooledBuffers: number;
  pooledTextures: number;
}

interface BufferPool {
  size: number;
  type: string;
  available: ArrayBuffer[];
  inUse: Set<ArrayBuffer>;
}

interface TexturePool {
  width: number;
  height: number;
  format: number;
  available: BABYLON.Texture[];
  inUse: Set<BABYLON.Texture>;
}

export class MemoryManager {
  private scene: Scene;
  private config: MemoryConfig;
  private bufferPools: Map<string, BufferPool> = new Map();
  private texturePools: Map<string, TexturePool> = new Map();
  private meshMemoryMap: WeakMap<Mesh, number> = new WeakMap();
  private textureMemoryMap: WeakMap<Texture, number> = new WeakMap();
  private totalMemoryUsage: number = 0;
  private cleanupTimer: NodeJS.Timer | null = null;
  private performanceObserver: PerformanceObserver | null = null;

  constructor(scene: Scene, config?: Partial<MemoryConfig>) {
    this.scene = scene;
    this.config = {
      maxMemoryMB: config?.maxMemoryMB ?? 512,
      enableBufferPooling: config?.enableBufferPooling ?? true,
      enableTexturePooling: config?.enableTexturePooling ?? true,
      enableAutomaticCleanup: config?.enableAutomaticCleanup ?? true,
      cleanupThresholdPercentage: config?.cleanupThresholdPercentage ?? 0.8,
      bufferPoolSize: config?.bufferPoolSize ?? 20,
      texturePoolSize: config?.texturePoolSize ?? 10,
      ...config
    };

    this.initializePools();
    this.setupMemoryMonitoring();
  }

  /**
   * Initialize buffer and texture pools
   */
  private initializePools(): void {
    if (this.config.enableBufferPooling) {
      // Common buffer sizes
      const bufferSizes = [
        1024 * 16,    // 16KB
        1024 * 64,    // 64KB
        1024 * 256,   // 256KB
        1024 * 1024,  // 1MB
        1024 * 1024 * 4  // 4MB
      ];

      bufferSizes.forEach(size => {
        this.createBufferPool(size, 'generic');
      });
    }

    if (this.config.enableTexturePooling) {
      // Common texture sizes
      const textureSizes = [
        { width: 256, height: 256 },
        { width: 512, height: 512 },
        { width: 1024, height: 1024 },
        { width: 2048, height: 2048 }
      ];

      textureSizes.forEach(({ width, height }) => {
        this.createTexturePool(width, height);
      });
    }
  }

  /**
   * Create buffer pool for specific size
   */
  private createBufferPool(size: number, type: string): void {
    const key = `${type}_${size}`;
    const pool: BufferPool = {
      size,
      type,
      available: [],
      inUse: new Set()
    };

    // Pre-allocate buffers
    for (let i = 0; i < this.config.bufferPoolSize; i++) {
      pool.available.push(new ArrayBuffer(size));
    }

    this.bufferPools.set(key, pool);
  }

  /**
   * Create texture pool for specific size
   */
  private createTexturePool(width: number, height: number): void {
    const key = `${width}x${height}`;
    const pool: TexturePool = {
      width,
      height,
      format: BABYLON.Engine.TEXTUREFORMAT_RGBA,
      available: [],
      inUse: new Set()
    };

    this.texturePools.set(key, pool);
  }

  /**
   * Setup memory monitoring
   */
  private setupMemoryMonitoring(): void {
    // Monitor WebGL memory if available
    if ('performance' in window && 'memory' in (performance as any)) {
      this.performanceObserver = new PerformanceObserver((list) => {
        this.updateMemoryStats();
      });
      
      try {
        this.performanceObserver.observe({ entryTypes: ['measure'] });
      } catch (e) {
        console.warn('Performance monitoring not fully supported');
      }
    }

    // Setup automatic cleanup
    if (this.config.enableAutomaticCleanup) {
      this.cleanupTimer = setInterval(() => {
        this.checkMemoryAndCleanup();
      }, 5000); // Check every 5 seconds
    }

    // Monitor scene changes
    this.scene.onNewMeshAddedObservable.add((mesh) => {
      this.trackMeshMemory(mesh);
    });

    this.scene.onMeshRemovedObservable.add((mesh) => {
      this.untrackMeshMemory(mesh);
    });

    this.scene.onNewTextureAddedObservable.add((texture) => {
      this.trackTextureMemory(texture);
    });

    this.scene.onTextureRemovedObservable.add((texture) => {
      this.untrackTextureMemory(texture);
    });
  }

  /**
   * Get buffer from pool
   */
  public getPooledBuffer(size: number, type: string = 'generic'): ArrayBuffer {
    if (!this.config.enableBufferPooling) {
      return new ArrayBuffer(size);
    }

    // Find appropriate pool
    let pool: BufferPool | undefined;
    let poolKey: string | undefined;

    for (const [key, p] of this.bufferPools) {
      if (p.type === type && p.size >= size) {
        pool = p;
        poolKey = key;
        break;
      }
    }

    if (!pool || pool.available.length === 0) {
      // Create new buffer if pool is empty or doesn't exist
      const buffer = new ArrayBuffer(size);
      
      if (pool) {
        pool.inUse.add(buffer);
      }
      
      return buffer;
    }

    // Get buffer from pool
    const buffer = pool.available.pop()!;
    pool.inUse.add(buffer);
    
    // Clear buffer contents for security
    new Uint8Array(buffer).fill(0);
    
    return buffer;
  }

  /**
   * Return buffer to pool
   */
  public returnPooledBuffer(buffer: ArrayBuffer, type: string = 'generic'): void {
    if (!this.config.enableBufferPooling) return;

    const size = buffer.byteLength;
    const key = `${type}_${size}`;
    const pool = this.bufferPools.get(key);

    if (pool && pool.inUse.has(buffer)) {
      pool.inUse.delete(buffer);
      
      if (pool.available.length < this.config.bufferPoolSize) {
        pool.available.push(buffer);
      }
    }
  }

  /**
   * Get pooled texture
   */
  public getPooledTexture(width: number, height: number): BABYLON.Texture | null {
    if (!this.config.enableTexturePooling) return null;

    const key = `${width}x${height}`;
    const pool = this.texturePools.get(key);

    if (!pool || pool.available.length === 0) {
      return null;
    }

    const texture = pool.available.pop()!;
    pool.inUse.add(texture);
    
    return texture;
  }

  /**
   * Create or get pooled render target texture
   */
  public getPooledRenderTarget(
    name: string,
    size: number | { width: number; height: number }
  ): BABYLON.RenderTargetTexture {
    const width = typeof size === 'number' ? size : size.width;
    const height = typeof size === 'number' ? size : size.height;
    
    // Try to get from pool first
    const pooled = this.getPooledTexture(width, height);
    if (pooled instanceof BABYLON.RenderTargetTexture) {
      return pooled;
    }

    // Create new render target
    const renderTarget = new BABYLON.RenderTargetTexture(
      name,
      { width, height },
      this.scene,
      false
    );

    this.trackTextureMemory(renderTarget);
    return renderTarget;
  }

  /**
   * Return texture to pool
   */
  public returnPooledTexture(texture: BABYLON.Texture): void {
    if (!this.config.enableTexturePooling) return;

    const size = texture.getSize();
    const key = `${size.width}x${size.height}`;
    const pool = this.texturePools.get(key);

    if (pool && pool.inUse.has(texture)) {
      pool.inUse.delete(texture);
      
      if (pool.available.length < this.config.texturePoolSize) {
        // Clear texture content
        if (texture instanceof BABYLON.RenderTargetTexture) {
          texture.renderList = [];
        }
        
        pool.available.push(texture);
      } else {
        // Pool is full, dispose texture
        texture.dispose();
      }
    }
  }

  /**
   * Track mesh memory usage
   */
  private trackMeshMemory(mesh: Mesh): void {
    let memoryUsage = 0;

    // Calculate vertex buffer memory
    const vertexBuffers = mesh.geometry?.getVertexBuffers();
    if (vertexBuffers) {
      Object.values(vertexBuffers).forEach(buffer => {
        memoryUsage += buffer.getStrideSize() * mesh.getTotalVertices() * 4; // 4 bytes per float
      });
    }

    // Calculate index buffer memory
    const indices = mesh.getTotalIndices();
    memoryUsage += indices * 4; // 4 bytes per index (assuming 32-bit)

    this.meshMemoryMap.set(mesh, memoryUsage);
    this.totalMemoryUsage += memoryUsage;
  }

  /**
   * Untrack mesh memory usage
   */
  private untrackMeshMemory(mesh: Mesh): void {
    const memoryUsage = this.meshMemoryMap.get(mesh) || 0;
    this.totalMemoryUsage -= memoryUsage;
    this.meshMemoryMap.delete(mesh);
  }

  /**
   * Track texture memory usage
   */
  private trackTextureMemory(texture: Texture): void {
    const size = texture.getSize();
    const format = texture.textureFormat || BABYLON.Engine.TEXTUREFORMAT_RGBA;
    const bytesPerPixel = this.getBytesPerPixel(format);
    
    let memoryUsage = size.width * size.height * bytesPerPixel;
    
    // Add mipmap memory
    if (texture.generateMipMaps) {
      memoryUsage *= 1.33; // Approximate mipmap overhead
    }

    this.textureMemoryMap.set(texture, memoryUsage);
    this.totalMemoryUsage += memoryUsage;
  }

  /**
   * Untrack texture memory usage
   */
  private untrackTextureMemory(texture: Texture): void {
    const memoryUsage = this.textureMemoryMap.get(texture) || 0;
    this.totalMemoryUsage -= memoryUsage;
    this.textureMemoryMap.delete(texture);
  }

  /**
   * Get bytes per pixel for texture format
   */
  private getBytesPerPixel(format: number): number {
    switch (format) {
      case BABYLON.Engine.TEXTUREFORMAT_ALPHA:
      case BABYLON.Engine.TEXTUREFORMAT_LUMINANCE:
        return 1;
      case BABYLON.Engine.TEXTUREFORMAT_LUMINANCE_ALPHA:
        return 2;
      case BABYLON.Engine.TEXTUREFORMAT_RGB:
        return 3;
      case BABYLON.Engine.TEXTUREFORMAT_RGBA:
        return 4;
      default:
        return 4;
    }
  }

  /**
   * Update memory statistics
   */
  private updateMemoryStats(): void {
    // Update WebGL memory stats if available
    const gl = this.scene.getEngine()._gl;
    if (gl && 'getParameter' in gl) {
      try {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) {
          // Some browsers provide memory info through extensions
        }
      } catch (e) {
        // Extension not available
      }
    }
  }

  /**
   * Check memory and perform cleanup if needed
   */
  private checkMemoryAndCleanup(): void {
    const usagePercentage = this.totalMemoryUsage / (this.config.maxMemoryMB * 1024 * 1024);
    
    if (usagePercentage > this.config.cleanupThresholdPercentage) {
      this.performCleanup();
    }
  }

  /**
   * Perform memory cleanup
   */
  public performCleanup(): void {
    console.log('Performing memory cleanup...');
    
    // Clear unused textures
    const texturesToDispose: Texture[] = [];
    this.scene.textures.forEach(texture => {
      if (texture.references === 0 && !texture.name.includes('pool')) {
        texturesToDispose.push(texture);
      }
    });
    
    texturesToDispose.forEach(texture => {
      texture.dispose();
    });

    // Clear unused materials
    const materialsToDispose: Material[] = [];
    this.scene.materials.forEach(material => {
      if (!material.getBindedMeshes().length) {
        materialsToDispose.push(material);
      }
    });
    
    materialsToDispose.forEach(material => {
      material.dispose();
    });

    // Compact buffer pools
    this.compactBufferPools();

    // Force garbage collection if available
    if ('gc' in window) {
      (window as any).gc();
    }

    console.log(`Cleaned up ${texturesToDispose.length} textures and ${materialsToDispose.length} materials`);
  }

  /**
   * Compact buffer pools by removing excess buffers
   */
  private compactBufferPools(): void {
    this.bufferPools.forEach(pool => {
      const excessBuffers = pool.available.length - this.config.bufferPoolSize;
      if (excessBuffers > 0) {
        pool.available.splice(0, excessBuffers);
      }
    });
  }

  /**
   * Get current memory statistics
   */
  public getMemoryStats(): MemoryStats {
    let bufferMemory = 0;
    let pooledBuffers = 0;
    
    this.bufferPools.forEach(pool => {
      bufferMemory += (pool.available.length + pool.inUse.size) * pool.size;
      pooledBuffers += pool.available.length;
    });

    let textureMemory = 0;
    let pooledTextures = 0;
    
    this.texturePools.forEach(pool => {
      const textureSize = pool.width * pool.height * 4; // Assuming RGBA
      textureMemory += (pool.available.length + pool.inUse.size) * textureSize;
      pooledTextures += pool.available.length;
    });

    // Add tracked memory
    this.scene.meshes.forEach(mesh => {
      const usage = this.meshMemoryMap.get(mesh);
      if (usage) bufferMemory += usage;
    });

    this.scene.textures.forEach(texture => {
      const usage = this.textureMemoryMap.get(texture);
      if (usage) textureMemory += usage;
    });

    const totalMemoryMB = (bufferMemory + textureMemory) / (1024 * 1024);
    const maxMemoryMB = this.config.maxMemoryMB;

    return {
      totalMemoryMB: maxMemoryMB,
      usedMemoryMB: totalMemoryMB,
      availableMemoryMB: maxMemoryMB - totalMemoryMB,
      bufferMemoryMB: bufferMemory / (1024 * 1024),
      textureMemoryMB: textureMemory / (1024 * 1024),
      meshCount: this.scene.meshes.length,
      textureCount: this.scene.textures.length,
      materialCount: this.scene.materials.length,
      pooledBuffers,
      pooledTextures
    };
  }

  /**
   * Set memory limit
   */
  public setMemoryLimit(limitMB: number): void {
    this.config.maxMemoryMB = limitMB;
  }

  /**
   * Clear all pools
   */
  public clearPools(): void {
    this.bufferPools.clear();
    this.texturePools.forEach(pool => {
      pool.available.forEach(texture => texture.dispose());
      pool.inUse.forEach(texture => texture.dispose());
    });
    this.texturePools.clear();
  }

  /**
   * Dispose memory manager
   */
  public dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    if (this.performanceObserver) {
      this.performanceObserver.disconnect();
    }

    this.clearPools();
  }
}