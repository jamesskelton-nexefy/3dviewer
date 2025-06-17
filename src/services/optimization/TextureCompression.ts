import * as BABYLON from '@babylonjs/core';
import { Texture, Engine, Scene, RawTexture } from '@babylonjs/core';

export interface CompressionConfig {
  format: 'DXT' | 'PVRTC' | 'ETC' | 'ASTC' | 'BASIS' | 'AUTO';
  quality: number; // 0-1
  generateMipmaps: boolean;
  maxTextureSize: number;
  useWebP: boolean;
  useBasis: boolean;
  cacheCompressed: boolean;
}

export interface TextureMetrics {
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  format: string;
  loadTime: number;
}

export class TextureCompressionPipeline {
  private scene: Scene;
  private engine: Engine;
  private config: CompressionConfig;
  private supportedFormats: Set<string> = new Set();
  private textureCache: Map<string, Texture> = new Map();
  private compressionMetrics: Map<string, TextureMetrics> = new Map();
  private basisLoader?: any; // Basis Universal loader
  
  constructor(scene: Scene, config?: Partial<CompressionConfig>) {
    this.scene = scene;
    this.engine = scene.getEngine();
    
    this.config = {
      format: config?.format ?? 'AUTO',
      quality: config?.quality ?? 0.85,
      generateMipmaps: config?.generateMipmaps ?? true,
      maxTextureSize: config?.maxTextureSize ?? 2048,
      useWebP: config?.useWebP ?? true,
      useBasis: config?.useBasis ?? true,
      cacheCompressed: config?.cacheCompressed ?? true,
      ...config
    };

    this.detectSupportedFormats();
    this.initializeBasisLoader();
  }

  /**
   * Detect supported compression formats
   */
  private detectSupportedFormats(): void {
    const gl = this.engine._gl;
    if (!gl) return;

    // Check for compressed texture support
    const extensions = [
      'WEBGL_compressed_texture_s3tc',
      'WEBGL_compressed_texture_pvrtc',
      'WEBGL_compressed_texture_etc1',
      'WEBGL_compressed_texture_astc',
      'WEBKIT_WEBGL_compressed_texture_pvrtc',
      'EXT_texture_compression_bptc'
    ];

    extensions.forEach(ext => {
      if (gl.getExtension(ext)) {
        this.supportedFormats.add(ext);
      }
    });

    // Check WebP support
    if (this.isWebPSupported()) {
      this.supportedFormats.add('webp');
    }
  }

  /**
   * Check WebP support
   */
  private isWebPSupported(): boolean {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    return canvas.toDataURL('image/webp').indexOf('image/webp') === 5;
  }

  /**
   * Initialize Basis Universal loader
   */
  private async initializeBasisLoader(): Promise<void> {
    if (!this.config.useBasis) return;

    try {
      // Load Basis transcoder
      const basisModule = await import('@babylonjs/core/Materials/Textures/Loaders/basis');
      this.basisLoader = basisModule;
      this.supportedFormats.add('basis');
    } catch (error) {
      console.warn('Basis Universal loader not available:', error);
    }
  }

  /**
   * Load and compress texture
   */
  public async loadCompressedTexture(
    url: string,
    noMipmap?: boolean,
    invertY?: boolean,
    samplingMode?: number
  ): Promise<Texture> {
    const startTime = performance.now();
    
    // Check cache first
    const cacheKey = this.getCacheKey(url, noMipmap, invertY, samplingMode);
    if (this.config.cacheCompressed && this.textureCache.has(cacheKey)) {
      return this.textureCache.get(cacheKey)!;
    }

    try {
      // Determine best format
      const format = this.determineBestFormat(url);
      
      // Load texture with appropriate method
      let texture: Texture;
      
      if (format === 'basis' && this.basisLoader) {
        texture = await this.loadBasisTexture(url, noMipmap, invertY, samplingMode);
      } else if (format === 'webp' && this.config.useWebP) {
        texture = await this.loadWebPTexture(url, noMipmap, invertY, samplingMode);
      } else {
        texture = await this.loadStandardTexture(url, noMipmap, invertY, samplingMode);
      }

      // Apply compression if needed
      if (this.shouldCompress(texture)) {
        texture = await this.compressTexture(texture);
      }

      // Apply size constraints
      texture = await this.constrainTextureSize(texture);

      // Cache if enabled
      if (this.config.cacheCompressed) {
        this.textureCache.set(cacheKey, texture);
      }

      // Record metrics
      const loadTime = performance.now() - startTime;
      this.recordMetrics(url, texture, format, loadTime);

      return texture;
    } catch (error) {
      console.error('Failed to load compressed texture:', error);
      throw error;
    }
  }

