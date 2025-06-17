// Version Control Types and Interfaces

export interface ModelVersion {
  id: string
  modelId: string
  version: string // Semantic version: major.minor.patch
  parentVersionId?: string
  branchName: string
  commitMessage: string
  commitHash: string
  authorId: string
  authorName: string
  authorEmail: string
  createdAt: Date
  metadata: VersionMetadata
  status: VersionStatus
  tags: string[]
  fileSize: number
  checksum: string
}

export interface VersionMetadata {
  triangleCount: number
  vertexCount: number
  materialCount: number
  textureCount: number
  boundingBox: BoundingBox
  format: string
  compressionType?: string
  annotations?: AnnotationChange[]
  dependencies?: string[] // Other model IDs this version depends on
}

export interface BoundingBox {
  min: { x: number; y: number; z: number }
  max: { x: number; y: number; z: number }
}

export interface AnnotationChange {
  id: string
  action: 'added' | 'modified' | 'deleted'
  annotation?: any // Reference to annotation object
}

export type VersionStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'archived'

export interface Branch {
  id: string
  modelId: string
  name: string
  description?: string
  isProtected: boolean
  isDefault: boolean
  headVersionId: string
  baseVersionId: string // Where this branch diverged from
  createdBy: string
  createdAt: Date
  updatedAt: Date
  metadata: BranchMetadata
}

export interface BranchMetadata {
  mergeRequests: number
  contributors: string[]
  lastActivity: Date
}

export interface MergeRequest {
  id: string
  modelId: string
  sourceBranchId: string
  targetBranchId: string
  title: string
  description: string
  status: MergeRequestStatus
  authorId: string
  reviewers: Reviewer[]
  createdAt: Date
  updatedAt: Date
  mergedAt?: Date
  mergedBy?: string
  conflicts?: MergeConflict[]
  comments: Comment[]
}

export type MergeRequestStatus = 'open' | 'merged' | 'closed' | 'conflict'

export interface Reviewer {
  userId: string
  userName: string
  status: 'pending' | 'approved' | 'rejected' | 'commented'
  reviewedAt?: Date
  comments?: string
}

export interface MergeConflict {
  id: string
  type: ConflictType
  path: string // Path to the conflicting element (e.g., mesh name, material ID)
  description: string
  sourceValue: any
  targetValue: any
  resolution?: ConflictResolution
}

export type ConflictType = 
  | 'geometry_overlap'
  | 'material_conflict'
  | 'texture_conflict'
  | 'metadata_conflict'
  | 'annotation_conflict'
  | 'transform_conflict'

export interface ConflictResolution {
  strategy: 'use_source' | 'use_target' | 'manual' | 'merge'
  resolvedBy: string
  resolvedAt: Date
  customResolution?: any
}

export interface Comment {
  id: string
  userId: string
  userName: string
  content: string
  createdAt: Date
  updatedAt?: Date
  isResolved: boolean
  replies?: Comment[]
}

export interface VersionDiff {
  fromVersion: string
  toVersion: string
  changes: ModelChange[]
  statistics: DiffStatistics
}

export interface ModelChange {
  type: ChangeType
  path: string
  oldValue?: any
  newValue?: any
  description: string
}

export type ChangeType = 
  | 'geometry_added'
  | 'geometry_removed'
  | 'geometry_modified'
  | 'material_added'
  | 'material_removed'
  | 'material_modified'
  | 'texture_added'
  | 'texture_removed'
  | 'texture_modified'
  | 'metadata_changed'
  | 'transform_changed'

export interface DiffStatistics {
  geometryChanges: number
  materialChanges: number
  textureChanges: number
  totalChanges: number
  addedTriangles: number
  removedTriangles: number
  filesizeChange: number
}

export interface ApprovalWorkflow {
  id: string
  modelId: string
  versionId: string
  requiredApprovers: string[] // User IDs
  approvals: Approval[]
  status: WorkflowStatus
  createdAt: Date
  deadline?: Date
  autoApproveAt?: Date
}

export interface Approval {
  userId: string
  userName: string
  status: 'pending' | 'approved' | 'rejected'
  comments?: string
  approvedAt?: Date
}

export type WorkflowStatus = 'pending' | 'approved' | 'rejected' | 'expired'

export interface VersionControlConfig {
  autoCommit: boolean
  requireApproval: boolean
  minApprovers: number
  allowForcePush: boolean
  retentionDays: number
  maxVersionsPerModel: number
  compressionEnabled: boolean
  diffingEnabled: boolean
}

export interface VersionTag {
  name: string
  versionId: string
  description?: string
  createdBy: string
  createdAt: Date
  isRelease: boolean
}

export interface VersionComparisonResult {
  areIdentical: boolean
  similarity: number // 0-1 score
  differences: ModelChange[]
  visualDiff?: {
    added: any[] // Added geometry elements
    removed: any[] // Removed geometry elements
    modified: any[] // Modified geometry elements
  }
}