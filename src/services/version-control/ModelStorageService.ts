import { supabase } from '../supabase/supabaseClient'
import { VersionMetadata, BoundingBox } from './types'
import * as BABYLON from '@babylonjs/core'
import { GLTFLoaderService } from '../GLTFLoaderService'

export class ModelStorageService {
  private bucketName = 'model-versions'
  private gltfLoader: GLTFLoaderService

  constructor() {
    this.gltfLoader = new GLTFLoaderService()
  }

  /**
   * Upload a model version to Supabase Storage
   */
  async uploadVersion(params: {
    modelId: string
    versionId: string
    file: File | Blob
    compress?: boolean
  }): Promise<string> {
    try {
      const { modelId, versionId, file, compress = true } = params
      
      // Prepare file for upload
      let uploadFile = file
      if (compress && file.type !== 'model/gltf-binary') {
        uploadFile = await this.compressModel(file)
      }

      // Generate storage path
      const storagePath = `${modelId}/${versionId}/${file.name || 'model.glb'}`

      // Upload to Supabase Storage
      const { data, error } = await supabase.storage
        .from(this.bucketName)
        .upload(storagePath, uploadFile, {
          cacheControl: '3600',
          upsert: false
        })

      if (error) throw error

      return data.path
    } catch (error) {
      console.error('Error uploading model version:', error)
      throw error
    }
  }

  /**
   * Download a model version from storage
   */
  async downloadVersion(modelId: string, versionId: string): Promise<Blob> {
    try {
      // Get the file path from database
      const { data: versionData } = await supabase
        .from('model_versions')
        .select('storage_path')
        .eq('modelId', modelId)
        .eq('id', versionId)
        .single()

      if (!versionData?.storage_path) {
        throw new Error('Version storage path not found')
      }

      // Download from Supabase Storage
      const { data, error } = await supabase.storage
        .from(this.bucketName)
        .download(versionData.storage_path)

      if (error) throw error

      return data
    } catch (error) {
      console.error('Error downloading model version:', error)
      throw error
    }
  }

  /**
   * Extract metadata from a 3D model file
   */
  async extractMetadata(file: File | Blob): Promise<VersionMetadata> {
    try {
      // Create a temporary scene for analysis
      const engine = new BABYLON.NullEngine()
      const scene = new BABYLON.Scene(engine)

      // Convert file to data URL for loading
      const dataUrl = await this.fileToDataUrl(file)
      
      // Load the model
      const result = await BABYLON.SceneLoader.LoadAssetContainerAsync(
        '',
        dataUrl,
        scene,
        null,
        '.glb'
      )

      // Extract metadata
      const metadata: VersionMetadata = {
        triangleCount: this.countTriangles(result.meshes),
        vertexCount: this.countVertices(result.meshes),
        materialCount: result.materials.length,
        textureCount: result.textures.length,
        boundingBox: this.calculateBoundingBox(result.meshes),
        format: file.type || 'model/gltf-binary',
        compressionType: this.detectCompression(file),
        dependencies: []
      }

      // Clean up
      scene.dispose()
      engine.dispose()

      return metadata
    } catch (error) {
      console.error('Error extracting metadata:', error)
      // Return basic metadata if extraction fails
      return {
        triangleCount: 0,
        vertexCount: 0,
        materialCount: 0,
        textureCount: 0,
        boundingBox: {
          min: { x: 0, y: 0, z: 0 },
          max: { x: 0, y: 0, z: 0 }
        },
        format: file.type || 'unknown',
        dependencies: []
      }
    }
  }

  /**
   * Compress a 3D model using Draco compression
   */
  async compressModel(file: File | Blob): Promise<Blob> {
    try {
      // For now, return the original file
      // In production, you would use draco3d library or a compression service
      console.log('Model compression not yet implemented, returning original file')
      return file
    } catch (error) {
      console.error('Error compressing model:', error)
      return file
    }
  }

  /**
   * Create a preview/thumbnail of the model
   */
  async createPreview(file: File | Blob): Promise<Blob> {
    try {
      // Create a temporary scene for rendering
      const canvas = document.createElement('canvas')
      canvas.width = 512
      canvas.height = 512
      
      const engine = new BABYLON.Engine(canvas, true)
      const scene = new BABYLON.Scene(engine)

      // Setup camera and lighting
      const camera = new BABYLON.ArcRotateCamera(
        'camera',
        Math.PI / 4,
        Math.PI / 3,
        10,
        BABYLON.Vector3.Zero(),
        scene
      )

      const light = new BABYLON.HemisphericLight(
        'light',
        new BABYLON.Vector3(0, 1, 0),
        scene
      )

      // Load the model
      const dataUrl = await this.fileToDataUrl(file)
      await BABYLON.SceneLoader.AppendAsync('', dataUrl, scene, null, '.glb')

      // Fit camera to meshes
      const meshes = scene.meshes.filter(m => m.getTotalVertices() > 0)
      if (meshes.length > 0) {
        camera.setTarget(this.calculateCenter(meshes))
        const radius = this.calculateRadius(meshes)
        camera.radius = radius * 2
      }

      // Render and capture
      scene.render()
      
      return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob)
          } else {
            reject(new Error('Failed to create preview'))
          }
          
