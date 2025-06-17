import { BabylonEngine } from '@/services/BabylonEngine'
import { ModelLoader } from '@/services/ModelLoader'
import { ViewerConfig, Model3D } from '@/types'

class ModelViewer {
  private engine: BabylonEngine | null = null
  private modelLoader: ModelLoader | null = null
  private canvas: HTMLCanvasElement | null = null
  private config: ViewerConfig = {
    enablePerformanceOptimization: true,
    maxModelSize: 100 * 1024 * 1024, // 100MB
    enableDracoCompression: true,
    enableTextureCompression: true,
    targetFPS: 60,
  }

  async initialize(): Promise<void> {
    try {
      // Get canvas element
      this.canvas = this.createCanvas()
      document.getElementById('root')?.appendChild(this.canvas)

      // Initialize Babylon.js engine
      this.engine = new BabylonEngine(this.config)
      await this.engine.initialize(this.canvas)

      // Initialize model loader
      const scene = this.engine.getScene()
      if (scene) {
        this.modelLoader = new ModelLoader(scene, this.config)
        this.setupLoadingStateHandler()
      }

      // Setup UI
      this.setupUI()

      // Hide loading indicator
      this.hideLoadingIndicator()

      console.log('3D Model Viewer initialized successfully')

    } catch (error) {
      console.error('Failed to initialize 3D Model Viewer:', error)
      this.showError('Failed to initialize 3D viewer. Please check your browser compatibility.')
    }
  }

  private createCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.id = 'babylon-canvas'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    canvas.style.outline = 'none'
    return canvas
  }

  private setupLoadingStateHandler(): void {
    this.modelLoader?.setLoadingStateCallback((state) => {
      if (state.isLoading) {
        this.showLoadingIndicator(state.message, state.progress)
      } else {
        this.hideLoadingIndicator()
      }
    })
  }

  private setupUI(): void {
    // Create basic UI
    const ui = document.createElement('div')
    ui.id = 'viewer-ui'
    ui.style.cssText = `
      position: absolute;
      top: 20px;
      left: 20px;
      z-index: 1000;
      background: rgba(0, 0, 0, 0.8);
      padding: 15px;
      border-radius: 8px;
      color: white;
      font-family: monospace;
      font-size: 12px;
      min-width: 200px;
    `

    // Performance metrics display
    const metricsDiv = document.createElement('div')
    metricsDiv.id = 'performance-metrics'
    ui.appendChild(metricsDiv)

    // File input for testing
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = '.gltf,.glb'
    fileInput.style.cssText = 'margin-top: 10px; width: 100%;'
    fileInput.addEventListener('change', (event) => {
      const file = (event.target as HTMLInputElement).files?.[0]
      if (file) {
        this.loadModelFromFile(file)
      }
    })
    ui.appendChild(fileInput)

    document.body.appendChild(ui)

    // Update performance metrics
    this.updatePerformanceMetrics()
  }

  private updatePerformanceMetrics(): void {
    const metricsDiv = document.getElementById('performance-metrics')
    if (!metricsDiv || !this.engine) return

    const metrics = this.engine.getPerformanceMetrics()
    metricsDiv.innerHTML = `
      <div><strong>Performance Metrics</strong></div>
      <div>FPS: ${metrics.fps.toFixed(1)}</div>
      <div>Draw Calls: ${metrics.drawCalls}</div>
      <div>Triangles: ${metrics.triangles.toLocaleString()}</div>
      <div>Memory: ${(metrics.memory / 1024 / 1024).toFixed(1)} MB</div>
    `

    // Update every second
    setTimeout(() => this.updatePerformanceMetrics(), 1000)
  }

  private async loadModelFromFile(file: File): Promise<void> {
    if (!this.modelLoader) return

    try {
      // Create URL for the file
      const url = URL.createObjectURL(file)
      
      const model: Model3D = {
        id: 'temp-' + Date.now(),
        name: file.name,
        url: url,
        size: file.size,
        format: file.name.split('.').pop() || 'unknown',
        uploadedBy: 'local',
        uploadedAt: new Date().toISOString(),
        version: '1.0.0',
        isPublic: false,
      }

      await this.modelLoader.loadModel(model)
      
      // Clean up URL
      URL.revokeObjectURL(url)

    } catch (error) {
      console.error('Failed to load model:', error)
      this.showError(`Failed to load model: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private showLoadingIndicator(message: string = 'Loading...', progress: number = 0): void {
    let indicator = document.getElementById('loading-indicator')
    
    if (!indicator) {
      indicator = document.createElement('div')
      indicator.id = 'loading-indicator'
      indicator.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 30px;
        border-radius: 10px;
        text-align: center;
        z-index: 2000;
        min-width: 300px;
      `
      document.body.appendChild(indicator)
    }

    indicator.innerHTML = `
      <div style="margin-bottom: 15px;">${message}</div>
      <div style="background: #333; height: 4px; border-radius: 2px; overflow: hidden;">
        <div style="background: #007acc; height: 100%; width: ${progress}%; transition: width 0.3s;"></div>
      </div>
      <div style="margin-top: 10px; font-size: 12px; opacity: 0.8;">${progress.toFixed(0)}%</div>
    `

    indicator.style.display = 'block'
  }

  private hideLoadingIndicator(): void {
    const indicator = document.getElementById('loading-indicator')
    if (indicator) {
      indicator.style.display = 'none'
    }

    // Also hide the initial loading screen
    const initialLoading = document.querySelector('.loading')
    if (initialLoading) {
      initialLoading.remove()
    }
  }

  private showError(message: string): void {
    const errorDiv = document.createElement('div')
    errorDiv.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #dc3545;
      color: white;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
      z-index: 3000;
      max-width: 80%;
    `
    errorDiv.textContent = message
    
    document.body.appendChild(errorDiv)
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      errorDiv.remove()
    }, 5000)
  }

  dispose(): void {
    this.modelLoader?.dispose()
    this.engine?.dispose()
    this.canvas?.remove()
  }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  const viewer = new ModelViewer()
  
  try {
    await viewer.initialize()
  } catch (error) {
    console.error('Application initialization failed:', error)
  }

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    viewer.dispose()
  })
})