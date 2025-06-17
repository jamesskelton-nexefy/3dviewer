import { useState, useEffect, useCallback, useRef } from 'react'
import { Scene } from '@babylonjs/core'
import { 
  CollaborationManager, 
  CollaborationConfig, 
  CollaborationState,
  getCollaborationManager,
  resetCollaborationManager
} from '@/services/collaboration'
import { Cursor3D } from '@/services/collaboration/CursorTrackingService'
import { UserPresence } from '@/services/annotations/CollaborativeAnnotationService'
import { Activity } from '@/components/collaboration'
import { Annotation3D } from '@/types/annotations'

export interface UseCollaborationOptions extends Omit<CollaborationConfig, 'scene'> {
  autoConnect?: boolean
  onError?: (error: Error) => void
  onConnectionChange?: (connected: boolean) => void
}

export interface UseCollaborationReturn {
  // State
  isConnected: boolean
  connectionState: CollaborationState
  cursors: Cursor3D[]
  presence: UserPresence[]
  activities: Activity[]
  error: Error | null
  
  // Actions
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  toggleCursorVisibility: (userId: string, visible: boolean) => void
  markActivityAsRead: (activityId: string) => void
  markAllActivitiesAsRead: () => void
  sendAnnotationUpdate: (annotationId: string, changes: Partial<Annotation3D>) => void
  requestSync: () => Promise<void>
  
  // Refs
  collaborationManager: CollaborationManager | null
}

export function useCollaboration(
  scene: Scene | null,
  options: UseCollaborationOptions
): UseCollaborationReturn {
  const [isConnected, setIsConnected] = useState(false)
  const [connectionState, setConnectionState] = useState<CollaborationState>({
    connected: false,
    connectionState: 'disconnected' as any,
    activeUsers: 0,
    cursorsVisible: true,
    activitiesEnabled: true,
    otEnabled: true,
    pendingOperations: 0,
    latency: 0
  })
  const [cursors, setCursors] = useState<Cursor3D[]>([])
  const [presence, setPresence] = useState<UserPresence[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [error, setError] = useState<Error | null>(null)
  
  const managerRef = useRef<CollaborationManager | null>(null)
  const { autoConnect = true, onError, onConnectionChange, ...config } = options

  // Initialize collaboration manager
  useEffect(() => {
    if (!scene) return

    try {
      // Reset any existing manager
      resetCollaborationManager()
      
      // Create new manager
      const manager = getCollaborationManager({
        ...config,
        scene
      })
      
      if (!manager) {
        throw new Error('Failed to create collaboration manager')
      }
      
      managerRef.current = manager

      // Setup event listeners
      manager.on('connected', () => {
        setIsConnected(true)
        setError(null)
        onConnectionChange?.(true)
      })

      manager.on('disconnected', () => {
        setIsConnected(false)
        onConnectionChange?.(false)
      })

      manager.on('error', (err: Error) => {
        setError(err)
        onError?.(err)
      })

      manager.on('connectionStateChange', (state: any) => {
        updateConnectionState()
      })

      manager.on('presenceUpdate', (users: UserPresence[]) => {
        setPresence(users)
      })

      manager.on('activityUpdate', (acts: Activity[]) => {
        setActivities(acts)
      })

      manager.on('remoteCursorUpdate', (cursor: Cursor3D) => {
        updateCursors()
      })

      manager.on('remoteCursorRemoved', (cursor: Cursor3D) => {
        updateCursors()
      })

      // Auto-connect if enabled
      if (autoConnect) {
        manager.connect().catch(err => {
          setError(err)
          onError?.(err)
        })
      }
    } catch (err) {
      const error = err as Error
      setError(error)
      onError?.(error)
    }

    // Cleanup
    return () => {
      if (managerRef.current) {
        managerRef.current.disconnect()
        resetCollaborationManager()
        managerRef.current = null
      }
    }
  }, [scene, config.serverUrl, config.modelId, config.userId])

  // Update connection state
  const updateConnectionState = useCallback(() => {
    if (managerRef.current) {
      setConnectionState(managerRef.current.getState())
    }
  }, [])

  // Update cursors
  const updateCursors = useCallback(() => {
    if (managerRef.current?.getCursorService()) {
      const activeCursors = managerRef.current.getCursorService()!.getActiveCursors()
      setCursors(activeCursors)
    }
  }, [])

  // Connect
  const connect = useCallback(async () => {
    if (!managerRef.current) {
      throw new Error('Collaboration manager not initialized')
    }
    
    try {
      await managerRef.current.connect()
    } catch (err) {
      const error = err as Error
      setError(error)
      throw error
    }
  }, [])

  // Disconnect
  const disconnect = useCallback(async () => {
    if (!managerRef.current) return
    
    try {
      await managerRef.current.disconnect()
    } catch (err) {
      const error = err as Error
      setError(error)
      throw error
    }
  }, [])

  // Toggle cursor visibility
  const toggleCursorVisibility = useCallback((userId: string, visible: boolean) => {
    managerRef.current?.toggleCursorVisibility(userId, visible)
  }, [])

  // Mark activity as read
  const markActivityAsRead = useCallback((activityId: string) => {
    managerRef.current?.markActivityAsRead(activityId)
  }, [])

  // Mark all activities as read
  const markAllActivitiesAsRead = useCallback(() => {
    managerRef.current?.markAllActivitiesAsRead()
  }, [])

  // Send annotation update
  const sendAnnotationUpdate = useCallback((annotationId: string, changes: Partial<Annotation3D>) => {
    managerRef.current?.sendAnnotationUpdate(annotationId, changes)
  }, [])

  // Request sync
  const requestSync = useCallback(async () => {
    if (!managerRef.current) {
      throw new Error('Collaboration manager not initialized')
    }
    
    await managerRef.current.requestSync()
  }, [])

  // Update connection state periodically
  useEffect(() => {
    if (!isConnected) return
    
    const interval = setInterval(updateConnectionState, 1000)
    return () => clearInterval(interval)
  }, [isConnected, updateConnectionState])

  return {
    // State
    isConnected,
    connectionState,
    cursors,
    presence,
    activities,
    error,
    
    // Actions
    connect,
    disconnect,
    toggleCursorVisibility,
    markActivityAsRead,
    markAllActivitiesAsRead,
    sendAnnotationUpdate,
    requestSync,
    
    // Refs
    collaborationManager: managerRef.current
  }
}