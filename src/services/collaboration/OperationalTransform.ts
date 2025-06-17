import { Vector3 } from '@babylonjs/core'

// Operation types for 3D annotations
export enum OperationType {
  INSERT = 'insert',
  UPDATE = 'update',
  DELETE = 'delete',
  MOVE = 'move',
  COMMENT = 'comment'
}

// Base operation interface
export interface Operation {
  id: string
  type: OperationType
  userId: string
  timestamp: number
  version: number
  targetId?: string // ID of the annotation being modified
  data: any
}

// Specific operation types
export interface InsertOperation extends Operation {
  type: OperationType.INSERT
  data: {
    annotationId: string
    position: Vector3
    content: any
  }
}

export interface UpdateOperation extends Operation {
  type: OperationType.UPDATE
  data: {
    field: string
    oldValue: any
    newValue: any
  }
}

export interface DeleteOperation extends Operation {
  type: OperationType.DELETE
  data: {
    annotationId: string
  }
}

export interface MoveOperation extends Operation {
  type: OperationType.MOVE
  data: {
    oldPosition: Vector3
    newPosition: Vector3
    delta: Vector3
  }
}

export interface CommentOperation extends Operation {
  type: OperationType.COMMENT
  data: {
    commentId: string
    action: 'add' | 'edit' | 'delete'
    content?: string
    parentId?: string
  }
}

// Transform result
export interface TransformResult {
  operation1: Operation
  operation2: Operation
  conflict: boolean
  resolution?: 'merge' | 'reject' | 'defer'
}

export class OperationalTransform {
  private operationHistory: Operation[] = []
  private pendingOperations: Map<string, Operation[]> = new Map()
  private currentVersion: number = 0

  // Transform two concurrent operations
  transform(op1: Operation, op2: Operation): TransformResult {
    // Same user operations are serialized, no transformation needed
    if (op1.userId === op2.userId) {
      return {
        operation1: op1,
        operation2: op2,
        conflict: false
      }
    }

    // Transform based on operation types
    const transformKey = `${op1.type}:${op2.type}`
    
    switch (transformKey) {
      case `${OperationType.INSERT}:${OperationType.INSERT}`:
        return this.transformInsertInsert(op1 as InsertOperation, op2 as InsertOperation)
      
      case `${OperationType.UPDATE}:${OperationType.UPDATE}`:
        return this.transformUpdateUpdate(op1 as UpdateOperation, op2 as UpdateOperation)
      
      case `${OperationType.MOVE}:${OperationType.MOVE}`:
        return this.transformMoveMove(op1 as MoveOperation, op2 as MoveOperation)
      
      case `${OperationType.DELETE}:${OperationType.UPDATE}`:
      case `${OperationType.UPDATE}:${OperationType.DELETE}`:
        return this.transformDeleteUpdate(op1, op2)
      
      case `${OperationType.DELETE}:${OperationType.DELETE}`:
        return this.transformDeleteDelete(op1 as DeleteOperation, op2 as DeleteOperation)
      
      default:
        // Default transformation - operations are independent
        return {
          operation1: op1,
          operation2: op2,
          conflict: false
        }
    }
  }

  // Transform INSERT vs INSERT
  private transformInsertInsert(op1: InsertOperation, op2: InsertOperation): TransformResult {
    // Check for position conflicts (annotations too close)
    const distance = Vector3.Distance(op1.data.position, op2.data.position)
    const threshold = 0.1 // 10cm threshold for conflict

    if (distance < threshold) {
      // Conflict: annotations too close together
      // Resolution: offset the second operation
      const offset = new Vector3(
        threshold * Math.random(),
        threshold * Math.random(),
        threshold * Math.random()
      )
      
      op2.data.position = op2.data.position.add(offset)
      
      return {
        operation1: op1,
        operation2: op2,
        conflict: true,
        resolution: 'merge'
      }
    }

    return {
      operation1: op1,
      operation2: op2,
      conflict: false
    }
  }

  // Transform UPDATE vs UPDATE
  private transformUpdateUpdate(op1: UpdateOperation, op2: UpdateOperation): TransformResult {
    // Check if they're updating the same annotation and field
    if (op1.targetId === op2.targetId && op1.data.field === op2.data.field) {
      // Conflict: both updating the same field
      // Resolution: timestamp-based (last write wins)
      if (op1.timestamp > op2.timestamp) {
        return {
          operation1: op1,
          operation2: this.createNoOp(op2),
          conflict: true,
          resolution: 'merge'
        }
      } else {
        return {
          operation1: this.createNoOp(op1),
          operation2: op2,
          conflict: true,
          resolution: 'merge'
        }
      }
    }

    return {
      operation1: op1,
      operation2: op2,
      conflict: false
    }
  }

  // Transform MOVE vs MOVE
  private transformMoveMove(op1: MoveOperation, op2: MoveOperation): TransformResult {
    if (op1.targetId === op2.targetId) {
      // Both moving the same annotation
      // Resolution: compose the movements
      const composedDelta = op1.data.delta.add(op2.data.delta)
      
      op2.data.oldPosition = op1.data.newPosition
      op2.data.delta = composedDelta
      op2.data.newPosition = op1.data.oldPosition.add(composedDelta)
      
      return {
        operation1: op1,
        operation2: op2,
        conflict: true,
        resolution: 'merge'
      }
    }

    return {
      operation1: op1,
      operation2: op2,
      conflict: false
    }
  }

