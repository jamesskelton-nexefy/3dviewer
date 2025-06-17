/**
 * Texture Optimization and Streaming Service
 * Supports KTX/KTX2, DDS, BASIS, WebP, AVIF formats with adaptive streaming
 */

import {
  Engine,
  Scene,
  Texture,
  BaseTexture,
  RenderTargetTexture,
  Material,
  StandardMaterial,
  PBRMaterial,
  InternalTexture,
  Constants,
  Tools,
  Observable,
  Vector2,
} from '@babylonjs/core';

import {
  TextureFormat,
  TextureStreamingConfig,
  GLTFLoadingError,
  GLTFErrorCode,
  LoadingStage,
} from '@/types/gltf';

export interface TextureOptimizationOptions {
  targetFormat?: TextureFormat;
  maxTextureSize?: number;
  enableMipmaps?: boolean;
  compressionQuality?: number; // 0-1
  enableStreaming?: boolean;
  prioritizeVisible?: boolean;
  adaptiveQuality?: boolean;
  cacheOptimizedTextures?: boolean;
  fallbackFormats?: TextureFormat[];
}

export interface TextureStreamingState {
  textureId: string;
  url: string;
  format: TextureFormat;
  size: Vector2;
  lodLevels: number;
  currentLOD: number;
  isStreaming: boolean;
  isVisible: boolean;
  priority: number;
  lastAccessed: number;
  memoryUsage: number;
}

export interface TextureCompressionResult {
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  format: TextureFormat;
  processingTime: number;
  quality: number;
}

export interface TextureStreamingStats {
  totalTextures: number;
  streamingTextures: number;
  cacheHits: number;
  cacheMisses: number;
  totalMemoryUsage: number;
  savedBandwidth: number;
  averageLoadTime: number;
}

export interface TextureFormatSupport {
  ktx: boolean;
  ktx2: boolean;
  dds: boolean;
  basis: boolean;
  webp: boolean;
  avif: boolean;
  astc: boolean;
  etc2: boolean;
  s3tc: boolean;
  bptc: boolean;
}

export class TextureOptimizationService {
  private engine: Engine;
  private scene: Scene;
  private streamingTextures = new Map<string, TextureStreamingState>();
  private textureCache = new Map<string, Texture>();
  private optimizationQueue: Texture[] = [];
  private formatSupport: TextureFormatSupport;
  private stats: TextureStreamingStats;
  private worker: Worker | null = null;
  
  // Configuration
  private defaultOptions: TextureOptimizationOptions = {
    targetFormat: TextureFormat.AUTO,
    maxTextureSize: 2048,
    enableMipmaps: true,
    compressionQuality: 0.8,
    enableStreaming: true,
    prioritizeVisible: true,
    adaptiveQuality: true,
    cacheOptimizedTextures: true,
    fallbackFormats: [TextureFormat.WEBP, TextureFormat.JPEG, TextureFormat.PNG],
  };

  // Events
  public onTextureOptimized = new Observable<{ texture: Texture; result: TextureCompressionResult }>();
  public onTextureStreamingStarted = new Observable<TextureStreamingState>();
  public onTextureStreamingCompleted = new Observable<TextureStreamingState>();
  public onTextureError = new Observable<{ textureId: string; error: Error }>();
  public onMemoryWarning = new Observable<{ usage: number; limit: number }>();

  constructor(engine: Engine, scene: Scene) {
    this.engine = engine;
    this.scene = scene;
    
    this.formatSupport = this.detectFormatSupport();
    this.stats = {
      totalTextures: 0,
      streamingTextures: 0,
      cacheHits: 0,
      cacheMisses: 0,
      totalMemoryUsage: 0,
      savedBandwidth: 0,
      averageLoadTime: 0,
    };

    this.initializeWorker();
    this.setupPerformanceMonitoring();
  }

  /**
   * Detect supported texture formats
   */
  private detectFormatSupport(): TextureFormatSupport {
    const gl = this.engine._gl;
    const extensions = this.engine.getGlInfo().supportedExtensions;

    return {
      ktx: this.engine._caps.ktx !== null,
      ktx2: this.engine._caps.ktx2 !== null,
      dds: this.engine._caps.s3tc !== null,
      basis: this.engine._caps.basis !== null,
      webp: this.checkWebPSupport(),
      avif: this.checkAVIFSupport(),
      astc: extensions.includes('WEBGL_compressed_texture_astc'),
      etc2: extensions.includes('WEBGL_compressed_texture_etc'),
      s3tc: extensions.includes('WEBGL_compressed_texture_s3tc'),
      bptc: extensions.includes('EXT_texture_compression_bptc'),
    };
  }

