import { createHash } from 'crypto'
import { 
  ModelVersion, 
  Branch, 
  MergeRequest, 
  VersionDiff, 
  ApprovalWorkflow,
  VersionControlConfig,
  VersionTag,
  VersionComparisonResult,
  MergeConflict,
  ConflictResolution,
  VersionStatus,
  MergeRequestStatus,
  WorkflowStatus
} from './types'
import { supabase } from '../supabase/supabaseClient'
import { ModelStorageService } from './ModelStorageService'
import { DiffingService } from './DiffingService'
import { MergeService } from './MergeService'
import { ApprovalService } from './ApprovalService'

export class VersionControlService {
  private modelStorage: ModelStorageService
  private diffingService: DiffingService
  private mergeService: MergeService
  private approvalService: ApprovalService
  private config: VersionControlConfig

  constructor(config?: Partial<VersionControlConfig>) {
    this.config = {
      autoCommit: false,
      requireApproval: true,
      minApprovers: 1,
      allowForcePush: false,
      retentionDays: 365,
      maxVersionsPerModel: 100,
      compressionEnabled: true,
      diffingEnabled: true,
      ...config
    }

    this.modelStorage = new ModelStorageService()
    this.diffingService = new DiffingService()
    this.mergeService = new MergeService()
    this.approvalService = new ApprovalService(this.config)
  }

  /**
   * Create a new version of a model
   */
  async createVersion(params: {
    modelId: string
    file: File | Blob
    branchName: string
    commitMessage: string
    authorId: string
    authorName: string
    authorEmail: string
    parentVersionId?: string
    tags?: string[]
  }): Promise<ModelVersion> {
    try {
      // Calculate file checksum
      const checksum = await this.calculateChecksum(params.file)
      
      // Get current version to determine semantic version
      const currentVersion = await this.getCurrentVersion(params.modelId, params.branchName)
      const newVersion = this.incrementVersion(currentVersion?.version || '0.0.0', 'patch')
      
      // Generate commit hash
      const commitHash = this.generateCommitHash({
        modelId: params.modelId,
        checksum,
        timestamp: new Date().toISOString(),
        authorId: params.authorId
      })

      // Upload model file to storage
      const storagePath = await this.modelStorage.uploadVersion({
        modelId: params.modelId,
        versionId: commitHash,
        file: params.file,
        compress: this.config.compressionEnabled
      })

      // Extract model metadata
      const metadata = await this.modelStorage.extractMetadata(params.file)

      // Create version record
      const version: ModelVersion = {
        id: crypto.randomUUID(),
        modelId: params.modelId,
        version: newVersion,
        parentVersionId: params.parentVersionId || currentVersion?.id,
        branchName: params.branchName,
        commitMessage: params.commitMessage,
        commitHash,
        authorId: params.authorId,
        authorName: params.authorName,
        authorEmail: params.authorEmail,
        createdAt: new Date(),
        metadata,
        status: this.config.requireApproval ? 'pending_review' : 'approved',
        tags: params.tags || [],
        fileSize: params.file.size,
        checksum
      }

      // Save to database
      const { data, error } = await supabase
        .from('model_versions')
        .insert(version)
        .select()
        .single()

      if (error) throw error

      // Update branch HEAD
      await this.updateBranchHead(params.branchName, params.modelId, version.id)

      // If auto-approval is enabled or no approval required, approve immediately
      if (!this.config.requireApproval) {
        await this.approveVersion(version.id, params.authorId)
      }

      return data
    } catch (error) {
      console.error('Error creating version:', error)
      throw error
    }
  }

  /**
   * Get version history for a model
   */
  async getVersionHistory(
    modelId: string, 
    branchName?: string,
    options?: {
      limit?: number
      offset?: number
      includeMetadata?: boolean
    }
  ): Promise<ModelVersion[]> {
    try {
      let query = supabase
        .from('model_versions')
        .select('*')
        .eq('modelId', modelId)
        .order('createdAt', { ascending: false })

      if (branchName) {
        query = query.eq('branchName', branchName)
      }

      if (options?.limit) {
        query = query.limit(options.limit)
      }

      if (options?.offset) {
        query = query.range(options.offset, options.offset + (options.limit || 10) - 1)
      }

      const { data, error } = await query

      if (error) throw error

      return data || []
    } catch (error) {
      console.error('Error fetching version history:', error)
      throw error
    }
  }

