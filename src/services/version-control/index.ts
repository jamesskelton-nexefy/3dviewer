// Version Control System Exports

export * from './types'
export { VersionControlService } from './VersionControlService'
export { ModelStorageService } from './ModelStorageService'
export { DiffingService } from './DiffingService'
export { MergeService } from './MergeService'
export { ApprovalService } from './ApprovalService'

// Re-export commonly used types for convenience
export type {
  ModelVersion,
  Branch,
  MergeRequest,
  ApprovalWorkflow,
  VersionDiff,
  MergeConflict,
  ConflictResolution,
  VersionControlConfig
} from './types'