import { EventEmitter } from 'events'
import WebSocketService, { ConnectionState, WebSocketConfig } from './WebSocketService'

export interface WebSocketChannel {
  name: string
  service: WebSocketService
  config: WebSocketConfig
  autoReconnect: boolean
}

export class WebSocketManager extends EventEmitter {
  private channels: Map<string, WebSocketChannel> = new Map()
  private defaultConfig: Partial<WebSocketConfig> = {}

  constructor(defaultConfig?: Partial<WebSocketConfig>) {
    super()
    if (defaultConfig) {
      this.defaultConfig = defaultConfig
    }
  }

  // Create or get a WebSocket channel
  createChannel(
    name: string, 
    config: WebSocketConfig, 
    autoReconnect: boolean = true
  ): WebSocketService {
    if (this.channels.has(name)) {
      return this.channels.get(name)!.service
    }

    const mergedConfig = { ...this.defaultConfig, ...config }
    const service = new WebSocketService(mergedConfig)

    // Forward events from service
    service.on('connectionStateChange', (state) => {
      this.emit('channelStateChange', { channel: name, ...state })
    })

    service.on('error', (error) => {
      this.emit('channelError', { channel: name, error })
    })

    service.on('latencyUpdate', (latency) => {
      this.emit('channelLatency', { channel: name, latency })
    })

    const channel: WebSocketChannel = {
      name,
      service,
      config: mergedConfig,
      autoReconnect
    }

    this.channels.set(name, channel)
    return service
  }

  // Get existing channel
  getChannel(name: string): WebSocketService | null {
    const channel = this.channels.get(name)
    return channel ? channel.service : null
  }

  // Connect a specific channel
  async connectChannel(name: string): Promise<void> {
    const channel = this.channels.get(name)
    if (!channel) {
      throw new Error(`Channel '${name}' not found`)
    }

    try {
      await channel.service.connect()
    } catch (error) {
      if (channel.autoReconnect) {
        this.scheduleReconnect(name)
      }
      throw error
    }
  }

  // Connect all channels
  async connectAll(): Promise<void> {
    const promises = Array.from(this.channels.keys()).map(name => 
      this.connectChannel(name).catch(error => {
        console.error(`Failed to connect channel '${name}':`, error)
        return error
      })
    )

    await Promise.all(promises)
  }

  // Disconnect a specific channel
  disconnectChannel(name: string): void {
    const channel = this.channels.get(name)
    if (channel) {
      channel.service.disconnect()
    }
  }

  // Disconnect all channels
  disconnectAll(): void {
    for (const channel of this.channels.values()) {
      channel.service.disconnect()
    }
  }

  // Remove a channel
  removeChannel(name: string): void {
    const channel = this.channels.get(name)
    if (channel) {
      channel.service.disconnect()
      this.channels.delete(name)
    }
  }

  // Get all channels
  getChannels(): string[] {
    return Array.from(this.channels.keys())
  }

  // Get channel status
  getChannelStatus(name: string): {
    connected: boolean
    state: ConnectionState
    latency: number
    queuedMessages: number
  } | null {
    const channel = this.channels.get(name)
    if (!channel) return null

    return {
      connected: channel.service.isConnected(),
      state: channel.service.getConnectionState(),
      latency: channel.service.getLatency(),
      queuedMessages: channel.service.getQueuedMessageCount()
    }
  }

  // Get all channels status
  getAllChannelStatus(): Record<string, {
    connected: boolean
    state: ConnectionState
    latency: number
    queuedMessages: number
  }> {
    const status: Record<string, any> = {}
    
    for (const [name, channel] of this.channels) {
      status[name] = {
        connected: channel.service.isConnected(),
        state: channel.service.getConnectionState(),
        latency: channel.service.getLatency(),
        queuedMessages: channel.service.getQueuedMessageCount()
      }
    }

    return status
  }

  // Schedule reconnection for a channel
  private scheduleReconnect(name: string, delay: number = 5000): void {
    setTimeout(() => {
      const channel = this.channels.get(name)
      if (channel && !channel.service.isConnected()) {
        this.connectChannel(name).catch(error => {
          console.error(`Reconnection failed for channel '${name}':`, error)
          // Schedule another reconnect with exponential backoff
          this.scheduleReconnect(name, Math.min(delay * 2, 60000))
        })
      }
    }, delay)
  }

  // Broadcast message to all connected channels
  async broadcast(event: string, data: any): Promise<void> {
    const promises = Array.from(this.channels.values())
      .filter(channel => channel.service.isConnected())
      .map(channel => channel.service.send(event, data))

    await Promise.all(promises)
  }

  // Send message to specific channels
  async sendToChannels(channels: string[], event: string, data: any): Promise<void> {
    const promises = channels
      .map(name => this.channels.get(name))
      .filter(channel => channel && channel.service.isConnected())
      .map(channel => channel!.service.send(event, data))

    await Promise.all(promises)
  }

  // Update default configuration
  setDefaultConfig(config: Partial<WebSocketConfig>): void {
    this.defaultConfig = { ...this.defaultConfig, ...config }
  }

  // Cleanup all resources
  cleanup(): void {
    this.disconnectAll()
    this.channels.clear()
    this.removeAllListeners()
  }
}

// Singleton instance
let managerInstance: WebSocketManager | null = null

export function getWebSocketManager(config?: Partial<WebSocketConfig>): WebSocketManager {
  if (!managerInstance) {
    managerInstance = new WebSocketManager(config)
  }
  return managerInstance
}

export default WebSocketManager