  // Transform DELETE vs UPDATE
  private transformDeleteUpdate(op1: Operation, op2: Operation): TransformResult {
    const deleteOp = op1.type === OperationType.DELETE ? op1 : op2
    const updateOp = op1.type === OperationType.UPDATE ? op1 : op2

    if (deleteOp.targetId === updateOp.targetId) {
      // Conflict: updating a deleted annotation
      // Resolution: reject the update
      return {
        operation1: op1.type === OperationType.DELETE ? op1 : this.createNoOp(op1),
        operation2: op2.type === OperationType.DELETE ? op2 : this.createNoOp(op2),
        conflict: true,
        resolution: 'reject'
      }
    }

    return {
      operation1: op1,
      operation2: op2,
      conflict: false
    }
  }

  // Transform DELETE vs DELETE
  private transformDeleteDelete(op1: DeleteOperation, op2: DeleteOperation): TransformResult {
    if (op1.data.annotationId === op2.data.annotationId) {
      // Both deleting the same annotation
      // Resolution: idempotent, convert second to no-op
      return {
        operation1: op1,
        operation2: this.createNoOp(op2),
        conflict: false
      }
    }

    return {
      operation1: op1,
      operation2: op2,
      conflict: false
    }
  }

  // Create a no-operation (for conflict resolution)
  private createNoOp(op: Operation): Operation {
    return {
      ...op,
      type: OperationType.UPDATE,
      data: {
        field: 'noop',
        oldValue: null,
        newValue: null
      }
    }
  }

  // Apply operation to local state
  applyOperation(op: Operation): void {
    // Update version
    op.version = ++this.currentVersion
    
    // Add to history
    this.operationHistory.push(op)
    
    // Clean old history (keep last 1000 operations)
    if (this.operationHistory.length > 1000) {
      this.operationHistory = this.operationHistory.slice(-1000)
    }
  }

  // Transform incoming operation against pending local operations
  transformIncoming(incoming: Operation, localOps: Operation[]): Operation {
    let transformed = incoming
    
    for (const localOp of localOps) {
      const result = this.transform(transformed, localOp)
      transformed = result.operation1
    }
    
    return transformed
  }

  // Transform local operations against incoming operation
  transformLocal(localOps: Operation[], incoming: Operation): Operation[] {
    return localOps.map(localOp => {
      const result = this.transform(localOp, incoming)
      return result.operation1
    })
  }

  // Get operation history
  getHistory(since?: number): Operation[] {
    if (since !== undefined) {
      return this.operationHistory.filter(op => op.version > since)
    }
    return [...this.operationHistory]
  }

  // Get current version
  getCurrentVersion(): number {
    return this.currentVersion
  }

  // Set version (for synchronization)
  setVersion(version: number): void {
    this.currentVersion = version
  }

  // Compose multiple operations into one
  compose(operations: Operation[]): Operation | null {
    if (operations.length === 0) return null
    if (operations.length === 1) return operations[0]

    // Group by target and type
    const groups = new Map<string, Operation[]>()
    
    for (const op of operations) {
      const key = `${op.targetId}:${op.type}`
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(op)
    }

    // Compose each group
    const composed: Operation[] = []
    
    for (const [key, ops] of groups) {
      if (ops[0].type === OperationType.MOVE) {
        // Compose move operations
        const moves = ops as MoveOperation[]
        const totalDelta = moves.reduce((acc, move) => 
          acc.add(move.data.delta), new Vector3(0, 0, 0)
        )
        
        composed.push({
          ...moves[0],
          data: {
            oldPosition: moves[0].data.oldPosition,
            newPosition: moves[0].data.oldPosition.add(totalDelta),
            delta: totalDelta
          }
        })
      } else if (ops[0].type === OperationType.UPDATE) {
        // Take the last update for each field
        const updates = ops as UpdateOperation[]
        const lastUpdate = updates[updates.length - 1]
        composed.push({
          ...lastUpdate,
          data: {
            field: lastUpdate.data.field,
            oldValue: updates[0].data.oldValue,
            newValue: lastUpdate.data.newValue
          }
        })
      } else {
        // For other types, keep the first operation
        composed.push(ops[0])
      }
    }

    // If we have multiple composed operations, return a batch operation
    if (composed.length > 1) {
      return {
        id: `batch-${Date.now()}`,
        type: OperationType.UPDATE,
        userId: composed[0].userId,
        timestamp: Date.now(),
        version: this.currentVersion,
        data: { operations: composed }
      }
    }

    return composed[0]
  }

  // Reset the OT system
  reset(): void {
    this.operationHistory = []
    this.pendingOperations.clear()
    this.currentVersion = 0
  }
}

// Singleton instance
let otInstance: OperationalTransform | null = null

export function getOperationalTransform(): OperationalTransform {
  if (!otInstance) {
    otInstance = new OperationalTransform()
  }
  return otInstance
}

export default OperationalTransform