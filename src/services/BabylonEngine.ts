import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  DirectionalLight,
  Vector3,
  Color3,
  UniversalCamera,
  WebGPUEngine,
} from '@babylonjs/core'
import '@babylonjs/loaders/glTF'
import { ViewerConfig, PerformanceMetrics } from '@/types'

export class BabylonEngine {
  private engine: Engine | null = null
  private scene: Scene | null = null
  private camera: ArcRotateCamera | null = null
  private canvas: HTMLCanvasElement | null = null
  private config: ViewerConfig
  private performanceMetrics: PerformanceMetrics = {
    fps: 0,
    drawCalls: 0,
    triangles: 0,
    memory: 0,
    loadTime: 0,
  }

  constructor(config: ViewerConfig) {
    this.config = config
  }

  async initialize(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas
    
    try {
      // Try WebGPU first, fallback to WebGL 2.0
      this.engine = await this.createEngine(canvas)
      
      if (!this.engine) {
        throw new Error('Failed to create rendering engine')
      }

      this.setupEngine()
      this.createScene()
      this.setupCamera()
      this.setupLighting()
      this.setupPerformanceMonitoring()
      
      // Start render loop
      this.engine.runRenderLoop(() => {
        if (this.scene) {
          this.scene.render()
          this.updatePerformanceMetrics()
        }
      })

      // Handle window resize
      window.addEventListener('resize', () => {
        this.engine?.resize()
      })

    } catch (error) {
      console.error('Failed to initialize Babylon.js engine:', error)
      throw error
    }
  }

  private async createEngine(canvas: HTMLCanvasElement): Promise<Engine> {
    let engine: Engine

    try {
      // Try WebGPU first for better performance
      if (navigator.gpu) {
        engine = new WebGPUEngine(canvas, {
          antialias: true,
          stencil: true,
          audioEngine: false,
        })
        await (engine as WebGPUEngine).initAsync()
        console.log('WebGPU engine initialized')
        return engine
      }
    } catch (error) {
      console.warn('WebGPU not available, falling back to WebGL:', error)
    }

    // Fallback to WebGL 2.0
    engine = new Engine(canvas, true, {
      antialias: true,
      stencil: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
      doNotHandleContextLost: false,
      audioEngine: false,
    })

    console.log('WebGL 2.0 engine initialized')
    return engine
  }

  private setupEngine(): void {
    if (!this.engine) return

    // Performance optimizations
    this.engine.setHardwareScalingLevel(this.getOptimalScalingLevel())
    
    // Enable optimizations
    if (this.config.enablePerformanceOptimization) {
      this.engine.enableOfflineSupport = false
      this.engine.cullBackFaces = true
    }
  }

  private createScene(): void {
    if (!this.engine) return

    this.scene = new Scene(this.engine)
    
    // Scene optimizations
    this.scene.skipPointerMovePicking = true
    this.scene.autoClear = true
    this.scene.autoClearDepthAndStencil = true
    
    // Enable frustum culling
    this.scene.freezeActiveMeshes = false
    
    // Set clear color
    this.scene.clearColor = new Color3(0.1, 0.1, 0.1)
  }

  private setupCamera(): void {
    if (!this.scene) return

    this.camera = new ArcRotateCamera(
      'camera',
      -Math.PI / 2,
      Math.PI / 2.5,
      10,
      Vector3.Zero(),
      this.scene
    )

    // Camera controls
    this.camera.attachControls(this.canvas, true)
    this.camera.wheelDeltaPercentage = 0.01
    this.camera.pinchDeltaPercentage = 0.01
    
    // Set camera limits
    this.camera.lowerRadiusLimit = 0.1
    this.camera.upperRadiusLimit = 100
    this.camera.lowerBetaLimit = 0.1
    this.camera.upperBetaLimit = Math.PI - 0.1

    // Smooth camera movements
    this.camera.inertia = 0.8
    this.camera.angularSensibilityX = 1000
    this.camera.angularSensibilityY = 1000
  }

  private setupLighting(): void {
    if (!this.scene) return

    // Ambient light
    const hemisphericLight = new HemisphericLight(
      'hemisphericLight',
      new Vector3(0, 1, 0),
      this.scene
    )
    hemisphericLight.intensity = 0.6

    // Directional light for shadows
    const directionalLight = new DirectionalLight(
      'directionalLight',
      new Vector3(-1, -1, -1),
      this.scene
    )
    directionalLight.intensity = 0.8
    directionalLight.position = new Vector3(10, 10, 10)
  }

  private setupPerformanceMonitoring(): void {
    if (!this.scene || !this.engine) return

    // FPS monitoring
    setInterval(() => {
      this.performanceMetrics.fps = this.engine?.getFps() || 0
    }, 1000)
  }

  private updatePerformanceMetrics(): void {
    if (!this.scene || !this.engine) return

    this.performanceMetrics.drawCalls = this.scene.getActiveMeshes().length
    this.performanceMetrics.triangles = this.scene.getTotalVertices()
    
    // Memory usage (approximate)
    if (performance.memory) {
      this.performanceMetrics.memory = performance.memory.usedJSHeapSize
    }
  }

  private getOptimalScalingLevel(): number {
    const devicePixelRatio = window.devicePixelRatio || 1
    
    // Adjust scaling based on device capabilities
    if (devicePixelRatio > 2) {
      return 1 / 1.5 // Reduce resolution on high DPI displays
    } else if (devicePixelRatio > 1) {
      return 1 / 1.2
    }
    
    return 1
  }

  getScene(): Scene | null {
    return this.scene
  }

  getEngine(): Engine | null {
    return this.engine
  }

  getCamera(): ArcRotateCamera | null {
    return this.camera
  }

  getPerformanceMetrics(): PerformanceMetrics {
    return { ...this.performanceMetrics }
  }

  dispose(): void {
    if (this.scene) {
      this.scene.dispose()
      this.scene = null
    }
    
    if (this.engine) {
      this.engine.dispose()
      this.engine = null
    }
    
    this.camera = null
    this.canvas = null
  }
}