import { Scene, Vector3, Ray, PickingInfo } from '@babylonjs/core'
import { EventEmitter } from 'events'
import {
  Annotation3D,
  AnnotationType,
  AnnotationFilter,
  AnnotationEvent,
  AnnotationEventType,
  AnnotationCollaborativeUpdate,
  AnnotationDisplaySettings,
  AnnotationStatus,
  AnnotationContent,
  AnnotationThread,
} from '@/types/annotations'

export class AnnotationManager extends EventEmitter {
  private scene: Scene | null = null
  private annotations: Map<string, Annotation3D> = new Map()
  private activeAnnotation: Annotation3D | null = null
  private displaySettings: AnnotationDisplaySettings
  private userId: string
  private userName: string
  private filter: AnnotationFilter | null = null
  private collaborativeUpdates: Map<string, AnnotationCollaborativeUpdate[]> = new Map()
  
  constructor(userId: string, userName: string) {
    super()
    this.userId = userId
    this.userName = userName
    
    this.displaySettings = {
      showLabels: true,
      showConnectors: true,
      opacity: 1,
      scale: 1,
      minDistance: 0.5,
      maxDistance: 100,
      fadeWithDistance: true,
      groupNearby: true,
      groupingThreshold: 2, // meters
    }
  }

  // Initialize with Babylon.js scene
  initialize(scene: Scene): void {
    this.scene = scene
    this.setupSceneInteraction()
  }

  // Scene interaction setup
  private setupSceneInteraction(): void {
    if (!this.scene) return

    // Handle clicks for annotation selection
    this.scene.onPointerObservable.add((pointerInfo) => {
      switch (pointerInfo.type) {
        case 2: // POINTERDOWN
          this.handlePointerDown(pointerInfo)
          break
        case 4: // POINTERUP
          this.handlePointerUp(pointerInfo)
          break
        case 8: // POINTERMOVE
          this.handlePointerMove(pointerInfo)
          break
      }
    })
  }

