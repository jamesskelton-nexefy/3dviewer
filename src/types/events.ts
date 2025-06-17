/**
 * Event system types and utilities
 */

export type EventListener<T = unknown> = (data: T) => void;

export interface EventEmitter<T extends Record<string, unknown> = Record<string, unknown>> {
  on<K extends keyof T>(event: K, listener: EventListener<T[K]>): void;
  off<K extends keyof T>(event: K, listener: EventListener<T[K]>): void;
  emit<K extends keyof T>(event: K, data: T[K]): void;
  removeAllListeners(event?: keyof T): void;
}

/**
 * Performance monitoring events
 */
export interface PerformanceEvents {
  fpsUpdate: { fps: number; frameTime: number };
  memoryWarning: { usage: number; limit: number };
  performanceDrop: { currentFps: number; targetFps: number };
  adaptiveQualityChange: { level: number; reason: string };
}

/**
 * Loading events
 */
export interface LoadingEvents {
  loadStart: { url: string; type: string };
  loadProgress: { url: string; progress: number; loaded: number; total: number };
  loadComplete: { url: string; duration: number };
  loadError: { url: string; error: Error };
}

/**
 * User interaction events
 */
export interface InteractionEvents {
  pointerDown: { x: number; y: number; button: number };
  pointerMove: { x: number; y: number; deltaX: number; deltaY: number };
  pointerUp: { x: number; y: number; button: number };
  wheel: { x: number; y: number; delta: number };
  keyDown: { key: string; code: string };
  keyUp: { key: string; code: string };
}

/**
 * Scene events
 */
export interface SceneEvents {
  sceneReady: { scene: import('@babylonjs/core').Scene };
  beforeRender: { scene: import('@babylonjs/core').Scene };
  afterRender: { scene: import('@babylonjs/core').Scene };
  meshAdded: { mesh: import('@babylonjs/core').AbstractMesh };
  meshRemoved: { mesh: import('@babylonjs/core').AbstractMesh };
  lightAdded: { light: import('@babylonjs/core').Light };
  lightRemoved: { light: import('@babylonjs/core').Light };
  cameraChanged: { camera: import('@babylonjs/core').Camera };
}

/**
 * All engine events combined
 */
export type AllEngineEvents = PerformanceEvents & LoadingEvents & InteractionEvents & SceneEvents;