  private checkWebPSupport(): boolean {
    try {
      const canvas = document.createElement('canvas');
      return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    } catch {
      return false;
    }
  }

  private checkAVIFSupport(): boolean {
    try {
      const canvas = document.createElement('canvas');
      return canvas.toDataURL('image/avif').indexOf('data:image/avif') === 0;
    } catch {
      return false;
    }
  }

  /**
   * Initialize web worker for texture processing
   */
  private initializeWorker(): void {
    try {
      // Create worker for texture processing
      const workerBlob = new Blob([this.getWorkerScript()], { type: 'application/javascript' });
      this.worker = new Worker(URL.createObjectURL(workerBlob));
      
      this.worker.onmessage = (event) => {
        this.handleWorkerMessage(event.data);
      };

      this.worker.onerror = (error) => {
        console.warn('Texture optimization worker error:', error);
        this.worker = null;
      };
    } catch (error) {
      console.warn('Failed to initialize texture optimization worker:', error);
    }
  }

  /**
   * Optimize texture with best available format and settings
   */
  public async optimizeTexture(
    texture: Texture,
    options: Partial<TextureOptimizationOptions> = {}
  ): Promise<TextureCompressionResult> {
    const config = { ...this.defaultOptions, ...options };
    const startTime = performance.now();

    try {
      // Determine optimal format
      const targetFormat = this.selectOptimalFormat(config.targetFormat!, texture);
      
      // Check cache first
      const cacheKey = this.generateCacheKey(texture.url, targetFormat, config);
      const cachedTexture = this.textureCache.get(cacheKey);
      
      if (cachedTexture && config.cacheOptimizedTextures) {
        this.stats.cacheHits++;
        return {
          originalSize: this.estimateTextureSize(texture),
          compressedSize: this.estimateTextureSize(cachedTexture),
          compressionRatio: 1.0,
          format: targetFormat,
          processingTime: 0,
          quality: config.compressionQuality!,
        };
      }

      this.stats.cacheMisses++;

      // Apply size constraints
      let targetSize = this.calculateTargetSize(texture, config.maxTextureSize!);
      
      // Optimize based on format
      const optimizedTexture = await this.applyOptimization(
        texture,
        targetFormat,
        targetSize,
        config
      );

      // Cache optimized texture
      if (config.cacheOptimizedTextures) {
        this.textureCache.set(cacheKey, optimizedTexture);
      }

      const processingTime = performance.now() - startTime;
      const originalSize = this.estimateTextureSize(texture);
      const compressedSize = this.estimateTextureSize(optimizedTexture);

      const result: TextureCompressionResult = {
        originalSize,
        compressedSize,
        compressionRatio: originalSize / compressedSize,
        format: targetFormat,
        processingTime,
        quality: config.compressionQuality!,
      };

      this.onTextureOptimized.notifyObservers({ texture: optimizedTexture, result });
      this.updateStats(result);

      return result;

    } catch (error) {
      throw new GLTFLoadingError({
        code: GLTFErrorCode.TEXTURE_LOADING_ERROR,
        message: `Texture optimization failed: ${error}`,
        stage: LoadingStage.LOADING_TEXTURES,
        recoverable: true,
        suggestions: [
          'Try different texture format',
          'Reduce texture size',
          'Check texture file integrity',
        ],
      });
    }
  }

  /**
   * Setup texture streaming for progressive loading
   */
  public setupTextureStreaming(
    texture: Texture,
    config: TextureStreamingConfig
  ): string {
    const textureId = this.generateTextureId(texture);
    
    const streamingState: TextureStreamingState = {
      textureId,
      url: texture.url,
      format: this.selectOptimalFormat(TextureFormat.AUTO, texture),
      size: new Vector2(texture.getSize().width, texture.getSize().height),
      lodLevels: this.calculateLODLevels(texture),
      currentLOD: 0,
      isStreaming: false,
      isVisible: true,
      priority: this.calculateTexturePriority(texture),
      lastAccessed: Date.now(),
      memoryUsage: this.estimateTextureSize(texture),
    };

    this.streamingTextures.set(textureId, streamingState);
    this.stats.streamingTextures++;

    // Start streaming if enabled
    if (config.enabled) {
      this.startTextureStreaming(textureId, config);
    }

    return textureId;
  }

