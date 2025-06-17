import { Vector3, Ray, Scene, Mesh, AbstractMesh } from '@babylonjs/core'
import { EventEmitter } from 'events'

export interface Cursor3D {
  userId: string
  userName: string
  position: Vector3
  normal?: Vector3
  meshId?: string
  meshName?: string
  faceIndex?: number
  screenPosition: { x: number; y: number }
  timestamp: number
  color: string
  isVisible: boolean
}

export interface CursorUpdate {
  userId: string
  position?: Vector3
  normal?: Vector3
  meshId?: string
  meshName?: string
  faceIndex?: number
  screenPosition?: { x: number; y: number }
  isVisible?: boolean
}

export interface CursorTrackingConfig {
  scene: Scene
  userId: string
  userName: string
  updateInterval?: number // Milliseconds between cursor updates
  smoothing?: boolean
  smoothingFactor?: number // 0-1, higher = smoother
  maxDistance?: number // Maximum raycast distance
}

export class CursorTrackingService extends EventEmitter {
  private scene: Scene
  private userId: string
  private userName: string
  private cursors: Map<string, Cursor3D> = new Map()
  private updateInterval: number
  private smoothing: boolean
  private smoothingFactor: number
  private maxDistance: number
  private updateTimer: NodeJS.Timeout | null = null
  private lastLocalUpdate: number = 0
  private localCursor: Cursor3D | null = null
  private colors: string[] = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57',
    '#FF9FF3', '#54A0FF', '#48DBFB', '#0ABDE3', '#00D2D3'
  ]
  private colorIndex: number = 0

  constructor(config: CursorTrackingConfig) {
    super()
    this.scene = config.scene
    this.userId = config.userId
    this.userName = config.userName
    this.updateInterval = config.updateInterval || 50 // 20 FPS default
    this.smoothing = config.smoothing !== false
    this.smoothingFactor = config.smoothingFactor || 0.15
    this.maxDistance = config.maxDistance || 1000
  }

  // Start tracking local cursor
  startTracking(): void {
    if (this.updateTimer) return

    // Create local cursor
    this.localCursor = {
      userId: this.userId,
      userName: this.userName,
      position: new Vector3(0, 0, 0),
      screenPosition: { x: 0, y: 0 },
      timestamp: Date.now(),
      color: this.getNextColor(),
      isVisible: true
    }

    // Listen to pointer events
    this.scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type === 2) { // POINTERMOVE
        this.updateLocalCursor(pointerInfo.event as PointerEvent)
      }
    })

    // Start update loop
    this.updateTimer = setInterval(() => {
      this.processUpdateQueue()
    }, this.updateInterval)
  }

  // Stop tracking
  stopTracking(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer)
      this.updateTimer = null
    }

    // Clear all cursors
    this.cursors.clear()
    this.localCursor = null
  }

  // Update local cursor position
  private updateLocalCursor(event: PointerEvent): void {
    const canvas = this.scene.getEngine().getRenderingCanvas()
    if (!canvas || !this.localCursor) return

    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    // Create picking ray
    const pickResult = this.scene.pick(x, y, (mesh) => {
      return mesh.isEnabled() && mesh.isVisible && mesh.isPickable
    }, false, this.scene.activeCamera, (p0, p1, p2, ray) => {
      // Custom triangle predicate if needed
      return true
    })

    if (pickResult && pickResult.hit && pickResult.pickedPoint) {
      this.localCursor.position = pickResult.pickedPoint
      this.localCursor.normal = pickResult.getNormal(true, true)
      this.localCursor.meshId = pickResult.pickedMesh?.id
      this.localCursor.meshName = pickResult.pickedMesh?.name
      this.localCursor.faceIndex = pickResult.faceId
      this.localCursor.isVisible = true
    } else {
      // Cast ray to a far plane if no mesh hit
      const ray = this.scene.createPickingRay(x, y, Matrix.Identity(), this.scene.activeCamera)
      if (ray) {
        this.localCursor.position = ray.origin.add(ray.direction.scale(this.maxDistance / 2))
        this.localCursor.normal = undefined
        this.localCursor.meshId = undefined
        this.localCursor.meshName = undefined
        this.localCursor.faceIndex = undefined
        this.localCursor.isVisible = true
      }
    }

    this.localCursor.screenPosition = { x, y }
    this.localCursor.timestamp = Date.now()

    // Emit local cursor update
    this.emit('localCursorUpdate', this.localCursor)
  }

  // Update remote cursor
  updateRemoteCursor(update: CursorUpdate): void {
    let cursor = this.cursors.get(update.userId)

    if (!cursor) {
      // Create new cursor
      cursor = {
        userId: update.userId,
        userName: update.userName || 'Unknown User',
        position: update.position || new Vector3(0, 0, 0),
        normal: update.normal,
        meshId: update.meshId,
        meshName: update.meshName,
        faceIndex: update.faceIndex,
        screenPosition: update.screenPosition || { x: 0, y: 0 },
        timestamp: Date.now(),
        color: this.getNextColor(),
        isVisible: update.isVisible !== false
      }
      this.cursors.set(update.userId, cursor)
    } else {
      // Update existing cursor with smoothing
      if (update.position) {
        if (this.smoothing && cursor.position) {
          cursor.position = Vector3.Lerp(
            cursor.position,
            update.position,
            this.smoothingFactor
          )
        } else {
          cursor.position = update.position
        }
      }

      if (update.normal !== undefined) cursor.normal = update.normal
      if (update.meshId !== undefined) cursor.meshId = update.meshId
      if (update.meshName !== undefined) cursor.meshName = update.meshName
      if (update.faceIndex !== undefined) cursor.faceIndex = update.faceIndex
      if (update.screenPosition) cursor.screenPosition = update.screenPosition
      if (update.isVisible !== undefined) cursor.isVisible = update.isVisible
      
      cursor.timestamp = Date.now()
    }

    this.emit('remoteCursorUpdate', cursor)
  }

  // Remove remote cursor
  removeRemoteCursor(userId: string): void {
    const cursor = this.cursors.get(userId)
    if (cursor) {
      this.cursors.delete(userId)
      this.emit('remoteCursorRemoved', cursor)
    }
  }

  // Get all active cursors
  getActiveCursors(): Cursor3D[] {
    const cursors = Array.from(this.cursors.values())
    
    // Include local cursor
    if (this.localCursor) {
      cursors.push(this.localCursor)
    }

    // Filter out stale cursors (no update in last 5 seconds)
    const now = Date.now()
    return cursors.filter(cursor => now - cursor.timestamp < 5000)
  }

  // Get cursor by user ID
  getCursor(userId: string): Cursor3D | null {
    if (userId === this.userId) {
      return this.localCursor
    }
    return this.cursors.get(userId) || null
  }

  // Process update queue
  private processUpdateQueue(): void {
    const now = Date.now()
    
    // Throttle local updates
    if (this.localCursor && now - this.lastLocalUpdate >= this.updateInterval) {
      this.emit('sendCursorUpdate', this.localCursor)
      this.lastLocalUpdate = now
    }

    // Clean up stale cursors
    const staleThreshold = now - 5000
    for (const [userId, cursor] of this.cursors) {
      if (cursor.timestamp < staleThreshold) {
        this.removeRemoteCursor(userId)
      }
    }
  }

  // Convert screen position to 3D position
  screenTo3D(screenX: number, screenY: number): Vector3 | null {
    const pickResult = this.scene.pick(screenX, screenY)
    
    if (pickResult && pickResult.hit && pickResult.pickedPoint) {
      return pickResult.pickedPoint
    }

    // Cast ray to far plane
    const ray = this.scene.createPickingRay(
      screenX, 
      screenY, 
      Matrix.Identity(), 
      this.scene.activeCamera
    )
    
    if (ray) {
      return ray.origin.add(ray.direction.scale(this.maxDistance / 2))
    }

    return null
  }

  // Convert 3D position to screen position
  worldToScreen(position: Vector3): { x: number; y: number } | null {
    const camera = this.scene.activeCamera
    if (!camera) return null

    const canvas = this.scene.getEngine().getRenderingCanvas()
    if (!canvas) return null

    const coordinates = Vector3.Project(
      position,
      Matrix.Identity(),
      this.scene.getTransformMatrix(),
      camera.viewport.toGlobal(
        canvas.width,
        canvas.height
      )
    )

    return {
      x: coordinates.x,
      y: coordinates.y
    }
  }

  // Get next available color
  private getNextColor(): string {
    const color = this.colors[this.colorIndex % this.colors.length]
    this.colorIndex++
    return color
  }

  // Update cursor colors
  updateCursorColor(userId: string, color: string): void {
    const cursor = this.cursors.get(userId)
    if (cursor) {
      cursor.color = color
      this.emit('cursorColorUpdate', { userId, color })
    }
  }

  // Set cursor visibility
  setCursorVisibility(userId: string, isVisible: boolean): void {
    const cursor = this.cursors.get(userId)
    if (cursor) {
      cursor.isVisible = isVisible
      this.emit('cursorVisibilityUpdate', { userId, isVisible })
    }
  }

  // Clear all remote cursors
  clearRemoteCursors(): void {
    const userIds = Array.from(this.cursors.keys())
    userIds.forEach(userId => this.removeRemoteCursor(userId))
  }

  // Get cursor statistics
  getCursorStats(): {
    totalCursors: number
    activeCursors: number
    localCursor: boolean
    updateRate: number
  } {
    const activeCursors = this.getActiveCursors()
    
    return {
      totalCursors: this.cursors.size + (this.localCursor ? 1 : 0),
      activeCursors: activeCursors.length,
      localCursor: !!this.localCursor,
      updateRate: 1000 / this.updateInterval
    }
  }
}

export default CursorTrackingService