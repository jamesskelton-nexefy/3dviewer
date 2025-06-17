import React, { useEffect, useRef, useState } from 'react';
import * as BABYLON from '@babylonjs/core';
import { OptimizationManager, OptimizationConfig } from './index';

/**
 * Example component demonstrating how to use the optimization services
 */
export const OptimizationExample: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [optimizationManager, setOptimizationManager] = useState<OptimizationManager | null>(null);
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Initialize Babylon.js scene
    const engine = new BABYLON.Engine(canvasRef.current, true);
    const scene = new BABYLON.Scene(engine);

    // Create camera
    const camera = new BABYLON.UniversalCamera(
      'camera',
      new BABYLON.Vector3(0, 5, -10),
      scene
    );
    camera.setTarget(BABYLON.Vector3.Zero());
    camera.attachControl(canvasRef.current, true);

    // Create light
    const light = new BABYLON.HemisphericLight(
      'light',
      new BABYLON.Vector3(0, 1, 0),
      scene
    );

    // Initialize optimization manager with configuration
    const optimizationConfig: OptimizationConfig = {
      lod: {
        distanceThresholds: {
          high: 0,
          medium: 30,
          low: 60,
          ultraLow: 100
        },
        autoGenerate: true
      },
      culling: {
        enableFrustumCulling: true,
        enableOcclusionCulling: true,
        updateInterval: 50
      },
      progressive: {
        enablePlaceholders: true,
        loadTexturesAsync: true,
        textureQualitySteps: [0.25, 0.5, 1.0]
      },
      compression: {
        format: 'AUTO',
        quality: 0.85,
        generateMipmaps: true,
        useWebP: true,
        useBasis: true
      },
      memory: {
        maxMemoryMB: 512,
        enableBufferPooling: true,
        enableTexturePooling: true,
        enableAutomaticCleanup: true,
        cleanupThresholdPercentage: 0.8
      },
      adaptive: {
        enableAutoAdjust: true,
        fpsTarget: 60,
        batteryOptimization: true
      }
    };

    const manager = new OptimizationManager(scene, optimizationConfig);
    setOptimizationManager(manager);

    // Example 1: Load and optimize a complex model
    const loadComplexModel = async () => {
      try {
        // Progressive loading with placeholder
        const meshes = await manager.progressiveLoader.loadModel(
          '/models/complex-scene.gltf',
          new BABYLON.Vector3(0, 0, 0),
          1 // High priority
        );

        // Optimize each mesh
        if (Array.isArray(meshes)) {
          for (const mesh of meshes) {
            await manager.optimizeMesh(mesh, {
              simplify: true,
              simplificationTarget: 0.7,
              generateLODs: true,
              compressTextures: true
            });
          }
        }
      } catch (error) {
        console.error('Failed to load model:', error);
      }
    };

    // Example 2: Create a scene with many objects for culling demo
    const createDemoScene = () => {
      // Create many spheres to demonstrate culling
      for (let x = -50; x <= 50; x += 5) {
        for (let z = -50; z <= 50; z += 5) {
          const sphere = BABYLON.MeshBuilder.CreateSphere(
            `sphere_${x}_${z}`,
            { diameter: 2 },
            scene
          );
          sphere.position = new BABYLON.Vector3(x, 1, z);
          
          // Register for culling
          manager.culling.registerMesh(sphere);
          
          // Create LODs for each sphere
          manager.lod.registerMesh(sphere.uniqueId.toString(), sphere);
        }
      }
    };

    // Example 3: Demonstrate texture compression
    const demonstrateTextureCompression = async () => {
      // Load and compress various texture formats
      const textureUrls = [
        '/textures/diffuse.jpg',
        '/textures/normal.png',
        '/textures/specular.png'
      ];

      for (const url of textureUrls) {
        const compressedTexture = await manager.textureCompression.loadCompressedTexture(url);
        console.log(`Compressed texture: ${url}`, manager.textureCompression.getMetrics().get(url));
      }
    };

    // Example 4: Mesh simplification
    const demonstrateMeshSimplification = async () => {
      // Create a high-poly mesh
      const highPolyMesh = BABYLON.MeshBuilder.CreateTorusKnot(
        'highPoly',
        { radius: 2, tube: 0.5, radialSegments: 128, tubularSegments: 64 },
        scene
      );
      highPolyMesh.position.x = -5;

      // Simplify to different levels
      const { mesh: mediumPoly, result: mediumResult } = 
        await manager.meshSimplification.simplifyMesh(highPolyMesh, {
          targetPercentage: 0.5,
          preserveBoundary: true,
          quality: 0.8
        });
      mediumPoly.position.x = 0;

      const { mesh: lowPoly, result: lowResult } = 
        await manager.meshSimplification.simplifyMesh(highPolyMesh, {
          targetPercentage: 0.1,
          preserveBoundary: true,
          quality: 0.5
        });
      lowPoly.position.x = 5;

      console.log('Simplification results:', {
        medium: mediumResult,
        low: lowResult
      });
    };

    // Example 5: Memory management with pooling
    const demonstrateMemoryPooling = () => {
      // Get pooled buffers for vertex data
      const positionBuffer = manager.memoryManager.getPooledBuffer(
        3 * 4 * 1000, // 1000 vertices * 3 components * 4 bytes
        'position'
      );

      const normalBuffer = manager.memoryManager.getPooledBuffer(
        3 * 4 * 1000,
        'normal'
      );

      // Use buffers...
      
      // Return to pool when done
      manager.memoryManager.returnPooledBuffer(positionBuffer, 'position');
      manager.memoryManager.returnPooledBuffer(normalBuffer, 'normal');

      // Get pooled render target
      const renderTarget = manager.memoryManager.getPooledRenderTarget(
        'shadowMap',
        { width: 1024, height: 1024 }
      );
    };

    // Example 6: Monitor and adjust quality based on device
    const monitorPerformance = () => {
      // Listen to quality changes
      manager.adaptiveQuality.onQualityChanged.add(({ profile, reason }) => {
        console.log(`Quality changed to ${profile.name}: ${reason}`);
      });

      // Get device profile
      const deviceProfile = manager.adaptiveQuality.getDeviceProfile();
      console.log('Device profile:', deviceProfile);

      // Manually set quality if needed
      if (deviceProfile.type === 'mobile' && deviceProfile.gpu === 'low-end') {
        manager.adaptiveQuality.setQualityProfile('low');
      }
    };

    // Initialize examples
    createDemoScene();
    monitorPerformance();
    
    // Load examples based on device capabilities
    const deviceProfile = manager.adaptiveQuality.getDeviceProfile();
    if (deviceProfile.gpu !== 'low-end') {
      loadComplexModel();
      demonstrateTextureCompression();
      demonstrateMeshSimplification();
    }
    
    demonstrateMemoryPooling();

    // Update statistics periodically
    const updateStats = setInterval(() => {
      setStats(manager.getStatistics());
    }, 1000);

    // Render loop
    engine.runRenderLoop(() => {
      scene.render();
    });

    // Handle window resize
    window.addEventListener('resize', () => {
      engine.resize();
    });

    // Cleanup
    return () => {
      clearInterval(updateStats);
      manager.dispose();
      scene.dispose();
      engine.dispose();
    };
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas 
        ref={canvasRef} 
        style={{ width: '100%', height: '100%' }}
      />
      
      {/* Performance Statistics Overlay */}
      {stats && (
        <div style={{
          position: 'absolute',
          top: 10,
          left: 10,
          background: 'rgba(0,0,0,0.8)',
          color: 'white',
          padding: '10px',
          fontFamily: 'monospace',
          fontSize: '12px',
          borderRadius: '5px'
        }}>
          <h3>Optimization Statistics</h3>
          
          <div>
            <strong>LOD System:</strong>
            <div>Total Meshes: {stats.lod.totalMeshes}</div>
            <div>Memory Reduction: {(stats.lod.memoryReduction * 100).toFixed(1)}%</div>
          </div>
          
          <div style={{ marginTop: '10px' }}>
            <strong>Culling:</strong>
            <div>Visible: {stats.culling.visibleMeshes}/{stats.culling.totalMeshes}</div>
            <div>Frustum Culled: {stats.culling.frustumCulled}</div>
            <div>Occlusion Culled: {stats.culling.occlusionCulled}</div>
          </div>
          
          <div style={{ marginTop: '10px' }}>
            <strong>Memory:</strong>
            <div>Used: {stats.memory.usedMemoryMB.toFixed(1)}MB / {stats.memory.totalMemoryMB}MB</div>
            <div>Textures: {stats.memory.textureMemoryMB.toFixed(1)}MB</div>
            <div>Pooled Buffers: {stats.memory.pooledBuffers}</div>
          </div>
          
          <div style={{ marginTop: '10px' }}>
            <strong>Performance:</strong>
            <div>Current FPS: {stats.quality.currentFPS.toFixed(1)}</div>
            <div>Average FPS: {stats.quality.averageFPS.toFixed(1)}</div>
            <div>Quality: {optimizationManager?.adaptiveQuality.getCurrentProfile().name}</div>
          </div>
        </div>
      )}
      
      {/* Controls */}
      <div style={{
        position: 'absolute',
        top: 10,
        right: 10,
        background: 'rgba(0,0,0,0.8)',
        color: 'white',
        padding: '10px',
        borderRadius: '5px'
      }}>
        <h3>Quality Controls</h3>
        <div>
          <button onClick={() => optimizationManager?.adaptiveQuality.setQualityProfile('ultra')}>
            Ultra
          </button>
          <button onClick={() => optimizationManager?.adaptiveQuality.setQualityProfile('high')}>
            High
          </button>
          <button onClick={() => optimizationManager?.adaptiveQuality.setQualityProfile('medium')}>
            Medium
          </button>
          <button onClick={() => optimizationManager?.adaptiveQuality.setQualityProfile('low')}>
            Low
          </button>
        </div>
        <div style={{ marginTop: '10px' }}>
          <button onClick={() => optimizationManager?.memoryManager.performCleanup()}>
            Force Memory Cleanup
          </button>
        </div>
      </div>
    </div>
  );
};