import { EventEmitter } from 'events'
import { Scene, Vector3 } from '@babylonjs/core'
import { WebSocketManager, ConnectionState } from '../websocket'
import { CursorTrackingService, Cursor3D } from './CursorTrackingService'
import { OperationalTransform, Operation, OperationType } from './OperationalTransform'
import CollaborativeAnnotationService from '../annotations/CollaborativeAnnotationService'
import { Activity, ActivityType } from '@/components/collaboration'
import { Annotation3D, AnnotationEvent } from '@/types/annotations'

export interface CollaborationConfig {
  serverUrl: string
  modelId: string
  userId: string
  userName: string
  token?: string
  scene: Scene
  enableCursors?: boolean
  enablePresence?: boolean
  enableActivities?: boolean
  enableOT?: boolean
}

export interface CollaborationState {
  connected: boolean
  connectionState: ConnectionState
  activeUsers: number
  cursorsVisible: boolean
  activitiesEnabled: boolean
  otEnabled: boolean
  pendingOperations: number
  latency: number
}

export class CollaborationManager extends EventEmitter {
  private config: CollaborationConfig
  private wsManager: WebSocketManager
  private cursorService: CursorTrackingService | null = null
  private otService: OperationalTransform | null = null
  private annotationService: CollaborativeAnnotationService | null = null
  private activities: Activity[] = []
  private cursorVisibilityMap: Map<string, boolean> = new Map()
  private isInitialized: boolean = false

  constructor(config: CollaborationConfig) {
    super()
    this.config = {
      enableCursors: true,
      enablePresence: true,
      enableActivities: true,
      enableOT: true,
      ...config
    }
    
    this.wsManager = new WebSocketManager({
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    })

    this.setupServices()
  }

  // Initialize services
  private setupServices(): void {
    // Setup cursor tracking
    if (this.config.enableCursors) {
      this.cursorService = new CursorTrackingService({
        scene: this.config.scene,
        userId: this.config.userId,
        userName: this.config.userName,
        updateInterval: 50,
        smoothing: true
      })

      this.cursorService.on('localCursorUpdate', (cursor: Cursor3D) => {
        this.broadcastCursorUpdate(cursor)
      })

      this.cursorService.on('sendCursorUpdate', (cursor: Cursor3D) => {
        this.sendMessage('cursor:update', cursor)
      })
    }

    // Setup operational transform
    if (this.config.enableOT) {
      this.otService = new OperationalTransform()
    }

    // Setup annotation service
    this.annotationService = new CollaborativeAnnotationService({
      serverUrl: this.config.serverUrl,
      modelId: this.config.modelId,
      userId: this.config.userId,
      userName: this.config.userName,
      token: this.config.token
    })

    this.setupAnnotationHandlers()
    this.setupWebSocketHandlers()
  }

  // Connect to collaboration server
  async connect(): Promise<void> {
    if (this.isInitialized) {
      throw new Error('Collaboration manager already initialized')
    }

    // Create WebSocket channels
    const mainChannel = this.wsManager.createChannel('main', {
      serverUrl: this.config.serverUrl,
      auth: {
        token: this.config.token,
        modelId: this.config.modelId,
        userId: this.config.userId,
        userName: this.config.userName
      }
    })

    // Setup channel event handlers
    mainChannel.on('cursor:update', (data: any) => {
      this.handleRemoteCursorUpdate(data)
    })

    mainChannel.on('presence:update', (data: any) => {
      this.handlePresenceUpdate(data)
    })

    mainChannel.on('activity:new', (data: any) => {
      this.handleNewActivity(data)
    })

    mainChannel.on('operation:remote', (data: any) => {
      this.handleRemoteOperation(data)
    })

    mainChannel.on('sync:state', (data: any) => {
      this.handleStateSync(data)
    })

    // Connect all services
    await Promise.all([
      this.wsManager.connectAll(),
      this.annotationService?.connect()
    ])

    // Start services
    if (this.cursorService) {
      this.cursorService.startTracking()
    }

    this.isInitialized = true
    this.emit('connected')
    this.addActivity({
      type: 'user_joined',
      userId: this.config.userId,
      userName: this.config.userName,
      data: {}
    })
  }

  // Disconnect from server
  async disconnect(): Promise<void> {
    if (!this.isInitialized) return

    this.addActivity({
      type: 'user_left',
      userId: this.config.userId,
      userName: this.config.userName,
      data: {}
    })

    // Stop services
    if (this.cursorService) {
      this.cursorService.stopTracking()
    }

    // Disconnect all
    this.annotationService?.disconnect()
    this.wsManager.disconnectAll()

    this.isInitialized = false
    this.emit('disconnected')
  }