  /**
   * Start streaming texture at different quality levels
   */
  private async startTextureStreaming(
    textureId: string,
    config: TextureStreamingConfig
  ): Promise<void> {
    const state = this.streamingTextures.get(textureId);
    if (!state || state.isStreaming) return;

    state.isStreaming = true;
    this.onTextureStreamingStarted.notifyObservers(state);

    try {
      // Load progressively from lowest to highest quality
      for (let lod = state.lodLevels - 1; lod >= 0; lod--) {
        if (!state.isVisible && !config.priorityBasedLoading) {
          break; // Skip if not visible and not priority-based
        }

        await this.loadTextureLOD(textureId, lod, config);
        state.currentLOD = lod;

        // Add delay between LOD levels to prevent blocking
        if (lod > 0) {
          await new Promise(resolve => setTimeout(resolve, 16)); // ~60fps
        }
      }

      state.isStreaming = false;
      this.onTextureStreamingCompleted.notifyObservers(state);

    } catch (error) {
      state.isStreaming = false;
      this.onTextureError.notifyObservers({
        textureId,
        error: error as Error,
      });
    }
  }

  /**
   * Load specific LOD level for texture
   */
  private async loadTextureLOD(
    textureId: string,
    lodLevel: number,
    config: TextureStreamingConfig
  ): Promise<void> {
    const state = this.streamingTextures.get(textureId);
    if (!state) return;

    // Calculate LOD texture size
    const lodScale = Math.pow(0.5, lodLevel);
    const lodSize = {
      width: Math.max(1, Math.floor(state.size.x * lodScale)),
      height: Math.max(1, Math.floor(state.size.y * lodScale)),
    };

    // Generate LOD texture URL (this would depend on your server setup)
    const lodUrl = this.generateLODUrl(state.url, lodLevel, lodSize);

    try {
      // Load the LOD texture
      const lodTexture = new Texture(lodUrl, this.scene, {
        noMipmap: lodLevel === 0 ? false : true,
        invertY: false,
        samplingMode: lodLevel === 0 ? Texture.TRILINEAR_SAMPLINGMODE : Texture.BILINEAR_SAMPLINGMODE,
      });

      // Replace existing texture in materials
      await this.replaceTextureInMaterials(state.url, lodTexture);

    } catch (error) {
      console.warn(`Failed to load LOD ${lodLevel} for texture ${textureId}:`, error);
    }
  }

  /**
   * Select optimal texture format based on support and requirements
   */
  private selectOptimalFormat(requestedFormat: TextureFormat, texture: Texture): TextureFormat {
    if (requestedFormat !== TextureFormat.AUTO) {
      if (this.isFormatSupported(requestedFormat)) {
        return requestedFormat;
      }
    }

    // Determine optimal format based on content and support
    if (this.formatSupport.ktx2) {
      return TextureFormat.KTX2;
    } else if (this.formatSupport.ktx) {
      return TextureFormat.KTX;
    } else if (this.formatSupport.dds) {
      return TextureFormat.DDS;
    } else if (this.formatSupport.basis) {
      return TextureFormat.BASIS;
    } else if (this.formatSupport.avif) {
      return TextureFormat.AVIF;
    } else if (this.formatSupport.webp) {
      return TextureFormat.WEBP;
    } else {
      return TextureFormat.JPEG;
    }
  }

  private isFormatSupported(format: TextureFormat): boolean {
    switch (format) {
      case TextureFormat.KTX: return this.formatSupport.ktx;
      case TextureFormat.KTX2: return this.formatSupport.ktx2;
      case TextureFormat.DDS: return this.formatSupport.dds;
      case TextureFormat.BASIS: return this.formatSupport.basis;
      case TextureFormat.WEBP: return this.formatSupport.webp;
      case TextureFormat.AVIF: return this.formatSupport.avif;
      case TextureFormat.PNG:
      case TextureFormat.JPEG:
        return true;
      default:
        return false;
    }
  }

  /**
   * Apply texture optimization based on format and settings
   */
  private async applyOptimization(
    texture: Texture,
    format: TextureFormat,
    targetSize: Vector2,
    options: TextureOptimizationOptions
  ): Promise<Texture> {
    // If no optimization needed, return original
    const currentSize = texture.getSize();
    if (currentSize.width <= targetSize.x && 
        currentSize.height <= targetSize.y && 
        format === TextureFormat.AUTO) {
      return texture;
    }

    // Use worker for intensive operations if available
    if (this.worker && this.shouldUseWorker(texture)) {
      return this.optimizeWithWorker(texture, format, targetSize, options);
    }

    // Fallback to main thread
    return this.optimizeOnMainThread(texture, format, targetSize, options);
  }

