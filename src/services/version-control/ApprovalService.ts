import { 
  ApprovalWorkflow, 
  Approval, 
  WorkflowStatus,
  VersionControlConfig 
} from './types'
import { supabase } from '../supabase/supabaseClient'

export class ApprovalService {
  private config: VersionControlConfig

  constructor(config: VersionControlConfig) {
    this.config = config
  }

  /**
   * Create an approval workflow for a version
   */
  async createWorkflow(params: {
    modelId: string
    versionId: string
    requiredApprovers: string[]
    deadline?: Date
    autoApproveAt?: Date
  }): Promise<ApprovalWorkflow> {
    try {
      const workflow: ApprovalWorkflow = {
        id: crypto.randomUUID(),
        modelId: params.modelId,
        versionId: params.versionId,
        requiredApprovers: params.requiredApprovers,
        approvals: params.requiredApprovers.map(userId => ({
          userId,
          userName: '', // Will be populated from user service
          status: 'pending'
        })),
        status: 'pending',
        createdAt: new Date(),
        deadline: params.deadline,
        autoApproveAt: params.autoApproveAt
      }

      const { data, error } = await supabase
        .from('approval_workflows')
        .insert(workflow)
        .select()
        .single()

      if (error) throw error

      // Send notifications to approvers
      await this.notifyApprovers(data.id, params.requiredApprovers)

      // Schedule auto-approval if configured
      if (params.autoApproveAt) {
        await this.scheduleAutoApproval(data.id, params.autoApproveAt)
      }

      return data
    } catch (error) {
      console.error('Error creating approval workflow:', error)
      throw error
    }
  }

  /**
   * Submit an approval decision
   */
  async submitApproval(params: {
    workflowId: string
    userId: string
    status: 'approved' | 'rejected'
    comments?: string
  }): Promise<void> {
    try {
      // Get the workflow
      const { data: workflow, error: fetchError } = await supabase
        .from('approval_workflows')
        .select('*')
        .eq('id', params.workflowId)
        .single()

      if (fetchError) throw fetchError

      if (!workflow) {
        throw new Error('Workflow not found')
      }

      if (workflow.status !== 'pending') {
        throw new Error(`Cannot approve workflow with status: ${workflow.status}`)
      }

      // Check if user is an approver
      if (!workflow.requiredApprovers.includes(params.userId)) {
        throw new Error('User is not authorized to approve this workflow')
      }

      // Update the approval
      const approvals = workflow.approvals.map((approval: Approval) => {
        if (approval.userId === params.userId) {
          return {
            ...approval,
            status: params.status,
            comments: params.comments,
            approvedAt: new Date()
          }
        }
        return approval
      })

      // Check if workflow is complete
      const newStatus = this.calculateWorkflowStatus(approvals)

      // Update workflow
      const { error: updateError } = await supabase
        .from('approval_workflows')
        .update({
          approvals,
          status: newStatus
        })
        .eq('id', params.workflowId)

      if (updateError) throw updateError

      // If approved, update the version status
      if (newStatus === 'approved') {
        await this.approveVersion(workflow.versionId)
      } else if (newStatus === 'rejected') {
        await this.rejectVersion(workflow.versionId, params.comments)
      }

      // Notify relevant parties
      await this.notifyWorkflowUpdate(params.workflowId, newStatus)
    } catch (error) {
      console.error('Error submitting approval:', error)
      throw error
    }
  }

  /**
   * Check if a merge request has required approvals
   */
  async checkApprovals(mergeRequestId: string): Promise<{
    isApproved: boolean
    pendingApprovers: string[]
    approvedBy: string[]
    rejectedBy: string[]
  }> {
    try {
      // Get merge request with its approval workflow
      const { data: mergeRequest } = await supabase
        .from('merge_requests')
        .select('*, approval_workflows(*)')
        .eq('id', mergeRequestId)
        .single()

      if (!mergeRequest || !mergeRequest.approval_workflows) {
        return {
          isApproved: !this.config.requireApproval,
          pendingApprovers: [],
          approvedBy: [],
          rejectedBy: []
        }
      }

      const workflow = mergeRequest.approval_workflows[0]
      const approvals = workflow.approvals || []

      const pendingApprovers = approvals
        .filter((a: Approval) => a.status === 'pending')
        .map((a: Approval) => a.userId)

      const approvedBy = approvals
        .filter((a: Approval) => a.status === 'approved')
        .map((a: Approval) => a.userId)

      const rejectedBy = approvals
        .filter((a: Approval) => a.status === 'rejected')
        .map((a: Approval) => a.userId)

      const isApproved = workflow.status === 'approved' || 
        (approvedBy.length >= this.config.minApprovers && rejectedBy.length === 0)

      return {
        isApproved,
        pendingApprovers,
        approvedBy,
        rejectedBy
      }
    } catch (error) {
      console.error('Error checking approvals:', error)
      throw error
    }
  }

