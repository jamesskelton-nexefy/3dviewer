import * as BABYLON from '@babylonjs/core'
import { 
  MergeConflict, 
  ConflictType, 
  ConflictResolution,
  ModelVersion 
} from './types'
import { ModelStorageService } from './ModelStorageService'
import { DiffingService } from './DiffingService'
import { supabase } from '../supabase/supabaseClient'

export class MergeService {
  private modelStorage: ModelStorageService
  private diffingService: DiffingService

  constructor() {
    this.modelStorage = new ModelStorageService()
    this.diffingService = new DiffingService()
  }

  /**
   * Detect conflicts between two branches
   */
  async detectConflicts(
    sourceBranchId: string,
    targetBranchId: string
  ): Promise<MergeConflict[]> {
    try {
      // Get branch HEAD versions
      const [sourceBranch, targetBranch] = await Promise.all([
        this.getBranch(sourceBranchId),
        this.getBranch(targetBranchId)
      ])

      if (!sourceBranch || !targetBranch) {
        throw new Error('One or both branches not found')
      }

      // Find common ancestor
      const commonAncestor = await this.findCommonAncestor(
        sourceBranch.headVersionId,
        targetBranch.headVersionId
      )

      if (!commonAncestor) {
        throw new Error('No common ancestor found between branches')
      }

      // Get diffs from common ancestor
      const [sourceDiff, targetDiff] = await Promise.all([
        this.diffingService.createDiff(commonAncestor, sourceBranch.headVersionId),
        this.diffingService.createDiff(commonAncestor, targetBranch.headVersionId)
      ])

      // Detect conflicts
      const conflicts: MergeConflict[] = []

      // Check for geometry conflicts
      const geometryConflicts = this.detectGeometryConflicts(sourceDiff, targetDiff)
      conflicts.push(...geometryConflicts)

      // Check for material conflicts
      const materialConflicts = this.detectMaterialConflicts(sourceDiff, targetDiff)
      conflicts.push(...materialConflicts)

      // Check for transform conflicts
      const transformConflicts = this.detectTransformConflicts(sourceDiff, targetDiff)
      conflicts.push(...transformConflicts)

      // Check for annotation conflicts
      const annotationConflicts = await this.detectAnnotationConflicts(
        sourceBranch.headVersionId,
        targetBranch.headVersionId
      )
      conflicts.push(...annotationConflicts)

      return conflicts
    } catch (error) {
      console.error('Error detecting conflicts:', error)
      throw error
    }
  }

  /**
   * Merge two branches
   */
  async merge(params: {
    sourceBranchId: string
    targetBranchId: string
    strategy: 'merge' | 'squash' | 'rebase'
    userId: string
    commitMessage: string
  }): Promise<ModelVersion> {
    try {
      const { sourceBranchId, targetBranchId, strategy, userId, commitMessage } = params

      // Get branches
      const [sourceBranch, targetBranch] = await Promise.all([
        this.getBranch(sourceBranchId),
        this.getBranch(targetBranchId)
      ])

      if (!sourceBranch || !targetBranch) {
        throw new Error('One or both branches not found')
      }

      // Check for conflicts
      const conflicts = await this.detectConflicts(sourceBranchId, targetBranchId)
      if (conflicts.length > 0) {
        throw new Error(`Cannot merge: ${conflicts.length} conflicts found`)
      }

      // Perform merge based on strategy
      let mergedVersion: ModelVersion

      switch (strategy) {
        case 'merge':
          mergedVersion = await this.performMerge(sourceBranch, targetBranch, userId, commitMessage)
          break
        case 'squash':
          mergedVersion = await this.performSquashMerge(sourceBranch, targetBranch, userId, commitMessage)
          break
        case 'rebase':
          mergedVersion = await this.performRebase(sourceBranch, targetBranch, userId, commitMessage)
          break
        default:
          throw new Error(`Unknown merge strategy: ${strategy}`)
      }

      return mergedVersion
    } catch (error) {
      console.error('Error merging branches:', error)
      throw error
    }
  }