  private async optimizeWithWorker(
    texture: Texture,
    format: TextureFormat,
    targetSize: Vector2,
    options: TextureOptimizationOptions
  ): Promise<Texture> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not available'));
        return;
      }

      const messageId = Math.random().toString(36);
      
      const handleMessage = (event: MessageEvent) => {
        if (event.data.id === messageId) {
          this.worker!.removeEventListener('message', handleMessage);
          
          if (event.data.error) {
            reject(new Error(event.data.error));
          } else {
            // Create texture from optimized data
            const optimizedTexture = this.createTextureFromData(
              event.data.imageData,
              texture.name + '_optimized',
              format
            );
            resolve(optimizedTexture);
          }
        }
      };

      this.worker.addEventListener('message', handleMessage);
      
      // Send optimization task to worker
      this.worker.postMessage({
        id: messageId,
        type: 'optimize',
        textureUrl: texture.url,
        format,
        targetSize,
        options,
      });
    });
  }

  private async optimizeOnMainThread(
    texture: Texture,
    format: TextureFormat,
    targetSize: Vector2,
    options: TextureOptimizationOptions
  ): Promise<Texture> {
    // Create a canvas for processing
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }

    // Set target size
    canvas.width = targetSize.x;
    canvas.height = targetSize.y;

    // Load and draw original texture
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        try {
          // Draw resized image
          ctx.drawImage(img, 0, 0, targetSize.x, targetSize.y);
          
          // Convert to target format
          const quality = options.compressionQuality || 0.8;
          const mimeType = this.formatToMimeType(format);
          
          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error('Failed to create blob'));
              return;
            }

            // Create texture from blob
            const url = URL.createObjectURL(blob);
            const optimizedTexture = new Texture(url, this.scene, {
              noMipmap: !options.enableMipmaps,
              invertY: false,
            });
            
            optimizedTexture.name = texture.name + '_optimized';
            resolve(optimizedTexture);
          }, mimeType, quality);
          
        } catch (error) {
          reject(error);
        }
      };

      img.onerror = () => {
        reject(new Error('Failed to load texture image'));
      };

      img.src = texture.url;
    });
  }

  /**
   * Utility methods
   */
  private calculateTargetSize(texture: Texture, maxSize: number): Vector2 {
    const currentSize = texture.getSize();
    const scale = Math.min(
      maxSize / currentSize.width,
      maxSize / currentSize.height,
      1.0
    );
    
    return new Vector2(
      Math.max(1, Math.floor(currentSize.width * scale)),
      Math.max(1, Math.floor(currentSize.height * scale))
    );
  }

  private calculateLODLevels(texture: Texture): number {
    const size = texture.getSize();
    const maxDimension = Math.max(size.width, size.height);
    return Math.floor(Math.log2(maxDimension)) + 1;
  }

  private calculateTexturePriority(texture: Texture): number {
    // Calculate priority based on size, usage, etc.
    const size = texture.getSize();
    const area = size.width * size.height;
    
    // Larger textures get higher priority for optimization
    // Frequently used textures get higher priority for streaming
    return Math.log2(area);
  }

  private estimateTextureSize(texture: Texture): number {
    const size = texture.getSize();
    const bytesPerPixel = 4; // RGBA
    return size.width * size.height * bytesPerPixel;
  }

  private generateCacheKey(url: string, format: TextureFormat, options: TextureOptimizationOptions): string {
    const optionsHash = JSON.stringify(options);
    return `${url}_${format}_${optionsHash}`;
  }

  private generateTextureId(texture: Texture): string {
    return `texture_${texture.uniqueId}_${Date.now()}`;
  }

  private generateLODUrl(baseUrl: string, lodLevel: number, size: { width: number; height: number }): string {
    // This would depend on your server setup
    // Example: append LOD parameters to URL
    const url = new URL(baseUrl);
    url.searchParams.set('lod', lodLevel.toString());
    url.searchParams.set('width', size.width.toString());
    url.searchParams.set('height', size.height.toString());
    return url.toString();
  }

  private formatToMimeType(format: TextureFormat): string {
    switch (format) {
      case TextureFormat.PNG: return 'image/png';
      case TextureFormat.JPEG: return 'image/jpeg';
      case TextureFormat.WEBP: return 'image/webp';
      case TextureFormat.AVIF: return 'image/avif';
      default: return 'image/png';
    }
  }

  private shouldUseWorker(texture: Texture): boolean {
    const size = texture.getSize();
    const area = size.width * size.height;
    return area > 1024 * 1024; // Use worker for textures larger than 1MP
  }

  private createTextureFromData(imageData: ImageData, name: string, format: TextureFormat): Texture {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }

    canvas.width = imageData.width;
    canvas.height = imageData.height;
    ctx.putImageData(imageData, 0, 0);

    const url = canvas.toDataURL(this.formatToMimeType(format));
    return new Texture(url, this.scene, { noMipmap: false, invertY: false });
  }

  private async replaceTextureInMaterials(oldUrl: string, newTexture: Texture): Promise<void> {
    // Find all materials using the old texture
    this.scene.materials.forEach(material => {
      if (material instanceof StandardMaterial || material instanceof PBRMaterial) {
        const textures = material.getActiveTextures();
        textures.forEach(texture => {
          if (texture.url === oldUrl) {
            // Replace texture (this is simplified - real implementation would need to handle different texture slots)
            if (material instanceof StandardMaterial) {
              if (material.diffuseTexture === texture) {
                material.diffuseTexture = newTexture;
              }
            } else if (material instanceof PBRMaterial) {
              if (material.baseTexture === texture) {
                material.baseTexture = newTexture;
              }
            }
          }
        });
      }
    });
  }

  private updateStats(result: TextureCompressionResult): void {
    this.stats.totalTextures++;
    this.stats.savedBandwidth += result.originalSize - result.compressedSize;
    this.stats.averageLoadTime = (this.stats.averageLoadTime * (this.stats.totalTextures - 1) + result.processingTime) / this.stats.totalTextures;
  }

  private handleWorkerMessage(data: any): void {
    // Handle worker messages (implementation would depend on worker design)
  }

  private setupPerformanceMonitoring(): void {
    // Monitor texture memory usage
    setInterval(() => {
      let totalMemory = 0;
      this.streamingTextures.forEach(state => {
        totalMemory += state.memoryUsage;
      });
      
      this.stats.totalMemoryUsage = totalMemory;
      
      // Check memory limits
      const limit = 512 * 1024 * 1024; // 512MB limit
      if (totalMemory > limit * 0.8) {
        this.onMemoryWarning.notifyObservers({ usage: totalMemory, limit });
      }
    }, 5000);
  }

  private getWorkerScript(): string {
    return `
      // Texture optimization worker script
      self.onmessage = function(event) {
        const { id, type, textureUrl, format, targetSize, options } = event.data;
        
        if (type === 'optimize') {
          // Implement texture optimization in worker
          // This is a simplified example
          
          fetch(textureUrl)
            .then(response => response.blob())
            .then(blob => createImageBitmap(blob))
            .then(bitmap => {
              const canvas = new OffscreenCanvas(targetSize.x, targetSize.y);
              const ctx = canvas.getContext('2d');
              
              ctx.drawImage(bitmap, 0, 0, targetSize.x, targetSize.y);
              
              return ctx.getImageData(0, 0, targetSize.x, targetSize.y);
            })
            .then(imageData => {
              self.postMessage({ id, imageData });
            })
            .catch(error => {
              self.postMessage({ id, error: error.message });
            });
        }
      };
    `;
  }

  /**
   * Public API methods
   */
  public getFormatSupport(): TextureFormatSupport {
    return { ...this.formatSupport };
  }

  public getStats(): TextureStreamingStats {
    return { ...this.stats };
  }

  public updateTextureVisibility(textureId: string, isVisible: boolean): void {
    const state = this.streamingTextures.get(textureId);
    if (state) {
      state.isVisible = isVisible;
      state.lastAccessed = Date.now();
    }
  }

  public clearCache(): void {
    this.textureCache.clear();
  }

  public dispose(): void {
    // Dispose worker
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    // Clear caches
    this.textureCache.clear();
    this.streamingTextures.clear();

    // Clear observables
    this.onTextureOptimized.clear();
    this.onTextureStreamingStarted.clear();
    this.onTextureStreamingCompleted.clear();
    this.onTextureError.clear();
    this.onMemoryWarning.clear();
  }
}