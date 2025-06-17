import { EventEmitter } from 'events'
import { io, Socket } from 'socket.io-client'
import {
  Annotation3D,
  AnnotationEvent,
  AnnotationCollaborativeUpdate,
  AnnotationThread,
} from '@/types/annotations'

interface CollaborativeAnnotationConfig {
  serverUrl: string
  modelId: string
  userId: string
  userName: string
  token?: string
}

interface CollaborativeEvent {
  type: 'annotation' | 'comment' | 'status' | 'position' | 'presence'
  data: any
  userId: string
  userName: string
  timestamp: Date
}

interface UserPresence {
  userId: string
  userName: string
  cursor?: { x: number; y: number; z: number }
  selectedAnnotation?: string
  lastActivity: Date
}

export class CollaborativeAnnotationService extends EventEmitter {
  private socket: Socket | null = null
  private config: CollaborativeAnnotationConfig
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private presenceMap: Map<string, UserPresence> = new Map()
  private pendingUpdates: CollaborativeEvent[] = []
  private isConnected = false

  constructor(config: CollaborativeAnnotationConfig) {
    super()
    this.config = config
  }

  // Connect to collaboration server
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.socket = io(this.config.serverUrl, {
          auth: {
            token: this.config.token,
            modelId: this.config.modelId,
            userId: this.config.userId,
            userName: this.config.userName,
          },
          transports: ['websocket'],
          reconnection: true,
          reconnectionAttempts: this.maxReconnectAttempts,
          reconnectionDelay: this.reconnectDelay,
        })

        this.setupEventHandlers()

        this.socket.on('connect', () => {
          this.isConnected = true
          this.reconnectAttempts = 0
          this.joinModel()
          this.processPendingUpdates()
          resolve()
        })

        this.socket.on('connect_error', (error) => {
          console.error('WebSocket connection error:', error)
          if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            reject(new Error('Failed to connect to collaboration server'))
          }
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  // Disconnect from server
  disconnect(): void {
    if (this.socket) {
      this.leaveModel()
      this.socket.disconnect()
      this.socket = null
      this.isConnected = false
      this.presenceMap.clear()
    }
  }

  // Join model collaboration room
  private joinModel(): void {
    if (!this.socket) return

    this.socket.emit('join:model', {
      modelId: this.config.modelId,
      userId: this.config.userId,
      userName: this.config.userName,
    })
  }

  // Leave model collaboration room
  private leaveModel(): void {
    if (!this.socket) return

    this.socket.emit('leave:model', {
      modelId: this.config.modelId,
      userId: this.config.userId,
    })
  }

  // Setup WebSocket event handlers
  private setupEventHandlers(): void {
    if (!this.socket) return

    // Handle incoming collaborative events
    this.socket.on('collaborative:event', (event: CollaborativeEvent) => {
      this.handleCollaborativeEvent(event)
    })

    // Handle user presence updates
    this.socket.on('presence:update', (presence: UserPresence) => {
      this.handlePresenceUpdate(presence)
    })

    // Handle user disconnection
    this.socket.on('presence:leave', (userId: string) => {
      this.presenceMap.delete(userId)
      this.emit('presenceUpdate', Array.from(this.presenceMap.values()))
    })

    // Handle sync request
    this.socket.on('sync:request', (callback: (data: any) => void) => {
      this.emit('syncRequest', callback)
    })

    // Handle connection events
    this.socket.on('disconnect', () => {
      this.isConnected = false
      this.emit('disconnected')
    })

    this.socket.on('reconnect', (attemptNumber: number) => {
      this.reconnectAttempts = attemptNumber
      this.emit('reconnected')
    })
  }

  // Handle incoming collaborative events
  private handleCollaborativeEvent(event: CollaborativeEvent): void {
    // Ignore own events
    if (event.userId === this.config.userId) return

    switch (event.type) {
      case 'annotation':
        this.emit('annotationUpdate', event.data as AnnotationCollaborativeUpdate)
        break

      case 'comment':
        this.emit('commentUpdate', {
          annotationId: event.data.annotationId,
          comment: event.data.comment as AnnotationThread,
          parentCommentId: event.data.parentCommentId,
        })
        break

      case 'status':
        this.emit('statusUpdate', {
          annotationId: event.data.annotationId,
          status: event.data.status,
          userId: event.userId,
        })
        break

      case 'position':
        this.emit('positionUpdate', {
          annotationId: event.data.annotationId,
          position: event.data.position,
          userId: event.userId,
        })
        break
    }
  }

  // Handle presence updates
  private handlePresenceUpdate(presence: UserPresence): void {
    this.presenceMap.set(presence.userId, presence)
    this.emit('presenceUpdate', Array.from(this.presenceMap.values()))
  }

  // Send annotation update
  sendAnnotationUpdate(update: AnnotationCollaborativeUpdate): void {
    this.sendEvent('annotation', update)
  }

  // Send comment update
  sendCommentUpdate(
    annotationId: string,
    comment: AnnotationThread,
    parentCommentId?: string
  ): void {
    this.sendEvent('comment', {
      annotationId,
      comment,
      parentCommentId,
    })
  }

  // Send status update
  sendStatusUpdate(annotationId: string, status: string): void {
    this.sendEvent('status', {
      annotationId,
      status,
    })
  }

  // Send position update
  sendPositionUpdate(annotationId: string, position: any): void {
    this.sendEvent('position', {
      annotationId,
      position,
    })
  }

  // Update user presence
  updatePresence(data: Partial<UserPresence>): void {
    if (!this.socket || !this.isConnected) return

    const presence: UserPresence = {
      userId: this.config.userId,
      userName: this.config.userName,
      lastActivity: new Date(),
      ...data,
    }

    this.socket.emit('presence:update', presence)
  }

  // Send collaborative event
  private sendEvent(type: CollaborativeEvent['type'], data: any): void {
    const event: CollaborativeEvent = {
      type,
      data,
      userId: this.config.userId,
      userName: this.config.userName,
      timestamp: new Date(),
    }

    if (this.isConnected && this.socket) {
      this.socket.emit('collaborative:event', event)
    } else {
      // Store event for later sending
      this.pendingUpdates.push(event)
    }
  }

  // Process pending updates after reconnection
  private processPendingUpdates(): void {
    if (!this.isConnected || !this.socket) return

    while (this.pendingUpdates.length > 0) {
      const event = this.pendingUpdates.shift()
      if (event) {
        this.socket.emit('collaborative:event', event)
      }
    }
  }

  // Get active users
  getActiveUsers(): UserPresence[] {
    return Array.from(this.presenceMap.values())
  }

  // Request full sync
  requestSync(): Promise<{
    annotations: Annotation3D[]
    presence: UserPresence[]
  }> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.isConnected) {
        reject(new Error('Not connected to collaboration server'))
        return
      }

      this.socket.emit('sync:request', (response: any) => {
        if (response.error) {
          reject(new Error(response.error))
        } else {
          resolve(response)
        }
      })
    })
  }

  // Check connection status
  isConnectedToServer(): boolean {
    return this.isConnected
  }

  // Get connection info
  getConnectionInfo(): {
    connected: boolean
    reconnectAttempts: number
    activeUsers: number
  } {
    return {
      connected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      activeUsers: this.presenceMap.size,
    }
  }
}

export default CollaborativeAnnotationService