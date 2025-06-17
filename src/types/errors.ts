/**
 * Custom error classes for the 3D viewer
 */

export class ViewerError extends Error {
  public readonly code: string;
  public readonly recoverable: boolean;
  public readonly details?: unknown;

  constructor(code: string, message: string, recoverable = false, details?: unknown) {
    super(message);
    this.name = 'ViewerError';
    this.code = code;
    this.recoverable = recoverable;
    this.details = details;
  }
}

export class EngineInitializationError extends ViewerError {
  constructor(message: string, details?: unknown) {
    super('ENGINE_INITIALIZATION_ERROR', message, false, details);
    this.name = 'EngineInitializationError';
  }
}

export class WebGLNotSupportedError extends ViewerError {
  constructor(message = 'WebGL is not supported by this browser') {
    super('WEBGL_NOT_SUPPORTED', message, false);
    this.name = 'WebGLNotSupportedError';
  }
}

export class ModelLoadError extends ViewerError {
  constructor(message: string, recoverable = true, details?: unknown) {
    super('MODEL_LOAD_ERROR', message, recoverable, details);
    this.name = 'ModelLoadError';
  }
}

export class UnsupportedFormatError extends ViewerError {
  constructor(format: string) {
    super('UNSUPPORTED_FORMAT', `Unsupported model format: ${format}`, false, { format });
    this.name = 'UnsupportedFormatError';
  }
}

export class PerformanceError extends ViewerError {
  constructor(message: string, details?: unknown) {
    super('PERFORMANCE_ERROR', message, true, details);
    this.name = 'PerformanceError';
  }
}

export class MemoryError extends ViewerError {
  constructor(message: string, details?: unknown) {
    super('MEMORY_ERROR', message, true, details);
    this.name = 'MemoryError';
  }
}

export class SceneError extends ViewerError {
  constructor(message: string, recoverable = true, details?: unknown) {
    super('SCENE_ERROR', message, recoverable, details);
    this.name = 'SceneError';
  }
}

export class CameraError extends ViewerError {
  constructor(message: string, recoverable = true, details?: unknown) {
    super('CAMERA_ERROR', message, recoverable, details);
    this.name = 'CameraError';
  }
}

export class LightingError extends ViewerError {
  constructor(message: string, recoverable = true, details?: unknown) {
    super('LIGHTING_ERROR', message, recoverable, details);
    this.name = 'LightingError';
  }
}