  // Setup annotation event handlers
  private setupAnnotationHandlers(): void {
    if (!this.annotationService) return

    this.annotationService.on('annotationUpdate', (update: any) => {
      this.handleAnnotationUpdate(update)
    })

    this.annotationService.on('commentUpdate', (update: any) => {
      this.handleCommentUpdate(update)
    })

    this.annotationService.on('statusUpdate', (update: any) => {
      this.handleStatusUpdate(update)
    })

    this.annotationService.on('presenceUpdate', (presence: any) => {
      this.emit('presenceUpdate', presence)
    })
  }

  // Setup WebSocket event handlers
  private setupWebSocketHandlers(): void {
    this.wsManager.on('channelStateChange', ({ channel, current }: any) => {
      if (channel === 'main') {
        this.emit('connectionStateChange', current)
      }
    })

    this.wsManager.on('channelLatency', ({ channel, latency }: any) => {
      if (channel === 'main') {
        this.emit('latencyUpdate', latency)
      }
    })

    this.wsManager.on('channelError', ({ channel, error }: any) => {
      console.error(`WebSocket error on channel ${channel}:`, error)
      this.emit('error', error)
    })
  }

  // Handle remote cursor update
  private handleRemoteCursorUpdate(data: any): void {
    if (!this.cursorService) return

    const cursor: Cursor3D = {
      ...data,
      position: new Vector3(data.position.x, data.position.y, data.position.z),
      normal: data.normal ? new Vector3(data.normal.x, data.normal.y, data.normal.z) : undefined
    }

    // Apply cursor visibility settings
    const isVisible = this.cursorVisibilityMap.get(cursor.userId) !== false
    cursor.isVisible = cursor.isVisible && isVisible

    this.cursorService.updateRemoteCursor(cursor)
  }

  // Handle presence update
  private handlePresenceUpdate(data: any): void {
    this.emit('presenceUpdate', data)
  }

  // Handle new activity
  private handleNewActivity(data: any): void {
    const activity: Activity = {
      id: `activity-${Date.now()}-${Math.random()}`,
      timestamp: new Date(data.timestamp || Date.now()),
      ...data
    }

    this.activities.push(activity)
    
    // Keep only last 100 activities
    if (this.activities.length > 100) {
      this.activities = this.activities.slice(-100)
    }

    this.emit('activityUpdate', this.activities)
  }

  // Handle remote operation (OT)
  private handleRemoteOperation(data: any): void {
    if (!this.otService || !this.config.enableOT) return

    const operation: Operation = data
    
    // Transform against local pending operations
    const pendingOps = this.getPendingOperations()
    const transformed = this.otService.transformIncoming(operation, pendingOps)
    
    // Apply the transformed operation
    this.applyOperation(transformed)
    this.otService.applyOperation(transformed)
    
    this.emit('operationApplied', transformed)
  }

  // Handle state synchronization
  private handleStateSync(data: any): void {
    if (data.annotations) {
      this.emit('annotationsSync', data.annotations)
    }

    if (data.cursors && this.cursorService) {
      data.cursors.forEach((cursor: any) => {
        if (cursor.userId !== this.config.userId) {
          this.handleRemoteCursorUpdate(cursor)
        }
      })
    }

    if (data.activities) {
      this.activities = data.activities.map((a: any) => ({
        ...a,
        timestamp: new Date(a.timestamp)
      }))
      this.emit('activityUpdate', this.activities)
    }

    if (data.version && this.otService) {
      this.otService.setVersion(data.version)
    }
  }

  // Handle annotation update
  private handleAnnotationUpdate(update: any): void {
    if (this.config.enableOT && this.otService) {
      const operation: Operation = {
        id: `op-${Date.now()}`,
        type: OperationType.UPDATE,
        userId: update.userId,
        timestamp: Date.now(),
        version: this.otService.getCurrentVersion(),
        targetId: update.annotationId,
        data: update.changes
      }
      
      this.otService.applyOperation(operation)
    }

    this.addActivity({
      type: 'annotation_updated',
      userId: update.userId,
      userName: update.userName || 'Unknown User',
      data: {
        annotationId: update.annotationId,
        title: update.changes.content?.title,
        changes: update.changes
      }
    })
  }

  // Handle comment update
  private handleCommentUpdate(update: any): void {
    const activityType = update.parentCommentId ? 'comment_replied' : 'comment_added'
    
    this.addActivity({
      type: activityType,
      userId: update.comment.userId,
      userName: update.comment.userName,
      data: {
        annotationId: update.annotationId,
        commentId: update.comment.id,
        message: update.comment.message,
        parentCommentId: update.parentCommentId
      }
    })
  }

  // Handle status update
  private handleStatusUpdate(update: any): void {
    this.addActivity({
      type: 'status_changed',
      userId: update.userId,
      userName: 'User',
      data: {
        annotationId: update.annotationId,
        newStatus: update.status
      }
    })
  }

