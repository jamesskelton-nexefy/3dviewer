import * as BABYLON from '@babylonjs/core'
import { 
  ModelVersion, 
  VersionDiff, 
  ModelChange, 
  ChangeType,
  DiffStatistics,
  VersionComparisonResult 
} from './types'
import { ModelStorageService } from './ModelStorageService'

export class DiffingService {
  private modelStorage: ModelStorageService

  constructor() {
    this.modelStorage = new ModelStorageService()
  }

  /**
   * Create a diff between two versions
   */
  async createDiff(fromVersionId: string, toVersionId: string): Promise<VersionDiff> {
    try {
      // Load both versions
      const [fromScene, toScene] = await Promise.all([
        this.loadVersionScene(fromVersionId),
        this.loadVersionScene(toVersionId)
      ])

      // Compare scenes
      const changes: ModelChange[] = []
      
      // Compare geometry
      const geometryChanges = this.compareGeometry(fromScene, toScene)
      changes.push(...geometryChanges)

      // Compare materials
      const materialChanges = this.compareMaterials(fromScene, toScene)
      changes.push(...materialChanges)

      // Compare textures
      const textureChanges = this.compareTextures(fromScene, toScene)
      changes.push(...textureChanges)

      // Compare transforms
      const transformChanges = this.compareTransforms(fromScene, toScene)
      changes.push(...transformChanges)

      // Calculate statistics
      const statistics = this.calculateDiffStatistics(changes, fromScene, toScene)

      // Clean up
      fromScene.dispose()
      toScene.dispose()

      return {
        fromVersion: fromVersionId,
        toVersion: toVersionId,
        changes,
        statistics
      }
    } catch (error) {
      console.error('Error creating diff:', error)
      throw error
    }
  }

  /**
   * Compare two model versions
   */
  async compareVersions(
    version1: ModelVersion,
    version2: ModelVersion
  ): Promise<VersionComparisonResult> {
    try {
      // Quick check using metadata
      const metadataIdentical = this.compareMetadata(version1.metadata, version2.metadata)
      
      if (metadataIdentical && version1.fileSize === version2.fileSize) {
        return {
          areIdentical: true,
          similarity: 1.0,
          differences: []
        }
      }

      // Detailed comparison
      const diff = await this.createDiff(version1.id, version2.id)
      
      // Calculate similarity score
      const similarity = this.calculateSimilarity(diff)

      // Create visual diff
      const visualDiff = await this.createVisualDiff(version1.id, version2.id)

      return {
        areIdentical: diff.changes.length === 0,
        similarity,
        differences: diff.changes,
        visualDiff
      }
    } catch (error) {
      console.error('Error comparing versions:', error)
      throw error
    }
  }

  /**
   * Create a visual diff showing added/removed/modified elements
   */
  async createVisualDiff(
    fromVersionId: string,
    toVersionId: string
  ): Promise<{
    added: any[]
    removed: any[]
    modified: any[]
  }> {
    try {
      const [fromScene, toScene] = await Promise.all([
        this.loadVersionScene(fromVersionId),
        this.loadVersionScene(toVersionId)
      ])

      const fromMeshMap = this.createMeshMap(fromScene)
      const toMeshMap = this.createMeshMap(toScene)

      const added: any[] = []
      const removed: any[] = []
      const modified: any[] = []

      // Find removed meshes
      fromMeshMap.forEach((mesh, name) => {
        if (!toMeshMap.has(name)) {
          removed.push({
            name,
            type: 'mesh',
            vertices: mesh.getTotalVertices(),
            position: mesh.position.asArray()
          })
        }
      })

      // Find added and modified meshes
      toMeshMap.forEach((mesh, name) => {
        const fromMesh = fromMeshMap.get(name)
        if (!fromMesh) {
          added.push({
            name,
            type: 'mesh',
            vertices: mesh.getTotalVertices(),
            position: mesh.position.asArray()
          })
        } else if (this.isMeshModified(fromMesh, mesh)) {
          modified.push({
            name,
            type: 'mesh',
            changes: this.getMeshChanges(fromMesh, mesh)
          })
        }
      })

      // Clean up
      fromScene.dispose()
      toScene.dispose()

      return { added, removed, modified }
    } catch (error) {
      console.error('Error creating visual diff:', error)
      throw error
    }
  }

  // Private helper methods

  private async loadVersionScene(versionId: string): Promise<BABYLON.Scene> {
    const engine = new BABYLON.NullEngine()
    const scene = new BABYLON.Scene(engine)

    // This is a placeholder - in production, you would:
    // 1. Get the version data from the database
    // 2. Download the model file from storage
    // 3. Load it into the scene
    
    // For now, return empty scene
    return scene
  }

