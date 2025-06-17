import * as BABYLON from '@babylonjs/core';
import { Mesh, Scene, Camera, Vector3, BoundingBox, Plane, Observable } from '@babylonjs/core';

export interface CullingConfig {
  enableFrustumCulling: boolean;
  enableOcclusionCulling: boolean;
  occlusionQueryDelay: number;
  frustumPadding: number;
  updateInterval: number;
  batchSize: number;
}

export interface CullingStats {
  totalMeshes: number;
  visibleMeshes: number;
  frustumCulled: number;
  occlusionCulled: number;
  performanceGain: number;
}

export class CullingSystem {
  private scene: Scene;
  private camera: Camera;
  private config: CullingConfig;
  private meshes: Set<Mesh> = new Set();
  private occlusionQueries: Map<Mesh, WebGLQuery> = new Map();
  private occlusionResults: Map<Mesh, boolean> = new Map();
  private frustumPlanes: Plane[] = [];
  private updateTimer: NodeJS.Timer | null = null;
  private stats: CullingStats;
  private spatialIndex: Map<string, Set<Mesh>> = new Map();
  private gridSize: number = 50; // World units per grid cell
  
  public onCullingUpdate = new Observable<CullingStats>();

  constructor(scene: Scene, config?: Partial<CullingConfig>) {
    this.scene = scene;
    this.camera = scene.activeCamera!;
    
    this.config = {
      enableFrustumCulling: config?.enableFrustumCulling ?? true,
      enableOcclusionCulling: config?.enableOcclusionCulling ?? true,
      occlusionQueryDelay: config?.occlusionQueryDelay ?? 5,
      frustumPadding: config?.frustumPadding ?? 0.1,
      updateInterval: config?.updateInterval ?? 50,
      batchSize: config?.batchSize ?? 10,
      ...config
    };

    this.stats = {
      totalMeshes: 0,
      visibleMeshes: 0,
      frustumCulled: 0,
      occlusionCulled: 0,
      performanceGain: 0
    };

    this.initializeFrustumPlanes();
    this.initializeOcclusionQueries();
  }

  /**
   * Initialize frustum planes for culling
   */
  private initializeFrustumPlanes(): void {
    // Create 6 frustum planes
    for (let i = 0; i < 6; i++) {
      this.frustumPlanes.push(new Plane(0, 0, 0, 0));
    }
  }

  /**
   * Initialize WebGL occlusion queries if supported
   */
  private initializeOcclusionQueries(): void {
    if (!this.config.enableOcclusionCulling) return;

    const gl = this.scene.getEngine()._gl;
    if (!gl) return;

    // Check for WebGL2 occlusion query support
    const ext = gl.getExtension('EXT_occlusion_query_boolean');
    if (!ext) {
      console.warn('Occlusion queries not supported, disabling occlusion culling');
      this.config.enableOcclusionCulling = false;
    }
  }

  /**
   * Register a mesh for culling optimization
   */
  public registerMesh(mesh: Mesh): void {
    this.meshes.add(mesh);
    
    // Add to spatial index
    const cellKey = this.getCellKey(mesh.position);
    if (!this.spatialIndex.has(cellKey)) {
      this.spatialIndex.set(cellKey, new Set());
    }
    this.spatialIndex.get(cellKey)!.add(mesh);

    // Enable built-in frustum culling
    mesh.alwaysSelectAsActiveMesh = false;
    
    // Create occlusion query if supported
    if (this.config.enableOcclusionCulling) {
      this.createOcclusionQuery(mesh);
    }

    this.stats.totalMeshes = this.meshes.size;
  }

  /**
   * Unregister a mesh from culling
   */
  public unregisterMesh(mesh: Mesh): void {
    this.meshes.delete(mesh);
    
    // Remove from spatial index
    const cellKey = this.getCellKey(mesh.position);
    this.spatialIndex.get(cellKey)?.delete(mesh);
    
    // Clean up occlusion query
    const query = this.occlusionQueries.get(mesh);
    if (query) {
      const gl = this.scene.getEngine()._gl;
      if (gl) {
        gl.deleteQuery(query);
      }
      this.occlusionQueries.delete(mesh);
      this.occlusionResults.delete(mesh);
    }

    this.stats.totalMeshes = this.meshes.size;
  }

