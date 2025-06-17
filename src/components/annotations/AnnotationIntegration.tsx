import React, { useRef, useEffect, useState } from 'react'
import { Scene } from '@babylonjs/core'
import { BabylonEngine } from '@/services/BabylonEngine'
import { AnnotationScene, AnnotationSceneMethods } from './AnnotationScene'
import { AnnotationPanel } from './AnnotationPanel'
import { Annotation3D, AnnotationFilter } from '@/types/annotations'
import { ViewerConfig } from '@/types'

interface AnnotationIntegrationProps {
  canvas: HTMLCanvasElement
  modelId: string
  userId: string
  userName: string
  viewerConfig?: ViewerConfig
}

/**
 * Example integration component showing how to use the annotation system
 * with the BabylonEngine for 3D model viewing
 */
export const AnnotationIntegration: React.FC<AnnotationIntegrationProps> = ({
  canvas,
  modelId,
  userId,
  userName,
  viewerConfig = {
    enablePerformanceOptimization: true,
    maxModelSize: 100 * 1024 * 1024, // 100MB
    enableDracoCompression: true,
    enableTextureCompression: true,
    targetFPS: 60,
  },
}) => {
  const [scene, setScene] = useState<Scene | null>(null)
  const [selectedAnnotation, setSelectedAnnotation] = useState<Annotation3D | null>(null)
  const [annotations, setAnnotations] = useState<Annotation3D[]>([])
  const engineRef = useRef<BabylonEngine | null>(null)
  const annotationSceneRef = useRef<AnnotationSceneMethods | null>(null)

  // Initialize Babylon.js engine and scene
  useEffect(() => {
    const initializeEngine = async () => {
      try {
        const engine = new BabylonEngine(viewerConfig)
        await engine.initialize(canvas)
        engineRef.current = engine
        
        const babylonScene = engine.getScene()
        if (babylonScene) {
          setScene(babylonScene)
        }
      } catch (error) {
        console.error('Failed to initialize Babylon.js engine:', error)
      }
    }

    initializeEngine()

    return () => {
      engineRef.current?.dispose()
      engineRef.current = null
    }
  }, [canvas, viewerConfig])

  // Handle annotation updates
  const handleUpdateAnnotation = async (id: string, updates: Partial<Annotation3D>) => {
    if (!annotationSceneRef.current) return
    await annotationSceneRef.current.updateAnnotation(id, updates)
  }

  // Handle annotation deletion
  const handleDeleteAnnotation = async (id: string) => {
    if (!annotationSceneRef.current) return
    await annotationSceneRef.current.deleteAnnotation(id)
  }

  // Handle adding comments
  const handleAddComment = async (
    annotationId: string,
    message: string,
    richText?: string,
    parentCommentId?: string
  ) => {
    if (!annotationSceneRef.current) return
    await annotationSceneRef.current.addComment(annotationId, message, richText, parentCommentId)
  }

  // Handle creating new annotation
  const handleCreateAnnotation = (type: any) => {
    if (!annotationSceneRef.current) return
    annotationSceneRef.current.startCreating(type)
  }

  // Handle filter changes
  const handleFilterChange = (filter: AnnotationFilter | null) => {
    if (!annotationSceneRef.current) return
    annotationSceneRef.current.setFilter(filter)
  }

  // Export annotations
  const handleExportAnnotations = async () => {
    if (!annotationSceneRef.current) return
    
    const annotationsData = await annotationSceneRef.current.exportAnnotations()
    const blob = new Blob([JSON.stringify(annotationsData, null, 2)], {
      type: 'application/json',
    })
    
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `annotations_${modelId}_${new Date().toISOString()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Import annotations
  const handleImportAnnotations = async (file: File) => {
    if (!annotationSceneRef.current) return
    
    try {
      const text = await file.text()
      const importedAnnotations = JSON.parse(text) as Annotation3D[]
      
      // Convert date strings back to Date objects
      const processedAnnotations = importedAnnotations.map(ann => ({
        ...ann,
        createdAt: new Date(ann.createdAt),
        updatedAt: new Date(ann.updatedAt),
        thread: ann.thread.map(comment => ({
          ...comment,
          createdAt: new Date(comment.createdAt),
          updatedAt: new Date(comment.updatedAt),
          replies: comment.replies?.map(reply => ({
            ...reply,
            createdAt: new Date(reply.createdAt),
            updatedAt: new Date(reply.updatedAt),
          })),
        })),
      }))
      
      await annotationSceneRef.current.importAnnotations(processedAnnotations)
    } catch (error) {
      console.error('Failed to import annotations:', error)
    }
  }

  return (
    <div className="flex h-full">
      {/* 3D Viewer Area */}
      <div className="flex-1 relative">
        {scene && (
          <AnnotationScene
            ref={annotationSceneRef as any}
            scene={scene}
            userId={userId}
            userName={userName}
            modelId={modelId}
            onAnnotationSelect={setSelectedAnnotation}
            onAnnotationsChange={setAnnotations}
          />
        )}
        
        {/* Toolbar */}
        <div className="absolute top-4 left-4 bg-white rounded-lg shadow-lg p-2">
          <div className="flex gap-2">
            <button
              onClick={handleExportAnnotations}
              className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded transition"
              title="Export Annotations"
            >
              Export
            </button>
            <label className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded transition cursor-pointer">
              Import
              <input
                type="file"
                accept=".json"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleImportAnnotations(file)
                }}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {/* Performance Metrics (optional) */}
        <div className="absolute bottom-4 left-4 bg-black bg-opacity-50 text-white rounded p-2 text-xs">
          <div>FPS: {engineRef.current?.getPerformanceMetrics().fps.toFixed(1)}</div>
          <div>Annotations: {annotations.length}</div>
        </div>
      </div>

      {/* Annotation Panel */}
      <div className="w-96 border-l">
        <AnnotationPanel
          selectedAnnotation={selectedAnnotation}
          annotations={annotations}
          currentUserId={userId}
          onUpdateAnnotation={handleUpdateAnnotation}
          onDeleteAnnotation={handleDeleteAnnotation}
          onAddComment={handleAddComment}
          onSelectAnnotation={setSelectedAnnotation}
          onCreateAnnotation={handleCreateAnnotation}
          onFilterChange={handleFilterChange}
        />
      </div>
    </div>
  )
}

export default AnnotationIntegration