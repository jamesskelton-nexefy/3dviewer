# 3D Model Version Control System

A comprehensive Git-like version control system for 3D models with semantic versioning, branch management, merge conflict resolution, and approval workflows.

## Features

### Core Version Control
- **Semantic Versioning**: Automatic version numbering (major.minor.patch)
- **Commit History**: Full history tracking with commit messages and authors
- **File Integrity**: SHA-256 checksums for all model versions
- **Metadata Tracking**: Automatic extraction of model statistics (triangles, vertices, materials, textures)

### Branch Management
- **Multiple Branches**: Create and manage multiple development branches
- **Protected Branches**: Prevent accidental modifications to important branches
- **Branch Switching**: Easy switching between different branches
- **Branch Metadata**: Track contributors and activity per branch

### Merge & Conflict Resolution
- **Merge Requests**: Create pull request-style merge requests
- **Conflict Detection**: Automatic detection of geometry, material, and transform conflicts
- **Conflict Resolution**: Multiple strategies (use source, use target, manual, auto-merge)
- **Merge Strategies**: Support for merge, squash, and rebase operations

### Approval Workflows
- **Review Process**: Require approvals before merging or publishing
- **Multiple Reviewers**: Assign multiple reviewers to merge requests
- **Auto-Approval**: Configure automatic approval after a specified time
- **Approval History**: Full audit trail of all approval decisions

### Storage & Performance
- **Supabase Integration**: Secure cloud storage for all model versions
- **Compression Support**: Optional Draco compression for reduced storage
- **Progressive Loading**: Stream large models as they download
- **Cleanup Policies**: Automatic cleanup of old versions based on retention settings

## Usage

### Basic Version Control

```typescript
import { VersionControlService } from '@/services/version-control'

// Initialize the service
const vcs = new VersionControlService({
  requireApproval: true,
  minApprovers: 2,
  compressionEnabled: true
})

// Create a new version
const version = await vcs.createVersion({
  modelId: 'model-123',
  file: modelFile,
  branchName: 'main',
  commitMessage: 'Fix texture mapping issues',
  authorId: 'user-123',
  authorName: 'John Doe',
  authorEmail: 'john@example.com'
})

// Get version history
const history = await vcs.getVersionHistory('model-123', 'main', {
  limit: 20,
  includeMetadata: true
})
```

### Branch Management

```typescript
// Create a new branch
const branch = await vcs.createBranch({
  modelId: 'model-123',
  name: 'feature/new-materials',
  description: 'Adding PBR materials',
  baseVersionId: 'version-456',
  createdBy: 'user-123'
})

// Switch branches (in UI)
await switchBranch('feature/new-materials')
```

### Merge Requests

```typescript
// Create a merge request
const mergeRequest = await vcs.createMergeRequest({
  modelId: 'model-123',
  sourceBranchId: 'branch-789',
  targetBranchId: 'branch-main',
  title: 'Add PBR materials',
  description: 'This PR adds physically-based rendering materials...',
  authorId: 'user-123',
  reviewers: ['user-456', 'user-789']
})

// Merge branches after approval
const mergedVersion = await vcs.mergeBranches(
  mergeRequest.id,
  'user-123',
  'merge' // or 'squash' or 'rebase'
)
```

### Conflict Resolution

```typescript
// Detect conflicts
const conflicts = await mergeService.detectConflicts(
  sourceBranchId,
  targetBranchId
)

// Resolve a conflict
await vcs.resolveConflict(
  mergeRequestId,
  conflictId,
  {
    strategy: 'use_source', // or 'use_target', 'manual', 'merge'
    resolvedBy: 'user-123',
    resolvedAt: new Date()
  }
)
```

### Version Comparison

```typescript
// Compare two versions
const comparison = await vcs.compareVersions(
  'version-123',
  'version-456'
)

console.log(`Similarity: ${comparison.similarity * 100}%`)
console.log(`Changes: ${comparison.differences.length}`)

// Get detailed diff
const diff = await vcs.getDiff('version-123', 'version-456')
console.log(`Geometry changes: ${diff.statistics.geometryChanges}`)
console.log(`Material changes: ${diff.statistics.materialChanges}`)
```

### React Hook Usage

```typescript
import { useVersionControl } from '@/services/version-control/useVersionControl'

function ModelVersionControl({ modelId }) {
  const {
    versions,
    branches,
    currentBranch,
    loading,
    error,
    createVersion,
    createBranch,
    switchBranch,
    rollback
  } = useVersionControl(modelId, {
    requireApproval: true,
    minApprovers: 1
  })

  const handleCommit = async (file: File) => {
    await createVersion(file, 'Update model geometry', {
      id: userId,
      name: userName,
      email: userEmail
    })
  }

  return (
    <div>
      <BranchSelector 
        branches={branches}
        current={currentBranch}
        onSwitch={switchBranch}
      />
      <VersionHistory versions={versions} />
      <CommitButton onCommit={handleCommit} />
    </div>
  )
}
```

## Database Schema

The version control system uses the following main tables:

- `model_versions`: Stores all version information
- `branches`: Manages branch metadata
- `merge_requests`: Tracks merge requests
- `merge_conflicts`: Stores detected conflicts
- `approval_workflows`: Manages approval processes
- `version_tags`: Allows tagging specific versions
- `version_comments`: Comments on versions and merge requests

## Configuration

```typescript
interface VersionControlConfig {
  autoCommit: boolean          // Auto-commit on save
  requireApproval: boolean     // Require approval for versions
  minApprovers: number         // Minimum number of approvers
  allowForcePush: boolean      // Allow overwriting history
  retentionDays: number        // Days to keep old versions
  maxVersionsPerModel: number  // Max versions per model
  compressionEnabled: boolean  // Enable Draco compression
  diffingEnabled: boolean      // Enable visual diffing
}
```

## Security

- All operations respect Supabase RLS policies
- Users can only modify their own models
- Branch protection prevents unauthorized changes
- Approval workflows ensure review before publishing
- Full audit trail of all operations

## Performance Considerations

- Checksums enable quick duplicate detection
- Metadata caching reduces repeated calculations
- Progressive loading for large models
- Efficient diffing algorithms for large meshes
- Automatic cleanup of old versions

## Future Enhancements

- Visual diff viewer component
- Automated conflict resolution for simple cases
- Integration with CI/CD pipelines
- Model validation before commits
- Distributed version control (like Git's distributed nature)
- LFS-style handling of very large models