  private compareGeometry(
    fromScene: BABYLON.Scene,
    toScene: BABYLON.Scene
  ): ModelChange[] {
    const changes: ModelChange[] = []
    const fromMeshes = fromScene.meshes
    const toMeshes = toScene.meshes

    // Create maps for efficient lookup
    const fromMap = new Map(fromMeshes.map(m => [m.name, m]))
    const toMap = new Map(toMeshes.map(m => [m.name, m]))

    // Check for removed meshes
    fromMap.forEach((mesh, name) => {
      if (!toMap.has(name)) {
        changes.push({
          type: 'geometry_removed',
          path: `meshes/${name}`,
          oldValue: {
            vertices: mesh.getTotalVertices(),
            indices: mesh.getTotalIndices()
          },
          description: `Mesh '${name}' was removed`
        })
      }
    })

    // Check for added meshes
    toMap.forEach((mesh, name) => {
      if (!fromMap.has(name)) {
        changes.push({
          type: 'geometry_added',
          path: `meshes/${name}`,
          newValue: {
            vertices: mesh.getTotalVertices(),
            indices: mesh.getTotalIndices()
          },
          description: `Mesh '${name}' was added`
        })
      }
    })

    // Check for modified meshes
    fromMap.forEach((fromMesh, name) => {
      const toMesh = toMap.get(name)
      if (toMesh && this.isMeshModified(fromMesh, toMesh)) {
        changes.push({
          type: 'geometry_modified',
          path: `meshes/${name}`,
          oldValue: {
            vertices: fromMesh.getTotalVertices(),
            indices: fromMesh.getTotalIndices()
          },
          newValue: {
            vertices: toMesh.getTotalVertices(),
            indices: toMesh.getTotalIndices()
          },
          description: `Mesh '${name}' was modified`
        })
      }
    })

    return changes
  }

  private compareMaterials(
    fromScene: BABYLON.Scene,
    toScene: BABYLON.Scene
  ): ModelChange[] {
    const changes: ModelChange[] = []
    const fromMaterials = fromScene.materials
    const toMaterials = toScene.materials

    const fromMap = new Map(fromMaterials.map(m => [m.name, m]))
    const toMap = new Map(toMaterials.map(m => [m.name, m]))

    // Check for removed materials
    fromMap.forEach((material, name) => {
      if (!toMap.has(name)) {
        changes.push({
          type: 'material_removed',
          path: `materials/${name}`,
          oldValue: this.serializeMaterial(material),
          description: `Material '${name}' was removed`
        })
      }
    })

    // Check for added materials
    toMap.forEach((material, name) => {
      if (!fromMap.has(name)) {
        changes.push({
          type: 'material_added',
          path: `materials/${name}`,
          newValue: this.serializeMaterial(material),
          description: `Material '${name}' was added`
        })
      }
    })

    // Check for modified materials
    fromMap.forEach((fromMaterial, name) => {
      const toMaterial = toMap.get(name)
      if (toMaterial && this.isMaterialModified(fromMaterial, toMaterial)) {
        changes.push({
          type: 'material_modified',
          path: `materials/${name}`,
          oldValue: this.serializeMaterial(fromMaterial),
          newValue: this.serializeMaterial(toMaterial),
          description: `Material '${name}' was modified`
        })
      }
    })

    return changes
  }

  private compareTextures(
    fromScene: BABYLON.Scene,
    toScene: BABYLON.Scene
  ): ModelChange[] {
    const changes: ModelChange[] = []
    const fromTextures = fromScene.textures
    const toTextures = toScene.textures

    const fromMap = new Map(fromTextures.map(t => [t.name, t]))
    const toMap = new Map(toTextures.map(t => [t.name, t]))

    // Check for removed textures
    fromMap.forEach((texture, name) => {
      if (!toMap.has(name)) {
        changes.push({
          type: 'texture_removed',
          path: `textures/${name}`,
          oldValue: { name, url: texture.name },
          description: `Texture '${name}' was removed`
        })
      }
    })

    // Check for added textures
    toMap.forEach((texture, name) => {
      if (!fromMap.has(name)) {
        changes.push({
          type: 'texture_added',
          path: `textures/${name}`,
          newValue: { name, url: texture.name },
          description: `Texture '${name}' was added`
        })
      }
    })

    return changes
  }

