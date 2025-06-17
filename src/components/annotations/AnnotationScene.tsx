import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Scene, Vector3, PointerEventTypes } from '@babylonjs/core'
import { AnnotationManager } from '@/services/annotations/AnnotationManager'
import { Annotation3D } from './Annotation3D'
import {
  Annotation3D as Annotation3DType,
  AnnotationType,
  AnnotationFilter,
  AnnotationDisplaySettings,
  AnnotationContent,
} from '@/types/annotations'

interface AnnotationSceneProps {
  scene: Scene
  userId: string
  userName: string
  modelId: string
  onAnnotationSelect?: (annotation: Annotation3DType | null) => void
  onAnnotationsChange?: (annotations: Annotation3DType[]) => void
}

export const AnnotationScene: React.FC<AnnotationSceneProps> = ({
  scene,
  userId,
  userName,
  modelId,
  onAnnotationSelect,
  onAnnotationsChange,
}) => {
  const managerRef = useRef<AnnotationManager | null>(null)
  const [annotations, setAnnotations] = useState<Annotation3DType[]>([])
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null)
  const [visibleAnnotations, setVisibleAnnotations] = useState<Set<string>>(new Set())
  const [displaySettings, setDisplaySettings] = useState<AnnotationDisplaySettings>({
    showLabels: true,
    showConnectors: true,
    opacity: 1,
    scale: 1,
    minDistance: 0.5,
    maxDistance: 100,
    fadeWithDistance: true,
    groupNearby: true,
    groupingThreshold: 2,
  })
  const [isCreatingAnnotation, setIsCreatingAnnotation] = useState(false)
  const [creationType, setCreationType] = useState<AnnotationType>('point')

  // Initialize annotation manager
  useEffect(() => {
    if (!scene) return

    const manager = new AnnotationManager(userId, userName)
    manager.initialize(scene)
    managerRef.current = manager

    // Setup event listeners
    manager.on('annotationEvent', handleAnnotationEvent)
    manager.on('annotationSelected', handleAnnotationSelected)
    manager.on('displaySettingsChanged', setDisplaySettings)
    
    // Setup scene interaction for creating annotations
    setupSceneInteraction()

    // Update visible annotations on camera movement
    const observer = scene.onAfterRenderObservable.add(() => {
      updateVisibleAnnotations()
    })

    return () => {
      scene.onAfterRenderObservable.remove(observer)
      manager.dispose()
      managerRef.current = null
    }
  }, [scene, userId, userName])

  // Setup scene interaction for creating annotations
  const setupSceneInteraction = () => {
    scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type === PointerEventTypes.POINTERTAP) {
        if (isCreatingAnnotation && pointerInfo.pickInfo?.hit) {
          handleCreateAnnotation(pointerInfo.pickInfo.pickedPoint!)
        }
      }
    })
  }

  // Handle annotation events
  const handleAnnotationEvent = useCallback(() => {
    if (!managerRef.current) return
    
    const allAnnotations = managerRef.current.getAnnotations()
    setAnnotations(allAnnotations)
    onAnnotationsChange?.(allAnnotations)
  }, [onAnnotationsChange])

  // Handle annotation selection
  const handleAnnotationSelected = useCallback((annotation: Annotation3DType) => {
    setActiveAnnotationId(annotation.id)
    onAnnotationSelect?.(annotation)
  }, [onAnnotationSelect])

  // Update visible annotations based on camera view
  const updateVisibleAnnotations = useCallback(() => {
    if (!managerRef.current) return

    const visible = managerRef.current.getVisibleAnnotations()
    const visibleIds = new Set(visible.map(a => a.id))
    setVisibleAnnotations(visibleIds)
  }, [])

  // Create new annotation
  const handleCreateAnnotation = async (position: Vector3) => {
    if (!managerRef.current || !isCreatingAnnotation) return

    const content: AnnotationContent = {
      title: 'New Annotation',
      description: 'Click to edit this annotation',
      tags: [],
      priority: 'medium',
    }

    try {
      const annotation = await managerRef.current.createAnnotation(
        creationType,
        position,
        content,
        { modelId }
      )

      setActiveAnnotationId(annotation.id)
      onAnnotationSelect?.(annotation)
      setIsCreatingAnnotation(false)
    } catch (error) {
      console.error('Failed to create annotation:', error)
    }
  }

  // Public methods exposed through ref
  const publicMethods = {
    // Start annotation creation mode
    startCreating: (type: AnnotationType) => {
      setCreationType(type)
      setIsCreatingAnnotation(true)
      scene.hoverCursor = 'crosshair'
    },

    // Cancel annotation creation
    cancelCreating: () => {
      setIsCreatingAnnotation(false)
      scene.hoverCursor = 'default'
    },

    // Update annotation
    updateAnnotation: async (id: string, updates: Partial<Annotation3DType>) => {
      if (!managerRef.current) return null
      return await managerRef.current.updateAnnotation(id, updates)
    },

    // Delete annotation
    deleteAnnotation: async (id: string) => {
      if (!managerRef.current) return false
      const result = await managerRef.current.deleteAnnotation(id)
      if (result && activeAnnotationId === id) {
        setActiveAnnotationId(null)
        onAnnotationSelect?.(null)
      }
      return result
    },

    // Add comment
    addComment: async (
      annotationId: string,
      message: string,
      richText?: string,
      parentCommentId?: string
    ) => {
      if (!managerRef.current) return null
      return await managerRef.current.addComment(
        annotationId,
        message,
        richText,
        parentCommentId
      )
    },

    // Update display settings
    updateDisplaySettings: (settings: Partial<AnnotationDisplaySettings>) => {
      if (!managerRef.current) return
      managerRef.current.updateDisplaySettings(settings)
    },

    // Set filter
    setFilter: (filter: AnnotationFilter | null) => {
      if (!managerRef.current) return
      managerRef.current.setFilter(filter)
      handleAnnotationEvent()
    },

    // Get annotations
    getAnnotations: (filter?: AnnotationFilter) => {
      if (!managerRef.current) return []
      return managerRef.current.getAnnotations(filter)
    },

    // Export annotations
    exportAnnotations: async (filter?: AnnotationFilter) => {
      if (!managerRef.current) return []
      return await managerRef.current.exportAnnotations(filter)
    },

    // Import annotations
    importAnnotations: async (annotations: Annotation3DType[]) => {
      if (!managerRef.current) return
      await managerRef.current.importAnnotations(annotations)
      handleAnnotationEvent()
    },
  }

  // Handle annotation position update
  const handleAnnotationUpdate = useCallback(
    (annotation: Annotation3DType, newPosition: Vector3) => {
      if (!managerRef.current) return
      managerRef.current.updateAnnotation(annotation.id, { position: newPosition })
    },
    []
  )

  // Handle annotation selection
  const handleAnnotationSelect = useCallback(
    (annotation: Annotation3DType) => {
      setActiveAnnotationId(annotation.id)
      managerRef.current?.setActiveAnnotation(annotation.id)
      onAnnotationSelect?.(annotation)
    },
    [onAnnotationSelect]
  )

  // Render annotation components
  return (
    <>
      {annotations.map(annotation => (
        <Annotation3D
          key={annotation.id}
          annotation={annotation}
          scene={scene}
          isActive={annotation.id === activeAnnotationId}
          isVisible={visibleAnnotations.has(annotation.id)}
          displaySettings={displaySettings}
          onSelect={handleAnnotationSelect}
          onUpdate={handleAnnotationUpdate}
        />
      ))}
    </>
  )
}

// Export methods type for ref usage
export type AnnotationSceneMethods = {
  startCreating: (type: AnnotationType) => void
  cancelCreating: () => void
  updateAnnotation: (id: string, updates: Partial<Annotation3DType>) => Promise<Annotation3DType | null>
  deleteAnnotation: (id: string) => Promise<boolean>
  addComment: (
    annotationId: string,
    message: string,
    richText?: string,
    parentCommentId?: string
  ) => Promise<any>
  updateDisplaySettings: (settings: Partial<AnnotationDisplaySettings>) => void
  setFilter: (filter: AnnotationFilter | null) => void
  getAnnotations: (filter?: AnnotationFilter) => Annotation3DType[]
  exportAnnotations: (filter?: AnnotationFilter) => Promise<Annotation3DType[]>
  importAnnotations: (annotations: Annotation3DType[]) => Promise<void>
}

export default AnnotationScene