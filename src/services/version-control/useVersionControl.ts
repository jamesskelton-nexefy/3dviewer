import { useState, useCallback, useEffect } from 'react'
import { 
  VersionControlService,
  ModelVersion,
  Branch,
  MergeRequest,
  VersionDiff,
  ApprovalWorkflow,
  VersionTag,
  VersionComparisonResult
} from './index'

interface UseVersionControlOptions {
  autoCommit?: boolean
  requireApproval?: boolean
  minApprovers?: number
}

export function useVersionControl(modelId: string, options?: UseVersionControlOptions) {
  const [service] = useState(() => new VersionControlService(options))
  const [versions, setVersions] = useState<ModelVersion[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [currentBranch, setCurrentBranch] = useState<Branch | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // Load initial data
  useEffect(() => {
    if (modelId) {
      loadVersionHistory()
      loadBranches()
    }
  }, [modelId])

  const loadVersionHistory = useCallback(async (branchName?: string) => {
    try {
      setLoading(true)
      const history = await service.getVersionHistory(modelId, branchName)
      setVersions(history)
    } catch (err) {
      setError(err as Error)
    } finally {
      setLoading(false)
    }
  }, [modelId, service])

  const loadBranches = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('branches')
        .select('*')
        .eq('modelId', modelId)
        .order('isDefault', { ascending: false })

      setBranches(data || [])
      
      // Set current branch to default or first branch
      const defaultBranch = data?.find(b => b.isDefault) || data?.[0]
      if (defaultBranch) {
        setCurrentBranch(defaultBranch)
      }
    } catch (err) {
      setError(err as Error)
    }
  }, [modelId])

  const createVersion = useCallback(async (
    file: File | Blob,
    commitMessage: string,
    authorInfo: {
      id: string
      name: string
      email: string
    }
  ) => {
    try {
      setLoading(true)
      const version = await service.createVersion({
        modelId,
        file,
        branchName: currentBranch?.name || 'main',
        commitMessage,
        authorId: authorInfo.id,
        authorName: authorInfo.name,
        authorEmail: authorInfo.email
      })
      
      // Refresh version history
      await loadVersionHistory(currentBranch?.name)
      
      return version
    } catch (err) {
      setError(err as Error)
      throw err
    } finally {
      setLoading(false)
    }
  }, [modelId, currentBranch, service, loadVersionHistory])

  const createBranch = useCallback(async (
    name: string,
    description: string,
    userId: string
  ) => {
    try {
      setLoading(true)
      const branch = await service.createBranch({
        modelId,
        name,
        description,
        baseVersionId: currentBranch?.headVersionId || '',
        createdBy: userId
      })
      
      // Refresh branches
      await loadBranches()
      
      return branch
    } catch (err) {
      setError(err as Error)
      throw err
    } finally {
      setLoading(false)
    }
  }, [modelId, currentBranch, service, loadBranches])

  const switchBranch = useCallback(async (branchName: string) => {
    const branch = branches.find(b => b.name === branchName)
    if (branch) {
      setCurrentBranch(branch)
      await loadVersionHistory(branchName)
    }
  }, [branches, loadVersionHistory])

  const createMergeRequest = useCallback(async (
    targetBranchName: string,
    title: string,
    description: string,
    authorId: string,
    reviewers: string[]
  ) => {
    try {
      setLoading(true)
      
      const targetBranch = branches.find(b => b.name === targetBranchName)
      if (!targetBranch || !currentBranch) {
        throw new Error('Invalid branch selection')
      }

      const mergeRequest = await service.createMergeRequest({
        modelId,
        sourceBranchId: currentBranch.id,
        targetBranchId: targetBranch.id,
        title,
        description,
        authorId,
        reviewers
      })
      
      return mergeRequest
    } catch (err) {
      setError(err as Error)
      throw err
    } finally {
      setLoading(false)
    }
  }, [modelId, branches, currentBranch, service])

  const compareVersions = useCallback(async (
    versionId1: string,
    versionId2: string
  ): Promise<VersionComparisonResult> => {
    try {
      setLoading(true)
      return await service.compareVersions(versionId1, versionId2)
    } catch (err) {
      setError(err as Error)
      throw err
    } finally {
      setLoading(false)
    }
  }, [service])

  const rollback = useCallback(async (
    targetVersionId: string,
    userId: string,
    reason: string
  ) => {
    try {
      setLoading(true)
      const version = await service.rollback(modelId, targetVersionId, userId, reason)
      
      // Refresh version history
      await loadVersionHistory(currentBranch?.name)
      
      return version
    } catch (err) {
      setError(err as Error)
      throw err
    } finally {
      setLoading(false)
    }
  }, [modelId, currentBranch, service, loadVersionHistory])

  const createTag = useCallback(async (
    versionId: string,
    tagName: string,
    description: string,
    userId: string,
    isRelease: boolean = false
  ) => {
    try {
      setLoading(true)
      return await service.createTag({
        name: tagName,
        versionId,
        description,
        createdBy: userId,
        isRelease
      })
    } catch (err) {
      setError(err as Error)
      throw err
    } finally {
      setLoading(false)
    }
  }, [service])

  const getDiff = useCallback(async (
    fromVersionId: string,
    toVersionId: string
  ): Promise<VersionDiff> => {
    try {
      setLoading(true)
      return await service.getDiff(fromVersionId, toVersionId)
    } catch (err) {
      setError(err as Error)
      throw err
    } finally {
      setLoading(false)
    }
  }, [service])

  const getStorageStats = useCallback(async () => {
    try {
      const storage = service['modelStorage'] as any
      return await storage.getStorageStats(modelId)
    } catch (err) {
      setError(err as Error)
      throw err
    }
  }, [modelId, service])

  return {
    // State
    versions,
    branches,
    currentBranch,
    loading,
    error,

    // Actions
    createVersion,
    createBranch,
    switchBranch,
    createMergeRequest,
    compareVersions,
    rollback,
    createTag,
    getDiff,
    getStorageStats,

    // Refresh functions
    refresh: {
      versions: loadVersionHistory,
      branches: loadBranches
    }
  }
}

// Import supabase at the end to avoid circular dependencies
import { supabase } from '../supabase/supabaseClient'