import React, { useEffect, useRef } from 'react'
import {
  Scene,
  Mesh,
  Vector3,
  Color3,
  StandardMaterial,
  DynamicTexture,
  BillboardMode,
  MeshBuilder,
  TransformNode,
  LinesMesh,
  PointerEventTypes
} from '@babylonjs/core'
import { Cursor3D } from '@/services/collaboration/CursorTrackingService'

export interface Cursor3DRendererProps {
  scene: Scene
  cursors: Cursor3D[]
  showLabels?: boolean
  cursorSize?: number
  labelSize?: number
  lineLength?: number
  fadeDistance?: number
  enableInteraction?: boolean
  onCursorClick?: (cursor: Cursor3D) => void
  onCursorHover?: (cursor: Cursor3D | null) => void
}

export class Cursor3DRenderer {
  private scene: Scene
  private cursorMeshes: Map<string, {
    container: TransformNode
    pointer: Mesh
    line: LinesMesh
    label?: Mesh
  }> = new Map()
  private props: Cursor3DRendererProps
  private hoveredCursor: string | null = null

  constructor(scene: Scene, props: Cursor3DRendererProps) {
    this.scene = scene
    this.props = {
      showLabels: true,
      cursorSize: 0.5,
      labelSize: 1,
      lineLength: 2,
      fadeDistance: 50,
      enableInteraction: true,
      ...props
    }

    if (this.props.enableInteraction) {
      this.setupInteraction()
    }
  }

  // Update cursors
  updateCursors(cursors: Cursor3D[]): void {
    const activeCursorIds = new Set(cursors.map(c => c.userId))

    // Remove inactive cursors
    for (const [userId, meshes] of this.cursorMeshes) {
      if (!activeCursorIds.has(userId)) {
        this.removeCursorMesh(userId)
      }
    }

    // Update or create cursor meshes
    for (const cursor of cursors) {
      if (cursor.isVisible) {
        this.updateCursorMesh(cursor)
      } else {
        this.hideCursorMesh(cursor.userId)
      }
    }
  }

  // Update or create cursor mesh
  private updateCursorMesh(cursor: Cursor3D): void {
    let meshes = this.cursorMeshes.get(cursor.userId)

    if (!meshes) {
      meshes = this.createCursorMesh(cursor)
      this.cursorMeshes.set(cursor.userId, meshes)
    }

    // Update position
    meshes.container.position = cursor.position

    // Update line direction
    if (cursor.normal) {
      const linePoints = [
        Vector3.Zero(),
        cursor.normal.scale(this.props.lineLength!)
      ]
      meshes.line = MeshBuilder.CreateLines(
        `cursor-line-${cursor.userId}`,
        { points: linePoints, instance: meshes.line },
        this.scene
      )
    }

    // Update visibility based on distance
    if (this.scene.activeCamera) {
      const distance = Vector3.Distance(
        cursor.position,
        this.scene.activeCamera.position
      )
      const opacity = Math.max(0, 1 - distance / this.props.fadeDistance!)
      
      const material = meshes.pointer.material as StandardMaterial
      material.alpha = opacity

      if (meshes.label) {
        const labelMaterial = meshes.label.material as StandardMaterial
        labelMaterial.alpha = opacity
      }
    }

    // Show meshes
    meshes.container.setEnabled(true)
  }

  // Create cursor mesh
  private createCursorMesh(cursor: Cursor3D): {
    container: TransformNode
    pointer: Mesh
    line: LinesMesh
    label?: Mesh
  } {
    // Container node
    const container = new TransformNode(`cursor-container-${cursor.userId}`, this.scene)

    // Pointer mesh (cone)
    const pointer = MeshBuilder.CreateCone(
      `cursor-pointer-${cursor.userId}`,
      {
        height: this.props.cursorSize!,
        diameterBottom: this.props.cursorSize! * 0.6,
        diameterTop: 0,
        tessellation: 8
      },
      this.scene
    )
    pointer.parent = container
    pointer.rotation.x = Math.PI

    // Material
    const material = new StandardMaterial(`cursor-material-${cursor.userId}`, this.scene)
    const color = Color3.FromHexString(cursor.color)
    material.diffuseColor = color
    material.specularColor = new Color3(0.2, 0.2, 0.2)
    material.emissiveColor = color.scale(0.3)
    material.alpha = 0.8
    pointer.material = material

    // Line from cursor to surface
    const linePoints = [
      Vector3.Zero(),
      new Vector3(0, this.props.lineLength!, 0)
    ]
    const line = MeshBuilder.CreateLines(
      `cursor-line-${cursor.userId}`,
      { points: linePoints },
      this.scene
    )
    line.parent = container
    line.color = color

    // Label (optional)
    let label: Mesh | undefined
    if (this.props.showLabels) {
      label = this.createLabel(cursor)
      if (label) {
        label.parent = container
        label.position.y = this.props.cursorSize! + 0.5
        label.billboardMode = BillboardMode.BILLBOARDMODE_ALL
      }
    }

    // Metadata for interaction
    pointer.metadata = { cursorUserId: cursor.userId, type: 'cursor' }

    return { container, pointer, line, label }
  }

