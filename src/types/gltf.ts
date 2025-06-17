/**
 * Comprehensive glTF 2.0 TypeScript type definitions for advanced loading system
 * Supports Draco compression, progressive loading, texture optimization, and more
 */

import { Scene, AssetContainer, AbstractMesh, Material, AnimationGroup, Node } from '@babylonjs/core';

// Core glTF loading types
export interface GLTFLoadingOptions {
  // Basic loading options
  url: string;
  name?: string;
  rootUrl?: string;
  
  // Progressive loading options
  enableProgressiveLoading?: boolean;
  placeholderModel?: string;
  lowResolutionFirst?: boolean;
  
  // Compression options
  dracoDecoderPath?: string;
  enableDracoCompression?: boolean;
  
  // Texture optimization
  enableTextureStreaming?: boolean;
  textureFormat?: TextureFormat;
  generateMipmaps?: boolean;
  maxTextureSize?: number;
  
  // Performance optimization
  enableLOD?: boolean;
  lodDistances?: number[];
  frustumCulling?: boolean;
  occlusionCulling?: boolean;
  
  // Animation options
  autoStartAnimations?: boolean;
  animationSpeed?: number;
  animationRange?: [number, number];
  
  // Memory management
  disposeOnLoad?: boolean;
  maxMemoryUsage?: number; // MB
  enableGarbageCollection?: boolean;
  
  // Security and validation
  validateFile?: boolean;
  maxFileSize?: number; // MB
  allowedExtensions?: string[];
  sanitizeContent?: boolean;
  
  // Error handling
  retryAttempts?: number;
  retryDelay?: number;
  fallbackModel?: string;
  
  // Progress callbacks
  onProgress?: (progress: GLTFLoadingProgress) => void;
  onError?: (error: GLTFLoadingError) => void;
  onSuccess?: (result: GLTFLoadingResult) => void;
  onValidationWarning?: (warnings: GLTFValidationWarning[]) => void;
}

export interface GLTFLoadingProgress {
  stage: LoadingStage;
  percentage: number;
  bytesLoaded: number;
  totalBytes: number;
  currentFile?: string;
  estimatedTimeRemaining?: number;
  memoryUsage?: number;
  meshesLoaded?: number;
  texturesLoaded?: number;
  materialsLoaded?: number;
  animationsLoaded?: number;
}

export interface GLTFLoadingResult {
  scene: Scene;
  container: AssetContainer;
  meshes: AbstractMesh[];
  materials: Material[];
  animations: AnimationGroup[];
  rootNodes: Node[];
  metadata: GLTFMetadata;
  loadingStats: GLTFLoadingStats;
  memoryFootprint: GLTFMemoryFootprint;
}

export interface GLTFLoadingError {
  code: GLTFErrorCode;
  message: string;
  stage: LoadingStage;
  details?: any;
  stack?: string;
  recoverable: boolean;
  suggestions?: string[];
}

export interface GLTFValidationWarning {
  code: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
  element?: string;
  suggestion?: string;
}

export interface GLTFMetadata {
  version: string;
  generator?: string;
  copyright?: string;
  extensions?: string[];
  extras?: Record<string, any>;
  fileSize: number;
  meshCount: number;
  materialCount: number;
  textureCount: number;
  animationCount: number;
  nodeCount: number;
  hasLighting: boolean;
  hasSkeleton: boolean;
  hasMorphTargets: boolean;
  hasExtensions: boolean;
  boundingBox?: {
    min: [number, number, number];
    max: [number, number, number];
  };
}

export interface GLTFLoadingStats {
  totalLoadTime: number;
  downloadTime: number;
  parseTime: number;
  processingTime: number;
  dracoDecompressionTime?: number;
  textureProcessingTime: number;
  materialCreationTime: number;
  meshCreationTime: number;
  animationSetupTime: number;
  bytesTransferred: number;
  compressionRatio?: number;
  cacheHitRate?: number;
}

export interface GLTFMemoryFootprint {
  totalMemoryUsage: number; // bytes
  geometryMemory: number;
  textureMemory: number;
  materialMemory: number;
  animationMemory: number;
  bufferMemory: number;
  peakMemoryUsage: number;
  gpuMemoryUsage?: number;
}

// Enums and constants
export enum LoadingStage {
  INITIALIZING = 'initializing',
  DOWNLOADING = 'downloading',
  VALIDATING = 'validating',
  PARSING = 'parsing',
  DECOMPRESSING = 'decompressing',
  PROCESSING_GEOMETRY = 'processing_geometry',
  LOADING_TEXTURES = 'loading_textures',
  CREATING_MATERIALS = 'creating_materials',
  SETTING_UP_ANIMATIONS = 'setting_up_animations',
  OPTIMIZING = 'optimizing',
  FINALIZING = 'finalizing',
  COMPLETE = 'complete',
  ERROR = 'error'
}

export enum GLTFErrorCode {
  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  TIMEOUT = 'TIMEOUT',
  
  // Validation errors
  INVALID_FILE_FORMAT = 'INVALID_FILE_FORMAT',
  UNSUPPORTED_VERSION = 'UNSUPPORTED_VERSION',
  MALFORMED_JSON = 'MALFORMED_JSON',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  INVALID_BUFFER_VIEW = 'INVALID_BUFFER_VIEW',
  INVALID_ACCESSOR = 'INVALID_ACCESSOR',
  