  /**
   * Resolve a merge conflict
   */
  async resolveConflict(
    mergeRequestId: string,
    conflictId: string,
    resolution: ConflictResolution
  ): Promise<void> {
    try {
      // Update conflict resolution in database
      const { error } = await supabase
        .from('merge_conflicts')
        .update({ resolution })
        .eq('merge_request_id', mergeRequestId)
        .eq('id', conflictId)

      if (error) throw error

      // Check if all conflicts are resolved
      const { data: unresolvedConflicts } = await supabase
        .from('merge_conflicts')
        .select('id')
        .eq('merge_request_id', mergeRequestId)
        .is('resolution', null)

      if (!unresolvedConflicts || unresolvedConflicts.length === 0) {
        // All conflicts resolved, update merge request status
        await supabase
          .from('merge_requests')
          .update({ status: 'open' })
          .eq('id', mergeRequestId)
      }
    } catch (error) {
      console.error('Error resolving conflict:', error)
      throw error
    }
  }

  /**
   * Apply conflict resolutions and create merged model
   */
  async applyResolutions(
    mergeRequestId: string,
    userId: string
  ): Promise<ModelVersion> {
    try {
      // Get merge request and conflicts
      const { data: mergeRequest } = await supabase
        .from('merge_requests')
        .select('*, merge_conflicts(*)')
        .eq('id', mergeRequestId)
        .single()

      if (!mergeRequest) {
        throw new Error('Merge request not found')
      }

      // Load source and target scenes
      const [sourceScene, targetScene] = await Promise.all([
        this.loadBranchScene(mergeRequest.sourceBranchId),
        this.loadBranchScene(mergeRequest.targetBranchId)
      ])

      // Create merged scene
      const mergedScene = new BABYLON.Scene(sourceScene.getEngine())

      // Apply resolutions
      for (const conflict of mergeRequest.merge_conflicts) {
        await this.applyConflictResolution(
          conflict,
          sourceScene,
          targetScene,
          mergedScene
        )
      }

      // Export merged scene to file
      const mergedFile = await this.exportScene(mergedScene)

      // Create new version
      const version = await this.createMergedVersion({
        modelId: mergeRequest.modelId,
        file: mergedFile,
        branchName: mergeRequest.targetBranchName,
        commitMessage: `Merged ${mergeRequest.sourceBranchName} into ${mergeRequest.targetBranchName}`,
        userId
      })

      // Clean up
      sourceScene.dispose()
      targetScene.dispose()
      mergedScene.dispose()

      return version
    } catch (error) {
      console.error('Error applying resolutions:', error)
      throw error
    }
  }

  // Private helper methods

  private async getBranch(branchId: string): Promise<any> {
    const { data } = await supabase
      .from('branches')
      .select('*')
      .eq('id', branchId)
      .single()

    return data
  }

  private async findCommonAncestor(
    versionId1: string,
    versionId2: string
  ): Promise<string | null> {
    // Simplified implementation - in production, you'd traverse the version tree
    // to find the actual common ancestor
    const { data: version1 } = await supabase
      .from('model_versions')
      .select('parentVersionId')
      .eq('id', versionId1)
      .single()

    const { data: version2 } = await supabase
      .from('model_versions')
      .select('parentVersionId')
      .eq('id', versionId2)
      .single()

    // For now, return the parent of version1 if it exists
    return version1?.parentVersionId || null
  }

  private detectGeometryConflicts(sourceDiff: any, targetDiff: any): MergeConflict[] {
    const conflicts: MergeConflict[] = []
    const processedPaths = new Set<string>()

    // Check for conflicting modifications to the same geometry
    sourceDiff.changes.forEach((sourceChange: any) => {
      if (sourceChange.type.startsWith('geometry_')) {
        const targetChange = targetDiff.changes.find(
          (c: any) => c.path === sourceChange.path && c.type.startsWith('geometry_')
        )

        if (targetChange && !processedPaths.has(sourceChange.path)) {
          processedPaths.add(sourceChange.path)
          
          conflicts.push({
            id: crypto.randomUUID(),
            type: 'geometry_overlap',
            path: sourceChange.path,
            description: `Both branches modified ${sourceChange.path}`,
            sourceValue: sourceChange.newValue,
            targetValue: targetChange.newValue
          })
        }
      }
    })

    return conflicts
  }