          // Clean up
          scene.dispose()
          engine.dispose()
        }, 'image/png')
      })
    } catch (error) {
      console.error('Error creating preview:', error)
      throw error
    }
  }

  /**
   * Get storage statistics for a model
   */
  async getStorageStats(modelId: string): Promise<{
    totalSize: number
    versionCount: number
    oldestVersion: Date
    newestVersion: Date
  }> {
    try {
      const { data, error } = await supabase
        .from('model_versions')
        .select('fileSize, createdAt')
        .eq('modelId', modelId)
        .order('createdAt')

      if (error) throw error

      if (!data || data.length === 0) {
        return {
          totalSize: 0,
          versionCount: 0,
          oldestVersion: new Date(),
          newestVersion: new Date()
        }
      }

      const totalSize = data.reduce((sum, v) => sum + (v.fileSize || 0), 0)
      
      return {
        totalSize,
        versionCount: data.length,
        oldestVersion: new Date(data[0].createdAt),
        newestVersion: new Date(data[data.length - 1].createdAt)
      }
    } catch (error) {
      console.error('Error getting storage stats:', error)
      throw error
    }
  }

  /**
   * Clean up old versions based on retention policy
   */
  async cleanupOldVersions(modelId: string, retentionDays: number): Promise<number> {
    try {
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays)

      // Get versions to delete
      const { data: versionsToDelete, error } = await supabase
        .from('model_versions')
        .select('id, storage_path')
        .eq('modelId', modelId)
        .lt('createdAt', cutoffDate.toISOString())
        .eq('status', 'archived')

      if (error) throw error

      if (!versionsToDelete || versionsToDelete.length === 0) {
        return 0
      }

      // Delete from storage
      const deletePaths = versionsToDelete
        .map(v => v.storage_path)
        .filter(Boolean)

      if (deletePaths.length > 0) {
        const { error: storageError } = await supabase.storage
          .from(this.bucketName)
          .remove(deletePaths)

        if (storageError) {
          console.error('Error deleting from storage:', storageError)
        }
      }

      // Delete from database
      const { error: dbError } = await supabase
        .from('model_versions')
        .delete()
        .in('id', versionsToDelete.map(v => v.id))

      if (dbError) throw dbError

      return versionsToDelete.length
    } catch (error) {
      console.error('Error cleaning up old versions:', error)
      throw error
    }
  }

  // Private helper methods

  private async fileToDataUrl(file: File | Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  private countTriangles(meshes: BABYLON.AbstractMesh[]): number {
    return meshes.reduce((count, mesh) => {
      if (mesh instanceof BABYLON.Mesh) {
        const indices = mesh.getIndices()
        if (indices) {
          return count + indices.length / 3
        }
      }
      return count
    }, 0)
  }

  private countVertices(meshes: BABYLON.AbstractMesh[]): number {
    return meshes.reduce((count, mesh) => {
      return count + mesh.getTotalVertices()
    }, 0)
  }

  private calculateBoundingBox(meshes: BABYLON.AbstractMesh[]): BoundingBox {
    let min = new BABYLON.Vector3(Infinity, Infinity, Infinity)
    let max = new BABYLON.Vector3(-Infinity, -Infinity, -Infinity)

    meshes.forEach(mesh => {
      mesh.computeWorldMatrix(true)
      const boundingInfo = mesh.getBoundingInfo()
      const worldMin = boundingInfo.boundingBox.minimumWorld
      const worldMax = boundingInfo.boundingBox.maximumWorld

      min = BABYLON.Vector3.Minimize(min, worldMin)
      max = BABYLON.Vector3.Maximize(max, worldMax)
    })

    return {
      min: { x: min.x, y: min.y, z: min.z },
      max: { x: max.x, y: max.y, z: max.z }
    }
  }

  private calculateCenter(meshes: BABYLON.AbstractMesh[]): BABYLON.Vector3 {
    const bounds = this.calculateBoundingBox(meshes)
    return new BABYLON.Vector3(
      (bounds.min.x + bounds.max.x) / 2,
      (bounds.min.y + bounds.max.y) / 2,
      (bounds.min.z + bounds.max.z) / 2
    )
  }

  private calculateRadius(meshes: BABYLON.AbstractMesh[]): number {
    const bounds = this.calculateBoundingBox(meshes)
    const diagonal = new BABYLON.Vector3(
      bounds.max.x - bounds.min.x,
      bounds.max.y - bounds.min.y,
      bounds.max.z - bounds.min.z
    )
    return diagonal.length() / 2
  }

  private detectCompression(file: File | Blob): string | undefined {
    // Check file headers or extension for compression type
    if (file.type === 'model/gltf-binary') {
      return 'glb'
    }
    // Add more compression detection logic as needed
    return undefined
  }
}