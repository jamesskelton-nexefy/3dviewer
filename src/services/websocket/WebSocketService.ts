import { EventEmitter } from 'events'
import { io, Socket } from 'socket.io-client'

export interface WebSocketConfig {
  serverUrl: string
  reconnection?: boolean
  reconnectionAttempts?: number
  reconnectionDelay?: number
  timeout?: number
  auth?: Record<string, any>
}

export interface WebSocketMessage {
  event: string
  data: any
  timestamp: number
  id?: string
}

export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error'
}

export class WebSocketService extends EventEmitter {
  private socket: Socket | null = null
  private config: WebSocketConfig
  private connectionState: ConnectionState = ConnectionState.DISCONNECTED
  private messageQueue: WebSocketMessage[] = []
  private reconnectTimer: NodeJS.Timeout | null = null
  private pingInterval: NodeJS.Timeout | null = null
  private lastPingTime: number = 0
  private latency: number = 0

  constructor(config: WebSocketConfig) {
    super()
    this.config = {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 20000,
      ...config
    }
  }

  // Connect to WebSocket server
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.connectionState === ConnectionState.CONNECTED) {
        resolve()
        return
      }

      this.setConnectionState(ConnectionState.CONNECTING)

      try {
        this.socket = io(this.config.serverUrl, {
          transports: ['websocket'],
          reconnection: this.config.reconnection,
          reconnectionAttempts: this.config.reconnectionAttempts,
          reconnectionDelay: this.config.reconnectionDelay,
          timeout: this.config.timeout,
          auth: this.config.auth
        })

        this.setupEventHandlers()

        this.socket.on('connect', () => {
          this.setConnectionState(ConnectionState.CONNECTED)
          this.processMessageQueue()
          this.startPingInterval()
          resolve()
        })

        this.socket.on('connect_error', (error) => {
          this.setConnectionState(ConnectionState.ERROR)
          console.error('WebSocket connection error:', error)
          if (this.socket?.io.opts.reconnectionAttempts === 0) {
            reject(new Error(`Failed to connect: ${error.message}`))
          }
        })
      } catch (error) {
        this.setConnectionState(ConnectionState.ERROR)
        reject(error)
      }
    })
  }

  // Disconnect from server
  disconnect(): void {
    this.stopPingInterval()
    
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
    
    this.setConnectionState(ConnectionState.DISCONNECTED)
    this.messageQueue = []
  }

  // Send message with queueing support
  send(event: string, data: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const message: WebSocketMessage = {
        event,
        data,
        timestamp: Date.now(),
        id: this.generateMessageId()
      }

      if (this.connectionState === ConnectionState.CONNECTED && this.socket) {
        this.socket.emit(event, data, (response: any) => {
          if (response?.error) {
            reject(new Error(response.error))
          } else {
            resolve(response)
          }
        })
      } else {
        // Queue message for later sending
        this.messageQueue.push(message)
        this.emit('messageQueued', message)
        resolve()
      }
    })
  }

  // Send message and wait for response
  request(event: string, data: any, timeout: number = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.connectionState !== ConnectionState.CONNECTED) {
        reject(new Error('Not connected'))
        return
      }

      const timeoutId = setTimeout(() => {
        reject(new Error(`Request timeout: ${event}`))
      }, timeout)

      this.socket.emit(event, data, (response: any) => {
        clearTimeout(timeoutId)
        
        if (response?.error) {
          reject(new Error(response.error))
        } else {
          resolve(response)
        }
      })
    })
  }

  // Subscribe to events
  on(event: string, handler: (...args: any[]) => void): this {
    if (this.socket && event !== 'connect' && event !== 'disconnect' && 
        event !== 'error' && event !== 'connectionStateChange') {
      this.socket.on(event, handler)
    }
    return super.on(event, handler)
  }

  // Unsubscribe from events
  off(event: string, handler?: (...args: any[]) => void): this {
    if (this.socket) {
      this.socket.off(event, handler)
    }
    return super.removeListener(event, handler!)
  }

  // Setup internal event handlers
  private setupEventHandlers(): void {
    if (!this.socket) return

    this.socket.on('disconnect', (reason) => {
      this.stopPingInterval()
      this.setConnectionState(ConnectionState.DISCONNECTED)
      this.emit('disconnect', reason)
    })

    this.socket.on('reconnect', (attemptNumber) => {
      this.setConnectionState(ConnectionState.CONNECTED)
      this.startPingInterval()
      this.emit('reconnect', attemptNumber)
    })

    this.socket.on('reconnect_attempt', (attemptNumber) => {
      this.setConnectionState(ConnectionState.RECONNECTING)
      this.emit('reconnect_attempt', attemptNumber)
    })

    this.socket.on('error', (error) => {
      this.emit('error', error)
    })

    // Handle ping/pong for latency measurement
    this.socket.on('pong', () => {
      this.latency = Date.now() - this.lastPingTime
      this.emit('latencyUpdate', this.latency)
    })
  }

  // Process queued messages
  private processMessageQueue(): void {
    if (!this.socket || this.connectionState !== ConnectionState.CONNECTED) return

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()
      if (message) {
        this.socket.emit(message.event, message.data)
      }
    }
  }

  // Start ping interval for latency measurement
  private startPingInterval(): void {
    this.stopPingInterval()
    
    this.pingInterval = setInterval(() => {
      if (this.socket && this.connectionState === ConnectionState.CONNECTED) {
        this.lastPingTime = Date.now()
        this.socket.emit('ping')
      }
    }, 30000) // Ping every 30 seconds
  }

  // Stop ping interval
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }

  // Set connection state and emit event
  private setConnectionState(state: ConnectionState): void {
    const previousState = this.connectionState
    this.connectionState = state
    
    if (previousState !== state) {
      this.emit('connectionStateChange', { previous: previousState, current: state })
    }
  }

  // Generate unique message ID
  private generateMessageId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  // Get current connection state
  getConnectionState(): ConnectionState {
    return this.connectionState
  }

  // Get current latency
  getLatency(): number {
    return this.latency
  }

  // Check if connected
  isConnected(): boolean {
    return this.connectionState === ConnectionState.CONNECTED
  }

  // Get socket ID
  getSocketId(): string | null {
    return this.socket?.id || null
  }

  // Get queued message count
  getQueuedMessageCount(): number {
    return this.messageQueue.length
  }
}

export default WebSocketService