  private detectMaterialConflicts(sourceDiff: any, targetDiff: any): MergeConflict[] {
    const conflicts: MergeConflict[] = []
    const processedPaths = new Set<string>()

    sourceDiff.changes.forEach((sourceChange: any) => {
      if (sourceChange.type.startsWith('material_')) {
        const targetChange = targetDiff.changes.find(
          (c: any) => c.path === sourceChange.path && c.type.startsWith('material_')
        )

        if (targetChange && !processedPaths.has(sourceChange.path)) {
          processedPaths.add(sourceChange.path)
          
          conflicts.push({
            id: crypto.randomUUID(),
            type: 'material_conflict',
            path: sourceChange.path,
            description: `Both branches modified material ${sourceChange.path}`,
            sourceValue: sourceChange.newValue,
            targetValue: targetChange.newValue
          })
        }
      }
    })

    return conflicts
  }

  private detectTransformConflicts(sourceDiff: any, targetDiff: any): MergeConflict[] {
    const conflicts: MergeConflict[] = []
    const processedPaths = new Set<string>()

    sourceDiff.changes.forEach((sourceChange: any) => {
      if (sourceChange.type === 'transform_changed') {
        const targetChange = targetDiff.changes.find(
          (c: any) => c.path === sourceChange.path && c.type === 'transform_changed'
        )

        if (targetChange && !processedPaths.has(sourceChange.path)) {
          processedPaths.add(sourceChange.path)
          
          conflicts.push({
            id: crypto.randomUUID(),
            type: 'transform_conflict',
            path: sourceChange.path,
            description: `Both branches modified transform for ${sourceChange.path}`,
            sourceValue: sourceChange.newValue,
            targetValue: targetChange.newValue
          })
        }
      }
    })

    return conflicts
  }

  private async detectAnnotationConflicts(
    sourceVersionId: string,
    targetVersionId: string
  ): Promise<MergeConflict[]> {
    // Check for conflicting annotation changes
    const conflicts: MergeConflict[] = []

    // This would query the annotation system for conflicts
    // For now, return empty array
    return conflicts
  }

  private async performMerge(
    sourceBranch: any,
    targetBranch: any,
    userId: string,
    commitMessage: string
  ): Promise<ModelVersion> {
    // Standard merge: create new version with both parent references
    const sourceScene = await this.loadBranchScene(sourceBranch.id)
    const targetScene = await this.loadBranchScene(targetBranch.id)

    // Merge scenes
    const mergedScene = await this.mergeScenes(sourceScene, targetScene)
    const mergedFile = await this.exportScene(mergedScene)

    // Create version
    const version = await this.createMergedVersion({
      modelId: sourceBranch.modelId,
      file: mergedFile,
      branchName: targetBranch.name,
      commitMessage,
      userId,
      parentVersions: [sourceBranch.headVersionId, targetBranch.headVersionId]
    })

    // Clean up
    sourceScene.dispose()
    targetScene.dispose()
    mergedScene.dispose()

    return version
  }

  private async performSquashMerge(
    sourceBranch: any,
    targetBranch: any,
    userId: string,
    commitMessage: string
  ): Promise<ModelVersion> {
    // Squash merge: combine all commits into one
    const sourceScene = await this.loadBranchScene(sourceBranch.id)
    const mergedFile = await this.exportScene(sourceScene)

    const version = await this.createMergedVersion({
      modelId: sourceBranch.modelId,
      file: mergedFile,
      branchName: targetBranch.name,
      commitMessage: `Squash merge: ${commitMessage}`,
      userId,
      parentVersions: [targetBranch.headVersionId]
    })

    sourceScene.dispose()
    return version
  }

  private async performRebase(
    sourceBranch: any,
    targetBranch: any,
    userId: string,
    commitMessage: string
  ): Promise<ModelVersion> {
    // Rebase: replay source commits on top of target
    // This is a simplified implementation
    return this.performMerge(sourceBranch, targetBranch, userId, `Rebase: ${commitMessage}`)
  }