  /**
   * Get spatial grid cell key for position
   */
  private getCellKey(position: Vector3): string {
    const x = Math.floor(position.x / this.gridSize);
    const y = Math.floor(position.y / this.gridSize);
    const z = Math.floor(position.z / this.gridSize);
    return `${x},${y},${z}`;
  }

  /**
   * Get neighboring cells for broad phase culling
   */
  private getNeighboringCells(cellKey: string, radius: number = 1): string[] {
    const [x, y, z] = cellKey.split(',').map(Number);
    const cells: string[] = [];
    
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          cells.push(`${x + dx},${y + dy},${z + dz}`);
        }
      }
    }
    
    return cells;
  }

  /**
   * Create WebGL occlusion query for mesh
   */
  private createOcclusionQuery(mesh: Mesh): void {
    const gl = this.scene.getEngine()._gl;
    if (!gl || !gl.createQuery) return;

    const query = gl.createQuery();
    if (query) {
      this.occlusionQueries.set(mesh, query);
      this.occlusionResults.set(mesh, true); // Initially visible
    }
  }

  /**
   * Start automatic culling updates
   */
  public startAutoUpdate(): void {
    if (this.updateTimer) return;

    this.updateTimer = setInterval(() => {
      this.update();
    }, this.config.updateInterval);
  }

  /**
   * Stop automatic culling updates
   */
  public stopAutoUpdate(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  /**
   * Update culling for all registered meshes
   */
  public update(): void {
    this.updateFrustumPlanes();
    
    let visibleCount = 0;
    let frustumCulledCount = 0;
    let occlusionCulledCount = 0;

    // Get camera cell and neighboring cells for broad phase
    const cameraCellKey = this.getCellKey(this.camera.position);
    const nearbyCells = this.getNeighboringCells(cameraCellKey, 3);
    const nearbyMeshes = new Set<Mesh>();
    
    // Collect meshes from nearby cells
    nearbyCells.forEach(cellKey => {
      const cellMeshes = this.spatialIndex.get(cellKey);
      if (cellMeshes) {
        cellMeshes.forEach(mesh => nearbyMeshes.add(mesh));
      }
    });

    // Process nearby meshes
    nearbyMeshes.forEach(mesh => {
      if (!mesh.isEnabled() || !mesh.isVisible) {
        return;
      }

      // Frustum culling
      if (this.config.enableFrustumCulling) {
        if (!this.isInFrustum(mesh)) {
          mesh.isVisible = false;
          frustumCulledCount++;
          return;
        }
      }

      // Occlusion culling
      if (this.config.enableOcclusionCulling) {
        const isOccluded = this.checkOcclusion(mesh);
        if (isOccluded) {
          mesh.isVisible = false;
          occlusionCulledCount++;
          return;
        }
      }

      // Mesh is visible
      mesh.isVisible = true;
      visibleCount++;
    });

    // Update stats
    this.stats.visibleMeshes = visibleCount;
    this.stats.frustumCulled = frustumCulledCount;
    this.stats.occlusionCulled = occlusionCulledCount;
    this.stats.performanceGain = 1 - (visibleCount / Math.max(this.meshes.size, 1));

    // Notify observers
    this.onCullingUpdate.notifyObservers(this.stats);
  }

  /**
   * Update frustum planes from camera
   */
  private updateFrustumPlanes(): void {
    const matrix = this.camera.getViewMatrix().multiply(this.camera.getProjectionMatrix());
    BABYLON.Frustum.GetPlanesFromMatrix(matrix, this.frustumPlanes);
  }

  /**
   * Check if mesh is within camera frustum
   */
  private isInFrustum(mesh: Mesh): boolean {
    const boundingBox = mesh.getBoundingInfo().boundingBox;
    const center = boundingBox.centerWorld;
    const radius = boundingBox.extendSizeWorld.length() + this.config.frustumPadding;

    // Check against all frustum planes
    for (const plane of this.frustumPlanes) {
      const distance = plane.normal.x * center.x + 
                      plane.normal.y * center.y + 
                      plane.normal.z * center.z + 
                      plane.d;
      
      if (distance < -radius) {
        return false; // Outside frustum
      }
    }

    return true;
  }

  /**
   * Check if mesh is occluded by other geometry
   */
  private checkOcclusion(mesh: Mesh): boolean {
    if (!this.config.enableOcclusionCulling) return false;

    // Simple distance-based occlusion for now
    // In production, use GPU occlusion queries or ray casting
    const cameraPosition = this.camera.position;
    const meshPosition = mesh.position;
    const distance = Vector3.Distance(cameraPosition, meshPosition);

    // Check if any large meshes are between camera and target
    let isOccluded = false;
    
    this.meshes.forEach(occluder => {
      if (occluder === mesh || !occluder.isVisible) return;
      
      const occluderDistance = Vector3.Distance(cameraPosition, occluder.position);
      if (occluderDistance < distance) {
        // Check if occluder blocks line of sight
        const toMesh = meshPosition.subtract(cameraPosition).normalize();
        const toOccluder = occluder.position.subtract(cameraPosition).normalize();
        const dot = Vector3.Dot(toMesh, toOccluder);
        
        if (dot > 0.95) { // Very similar direction
          const occluderSize = occluder.getBoundingInfo().boundingBox.extendSizeWorld.length();
          if (occluderSize > distance * 0.1) { // Large enough to occlude
            isOccluded = true;
          }
        }
      }
    });

    return isOccluded;
  }

  /**
   * Perform GPU occlusion query (WebGL2)
   */
  private performGPUOcclusionQuery(mesh: Mesh): void {
    const gl = this.scene.getEngine()._gl;
    const query = this.occlusionQueries.get(mesh);
    
    if (!gl || !query) return;

    // Start occlusion query
    gl.beginQuery(gl.ANY_SAMPLES_PASSED, query);
    
    // Render bounding box
    this.renderBoundingBox(mesh);
    
    // End query
    gl.endQuery(gl.ANY_SAMPLES_PASSED);

    // Check result asynchronously
    setTimeout(() => {
      if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
        const anySamplesPassed = gl.getQueryParameter(query, gl.QUERY_RESULT);
        this.occlusionResults.set(mesh, anySamplesPassed);
      }
    }, this.config.occlusionQueryDelay);
  }

  /**
   * Render mesh bounding box for occlusion query
   */
  private renderBoundingBox(mesh: Mesh): void {
    // Implementation would render a simple bounding box
    // This is a placeholder - actual implementation needs WebGL commands
    const boundingBox = mesh.getBoundingInfo().boundingBox;
    // Render bounding box vertices...
  }

  /**
   * Get current culling statistics
   */
  public getStatistics(): CullingStats {
    return { ...this.stats };
  }

  /**
   * Set culling configuration
   */
  public setConfig(config: Partial<CullingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Force update spatial index for moved mesh
   */
  public updateMeshPosition(mesh: Mesh): void {
    // Remove from old cell
    this.spatialIndex.forEach((meshes, cellKey) => {
      if (meshes.has(mesh)) {
        meshes.delete(mesh);
        if (meshes.size === 0) {
          this.spatialIndex.delete(cellKey);
        }
      }
    });

    // Add to new cell
    const newCellKey = this.getCellKey(mesh.position);
    if (!this.spatialIndex.has(newCellKey)) {
      this.spatialIndex.set(newCellKey, new Set());
    }
    this.spatialIndex.get(newCellKey)!.add(mesh);
  }

  /**
   * Dispose of culling system
   */
  public dispose(): void {
    this.stopAutoUpdate();
    
    // Clean up occlusion queries
    const gl = this.scene.getEngine()._gl;
    if (gl) {
      this.occlusionQueries.forEach(query => {
        gl.deleteQuery(query);
      });
    }
    
    this.meshes.clear();
    this.occlusionQueries.clear();
    this.occlusionResults.clear();
    this.spatialIndex.clear();
    this.onCullingUpdate.clear();
  }
}