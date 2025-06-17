import { Vector3 } from '@babylonjs/core'

// Core annotation types
export interface Annotation3D {
  id: string
  modelId: string
  userId: string
  userName: string
  type: AnnotationType
  position: Vector3
  normal?: Vector3 // Surface normal for proper orientation
  cameraPosition?: Vector3 // Camera position when annotation was created
  content: AnnotationContent
  thread: AnnotationThread[]
  visibility: AnnotationVisibility
  status: AnnotationStatus
  metadata: AnnotationMetadata
  createdAt: Date
  updatedAt: Date
}

export type AnnotationType = 
  | 'point' // Single point annotation
  | 'area' // Area/region annotation
  | 'measurement' // Distance/angle measurement
  | 'section' // Section cut annotation
  | 'markup' // 2D screen-space markup

export interface AnnotationContent {
  title: string
  description: string
  richText?: string // HTML formatted text
  attachments?: AnnotationAttachment[]
  tags?: string[]
  priority?: 'low' | 'medium' | 'high' | 'critical'
}

export interface AnnotationAttachment {
  id: string
  type: 'image' | 'document' | 'link'
  url: string
  name: string
  size?: number
  thumbnail?: string
}

export interface AnnotationThread {
  id: string
  userId: string
  userName: string
  message: string
  richText?: string
  attachments?: AnnotationAttachment[]
  createdAt: Date
  updatedAt: Date
  replies?: AnnotationThread[]
}

export interface AnnotationVisibility {
  isPublic: boolean
  sharedWith?: string[] // User IDs
  sharedGroups?: string[] // Group IDs
  viewAngle?: number // Maximum angle from annotation normal for visibility
  distanceRange?: {
    min: number
    max: number
  }
}

export type AnnotationStatus = 
  | 'open'
  | 'in_progress'
  | 'resolved'
  | 'closed'
  | 'archived'

export interface AnnotationMetadata {
  version: string // Model version when created
  meshId?: string // Specific mesh/part ID
  meshName?: string
  faceIndex?: number // Specific face on mesh
  screenCoordinates?: { x: number; y: number } // 2D screen position
  viewMatrix?: number[] // Camera view matrix when created
  customFields?: Record<string, any>
}

// Annotation display settings
export interface AnnotationDisplaySettings {
  showLabels: boolean
  showConnectors: boolean
  opacity: number
  scale: number
  minDistance: number
  maxDistance: number
  fadeWithDistance: boolean
  groupNearby: boolean
  groupingThreshold: number
}

// Annotation filter options
export interface AnnotationFilter {
  types?: AnnotationType[]
  status?: AnnotationStatus[]
  users?: string[]
  tags?: string[]
  dateRange?: {
    start: Date
    end: Date
  }
  searchText?: string
  priority?: Array<'low' | 'medium' | 'high' | 'critical'>
}

// Events
export interface AnnotationEvent {
  type: AnnotationEventType
  annotation: Annotation3D
  previousState?: Partial<Annotation3D>
  user: {
    id: string
    name: string
  }
  timestamp: Date
}

export type AnnotationEventType =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'status_changed'
  | 'comment_added'
  | 'comment_updated'
  | 'comment_deleted'

// Collaborative editing
export interface AnnotationCollaborativeUpdate {
  annotationId: string
  userId: string
  changes: Partial<Annotation3D>
  timestamp: Date
  conflictResolution?: 'merge' | 'overwrite' | 'reject'
}

// Measurement specific types
export interface MeasurementAnnotation extends Annotation3D {
  type: 'measurement'
  measurementData: {
    points: Vector3[]
    distance?: number
    angle?: number
    area?: number
    volume?: number
    units: MeasurementUnits
  }
}

export type MeasurementUnits = 'mm' | 'cm' | 'm' | 'in' | 'ft'

// Area annotation specific types
export interface AreaAnnotation extends Annotation3D {
  type: 'area'
  areaData: {
    points: Vector3[] // Polygon points
    isClosed: boolean
    fillColor?: string
    strokeColor?: string
    opacity?: number
  }
}

// Section annotation specific types
export interface SectionAnnotation extends Annotation3D {
  type: 'section'
  sectionData: {
    plane: {
      normal: Vector3
      distance: number
    }
    clipAbove: boolean
    clipBelow: boolean
    showCapping: boolean
    cappingColor?: string
  }
}

// Export formats
export type AnnotationExportFormat = 
  | 'json'
  | 'csv'
  | 'pdf'
  | 'bcf' // Building Collaboration Format
  | 'excel'

export interface AnnotationExportOptions {
  format: AnnotationExportFormat
  includeComments: boolean
  includeAttachments: boolean
  includeMetadata: boolean
  filter?: AnnotationFilter
  groupBy?: 'type' | 'status' | 'user' | 'date'
}