import {
  Scene,
  SceneLoader,
  AbstractMesh,
  AssetContainer,
  ISceneLoaderProgressEvent,
  Tools,
  Texture,
  Material,
  PBRMaterial,
} from '@babylonjs/core'
import '@babylonjs/loaders/glTF'
import { DracoCompression } from '@babylonjs/core/Meshes/Compression/dracoCompression'
import { Model3D, LoadingState, ViewerConfig } from '@/types'

export class ModelLoader {
  private scene: Scene
  private config: ViewerConfig
  private currentContainer: AssetContainer | null = null
  private loadingState: LoadingState = {
    isLoading: false,
    progress: 0,
    message: '',
  }
  private onLoadingStateChange?: (state: LoadingState) => void

  constructor(scene: Scene, config: ViewerConfig) {
    this.scene = scene
    this.config = config
    this.setupDracoCompression()
  }

  private setupDracoCompression(): void {
    if (this.config.enableDracoCompression) {
      DracoCompression.Configuration = {
        decoder: {
          wasmUrl: '/draco/draco_wasm_wrapper.js',
          wasmBinaryUrl: '/draco/draco_decoder.wasm',
          fallbackUrl: '/draco/draco_decoder.js',
        },
      }
    }
  }

  async loadModel(model: Model3D): Promise<AbstractMesh[]> {
    this.updateLoadingState(true, 0, `Loading ${model.name}...`)
    
    const startTime = performance.now()

    try {
      // Validate file size
      if (model.size > this.config.maxModelSize) {
        throw new Error(`Model size (${this.formatFileSize(model.size)}) exceeds limit (${this.formatFileSize(this.config.maxModelSize)})`)
      }

      // Clear previous model
      await this.clearCurrentModel()

      this.updateLoadingState(true, 10, 'Downloading model...')

      // Load the model
      const result = await SceneLoader.ImportMeshAsync(
        '',
        '',
        model.url,
        this.scene,
        (progress: ISceneLoaderProgressEvent) => {
          const progressPercent = progress.total > 0 
            ? Math.round((progress.loaded / progress.total) * 80) + 10
            : 50
          this.updateLoadingState(true, progressPercent, 'Loading geometry...')
        }
      )

      this.updateLoadingState(true, 90, 'Optimizing model...')

      // Store the loaded meshes in a container for easy management
      this.currentContainer = new AssetContainer(this.scene)
      result.meshes.forEach(mesh => {
        this.currentContainer?.meshes.push(mesh)
      })
      result.materials.forEach(material => {
        this.currentContainer?.materials.push(material)
      })
      result.textures.forEach(texture => {
        this.currentContainer?.textures.push(texture)
      })

      // Optimize the model
      await this.optimizeModel(result.meshes)

      // Center and scale the model
      this.centerAndScaleModel(result.meshes)

      const loadTime = performance.now() - startTime
      this.updateLoadingState(false, 100, `Loaded in ${Math.round(loadTime)}ms`)

      console.log(`Model loaded successfully in ${Math.round(loadTime)}ms:`, {
        meshes: result.meshes.length,
        materials: result.materials.length,
        textures: result.textures.length,
      })

      return result.meshes

    } catch (error) {
      this.updateLoadingState(false, 0, 'Failed to load model')
      console.error('Model loading failed:', error)
      throw error
    }
  }

  private async optimizeModel(meshes: AbstractMesh[]): Promise<void> {
    for (const mesh of meshes) {
      // Enable frustum culling
      mesh.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_STANDARD

      // Optimize for static meshes
      if (mesh.skeleton === null && mesh.morphTargetManager === null) {
        mesh.freezeWorldMatrix()
      }

      // Optimize materials
      if (mesh.material) {
        this.optimizeMaterial(mesh.material)
      }
    }

    // Merge compatible meshes for better performance
    // This is commented out as it can break animations and materials
    // SceneLoader.ImportMesh can handle this better with proper flags
  }

  private optimizeMaterial(material: Material): void {
    if (material instanceof PBRMaterial) {
      // Enable texture caching
      if (material.baseTexture) {
        material.baseTexture.wrapU = Texture.CLAMP_ADDRESSMODE
        material.baseTexture.wrapV = Texture.CLAMP_ADDRESSMODE
      }

      // Optimize for performance
      material.forceCompilation(this.scene)
    }
  }

  private centerAndScaleModel(meshes: AbstractMesh[]): void {
    if (meshes.length === 0) return

    // Calculate bounding box
    let min = meshes[0].getBoundingInfo().boundingBox.minimumWorld.clone()
    let max = meshes[0].getBoundingInfo().boundingBox.maximumWorld.clone()

    meshes.forEach(mesh => {
      const boundingInfo = mesh.getBoundingInfo()
      min = min.minimizeInPlace(boundingInfo.boundingBox.minimumWorld)
      max = max.maximizeInPlace(boundingInfo.boundingBox.maximumWorld)
    })

    // Calculate center and size
    const center = min.add(max).scale(0.5)
    const size = max.subtract(min)
    const maxDimension = Math.max(size.x, size.y, size.z)

    // Scale to fit in a 10-unit cube
    const targetSize = 10
    const scaleFactor = targetSize / maxDimension

    meshes.forEach(mesh => {
      // Center the mesh
      mesh.position = mesh.position.subtract(center)
      
      // Scale the mesh
      if (scaleFactor !== 1) {
        mesh.scaling = mesh.scaling.scale(scaleFactor)
      }
    })

    console.log(`Model centered and scaled by factor: ${scaleFactor.toFixed(3)}`)
  }

  async clearCurrentModel(): Promise<void> {
    if (this.currentContainer) {
      this.currentContainer.dispose()
      this.currentContainer = null
    }

    // Clean up any remaining meshes
    const meshesToDispose = this.scene.meshes.filter(mesh => mesh.name !== '__root__')
    meshesToDispose.forEach(mesh => mesh.dispose())

    // Force garbage collection
    this.scene.cleanCachedTextureBuffer()
    Tools.ToBlob(this.scene.getEngine().getRenderingCanvas() as HTMLCanvasElement, () => {})
  }

  private updateLoadingState(isLoading: boolean, progress: number, message: string): void {
    this.loadingState = { isLoading, progress, message }
    this.onLoadingStateChange?.(this.loadingState)
  }

  private formatFileSize(bytes: number): string {
    const sizes = ['B', 'KB', 'MB', 'GB']
    if (bytes === 0) return '0 B'
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i]
  }

  setLoadingStateCallback(callback: (state: LoadingState) => void): void {
    this.onLoadingStateChange = callback
  }

  getLoadingState(): LoadingState {
    return { ...this.loadingState }
  }

  getCurrentModel(): AssetContainer | null {
    return this.currentContainer
  }

  dispose(): void {
    this.clearCurrentModel()
    this.onLoadingStateChange = undefined
  }
}