  // Send message through WebSocket
  private sendMessage(event: string, data: any): void {
    const channel = this.wsManager.getChannel('main')
    if (channel && channel.isConnected()) {
      channel.send(event, data)
    }
  }

  // Broadcast cursor update
  private broadcastCursorUpdate(cursor: Cursor3D): void {
    if (!this.config.enableCursors) return
    
    this.sendMessage('cursor:update', {
      userId: cursor.userId,
      userName: cursor.userName,
      position: { x: cursor.position.x, y: cursor.position.y, z: cursor.position.z },
      normal: cursor.normal ? { x: cursor.normal.x, y: cursor.normal.y, z: cursor.normal.z } : undefined,
      meshId: cursor.meshId,
      meshName: cursor.meshName,
      faceIndex: cursor.faceIndex,
      screenPosition: cursor.screenPosition,
      color: cursor.color,
      isVisible: cursor.isVisible
    })
  }

  // Add activity
  private addActivity(data: Omit<Activity, 'id' | 'timestamp'>): void {
    if (!this.config.enableActivities) return
    
    const activity: Activity = {
      id: `activity-${Date.now()}-${Math.random()}`,
      timestamp: new Date(),
      ...data
    }
    
    this.activities.push(activity)
    
    // Broadcast to others
    this.sendMessage('activity:new', activity)
    
    this.emit('activityUpdate', this.activities)
  }

  // Apply operation locally
  private applyOperation(operation: Operation): void {
    // This would apply the operation to the local state
    // Implementation depends on your data model
    this.emit('applyOperation', operation)
  }

  // Get pending operations
  private getPendingOperations(): Operation[] {
    // Return operations that haven't been acknowledged by server
    return []
  }

  // Public API methods

  // Get cursor service
  getCursorService(): CursorTrackingService | null {
    return this.cursorService
  }

  // Get annotation service
  getAnnotationService(): CollaborativeAnnotationService | null {
    return this.annotationService
  }

  // Get activities
  getActivities(): Activity[] {
    return [...this.activities]
  }

  // Mark activity as read
  markActivityAsRead(activityId: string): void {
    const activity = this.activities.find(a => a.id === activityId)
    if (activity) {
      activity.read = true
      this.emit('activityUpdate', this.activities)
    }
  }

  // Mark all activities as read
  markAllActivitiesAsRead(): void {
    this.activities.forEach(a => a.read = true)
    this.emit('activityUpdate', this.activities)
  }

  // Toggle cursor visibility
  toggleCursorVisibility(userId: string, visible: boolean): void {
    this.cursorVisibilityMap.set(userId, visible)
    
    if (this.cursorService) {
      this.cursorService.setCursorVisibility(userId, visible)
    }
  }

  // Send annotation update
  sendAnnotationUpdate(annotationId: string, changes: Partial<Annotation3D>): void {
    if (this.annotationService) {
      this.annotationService.sendAnnotationUpdate({
        annotationId,
        userId: this.config.userId,
        changes,
        timestamp: new Date()
      })
    }
  }

  // Get collaboration state
  getState(): CollaborationState {
    const mainChannel = this.wsManager.getChannel('main')
    const channelStatus = this.wsManager.getChannelStatus('main')
    
    return {
      connected: mainChannel?.isConnected() || false,
      connectionState: channelStatus?.state || ConnectionState.DISCONNECTED,
      activeUsers: this.annotationService?.getActiveUsers().length || 0,
      cursorsVisible: this.config.enableCursors || false,
      activitiesEnabled: this.config.enableActivities || false,
      otEnabled: this.config.enableOT || false,
      pendingOperations: this.getPendingOperations().length,
      latency: channelStatus?.latency || 0
    }
  }

  // Request full synchronization
  async requestSync(): Promise<void> {
    const mainChannel = this.wsManager.getChannel('main')
    if (mainChannel && mainChannel.isConnected()) {
      const response = await mainChannel.request('sync:request', {
        modelId: this.config.modelId,
        userId: this.config.userId
      })
      
      this.handleStateSync(response)
    }
  }

  // Cleanup resources
  dispose(): void {
    this.disconnect()
    this.wsManager.cleanup()
    this.removeAllListeners()
  }
}

// Singleton instance
let managerInstance: CollaborationManager | null = null

export function getCollaborationManager(config?: CollaborationConfig): CollaborationManager | null {
  if (!managerInstance && config) {
    managerInstance = new CollaborationManager(config)
  }
  return managerInstance
}

export function resetCollaborationManager(): void {
  if (managerInstance) {
    managerInstance.dispose()
    managerInstance = null
  }
}

export default CollaborationManager