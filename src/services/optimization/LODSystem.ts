import * as BABYLON from '@babylonjs/core';
import { Mesh, Scene, Vector3, Observable, Observer } from '@babylonjs/core';

export interface LODLevel {
  distance: number;
  meshes: Mesh[];
  quality: 'high' | 'medium' | 'low' | 'ultra-low';
}

export interface LODConfig {
  distanceThresholds: {
    high: number;
    medium: number;
    low: number;
    ultraLow: number;
  };
  autoGenerate: boolean;
  preserveMaterials: boolean;
}

export class LODSystem {
  private scene: Scene;
  private lodGroups: Map<string, LODLevel[]> = new Map();
  private activeLODs: Map<string, number> = new Map();
  private camera: BABYLON.Camera;
  private updateInterval: number = 100; // milliseconds
  private updateTimer: NodeJS.Timer | null = null;
  private config: LODConfig;
  
  public onLODChanged = new Observable<{ meshId: string; level: number }>();

  constructor(scene: Scene, config?: Partial<LODConfig>) {
    this.scene = scene;
    this.camera = scene.activeCamera!;
    
    this.config = {
      distanceThresholds: {
        high: 0,
        medium: 50,
        low: 100,
        ultraLow: 200,
        ...config?.distanceThresholds
      },
      autoGenerate: config?.autoGenerate ?? true,
      preserveMaterials: config?.preserveMaterials ?? true
    };
  }

  /**
   * Register a mesh with LOD levels
   */
  public registerMesh(
    meshId: string, 
    highDetailMesh: Mesh, 
    customLevels?: LODLevel[]
  ): void {
    if (customLevels) {
      this.lodGroups.set(meshId, customLevels);
    } else if (this.config.autoGenerate) {
      const generatedLevels = this.generateLODLevels(highDetailMesh);
      this.lodGroups.set(meshId, generatedLevels);
    } else {
      // Use only the high detail mesh at all distances
      this.lodGroups.set(meshId, [{
        distance: 0,
        meshes: [highDetailMesh],
        quality: 'high'
      }]);
    }

    // Initially show the highest quality
    this.setLODLevel(meshId, 0);
  }

  /**
   * Automatically generate LOD levels using mesh simplification
   */
  private generateLODLevels(originalMesh: Mesh): LODLevel[] {
    const levels: LODLevel[] = [];

    // High quality - original mesh
    levels.push({
      distance: this.config.distanceThresholds.high,
      meshes: [originalMesh],
      quality: 'high'
    });

    // Medium quality - 50% vertices
    const mediumMesh = this.simplifyMesh(originalMesh, 0.5);
    if (mediumMesh) {
      mediumMesh.name = `${originalMesh.name}_LOD_medium`;
      levels.push({
        distance: this.config.distanceThresholds.medium,
        meshes: [mediumMesh],
        quality: 'medium'
      });
    }

    // Low quality - 25% vertices
    const lowMesh = this.simplifyMesh(originalMesh, 0.25);
    if (lowMesh) {
      lowMesh.name = `${originalMesh.name}_LOD_low`;
      levels.push({
        distance: this.config.distanceThresholds.low,
        meshes: [lowMesh],
        quality: 'low'
      });
    }

    // Ultra low quality - 10% vertices
    const ultraLowMesh = this.simplifyMesh(originalMesh, 0.1);
    if (ultraLowMesh) {
      ultraLowMesh.name = `${originalMesh.name}_LOD_ultralow`;
      levels.push({
        distance: this.config.distanceThresholds.ultraLow,
        meshes: [ultraLowMesh],
        quality: 'ultra-low'
      });
    }

    return levels;
  }

  /**
   * Simplify mesh geometry using decimation
   */
  private simplifyMesh(originalMesh: Mesh, targetQuality: number): Mesh | null {
    try {
      const simplifiedMesh = originalMesh.clone(
        `${originalMesh.name}_simplified_${targetQuality}`,
        originalMesh.parent
      );

      // Get vertex data
      const positions = originalMesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
      const indices = originalMesh.getIndices();
      
      if (!positions || !indices) {
        simplifiedMesh.dispose();
        return null;
      }

      // Simple decimation algorithm (quadric error simplification)
      const decimatedData = this.decimateMesh(positions, indices, targetQuality);
      
      if (!decimatedData) {
        simplifiedMesh.dispose();
        return null;
      }

      // Apply simplified geometry
      const vertexData = new BABYLON.VertexData();
      vertexData.positions = decimatedData.positions;
      vertexData.indices = decimatedData.indices;
      
      // Copy other vertex data if available
      const normals = originalMesh.getVerticesData(BABYLON.VertexBuffer.NormalKind);
      if (normals) {
        vertexData.normals = this.interpolateVertexData(
          normals, 
          positions.length / 3, 
          decimatedData.positions.length / 3,
          decimatedData.vertexMap
        );
      }

      const uvs = originalMesh.getVerticesData(BABYLON.VertexBuffer.UVKind);
      if (uvs) {
        vertexData.uvs = this.interpolateVertexData(
          uvs,
          positions.length / 3,
          decimatedData.positions.length / 3,
          decimatedData.vertexMap,
          2
        );
      }

      vertexData.applyToMesh(simplifiedMesh);

      // Preserve materials if configured
      if (this.config.preserveMaterials && originalMesh.material) {
        simplifiedMesh.material = originalMesh.material;
      }

      // Copy other properties
      simplifiedMesh.position = originalMesh.position.clone();
      simplifiedMesh.rotation = originalMesh.rotation.clone();
      simplifiedMesh.scaling = originalMesh.scaling.clone();
      simplifiedMesh.isVisible = false; // Initially hidden

      return simplifiedMesh;
    } catch (error) {
      console.error('Error simplifying mesh:', error);
      return null;
    }
  }