  /**
   * Get approval history for a model
   */
  async getApprovalHistory(
    modelId: string,
    options?: {
      limit?: number
      offset?: number
      status?: WorkflowStatus
    }
  ): Promise<ApprovalWorkflow[]> {
    try {
      let query = supabase
        .from('approval_workflows')
        .select('*')
        .eq('modelId', modelId)
        .order('createdAt', { ascending: false })

      if (options?.status) {
        query = query.eq('status', options.status)
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
      console.error('Error fetching approval history:', error)
      throw error
    }
  }

  /**
   * Cancel an approval workflow
   */
  async cancelWorkflow(workflowId: string, reason: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('approval_workflows')
        .update({
          status: 'rejected' as WorkflowStatus,
          metadata: { cancelReason: reason }
        })
        .eq('id', workflowId)
        .eq('status', 'pending')

      if (error) throw error

      await this.notifyWorkflowUpdate(workflowId, 'rejected')
    } catch (error) {
      console.error('Error canceling workflow:', error)
      throw error
    }
  }

  /**
   * Process expired workflows
   */
  async processExpiredWorkflows(): Promise<void> {
    try {
      const now = new Date()

      // Find expired workflows
      const { data: expiredWorkflows, error } = await supabase
        .from('approval_workflows')
        .select('*')
        .eq('status', 'pending')
        .lt('deadline', now.toISOString())

      if (error) throw error

      if (!expiredWorkflows || expiredWorkflows.length === 0) {
        return
      }

      // Update expired workflows
      for (const workflow of expiredWorkflows) {
        await supabase
          .from('approval_workflows')
          .update({ status: 'expired' as WorkflowStatus })
          .eq('id', workflow.id)

        await this.notifyWorkflowUpdate(workflow.id, 'expired')
      }
    } catch (error) {
      console.error('Error processing expired workflows:', error)
    }
  }

  /**
   * Process auto-approvals
   */
  async processAutoApprovals(): Promise<void> {
    try {
      const now = new Date()

      // Find workflows ready for auto-approval
      const { data: readyWorkflows, error } = await supabase
        .from('approval_workflows')
        .select('*')
        .eq('status', 'pending')
        .lt('autoApproveAt', now.toISOString())

      if (error) throw error

      if (!readyWorkflows || readyWorkflows.length === 0) {
        return
      }

      // Auto-approve workflows
      for (const workflow of readyWorkflows) {
        await this.autoApprove(workflow.id)
      }
    } catch (error) {
      console.error('Error processing auto-approvals:', error)
    }
  }

  // Private helper methods

  private calculateWorkflowStatus(approvals: Approval[]): WorkflowStatus {
    const rejectedCount = approvals.filter(a => a.status === 'rejected').length
    const approvedCount = approvals.filter(a => a.status === 'approved').length
    const pendingCount = approvals.filter(a => a.status === 'pending').length

    if (rejectedCount > 0) {
      return 'rejected'
    }

    if (approvedCount >= this.config.minApprovers) {
      return 'approved'
    }

    if (pendingCount === 0) {
      return 'rejected' // All reviewed but not enough approvals
    }

    return 'pending'
  }

  private async approveVersion(versionId: string): Promise<void> {
    await supabase
      .from('model_versions')
      .update({ status: 'approved' })
      .eq('id', versionId)
  }

  private async rejectVersion(versionId: string, reason?: string): Promise<void> {
    await supabase
      .from('model_versions')
      .update({ 
        status: 'rejected',
        metadata: { rejectionReason: reason }
      })
      .eq('id', versionId)
  }

  private async autoApprove(workflowId: string): Promise<void> {
    const { data: workflow } = await supabase
      .from('approval_workflows')
      .select('*')
      .eq('id', workflowId)
      .single()

    if (!workflow) return

    // Mark all pending approvals as auto-approved
    const approvals = workflow.approvals.map((approval: Approval) => ({
      ...approval,
      status: approval.status === 'pending' ? 'approved' : approval.status,
      comments: approval.status === 'pending' ? 'Auto-approved' : approval.comments,
      approvedAt: approval.status === 'pending' ? new Date() : approval.approvedAt
    }))

    await supabase
      .from('approval_workflows')
      .update({
        approvals,
        status: 'approved' as WorkflowStatus
      })
      .eq('id', workflowId)

    await this.approveVersion(workflow.versionId)
    await this.notifyWorkflowUpdate(workflowId, 'approved')
  }

  private async notifyApprovers(workflowId: string, approverIds: string[]): Promise<void> {
    // Send notifications via email/websocket
    console.log(`Notifying approvers for workflow ${workflowId}:`, approverIds)
    
    // In production, this would:
    // 1. Look up approver email addresses
    // 2. Send email notifications
    // 3. Send real-time notifications via WebSocket
    // 4. Create in-app notifications
  }

  private async notifyWorkflowUpdate(
    workflowId: string, 
    status: WorkflowStatus
  ): Promise<void> {
    // Notify relevant parties about workflow status change
    console.log(`Workflow ${workflowId} status changed to: ${status}`)
    
    // In production, this would notify:
    // 1. The version author
    // 2. Other approvers
    // 3. Watchers/subscribers
  }

  private async scheduleAutoApproval(
    workflowId: string, 
    autoApproveAt: Date
  ): Promise<void> {
    // Schedule auto-approval job
    console.log(`Scheduling auto-approval for workflow ${workflowId} at ${autoApproveAt}`)
    
    // In production, this would use a job queue like:
    // - BullMQ
    // - Agenda
    // - Node-cron
    // - Cloud scheduler (AWS EventBridge, Google Cloud Scheduler)
  }
}