  // Create new annotation
  async createAnnotation(
    type: AnnotationType,
    position: Vector3,
    content: AnnotationContent,
    metadata?: Partial<Annotation3D>
  ): Promise<Annotation3D> {
    if (!this.scene) throw new Error('Scene not initialized')

    // Get surface normal if clicking on mesh
    const pickInfo = this.getPickingInfo(position)
    const normal = pickInfo?.getNormal(true) || new Vector3(0, 1, 0)

    const annotation: Annotation3D = {
      id: this.generateId(),
      modelId: metadata?.modelId || '',
      userId: this.userId,
      userName: this.userName,
      type,
      position: position.clone(),
      normal: normal.clone(),
      cameraPosition: this.scene.activeCamera?.position.clone(),
      content,
      thread: [],
      visibility: {
        isPublic: true,
        viewAngle: 90,
        distanceRange: {
          min: this.displaySettings.minDistance,
          max: this.displaySettings.maxDistance,
        },
      },
      status: 'open',
      metadata: {
        version: '1.0.0',
        meshId: pickInfo?.pickedMesh?.id,
        meshName: pickInfo?.pickedMesh?.name,
        faceIndex: pickInfo?.faceId,
        viewMatrix: this.scene.activeCamera?.getViewMatrix().toArray(),
        ...metadata?.metadata,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      ...metadata,
    }

    this.annotations.set(annotation.id, annotation)
    this.emitEvent('created', annotation)
    
    return annotation
  }

  // Update annotation
  async updateAnnotation(
    id: string,
    updates: Partial<Annotation3D>
  ): Promise<Annotation3D | null> {
    const annotation = this.annotations.get(id)
    if (!annotation) return null

    const previousState = { ...annotation }
    const updatedAnnotation: Annotation3D = {
      ...annotation,
      ...updates,
      updatedAt: new Date(),
    }

    this.annotations.set(id, updatedAnnotation)
    this.emitEvent('updated', updatedAnnotation, previousState)

    // Handle collaborative updates
    this.addCollaborativeUpdate(id, updates)

    return updatedAnnotation
  }

  // Delete annotation
  async deleteAnnotation(id: string): Promise<boolean> {
    const annotation = this.annotations.get(id)
    if (!annotation) return false

    this.annotations.delete(id)
    this.emitEvent('deleted', annotation)
    
    if (this.activeAnnotation?.id === id) {
      this.activeAnnotation = null
    }

    return true
  }

  // Add comment to thread
  async addComment(
    annotationId: string,
    message: string,
    richText?: string,
    parentCommentId?: string
  ): Promise<AnnotationThread | null> {
    const annotation = this.annotations.get(annotationId)
    if (!annotation) return null

    const comment: AnnotationThread = {
      id: this.generateId(),
      userId: this.userId,
      userName: this.userName,
      message,
      richText,
      createdAt: new Date(),
      updatedAt: new Date(),
      replies: [],
    }

    if (parentCommentId) {
      // Add as reply
      const parentComment = this.findComment(annotation.thread, parentCommentId)
      if (parentComment) {
        parentComment.replies = parentComment.replies || []
        parentComment.replies.push(comment)
      }
    } else {
      // Add to main thread
      annotation.thread.push(comment)
    }

    annotation.updatedAt = new Date()
    this.emitEvent('comment_added', annotation)

    return comment
  }

  // Update annotation status
  async updateStatus(id: string, status: AnnotationStatus): Promise<boolean> {
    const annotation = this.annotations.get(id)
    if (!annotation) return false

    const previousState = { ...annotation }
    annotation.status = status
    annotation.updatedAt = new Date()

    this.emitEvent('status_changed', annotation, previousState)
    return true
  }

  // Get annotations by filter
  getAnnotations(filter?: AnnotationFilter): Annotation3D[] {
    let annotations = Array.from(this.annotations.values())

    if (filter) {
      annotations = this.applyFilter(annotations, filter)
    }

    return annotations
  }

  // Get single annotation
  getAnnotation(id: string): Annotation3D | null {
    return this.annotations.get(id) || null
  }

  // Set active annotation
  setActiveAnnotation(id: string | null): void {
    if (id === null) {
      this.activeAnnotation = null
      return
    }

    const annotation = this.annotations.get(id)
    if (annotation) {
      this.activeAnnotation = annotation
      this.emit('annotationSelected', annotation)
    }
  }

  // Get annotations in viewport
  getVisibleAnnotations(): Annotation3D[] {
    if (!this.scene || !this.scene.activeCamera) return []

    const camera = this.scene.activeCamera
    const annotations = this.getAnnotations(this.filter || undefined)

    return annotations.filter(annotation => {
      // Check distance
      const distance = Vector3.Distance(camera.position, annotation.position)
      if (distance < annotation.visibility.distanceRange?.min || 
          distance > annotation.visibility.distanceRange?.max) {
        return false
      }

      // Check view angle if specified
      if (annotation.visibility.viewAngle && annotation.normal) {
        const toCamera = camera.position.subtract(annotation.position).normalize()
        const angle = Math.acos(Vector3.Dot(annotation.normal, toCamera)) * (180 / Math.PI)
        if (angle > annotation.visibility.viewAngle) {
          return false
        }
      }

      // Check if in frustum
      return this.isInFrustum(annotation.position)
    })
  }

  // Update display settings
  updateDisplaySettings(settings: Partial<AnnotationDisplaySettings>): void {
    this.displaySettings = { ...this.displaySettings, ...settings }
    this.emit('displaySettingsChanged', this.displaySettings)
  }

  // Set filter
  setFilter(filter: AnnotationFilter | null): void {
    this.filter = filter
    this.emit('filterChanged', filter)
  }

  // Handle collaborative updates
  private addCollaborativeUpdate(
    annotationId: string,
    changes: Partial<Annotation3D>
  ): void {
    const update: AnnotationCollaborativeUpdate = {
      annotationId,
      userId: this.userId,
      changes,
      timestamp: new Date(),
    }

    if (!this.collaborativeUpdates.has(annotationId)) {
      this.collaborativeUpdates.set(annotationId, [])
    }

    this.collaborativeUpdates.get(annotationId)!.push(update)
    this.emit('collaborativeUpdate', update)
  }

  // Apply collaborative update from another user
  applyCollaborativeUpdate(update: AnnotationCollaborativeUpdate): void {
    const annotation = this.annotations.get(update.annotationId)
    if (!annotation) return

    // Apply changes based on conflict resolution strategy
    if (update.conflictResolution === 'overwrite' || !update.conflictResolution) {
      this.updateAnnotation(update.annotationId, update.changes)
    } else if (update.conflictResolution === 'merge') {
      // Implement merge logic based on timestamps
      const localUpdates = this.collaborativeUpdates.get(update.annotationId) || []
      const hasConflict = localUpdates.some(
        localUpdate => localUpdate.timestamp > update.timestamp
      )

      if (!hasConflict) {
        this.updateAnnotation(update.annotationId, update.changes)
      }
    }
  }

  // Export annotations
  async exportAnnotations(filter?: AnnotationFilter): Promise<Annotation3D[]> {
    return this.getAnnotations(filter)
  }

  // Import annotations
  async importAnnotations(annotations: Annotation3D[]): Promise<void> {
    for (const annotation of annotations) {
      // Validate and adjust positions if needed
      this.annotations.set(annotation.id, annotation)
    }
    
    this.emit('annotationsImported', annotations.length)
  }

  // Private helper methods
  private handlePointerDown(pointerInfo: any): void {
    // Implementation for pointer down
  }

  private handlePointerUp(pointerInfo: any): void {
    if (!pointerInfo.pickInfo?.hit) return

    // Check if clicking on existing annotation
    const clickedAnnotation = this.getAnnotationAtPosition(pointerInfo.pickInfo.pickedPoint)
    if (clickedAnnotation) {
      this.setActiveAnnotation(clickedAnnotation.id)
    }
  }

  private handlePointerMove(pointerInfo: any): void {
    // Implementation for hover effects
  }

  private getPickingInfo(position: Vector3): PickingInfo | null {
    if (!this.scene) return null

    const ray = new Ray(position, new Vector3(0, -1, 0))
    return this.scene.pickWithRay(ray)
  }

  private getAnnotationAtPosition(position: Vector3): Annotation3D | null {
    const threshold = 0.5 // Distance threshold for selection

    for (const annotation of this.annotations.values()) {
      if (Vector3.Distance(position, annotation.position) < threshold) {
        return annotation
      }
    }

    return null
  }

  private isInFrustum(position: Vector3): boolean {
    if (!this.scene || !this.scene.activeCamera) return false

    // Simple frustum check
    const frustumPlanes = this.scene.frustumPlanes
    if (!frustumPlanes) return true

    for (const plane of frustumPlanes) {
      const distance = plane.dotCoordinate(position) + plane.d
      if (distance < 0) return false
    }

    return true
  }

  private applyFilter(
    annotations: Annotation3D[],
    filter: AnnotationFilter
  ): Annotation3D[] {
    return annotations.filter(annotation => {
      if (filter.types && !filter.types.includes(annotation.type)) {
        return false
      }

      if (filter.status && !filter.status.includes(annotation.status)) {
        return false
      }

      if (filter.users && !filter.users.includes(annotation.userId)) {
        return false
      }

      if (filter.tags && annotation.content.tags) {
        const hasTag = filter.tags.some(tag => 
          annotation.content.tags?.includes(tag)
        )
        if (!hasTag) return false
      }

      if (filter.priority && annotation.content.priority) {
        if (!filter.priority.includes(annotation.content.priority)) {
          return false
        }
      }

      if (filter.dateRange) {
        const createdAt = annotation.createdAt.getTime()
        if (createdAt < filter.dateRange.start.getTime() ||
            createdAt > filter.dateRange.end.getTime()) {
          return false
        }
      }

      if (filter.searchText) {
        const searchLower = filter.searchText.toLowerCase()
        const inContent = annotation.content.title.toLowerCase().includes(searchLower) ||
                         annotation.content.description.toLowerCase().includes(searchLower)
        
        const inComments = this.searchInThread(annotation.thread, searchLower)
        
        if (!inContent && !inComments) return false
      }

      return true
    })
  }

  private searchInThread(thread: AnnotationThread[], searchText: string): boolean {
    for (const comment of thread) {
      if (comment.message.toLowerCase().includes(searchText)) {
        return true
      }
      
      if (comment.replies && this.searchInThread(comment.replies, searchText)) {
        return true
      }
    }
    
    return false
  }

  private findComment(
    thread: AnnotationThread[],
    commentId: string
  ): AnnotationThread | null {
    for (const comment of thread) {
      if (comment.id === commentId) {
        return comment
      }
      
      if (comment.replies) {
        const found = this.findComment(comment.replies, commentId)
        if (found) return found
      }
    }
    
    return null
  }

  private emitEvent(
    type: AnnotationEventType,
    annotation: Annotation3D,
    previousState?: Partial<Annotation3D>
  ): void {
    const event: AnnotationEvent = {
      type,
      annotation,
      previousState,
      user: {
        id: this.userId,
        name: this.userName,
      },
      timestamp: new Date(),
    }

    this.emit('annotationEvent', event)
    this.emit(type, annotation)
  }

  private generateId(): string {
    return `ann_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  // Cleanup
  dispose(): void {
    this.annotations.clear()
    this.collaborativeUpdates.clear()
    this.activeAnnotation = null
    this.removeAllListeners()
  }
}