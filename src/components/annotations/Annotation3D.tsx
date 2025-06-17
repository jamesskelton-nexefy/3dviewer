import React, { useEffect, useRef, useState } from 'react'
import {
  Scene,
  Vector3,
  Color3,
  Color4,
  Mesh,
  StandardMaterial,
  DynamicTexture,
  MeshBuilder,
  TransformNode,
  ActionManager,
  ExecuteCodeAction,
  PointerEventTypes,
  GUI3DManager,
  HolographicButton,
  TextBlock,
  AdvancedDynamicTexture,
  Rectangle,
  Line,
  Ellipse,
} from '@babylonjs/core'
import { Annotation3D as Annotation3DType, AnnotationType } from '@/types/annotations'

interface Annotation3DProps {
  annotation: Annotation3DType
  scene: Scene
  isActive: boolean
  isVisible: boolean
  displaySettings: {
    showLabels: boolean
    showConnectors: boolean
    opacity: number
    scale: number
    fadeWithDistance: boolean
  }
  onSelect: (annotation: Annotation3DType) => void
  onUpdate: (annotation: Annotation3DType, position: Vector3) => void
}

export const Annotation3D: React.FC<Annotation3DProps> = ({
  annotation,
  scene,
  isActive,
  isVisible,
  displaySettings,
  onSelect,
  onUpdate,
}) => {
  const meshesRef = useRef<{
    marker: Mesh | null
    label: Mesh | null
    connector: Mesh | null
    container: TransformNode | null
  }>({
    marker: null,
    label: null,
    connector: null,
    container: null,
  })

  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    if (!scene) return

    createAnnotationMeshes()

    return () => {
      disposeAnnotationMeshes()
    }
  }, [scene, annotation])

  useEffect(() => {
    updateVisibility()
    updateAppearance()
  }, [isActive, isVisible, displaySettings])

  const createAnnotationMeshes = () => {
    // Create container for all annotation elements
    const container = new TransformNode(`annotation_${annotation.id}`, scene)
    container.position = annotation.position.clone()
    meshesRef.current.container = container

    // Create marker based on annotation type
    const marker = createMarker()
    if (marker) {
      marker.parent = container
      meshesRef.current.marker = marker
      setupInteraction(marker)
    }

    // Create label if enabled
    if (displaySettings.showLabels) {
      const label = createLabel()
      if (label) {
        label.parent = container
        meshesRef.current.label = label
      }
    }

    // Create connector line if enabled
    if (displaySettings.showConnectors) {
      const connector = createConnector()
      if (connector) {
        connector.parent = container
        meshesRef.current.connector = connector
      }
    }
  }

  const createMarker = (): Mesh | null => {
    let marker: Mesh | null = null
    const material = new StandardMaterial(`annotation_mat_${annotation.id}`, scene)
    
    // Set color based on priority
    const color = getPriorityColor()
    material.diffuseColor = color
    material.specularColor = new Color3(0, 0, 0)
    material.emissiveColor = color.scale(0.3)
    material.alpha = displaySettings.opacity

    switch (annotation.type) {
      case 'point':
        marker = MeshBuilder.CreateSphere(
          `marker_${annotation.id}`,
          { diameter: 0.3 * displaySettings.scale, segments: 16 },
          scene
        )
        break

      case 'area':
        marker = MeshBuilder.CreateCylinder(
          `marker_${annotation.id}`,
          { 
            height: 0.1 * displaySettings.scale,
            diameter: 0.5 * displaySettings.scale,
            tessellation: 6
          },
          scene
        )
        break

      case 'measurement':
        marker = MeshBuilder.CreateBox(
          `marker_${annotation.id}`,
          { size: 0.2 * displaySettings.scale },
          scene
        )
        break

      case 'section':
        marker = MeshBuilder.CreatePlane(
          `marker_${annotation.id}`,
          { size: 0.4 * displaySettings.scale },
          scene
        )
        break

      case 'markup':
        marker = MeshBuilder.CreateTorus(
          `marker_${annotation.id}`,
          {
            diameter: 0.4 * displaySettings.scale,
            thickness: 0.1 * displaySettings.scale,
            tessellation: 16
          },
          scene
        )
        break
    }

    if (marker) {
      marker.material = material
      marker.isPickable = true
      
      // Add glow effect for active annotation
      if (isActive) {
        material.emissiveColor = color.scale(0.6)
      }
    }

    return marker
  }

  const createLabel = (): Mesh | null => {
    const label = MeshBuilder.CreatePlane(
      `label_${annotation.id}`,
      { width: 2, height: 0.5 },
      scene
    )

    // Create dynamic texture for text
    const texture = new DynamicTexture(
      `label_texture_${annotation.id}`,
      { width: 512, height: 128 },
      scene
    )

    const material = new StandardMaterial(`label_mat_${annotation.id}`, scene)
    material.diffuseTexture = texture
    material.specularColor = new Color3(0, 0, 0)
    material.emissiveColor = new Color3(1, 1, 1)
    material.backFaceCulling = false
    material.alpha = displaySettings.opacity * 0.9

    // Draw text
    const context = texture.getContext()
    context.fillStyle = 'rgba(0, 0, 0, 0.8)'
    context.fillRect(0, 0, 512, 128)
    
    context.font = 'bold 36px Arial'
    context.fillStyle = 'white'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    
    const title = annotation.content.title || 'Annotation'
    const maxLength = 20
    const displayTitle = title.length > maxLength 
      ? title.substring(0, maxLength) + '...' 
      : title
    
    context.fillText(displayTitle, 256, 40)

    // Add status indicator
    if (annotation.thread.length > 0) {
      context.font = '24px Arial'
      context.fillStyle = '#64b5f6'
      context.fillText(`${annotation.thread.length} comments`, 256, 80)
    }

    texture.update()

    label.material = material
    label.position.y = 0.5
    label.billboardMode = Mesh.BILLBOARDMODE_ALL

    return label
  }

  const createConnector = (): Mesh | null => {
    const points = [
      new Vector3(0, 0, 0),
      new Vector3(0, -0.3, 0)
    ]

    const connector = MeshBuilder.CreateLines(
      `connector_${annotation.id}`,
      { points },
      scene
    )

    connector.color = getPriorityColor()
    connector.alpha = displaySettings.opacity * 0.7

    return connector as Mesh
  }

  const setupInteraction = (mesh: Mesh) => {
    // Add action manager for interactions
    mesh.actionManager = new ActionManager(scene)

    // Click to select
    mesh.actionManager.registerAction(
      new ExecuteCodeAction(
        ActionManager.OnPickTrigger,
        () => {
          onSelect(annotation)
        }
      )
    )

    // Hover effects
    mesh.actionManager.registerAction(
      new ExecuteCodeAction(
        ActionManager.OnPointerOverTrigger,
        () => {
          if (mesh.material && 'emissiveColor' in mesh.material) {
            ;(mesh.material as StandardMaterial).emissiveColor = 
              getPriorityColor().scale(0.5)
          }
          scene.hoverCursor = 'pointer'
        }
      )
    )

    mesh.actionManager.registerAction(
      new ExecuteCodeAction(
        ActionManager.OnPointerOutTrigger,
        () => {
          if (mesh.material && 'emissiveColor' in mesh.material) {
            ;(mesh.material as StandardMaterial).emissiveColor = 
              getPriorityColor().scale(isActive ? 0.6 : 0.3)
          }
          scene.hoverCursor = 'default'
        }
      )
    )

    // Enable dragging for position updates
    if (annotation.userId === getCurrentUserId()) {
      setupDragging(mesh)
    }
  }

  const setupDragging = (mesh: Mesh) => {
    let startingPoint: Vector3 | null = null
    let currentMesh: Mesh | null = null

    const getGroundPosition = (): Vector3 | null => {
      const pickinfo = scene.pick(scene.pointerX, scene.pointerY, (mesh) => {
        return mesh !== currentMesh && mesh !== meshesRef.current.label
      })

      if (pickinfo?.hit) {
        return pickinfo.pickedPoint
      }

      return null
    }

    scene.onPointerObservable.add((pointerInfo) => {
      switch (pointerInfo.type) {
        case PointerEventTypes.POINTERDOWN:
          if (
            pointerInfo.pickInfo?.hit &&
            pointerInfo.pickInfo.pickedMesh === mesh &&
            pointerInfo.event.button === 0 &&
            pointerInfo.event.ctrlKey
          ) {
            currentMesh = mesh
            startingPoint = getGroundPosition()
            if (startingPoint) {
              setIsDragging(true)
              scene.activeCamera?.detachControl()
            }
          }
          break

        case PointerEventTypes.POINTERUP:
          if (startingPoint && currentMesh) {
            setIsDragging(false)
            scene.activeCamera?.attachControl()
            
            // Update annotation position
            if (meshesRef.current.container) {
              onUpdate(annotation, meshesRef.current.container.position)
            }
            
            startingPoint = null
            currentMesh = null
          }
          break

        case PointerEventTypes.POINTERMOVE:
          if (startingPoint && currentMesh) {
            const current = getGroundPosition()
            if (current && meshesRef.current.container) {
              const diff = current.subtract(startingPoint)
              meshesRef.current.container.position.addInPlace(diff)
              startingPoint = current
            }
          }
          break
      }
    })
  }

  const updateVisibility = () => {
    const { container } = meshesRef.current
    if (!container) return

    container.setEnabled(isVisible)

    // Update label visibility
    if (meshesRef.current.label) {
      meshesRef.current.label.setEnabled(isVisible && displaySettings.showLabels)
    }

    // Update connector visibility
    if (meshesRef.current.connector) {
      meshesRef.current.connector.setEnabled(isVisible && displaySettings.showConnectors)
    }
  }

  const updateAppearance = () => {
    const { marker, label, connector } = meshesRef.current
    
    // Update marker appearance
    if (marker && marker.material) {
      const material = marker.material as StandardMaterial
      material.alpha = displaySettings.opacity
      material.emissiveColor = getPriorityColor().scale(isActive ? 0.6 : 0.3)
    }

    // Update label appearance
    if (label && label.material) {
      const material = label.material as StandardMaterial
      material.alpha = displaySettings.opacity * 0.9
    }

    // Update scale
    if (meshesRef.current.container) {
      const scale = displaySettings.scale
      meshesRef.current.container.scaling = new Vector3(scale, scale, scale)
    }

    // Handle distance-based fading
    if (displaySettings.fadeWithDistance && scene.activeCamera) {
      updateDistanceFading()
    }
  }

  const updateDistanceFading = () => {
    if (!scene.activeCamera || !meshesRef.current.container) return

    const distance = Vector3.Distance(
      scene.activeCamera.position,
      meshesRef.current.container.position
    )

    const fadeStart = 10
    const fadeEnd = 50
    
    let opacity = displaySettings.opacity
    if (distance > fadeStart) {
      opacity *= Math.max(0, 1 - (distance - fadeStart) / (fadeEnd - fadeStart))
    }

    // Apply faded opacity to all materials
    const { marker, label } = meshesRef.current
    if (marker?.material) {
      (marker.material as StandardMaterial).alpha = opacity
    }
    if (label?.material) {
      (label.material as StandardMaterial).alpha = opacity * 0.9
    }
  }

  const getPriorityColor = (): Color3 => {
    switch (annotation.content.priority) {
      case 'critical':
        return new Color3(1, 0.2, 0.2) // Red
      case 'high':
        return new Color3(1, 0.6, 0.2) // Orange
      case 'medium':
        return new Color3(1, 1, 0.2) // Yellow
      case 'low':
        return new Color3(0.2, 0.8, 0.2) // Green
      default:
        return new Color3(0.2, 0.6, 1) // Blue
    }
  }

  const getCurrentUserId = (): string => {
    // This should be implemented to get the current user ID from your auth system
    return 'current_user_id'
  }

  const disposeAnnotationMeshes = () => {
    const { marker, label, connector, container } = meshesRef.current

    if (marker) {
      marker.dispose()
      meshesRef.current.marker = null
    }

    if (label) {
      label.dispose()
      meshesRef.current.label = null
    }

    if (connector) {
      connector.dispose()
      meshesRef.current.connector = null
    }

    if (container) {
      container.dispose()
      meshesRef.current.container = null
    }
  }

  return null // This component doesn't render anything in React, it manages Babylon.js objects
}

export default Annotation3D