// Core application types
export interface User {
  id: string
  email: string
  role: UserRole
  createdAt: string
  updatedAt: string
}

export type UserRole = 'admin' | 'collaborator' | 'viewer'

export interface Model3D {
  id: string
  name: string
  url: string
  size: number
  format: string
  uploadedBy: string
  uploadedAt: string
  version: string
  isPublic: boolean
}

export interface Annotation {
  id: string
  modelId: string
  userId: string
  type: AnnotationType
  position: Vector3
  content: string
  createdAt: string
  updatedAt: string
}

export type AnnotationType = 'point' | 'area' | 'measurement' | 'comment'

export interface Vector3 {
  x: number
  y: number
  z: number
}

export interface ViewerConfig {
  enablePerformanceOptimization: boolean
  maxModelSize: number
  enableDracoCompression: boolean
  enableTextureCompression: boolean
  targetFPS: number
}

export interface PerformanceMetrics {
  fps: number
  drawCalls: number
  triangles: number
  memory: number
  loadTime: number
}

export interface LoadingState {
  isLoading: boolean
  progress: number
  message: string
}