  // Create label mesh
  private createLabel(cursor: Cursor3D): Mesh | undefined {
    const plane = MeshBuilder.CreatePlane(
      `cursor-label-${cursor.userId}`,
      { size: this.props.labelSize! },
      this.scene
    )

    // Create dynamic texture for text
    const texture = new DynamicTexture(
      `cursor-label-texture-${cursor.userId}`,
      { width: 256, height: 128 },
      this.scene,
      false
    )

    const material = new StandardMaterial(`cursor-label-material-${cursor.userId}`, this.scene)
    material.diffuseTexture = texture
    material.opacityTexture = texture
    material.emissiveColor = new Color3(1, 1, 1)
    material.disableLighting = true
    material.backFaceCulling = false
    plane.material = material

    // Draw text
    const context = texture.getContext()
    context.fillStyle = cursor.color
    context.fillRect(0, 0, 256, 128)
    
    context.font = 'bold 32px Arial'
    context.fillStyle = 'white'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    
    // Truncate long names
    const displayName = cursor.userName.length > 15 
      ? cursor.userName.substring(0, 12) + '...' 
      : cursor.userName
    
    context.fillText(displayName, 128, 64)
    texture.update()

    return plane
  }

  // Hide cursor mesh
  private hideCursorMesh(userId: string): void {
    const meshes = this.cursorMeshes.get(userId)
    if (meshes) {
      meshes.container.setEnabled(false)
    }
  }

  // Remove cursor mesh
  private removeCursorMesh(userId: string): void {
    const meshes = this.cursorMeshes.get(userId)
    if (meshes) {
      meshes.pointer.dispose()
      meshes.line.dispose()
      if (meshes.label) {
        meshes.label.dispose()
      }
      meshes.container.dispose()
      this.cursorMeshes.delete(userId)
    }
  }

  // Setup interaction handlers
  private setupInteraction(): void {
    this.scene.onPointerObservable.add((pointerInfo) => {
      switch (pointerInfo.type) {
        case PointerEventTypes.POINTERMOVE:
          this.handlePointerMove(pointerInfo)
          break
        case PointerEventTypes.POINTERTAP:
          this.handlePointerTap(pointerInfo)
          break
      }
    })
  }

  // Handle pointer move for hover
  private handlePointerMove(pointerInfo: any): void {
    if (!this.props.onCursorHover) return

    const pickResult = pointerInfo.pickInfo
    if (pickResult?.hit && pickResult.pickedMesh?.metadata?.type === 'cursor') {
      const userId = pickResult.pickedMesh.metadata.cursorUserId
      if (userId !== this.hoveredCursor) {
        this.hoveredCursor = userId
        const cursor = this.findCursor(userId)
        if (cursor) {
          this.props.onCursorHover(cursor)
        }
      }
    } else if (this.hoveredCursor) {
      this.hoveredCursor = null
      this.props.onCursorHover(null)
    }
  }

  // Handle pointer tap for click
  private handlePointerTap(pointerInfo: any): void {
    if (!this.props.onCursorClick) return

    const pickResult = pointerInfo.pickInfo
    if (pickResult?.hit && pickResult.pickedMesh?.metadata?.type === 'cursor') {
      const userId = pickResult.pickedMesh.metadata.cursorUserId
      const cursor = this.findCursor(userId)
      if (cursor) {
        this.props.onCursorClick(cursor)
      }
    }
  }

  // Find cursor by user ID
  private findCursor(userId: string): Cursor3D | undefined {
    return this.props.cursors.find(c => c.userId === userId)
  }

  // Update properties
  updateProps(props: Partial<Cursor3DRendererProps>): void {
    this.props = { ...this.props, ...props }
    
    // Recreate all cursors if size properties changed
    if ('cursorSize' in props || 'labelSize' in props || 'lineLength' in props) {
      const cursors = this.props.cursors
      this.dispose()
      this.updateCursors(cursors)
    }
  }

  // Dispose of all resources
  dispose(): void {
    for (const userId of this.cursorMeshes.keys()) {
      this.removeCursorMesh(userId)
    }
    this.cursorMeshes.clear()
  }
}

// React component wrapper
const Cursor3DRendererComponent: React.FC<Cursor3DRendererProps> = (props) => {
  const rendererRef = useRef<Cursor3DRenderer | null>(null)

  useEffect(() => {
    if (!rendererRef.current && props.scene) {
      rendererRef.current = new Cursor3DRenderer(props.scene, props)
    }

    return () => {
      if (rendererRef.current) {
        rendererRef.current.dispose()
        rendererRef.current = null
      }
    }
  }, [props.scene])

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.updateCursors(props.cursors)
    }
  }, [props.cursors])

  useEffect(() => {
    if (rendererRef.current) {
      const { scene, cursors, ...otherProps } = props
      rendererRef.current.updateProps(otherProps)
    }
  }, [props.showLabels, props.cursorSize, props.labelSize, props.lineLength, props.fadeDistance])

  return null
}

export default Cursor3DRendererComponent