  /**
   * Create a new branch
   */
  async createBranch(params: {
    modelId: string
    name: string
    description?: string
    baseVersionId: string
    createdBy: string
    isProtected?: boolean
  }): Promise<Branch> {
    try {
      // Check if branch name already exists
      const existing = await this.getBranch(params.modelId, params.name)
      if (existing) {
        throw new Error(`Branch '${params.name}' already exists`)
      }

      const branch: Branch = {
        id: crypto.randomUUID(),
        modelId: params.modelId,
        name: params.name,
        description: params.description,
        isProtected: params.isProtected || false,
        isDefault: false,
        headVersionId: params.baseVersionId,
        baseVersionId: params.baseVersionId,
        createdBy: params.createdBy,
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          mergeRequests: 0,
          contributors: [params.createdBy],
          lastActivity: new Date()
        }
      }

      const { data, error } = await supabase
        .from('branches')
        .insert(branch)
        .select()
        .single()

      if (error) throw error

      return data
    } catch (error) {
      console.error('Error creating branch:', error)
      throw error
    }
  }

  /**
   * Create a merge request
   */
  async createMergeRequest(params: {
    modelId: string
    sourceBranchId: string
    targetBranchId: string
    title: string
    description: string
    authorId: string
    reviewers: string[]
  }): Promise<MergeRequest> {
    try {
      // Check for conflicts
      const conflicts = await this.mergeService.detectConflicts(
        params.sourceBranchId,
        params.targetBranchId
      )

      const mergeRequest: MergeRequest = {
        id: crypto.randomUUID(),
        modelId: params.modelId,
        sourceBranchId: params.sourceBranchId,
        targetBranchId: params.targetBranchId,
        title: params.title,
        description: params.description,
        status: conflicts.length > 0 ? 'conflict' : 'open',
        authorId: params.authorId,
        reviewers: params.reviewers.map(userId => ({
          userId,
          userName: '', // Will be populated from user service
          status: 'pending'
        })),
        createdAt: new Date(),
        updatedAt: new Date(),
        conflicts: conflicts.length > 0 ? conflicts : undefined,
        comments: []
      }

      const { data, error } = await supabase
        .from('merge_requests')
        .insert(mergeRequest)
        .select()
        .single()

      if (error) throw error

      // Notify reviewers
      await this.notifyReviewers(data.id, params.reviewers)

      return data
    } catch (error) {
      console.error('Error creating merge request:', error)
      throw error
    }
  }

  /**
   * Merge branches
   */
  async mergeBranches(
    mergeRequestId: string,
    userId: string,
    strategy: 'merge' | 'squash' | 'rebase' = 'merge'
  ): Promise<ModelVersion> {
    try {
      // Get merge request
      const mergeRequest = await this.getMergeRequest(mergeRequestId)
      if (!mergeRequest) {
        throw new Error('Merge request not found')
      }

      if (mergeRequest.status !== 'open') {
        throw new Error(`Cannot merge request with status: ${mergeRequest.status}`)
      }

      // Check if all required approvals are obtained
      if (this.config.requireApproval) {
        const approvalStatus = await this.approvalService.checkApprovals(mergeRequestId)
        if (!approvalStatus.isApproved) {
          throw new Error('Merge request requires approval')
        }
      }

      // Perform merge
      const mergedVersion = await this.mergeService.merge({
        sourceBranchId: mergeRequest.sourceBranchId,
        targetBranchId: mergeRequest.targetBranchId,
        strategy,
        userId,
        commitMessage: `Merge: ${mergeRequest.title}`
      })

      // Update merge request status
      await supabase
        .from('merge_requests')
        .update({
          status: 'merged' as MergeRequestStatus,
          mergedAt: new Date(),
          mergedBy: userId
        })
        .eq('id', mergeRequestId)

      return mergedVersion
    } catch (error) {
      console.error('Error merging branches:', error)
      throw error
    }
  }

  /**
   * Rollback to a previous version
   */
  async rollback(
    modelId: string,
    targetVersionId: string,
    userId: string,
    reason: string
  ): Promise<ModelVersion> {
    try {
      // Get target version
      const targetVersion = await this.getVersion(targetVersionId)
      if (!targetVersion || targetVersion.modelId !== modelId) {
        throw new Error('Invalid target version')
      }

      // Create a new version that's a copy of the target
      const rollbackVersion = await this.createVersion({
        modelId,
        file: await this.modelStorage.downloadVersion(modelId, targetVersionId),
        branchName: targetVersion.branchName,
        commitMessage: `Rollback to version ${targetVersion.version}: ${reason}`,
        authorId: userId,
        authorName: '', // Will be populated from user service
        authorEmail: '', // Will be populated from user service
        tags: ['rollback']
      })

      return rollbackVersion
    } catch (error) {
      console.error('Error rolling back version:', error)
      throw error
    }
  }

  /**
   * Compare two versions
   */
  async compareVersions(
    versionId1: string,
    versionId2: string
  ): Promise<VersionComparisonResult> {
    try {
      const [version1, version2] = await Promise.all([
        this.getVersion(versionId1),
        this.getVersion(versionId2)
      ])

      if (!version1 || !version2) {
        throw new Error('One or both versions not found')
      }

      // Quick check using checksums
      if (version1.checksum === version2.checksum) {
        return {
          areIdentical: true,
          similarity: 1.0,
          differences: []
        }
      }

      // Perform detailed comparison
      const comparison = await this.diffingService.compareVersions(version1, version2)
      
      return comparison
    } catch (error) {
      console.error('Error comparing versions:', error)
      throw error
    }
  }

  /**
   * Create a version tag
   */
  async createTag(params: {
    name: string
    versionId: string
    description?: string
    createdBy: string
    isRelease?: boolean
  }): Promise<VersionTag> {
    try {
      const tag: VersionTag = {
        name: params.name,
        versionId: params.versionId,
        description: params.description,
        createdBy: params.createdBy,
        createdAt: new Date(),
        isRelease: params.isRelease || false
      }

      const { data, error } = await supabase
        .from('version_tags')
        .insert(tag)
        .select()
        .single()

      if (error) throw error

      return data
    } catch (error) {
      console.error('Error creating tag:', error)
      throw error
    }
  }

  /**
   * Get diff between two versions
   */
  async getDiff(fromVersionId: string, toVersionId: string): Promise<VersionDiff> {
    try {
      const diff = await this.diffingService.createDiff(fromVersionId, toVersionId)
      return diff
    } catch (error) {
      console.error('Error getting diff:', error)
      throw error
    }
  }

  /**
   * Resolve merge conflict
   */
  async resolveConflict(
    mergeRequestId: string,
    conflictId: string,
    resolution: ConflictResolution
  ): Promise<void> {
    try {
      await this.mergeService.resolveConflict(mergeRequestId, conflictId, resolution)
    } catch (error) {
      console.error('Error resolving conflict:', error)
      throw error
    }
  }

  // Private helper methods

  private async calculateChecksum(file: File | Blob): Promise<string> {
    const buffer = await file.arrayBuffer()
    const hash = createHash('sha256')
    hash.update(Buffer.from(buffer))
    return hash.digest('hex')
  }

  private generateCommitHash(data: any): string {
    const hash = createHash('sha1')
    hash.update(JSON.stringify(data))
    return hash.digest('hex').substring(0, 8)
  }

  private incrementVersion(
    currentVersion: string, 
    type: 'major' | 'minor' | 'patch'
  ): string {
    const [major, minor, patch] = currentVersion.split('.').map(Number)
    
    switch (type) {
      case 'major':
        return `${major + 1}.0.0`
      case 'minor':
        return `${major}.${minor + 1}.0`
      case 'patch':
        return `${major}.${minor}.${patch + 1}`
    }
  }

  private async getCurrentVersion(
    modelId: string, 
    branchName: string
  ): Promise<ModelVersion | null> {
    const { data } = await supabase
      .from('model_versions')
      .select('*')
      .eq('modelId', modelId)
      .eq('branchName', branchName)
      .order('createdAt', { ascending: false })
      .limit(1)
      .single()

    return data
  }

  private async updateBranchHead(
    branchName: string,
    modelId: string,
    versionId: string
  ): Promise<void> {
    await supabase
      .from('branches')
      .update({ 
        headVersionId: versionId,
        updatedAt: new Date()
      })
      .eq('name', branchName)
      .eq('modelId', modelId)
  }

  private async getBranch(modelId: string, name: string): Promise<Branch | null> {
    const { data } = await supabase
      .from('branches')
      .select('*')
      .eq('modelId', modelId)
      .eq('name', name)
      .single()

    return data
  }

  private async getVersion(versionId: string): Promise<ModelVersion | null> {
    const { data } = await supabase
      .from('model_versions')
      .select('*')
      .eq('id', versionId)
      .single()

    return data
  }

  private async getMergeRequest(mergeRequestId: string): Promise<MergeRequest | null> {
    const { data } = await supabase
      .from('merge_requests')
      .select('*')
      .eq('id', mergeRequestId)
      .single()

    return data
  }

  private async approveVersion(versionId: string, userId: string): Promise<void> {
    await supabase
      .from('model_versions')
      .update({ status: 'approved' as VersionStatus })
      .eq('id', versionId)
  }

  private async notifyReviewers(mergeRequestId: string, reviewerIds: string[]): Promise<void> {
    // Implementation would send notifications via email/websocket
    console.log(`Notifying reviewers for merge request ${mergeRequestId}:`, reviewerIds)
  }
}