  private compareTransforms(
    fromScene: BABYLON.Scene,
    toScene: BABYLON.Scene
  ): ModelChange[] {
    const changes: ModelChange[] = []
    const fromMeshes = fromScene.meshes
    const toMeshes = toScene.meshes

    const fromMap = new Map(fromMeshes.map(m => [m.name, m]))
    const toMap = new Map(toMeshes.map(m => [m.name, m]))

    fromMap.forEach((fromMesh, name) => {
      const toMesh = toMap.get(name)
      if (toMesh && this.isTransformModified(fromMesh, toMesh)) {
        changes.push({
          type: 'transform_changed',
          path: `meshes/${name}/transform`,
          oldValue: {
            position: fromMesh.position.asArray(),
            rotation: fromMesh.rotation.asArray(),
            scaling: fromMesh.scaling.asArray()
          },
          newValue: {
            position: toMesh.position.asArray(),
            rotation: toMesh.rotation.asArray(),
            scaling: toMesh.scaling.asArray()
          },
          description: `Transform of mesh '${name}' was changed`
        })
      }
    })

    return changes
  }

  private calculateDiffStatistics(
    changes: ModelChange[],
    fromScene: BABYLON.Scene,
    toScene: BABYLON.Scene
  ): DiffStatistics {
    const geometryChanges = changes.filter(c => 
      c.type.startsWith('geometry_')
    ).length

    const materialChanges = changes.filter(c => 
      c.type.startsWith('material_')
    ).length

    const textureChanges = changes.filter(c => 
      c.type.startsWith('texture_')
    ).length

    const fromTriangles = this.countSceneTriangles(fromScene)
    const toTriangles = this.countSceneTriangles(toScene)

    return {
      geometryChanges,
      materialChanges,
      textureChanges,
      totalChanges: changes.length,
      addedTriangles: Math.max(0, toTriangles - fromTriangles),
      removedTriangles: Math.max(0, fromTriangles - toTriangles),
      filesizeChange: 0 // Would be calculated from actual file sizes
    }
  }

  private calculateSimilarity(diff: VersionDiff): number {
    if (diff.changes.length === 0) return 1.0

    // Calculate similarity based on the number and severity of changes
    const weights = {
      geometry_added: 0.3,
      geometry_removed: 0.3,
      geometry_modified: 0.2,
      material_added: 0.1,
      material_removed: 0.1,
      material_modified: 0.05,
      texture_added: 0.05,
      texture_removed: 0.05,
      texture_modified: 0.02,
      metadata_changed: 0.01,
      transform_changed: 0.02
    }

    let totalWeight = 0
    diff.changes.forEach(change => {
      totalWeight += weights[change.type] || 0.01
    })

    return Math.max(0, 1 - totalWeight)
  }

  private compareMetadata(meta1: any, meta2: any): boolean {
    return (
      meta1.triangleCount === meta2.triangleCount &&
      meta1.vertexCount === meta2.vertexCount &&
      meta1.materialCount === meta2.materialCount &&
      meta1.textureCount === meta2.textureCount
    )
  }

  private createMeshMap(scene: BABYLON.Scene): Map<string, BABYLON.AbstractMesh> {
    return new Map(scene.meshes.map(m => [m.name, m]))
  }

  private isMeshModified(mesh1: BABYLON.AbstractMesh, mesh2: BABYLON.AbstractMesh): boolean {
    return (
      mesh1.getTotalVertices() !== mesh2.getTotalVertices() ||
      mesh1.getTotalIndices() !== mesh2.getTotalIndices()
    )
  }

  private isTransformModified(mesh1: BABYLON.AbstractMesh, mesh2: BABYLON.AbstractMesh): boolean {
    return (
      !mesh1.position.equals(mesh2.position) ||
      !mesh1.rotation.equals(mesh2.rotation) ||
      !mesh1.scaling.equals(mesh2.scaling)
    )
  }

  private isMaterialModified(mat1: BABYLON.Material, mat2: BABYLON.Material): boolean {
    // Simplified comparison - in production, you'd do deep comparison
    return JSON.stringify(mat1) !== JSON.stringify(mat2)
  }

  private getMeshChanges(mesh1: BABYLON.AbstractMesh, mesh2: BABYLON.AbstractMesh): any {
    return {
      vertices: {
        before: mesh1.getTotalVertices(),
        after: mesh2.getTotalVertices()
      },
      indices: {
        before: mesh1.getTotalIndices(),
        after: mesh2.getTotalIndices()
      },
      position: {
        before: mesh1.position.asArray(),
        after: mesh2.position.asArray()
      }
    }
  }

  private serializeMaterial(material: BABYLON.Material): any {
    // Simplified serialization - in production, use proper serialization
    return {
      name: material.name,
      type: material.getClassName()
    }
  }

  private countSceneTriangles(scene: BABYLON.Scene): number {
    return scene.meshes.reduce((count, mesh) => {
      if (mesh instanceof BABYLON.Mesh) {
        const indices = mesh.getIndices()
        if (indices) {
          return count + indices.length / 3
        }
      }
      return count
    }, 0)
  }
}