  /**
   * Determine best texture format based on support and file
   */
  private determineBestFormat(url: string): string {
    if (this.config.format !== 'AUTO') {
      return this.config.format.toLowerCase();
    }

    const extension = url.split('.').pop()?.toLowerCase();
    
    // Check if already compressed
    if (extension === 'basis' && this.supportedFormats.has('basis')) {
      return 'basis';
    }
    
    if (extension === 'ktx' || extension === 'ktx2') {
      return 'ktx';
    }

    // Convert to WebP if supported and beneficial
    if (this.config.useWebP && this.supportedFormats.has('webp') && 
        (extension === 'jpg' || extension === 'jpeg' || extension === 'png')) {
      return 'webp';
    }

    // Determine GPU compression format
    if (this.supportedFormats.has('WEBGL_compressed_texture_s3tc')) {
      return 'dxt';
    } else if (this.supportedFormats.has('WEBGL_compressed_texture_pvrtc')) {
      return 'pvrtc';
    } else if (this.supportedFormats.has('WEBGL_compressed_texture_etc1')) {
      return 'etc1';
    }

    return 'standard';
  }

  /**
   * Load Basis Universal texture
   */
  private async loadBasisTexture(
    url: string,
    noMipmap?: boolean,
    invertY?: boolean,
    samplingMode?: number
  ): Promise<Texture> {
    return new Promise((resolve, reject) => {
      const texture = new Texture(
        url.replace(/\.(jpg|jpeg|png)$/i, '.basis'),
        this.scene,
        noMipmap,
        invertY,
        samplingMode
      );

      texture.onLoadObservable.addOnce(() => resolve(texture));
      texture.onErrorObservable.addOnce((error) => reject(error));
    });
  }

  /**
   * Load WebP texture with fallback
   */
  private async loadWebPTexture(
    url: string,
    noMipmap?: boolean,
    invertY?: boolean,
    samplingMode?: number
  ): Promise<Texture> {
    const webpUrl = url.replace(/\.(jpg|jpeg|png)$/i, '.webp');
    
    return new Promise((resolve, reject) => {
      const texture = new Texture(
        webpUrl,
        this.scene,
        noMipmap,
        invertY,
        samplingMode
      );

      texture.onLoadObservable.addOnce(() => resolve(texture));
      texture.onErrorObservable.addOnce(() => {
        // Fallback to original format
        this.loadStandardTexture(url, noMipmap, invertY, samplingMode)
          .then(resolve)
          .catch(reject);
      });
    });
  }

  /**
   * Load standard texture
   */
  private async loadStandardTexture(
    url: string,
    noMipmap?: boolean,
    invertY?: boolean,
    samplingMode?: number
  ): Promise<Texture> {
    return new Promise((resolve, reject) => {
      const texture = new Texture(
        url,
        this.scene,
        noMipmap ?? !this.config.generateMipmaps,
        invertY,
        samplingMode ?? Texture.TRILINEAR_SAMPLINGMODE
      );

      texture.onLoadObservable.addOnce(() => resolve(texture));
      texture.onErrorObservable.addOnce((error) => reject(error));
    });
  }

  /**
   * Check if texture should be compressed
   */
  private shouldCompress(texture: Texture): boolean {
    const size = texture.getSize();
    return size.width > 512 || size.height > 512;
  }

  /**
   * Compress texture using GPU compression
   */
  private async compressTexture(texture: Texture): Promise<Texture> {
    const size = texture.getSize();
    const gl = this.engine._gl;
    
    if (!gl) return texture;

    // Create compressed texture
    const compressedTexture = RawTexture.CreateRGBATexture(
      null,
      size.width,
      size.height,
      this.scene,
      this.config.generateMipmaps,
      false,
      texture.samplingMode
    );

    // Get texture data
    const pixels = await this.getTexturePixels(texture);
    
    // Apply compression based on format
    const compressedData = this.compressPixelData(
      pixels,
      size.width,
      size.height,
      this.determineBestFormat(texture.name)
    );

    // Update texture with compressed data
    compressedTexture.update(compressedData);

    // Dispose original texture
    texture.dispose();

    return compressedTexture;
  }