  private async loadBranchScene(branchId: string): Promise<BABYLON.Scene> {
    // Load the HEAD version of the branch
    const engine = new BABYLON.NullEngine()
    const scene = new BABYLON.Scene(engine)
    
    // This would load the actual model data
    // For now, return empty scene
    return scene
  }

  private async mergeScenes(
    sourceScene: BABYLON.Scene,
    targetScene: BABYLON.Scene
  ): Promise<BABYLON.Scene> {
    const engine = sourceScene.getEngine()
    const mergedScene = new BABYLON.Scene(engine)

    // Copy all meshes from target (base)
    targetScene.meshes.forEach(mesh => {
      mesh.clone(mesh.name, null, true)?.setParent(null)
    })

    // Add/update meshes from source
    sourceScene.meshes.forEach(mesh => {
      const existing = mergedScene.getMeshByName(mesh.name)
      if (existing) {
        existing.dispose()
      }
      mesh.clone(mesh.name, null, true)?.setParent(null)
    })

    // Merge materials and textures similarly
    // ...

    return mergedScene
  }

  private async exportScene(scene: BABYLON.Scene): Promise<Blob> {
    // Export scene to GLB format
    // This is a placeholder - use BABYLON.GLTF2Export in production
    return new Blob([''], { type: 'model/gltf-binary' })
  }

  private async createMergedVersion(params: {
    modelId: string
    file: Blob
    branchName: string
    commitMessage: string
    userId: string
    parentVersions?: string[]
  }): Promise<ModelVersion> {
    // This would call the VersionControlService.createVersion method
    // For now, return a mock version
    return {
      id: crypto.randomUUID(),
      modelId: params.modelId,
      version: '1.0.0',
      branchName: params.branchName,
      commitMessage: params.commitMessage,
      commitHash: 'merged',
      authorId: params.userId,
      authorName: 'User',
      authorEmail: 'user@example.com',
      createdAt: new Date(),
      metadata: {
        triangleCount: 0,
        vertexCount: 0,
        materialCount: 0,
        textureCount: 0,
        boundingBox: {
          min: { x: 0, y: 0, z: 0 },
          max: { x: 0, y: 0, z: 0 }
        },
        format: 'model/gltf-binary'
      },
      status: 'approved',
      tags: ['merged'],
      fileSize: params.file.size,
      checksum: ''
    }
  }

  private async applyConflictResolution(
    conflict: any,
    sourceScene: BABYLON.Scene,
    targetScene: BABYLON.Scene,
    mergedScene: BABYLON.Scene
  ): Promise<void> {
    const resolution = conflict.resolution

    switch (resolution.strategy) {
      case 'use_source':
        // Copy from source scene
        await this.copyElement(conflict.path, sourceScene, mergedScene)
        break
      case 'use_target':
        // Copy from target scene
        await this.copyElement(conflict.path, targetScene, mergedScene)
        break
      case 'manual':
        // Apply custom resolution
        await this.applyCustomResolution(conflict, mergedScene)
        break
      case 'merge':
        // Attempt automatic merge
        await this.autoMergeElement(conflict, sourceScene, targetScene, mergedScene)
        break
    }
  }

  private async copyElement(
    path: string,
    fromScene: BABYLON.Scene,
    toScene: BABYLON.Scene
  ): Promise<void> {
    // Copy the specified element from one scene to another
    const [type, name] = path.split('/')
    
    switch (type) {
      case 'meshes':
        const mesh = fromScene.getMeshByName(name)
        if (mesh) {
          mesh.clone(name, null, true)?.setParent(null)
        }
        break
      case 'materials':
        const material = fromScene.getMaterialByName(name)
        if (material) {
          material.clone(name)
        }
        break
      // Add more cases as needed
    }
  }

  private async applyCustomResolution(
    conflict: any,
    scene: BABYLON.Scene
  ): Promise<void> {
    // Apply custom resolution data
    // This would be specific to the conflict type and resolution data
  }

  private async autoMergeElement(
    conflict: any,
    sourceScene: BABYLON.Scene,
    targetScene: BABYLON.Scene,
    mergedScene: BABYLON.Scene
  ): Promise<void> {
    // Attempt to automatically merge the conflicting element
    // This would use sophisticated algorithms based on the conflict type
  }
}