  // Security errors
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  UNAUTHORIZED_EXTENSION = 'UNAUTHORIZED_EXTENSION',
  SECURITY_VIOLATION = 'SECURITY_VIOLATION',
  
  // Processing errors
  DRACO_DECOMPRESSION_ERROR = 'DRACO_DECOMPRESSION_ERROR',
  TEXTURE_LOADING_ERROR = 'TEXTURE_LOADING_ERROR',
  MATERIAL_CREATION_ERROR = 'MATERIAL_CREATION_ERROR',
  GEOMETRY_PROCESSING_ERROR = 'GEOMETRY_PROCESSING_ERROR',
  ANIMATION_ERROR = 'ANIMATION_ERROR',
  
  // Memory errors
  OUT_OF_MEMORY = 'OUT_OF_MEMORY',
  MEMORY_LIMIT_EXCEEDED = 'MEMORY_LIMIT_EXCEEDED',
  GPU_MEMORY_ERROR = 'GPU_MEMORY_ERROR',
  
  // General errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  ABORTED = 'ABORTED'
}

export enum TextureFormat {
  AUTO = 'auto',
  PNG = 'png',
  JPEG = 'jpeg',
  WEBP = 'webp',
  AVIF = 'avif',
  KTX = 'ktx',
  KTX2 = 'ktx2',
  DDS = 'dds',
  BASIS = 'basis'
}

export enum CompressionLevel {
  NONE = 0,
  LOW = 1,
  MEDIUM = 2,
  HIGH = 3,
  MAXIMUM = 4
}

// Advanced feature interfaces
export interface LODConfiguration {
  enabled: boolean;
  distances: number[];
  simplificationRatios: number[];
  autoGenerate: boolean;
  preserveUV: boolean;
  preserveNormals: boolean;
}

export interface TextureStreamingConfig {
  enabled: boolean;
  baseTextureSize: number;
  maxTextureSize: number;
  compressionFormat: TextureFormat[];
  priorityBasedLoading: boolean;
  viewportAwareness: boolean;
}

export interface ProgressiveLoadingConfig {
  enabled: boolean;
  chunkSize: number;
  prioritizeVisible: boolean;
  loadOrder: 'sequential' | 'priority' | 'adaptive';
  preloadDistance: number;
}

export interface SecurityConfig {
  validateSchema: boolean;
  sanitizeBuffers: boolean;
  maxComplexity: number;
  allowedMimeTypes: string[];
  checkDigitalSignature: boolean;
  enforceOriginPolicy: boolean;
}

export interface PerformanceConfig {
  enableInstancedRendering: boolean;
  enableFrustumCulling: boolean;
  enableOcclusionCulling: boolean;
  maxDrawCalls: number;
  batchingThreshold: number;
  adaptiveQuality: boolean;
}

// Cache and optimization interfaces
export interface GLTFCacheEntry {
  key: string;
  data: GLTFLoadingResult;
  timestamp: number;
  accessCount: number;
  size: number;
  ttl: number;
}

export interface GLTFOptimizationResult {
  originalSize: number;
  optimizedSize: number;
  compressionRatio: number;
  optimizations: OptimizationApplied[];
  warnings: string[];
}

export interface OptimizationApplied {
  type: 'geometry' | 'texture' | 'material' | 'animation';
  description: string;
  sizeSaved: number;
  qualityImpact: 'none' | 'minimal' | 'moderate' | 'significant';
}

// Event system interfaces
export interface GLTFLoaderEventMap {
  'loading-started': GLTFLoadingOptions;
  'progress': GLTFLoadingProgress;
  'stage-changed': { stage: LoadingStage; timestamp: number };
  'validation-warning': GLTFValidationWarning;
  'error': GLTFLoadingError;
  'success': GLTFLoadingResult;
  'memory-warning': { usage: number; limit: number };
  'cache-hit': { key: string; timestamp: number };
  'optimization-complete': GLTFOptimizationResult;
}

// Utility types
export type GLTFLoaderEventListener<T extends keyof GLTFLoaderEventMap> = (
  event: GLTFLoaderEventMap[T]
) => void;

export interface GLTFLoaderState {
  isLoading: boolean;
  currentStage: LoadingStage;
  progress: GLTFLoadingProgress | null;
  error: GLTFLoadingError | null;
  result: GLTFLoadingResult | null;
  memoryUsage: number;
  cacheSize: number;
}

// Configuration presets
export const GLTF_PRESET_CONFIGS = {
  HIGH_QUALITY: {
    enableDracoCompression: true,
    textureFormat: TextureFormat.KTX2,
    enableLOD: true,
    maxTextureSize: 4096,
    generateMipmaps: true,
    enableTextureStreaming: true,
  },
  FAST_LOADING: {
    enableProgressiveLoading: true,
    lowResolutionFirst: true,
    textureFormat: TextureFormat.WEBP,
    maxTextureSize: 1024,
    enableLOD: true,
    lodDistances: [50, 200, 500],
  },
  MOBILE_OPTIMIZED: {
    maxTextureSize: 512,
    textureFormat: TextureFormat.WEBP,
    enableDracoCompression: true,
    maxMemoryUsage: 256,
    enableGarbageCollection: true,
    adaptiveQuality: true,
  },
  SECURE: {
    validateFile: true,
    sanitizeContent: true,
    maxFileSize: 50,
    allowedExtensions: ['.gltf', '.glb'],
    enforceOriginPolicy: true,
    checkDigitalSignature: true,
  },
} as const;