  /**
   * Get pixel data from texture
   */
  private async getTexturePixels(texture: Texture): Promise<Uint8Array> {
    const size = texture.getSize();
    const pixels = new Uint8Array(size.width * size.height * 4);
    
    // Read pixels from texture
    const gl = this.engine._gl;
    if (gl) {
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture._texture!._webGLTexture,
        0
      );
      
      gl.readPixels(0, 0, size.width, size.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(framebuffer);
    }
    
    return pixels;
  }

  /**
   * Compress pixel data
   */
  private compressPixelData(
    pixels: Uint8Array,
    width: number,
    height: number,
    format: string
  ): Uint8Array {
    // Apply quality reduction
    if (this.config.quality < 1) {
      return this.reduceQuality(pixels, width, height, this.config.quality);
    }
    
    // Note: Actual GPU compression would require native extensions
    // This is a placeholder for quality reduction
    return pixels;
  }

  /**
   * Reduce texture quality
   */
  private reduceQuality(
    pixels: Uint8Array,
    width: number,
    height: number,
    quality: number
  ): Uint8Array {
    const quantizationLevel = Math.floor((1 - quality) * 8) + 1;
    const output = new Uint8Array(pixels.length);
    
    for (let i = 0; i < pixels.length; i++) {
      // Quantize color values
      output[i] = Math.floor(pixels[i] / quantizationLevel) * quantizationLevel;
    }
    
    return output;
  }

  /**
   * Constrain texture size to maximum
   */
  private async constrainTextureSize(texture: Texture): Promise<Texture> {
    const size = texture.getSize();
    
    if (size.width <= this.config.maxTextureSize && 
        size.height <= this.config.maxTextureSize) {
      return texture;
    }

    // Calculate new size
    const scale = Math.min(
      this.config.maxTextureSize / size.width,
      this.config.maxTextureSize / size.height
    );
    
    const newWidth = Math.floor(size.width * scale);
    const newHeight = Math.floor(size.height * scale);

    // Create resized texture
    const resizedTexture = new BABYLON.DynamicTexture(
      `${texture.name}_resized`,
      { width: newWidth, height: newHeight },
      this.scene,
      this.config.generateMipmaps
    );

    // Copy and resize
    const context = resizedTexture.getContext();
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    
    // Draw original texture to canvas
    const originalContext = canvas.getContext('2d');
    if (originalContext && texture._texture) {
      // Note: In production, use proper texture to canvas conversion
      context.drawImage(canvas, 0, 0, newWidth, newHeight);
    }

    resizedTexture.update();
    
    // Dispose original
    texture.dispose();
    
    return resizedTexture;
  }

  /**
   * Get cache key for texture
   */
  private getCacheKey(
    url: string,
    noMipmap?: boolean,
    invertY?: boolean,
    samplingMode?: number
  ): string {
    return `${url}_${noMipmap}_${invertY}_${samplingMode}`;
  }

  /**
   * Record compression metrics
   */
  private recordMetrics(
    url: string,
    texture: Texture,
    format: string,
    loadTime: number
  ): void {
    const size = texture.getSize();
    const pixels = size.width * size.height * 4;
    
    // Estimate compressed size based on format
    const compressionRatios: Record<string, number> = {
      'dxt': 0.125,
      'pvrtc': 0.125,
      'etc1': 0.125,
      'astc': 0.25,
      'basis': 0.15,
      'webp': 0.4,
      'standard': 1
    };

    const ratio = compressionRatios[format] || 1;
    const compressedSize = pixels * ratio;

    this.compressionMetrics.set(url, {
      originalSize: pixels,
      compressedSize,
      compressionRatio: 1 - ratio,
      format,
      loadTime
    });
  }

  /**
   * Get compression metrics
   */
  public getMetrics(): Map<string, TextureMetrics> {
    return new Map(this.compressionMetrics);
  }

  /**
   * Clear texture cache
   */
  public clearCache(): void {
    this.textureCache.forEach(texture => texture.dispose());
    this.textureCache.clear();
  }

  /**
   * Get supported formats
   */
  public getSupportedFormats(): string[] {
    return Array.from(this.supportedFormats);
  }

  /**
   * Preload and compress textures
   */
  public async preloadTextures(urls: string[]): Promise<void> {
    await Promise.all(
      urls.map(url => this.loadCompressedTexture(url))
    );
  }

  /**
   * Dispose compression pipeline
   */
  public dispose(): void {
    this.clearCache();
    this.compressionMetrics.clear();
  }
}