  /**
   * Decimate mesh using edge collapse
   */
  private decimateMesh(
    positions: Float32Array,
    indices: Uint32Array | Int32Array,
    targetQuality: number
  ): { positions: Float32Array; indices: Uint32Array; vertexMap: Map<number, number> } | null {
    const vertexCount = positions.length / 3;
    const targetVertexCount = Math.floor(vertexCount * targetQuality);
    
    if (targetVertexCount < 3) return null;

    // Simple implementation - for production, use a proper decimation library
    // This is a placeholder that randomly removes vertices
    const vertexMap = new Map<number, number>();
    const newPositions: number[] = [];
    const keepVertices = new Set<number>();
    
    // Randomly select vertices to keep (simplified approach)
    while (keepVertices.size < targetVertexCount) {
      keepVertices.add(Math.floor(Math.random() * vertexCount));
    }

    // Build vertex map and new positions
    let newIndex = 0;
    for (let i = 0; i < vertexCount; i++) {
      if (keepVertices.has(i)) {
        vertexMap.set(i, newIndex);
        newPositions.push(
          positions[i * 3],
          positions[i * 3 + 1],
          positions[i * 3 + 2]
        );
        newIndex++;
      }
    }

    // Remap indices
    const newIndices: number[] = [];
    for (let i = 0; i < indices.length; i += 3) {
      const v0 = vertexMap.get(indices[i]);
      const v1 = vertexMap.get(indices[i + 1]);
      const v2 = vertexMap.get(indices[i + 2]);
      
      if (v0 !== undefined && v1 !== undefined && v2 !== undefined) {
        newIndices.push(v0, v1, v2);
      }
    }

    return {
      positions: new Float32Array(newPositions),
      indices: new Uint32Array(newIndices),
      vertexMap
    };
  }

  /**
   * Interpolate vertex data for simplified mesh
   */
  private interpolateVertexData(
    originalData: Float32Array,
    originalVertexCount: number,
    newVertexCount: number,
    vertexMap: Map<number, number>,
    componentsPerVertex: number = 3
  ): Float32Array {
    const newData = new Float32Array(newVertexCount * componentsPerVertex);
    
    vertexMap.forEach((newIdx, oldIdx) => {
      for (let c = 0; c < componentsPerVertex; c++) {
        newData[newIdx * componentsPerVertex + c] = 
          originalData[oldIdx * componentsPerVertex + c];
      }
    });

    return newData;
  }

  /**
   * Start automatic LOD updates based on camera distance
   */
  public startAutoUpdate(): void {
    if (this.updateTimer) return;

    this.updateTimer = setInterval(() => {
      this.updateLODs();
    }, this.updateInterval);
  }

  /**
   * Stop automatic LOD updates
   */
  public stopAutoUpdate(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  /**
   * Update LOD levels for all registered meshes
   */
  private updateLODs(): void {
    const cameraPosition = this.camera.position;

    this.lodGroups.forEach((levels, meshId) => {
      if (levels.length === 0) return;

      // Calculate distance to first mesh in group
      const referenceMesh = levels[0].meshes[0];
      if (!referenceMesh) return;

      const distance = Vector3.Distance(cameraPosition, referenceMesh.position);
      
      // Find appropriate LOD level
      let selectedLevel = 0;
      for (let i = levels.length - 1; i >= 0; i--) {
        if (distance >= levels[i].distance) {
          selectedLevel = i;
          break;
        }
      }

      // Apply LOD if changed
      const currentLevel = this.activeLODs.get(meshId) ?? -1;
      if (currentLevel !== selectedLevel) {
        this.setLODLevel(meshId, selectedLevel);
      }
    });
  }

  /**
   * Manually set LOD level for a mesh
   */
  private setLODLevel(meshId: string, level: number): void {
    const levels = this.lodGroups.get(meshId);
    if (!levels || level < 0 || level >= levels.length) return;

    // Hide all LOD levels
    levels.forEach(lodLevel => {
      lodLevel.meshes.forEach(mesh => {
        mesh.isVisible = false;
      });
    });

    // Show selected level
    levels[level].meshes.forEach(mesh => {
      mesh.isVisible = true;
    });

    this.activeLODs.set(meshId, level);
    
    // Notify observers
    this.onLODChanged.notifyObservers({ meshId, level });
  }

  /**
   * Get current LOD statistics
   */
  public getStatistics(): {
    totalMeshes: number;
    activeLODs: Map<string, { level: number; quality: string }>;
    memoryReduction: number;
  } {
    const stats = {
      totalMeshes: this.lodGroups.size,
      activeLODs: new Map<string, { level: number; quality: string }>(),
      memoryReduction: 0
    };

    this.activeLODs.forEach((level, meshId) => {
      const levels = this.lodGroups.get(meshId);
      if (levels && levels[level]) {
        stats.activeLODs.set(meshId, {
          level,
          quality: levels[level].quality
        });

        // Estimate memory reduction
        if (level > 0) {
          const reductionFactors = { 'medium': 0.5, 'low': 0.75, 'ultra-low': 0.9 };
          stats.memoryReduction += reductionFactors[levels[level].quality] || 0;
        }
      }
    });

    stats.memoryReduction = stats.memoryReduction / Math.max(stats.totalMeshes, 1);
    return stats;
  }

  /**
   * Dispose of LOD system
   */
  public dispose(): void {
    this.stopAutoUpdate();
    
    // Dispose all generated LOD meshes
    this.lodGroups.forEach(levels => {
      levels.forEach((level, idx) => {
        if (idx > 0) { // Keep original mesh
          level.meshes.forEach(mesh => mesh.dispose());
        }
      });
    });

    this.lodGroups.clear();
    this.activeLODs.clear();
    this.onLODChanged.clear();
  }
}