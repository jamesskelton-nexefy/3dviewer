import * as BABYLON from '@babylonjs/core';
import { Scene, Engine, Observable } from '@babylonjs/core';

export interface DeviceProfile {
  type: 'desktop' | 'mobile' | 'tablet';
  gpu: 'high-end' | 'mid-range' | 'low-end';
  memory: number; // MB
  cores: number;
  pixelRatio: number;
  isTouchDevice: boolean;
  powerMode?: 'battery' | 'charging';
}

export interface QualityProfile {
  name: string;
  renderScale: number;
  shadowQuality: 'high' | 'medium' | 'low' | 'off';
  textureResolution: number; // multiplier
  postProcessing: boolean;
  antialiasing: boolean;
  particleCount: number; // multiplier
  maxLights: number;
  reflectionProbes: boolean;
  targetFPS: number;
}

export interface AdaptiveConfig {
  enableAutoAdjust: boolean;
  fpsTarget: number;
  fpsThresholdLow: number;
  fpsThresholdHigh: number;
  adjustmentInterval: number;
  measurementDuration: number;
  batteryOptimization: boolean;
  thermalThrottling: boolean;
}

export class AdaptiveQualitySystem {
  private scene: Scene;
  private engine: Engine;
  private config: AdaptiveConfig;
  private deviceProfile: DeviceProfile;
  private currentProfile: QualityProfile;
  private qualityProfiles: Map<string, QualityProfile> = new Map();
  private fpsHistory: number[] = [];
  private adjustmentTimer: NodeJS.Timer | null = null;
  private batteryManager: any = null;
  private thermalObserver: any = null;
  
  public onQualityChanged = new Observable<{ profile: QualityProfile; reason: string }>();
  public onDeviceProfileDetected = new Observable<DeviceProfile>();

  constructor(scene: Scene, config?: Partial<AdaptiveConfig>) {
    this.scene = scene;
    this.engine = scene.getEngine();
    
    this.config = {
      enableAutoAdjust: config?.enableAutoAdjust ?? true,
      fpsTarget: config?.fpsTarget ?? 30,
      fpsThresholdLow: config?.fpsThresholdLow ?? 20,
      fpsThresholdHigh: config?.fpsThresholdHigh ?? 55,
      adjustmentInterval: config?.adjustmentInterval ?? 3000,
      measurementDuration: config?.measurementDuration ?? 1000,
      batteryOptimization: config?.batteryOptimization ?? true,
      thermalThrottling: config?.thermalThrottling ?? true,
      ...config
    };

    this.deviceProfile = this.detectDeviceProfile();
    this.initializeQualityProfiles();
    this.currentProfile = this.selectInitialProfile();
    this.applyQualityProfile(this.currentProfile);
    
    if (this.config.enableAutoAdjust) {
      this.startAutoAdjustment();
    }

    this.setupBatteryMonitoring();
    this.setupThermalMonitoring();
  }

  /**
   * Detect device capabilities
   */
  private detectDeviceProfile(): DeviceProfile {
    const profile: DeviceProfile = {
      type: this.detectDeviceType(),
      gpu: this.detectGPUTier(),
      memory: this.detectMemory(),
      cores: navigator.hardwareConcurrency || 4,
      pixelRatio: window.devicePixelRatio || 1,
      isTouchDevice: 'ontouchstart' in window
    };

    this.onDeviceProfileDetected.notifyObservers(profile);
    return profile;
  }

  /**
   * Detect device type
   */
  private detectDeviceType(): 'desktop' | 'mobile' | 'tablet' {
    const userAgent = navigator.userAgent.toLowerCase();
    const screenWidth = window.screen.width;
    const screenHeight = window.screen.height;
    const diagonal = Math.sqrt(screenWidth * screenWidth + screenHeight * screenHeight);

    if (/mobile|android|iphone|ipod/.test(userAgent) && diagonal < 800) {
      return 'mobile';
    } else if (/ipad|tablet|playbook|silk/.test(userAgent) || 
               (diagonal >= 800 && diagonal < 1200 && 'ontouchstart' in window)) {
      return 'tablet';
    }
    return 'desktop';
  }

  /**
   * Detect GPU performance tier
   */
  private detectGPUTier(): 'high-end' | 'mid-range' | 'low-end' {
    const gl = this.engine._gl;
    if (!gl) return 'mid-range';

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (!debugInfo) return 'mid-range';

    const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
    const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);

    // GPU performance detection based on known GPUs
    const highEndPatterns = /nvidia.*[39][0-9]{2}|radeon.*[67][0-9]{3}|apple.*m[12]|adreno.*[67][0-9]{2}/i;
    const lowEndPatterns = /intel.*hd|mali-[gt][0-9]{2}|adreno.*[23][0-9]{2}|powervr/i;

    if (highEndPatterns.test(renderer)) {
      return 'high-end';
    } else if (lowEndPatterns.test(renderer)) {
      return 'low-end';
    }

    // Check max texture size as additional metric
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (maxTextureSize >= 16384) {
      return 'high-end';
    } else if (maxTextureSize <= 4096) {
      return 'low-end';
    }

    return 'mid-range';
  }

  /**
   * Detect available memory
   */
  private detectMemory(): number {
    // Use Device Memory API if available
    if ('deviceMemory' in navigator) {
      return (navigator as any).deviceMemory * 1024; // Convert GB to MB
    }

    // Fallback estimation based on device type
    switch (this.deviceProfile?.type) {
      case 'mobile':
        return 2048;
      case 'tablet':
        return 4096;
      default:
        return 8192;
    }
  }

  /**
   * Initialize quality profiles
   */
  private initializeQualityProfiles(): void {
    // Ultra quality for high-end desktop
    this.qualityProfiles.set('ultra', {
      name: 'ultra',
      renderScale: 1.0,
      shadowQuality: 'high',
      textureResolution: 1.0,
      postProcessing: true,
      antialiasing: true,
      particleCount: 1.0,
      maxLights: 8,
      reflectionProbes: true,
      targetFPS: 60
    });

    // High quality for good desktop/high-end mobile
    this.qualityProfiles.set('high', {
      name: 'high',
      renderScale: 1.0,
      shadowQuality: 'medium',
      textureResolution: 1.0,
      postProcessing: true,
      antialiasing: true,
      particleCount: 0.8,
      maxLights: 6,
      reflectionProbes: true,
      targetFPS: 60
    });

    // Medium quality for average devices
    this.qualityProfiles.set('medium', {
      name: 'medium',
      renderScale: 0.9,
      shadowQuality: 'low',
      textureResolution: 0.75,
      postProcessing: false,
      antialiasing: false,
      particleCount: 0.5,
      maxLights: 4,
      reflectionProbes: false,
      targetFPS: 30
    });

    // Low quality for mobile/low-end devices
    this.qualityProfiles.set('low', {
      name: 'low',
      renderScale: 0.75,
      shadowQuality: 'off',
      textureResolution: 0.5,
      postProcessing: false,
      antialiasing: false,
      particleCount: 0.25,
      maxLights: 2,
      reflectionProbes: false,
      targetFPS: 30
    });

    // Ultra low for very weak devices
    this.qualityProfiles.set('ultra-low', {
      name: 'ultra-low',
      renderScale: 0.5,
      shadowQuality: 'off',
      textureResolution: 0.25,
      postProcessing: false,
      antialiasing: false,
      particleCount: 0.1,
      maxLights: 1,
      reflectionProbes: false,
      targetFPS: 24
    });
  }

  /**
   * Select initial quality profile based on device
   */
  private selectInitialProfile(): QualityProfile {
    const { type, gpu, memory } = this.deviceProfile;

    if (type === 'mobile') {
      if (gpu === 'high-end' && memory >= 4096) {
        return this.qualityProfiles.get('medium')!;
      } else if (gpu === 'low-end' || memory < 2048) {
        return this.qualityProfiles.get('ultra-low')!;
      }
      return this.qualityProfiles.get('low')!;
    } else if (type === 'tablet') {
      if (gpu === 'high-end') {
        return this.qualityProfiles.get('high')!;
      }
      return this.qualityProfiles.get('medium')!;
    } else { // desktop
      if (gpu === 'high-end' && memory >= 8192) {
        return this.qualityProfiles.get('ultra')!;
      } else if (gpu === 'low-end') {
        return this.qualityProfiles.get('medium')!;
      }
      return this.qualityProfiles.get('high')!;
    }
  }

  /**
   * Apply quality profile to scene
   */
  private applyQualityProfile(profile: QualityProfile): void {
    // Update render scale
    const currentHardwareScale = this.engine.getHardwareScalingLevel();
    const newHardwareScale = 1 / profile.renderScale;
    if (Math.abs(currentHardwareScale - newHardwareScale) > 0.01) {
      this.engine.setHardwareScalingLevel(newHardwareScale);
    }

    // Update shadows
    this.updateShadowQuality(profile.shadowQuality);

    // Update texture resolution
    this.updateTextureResolution(profile.textureResolution);

    // Update post-processing
    this.updatePostProcessing(profile.postProcessing);

    // Update antialiasing
    if (profile.antialiasing !== this.scene.postProcessRenderPipelineManager.supportedPipelines) {
      // Note: Actual AA implementation depends on your post-process setup
    }

    // Update particle systems
    this.updateParticleSystems(profile.particleCount);

    // Update lighting
    this.updateLighting(profile.maxLights);

    // Update reflection probes
    this.updateReflectionProbes(profile.reflectionProbes);

    // Update engine options for mobile
    if (this.deviceProfile.type === 'mobile') {
      this.engine.doNotHandleContextLost = true;
      this.engine.enableOfflineSupport = false;
      this.engine.disableUniformBuffers = true;
    }

    this.currentProfile = profile;
  }

  /**
   * Update shadow quality
   */
  private updateShadowQuality(quality: 'high' | 'medium' | 'low' | 'off'): void {
    const shadowGenerators = this.scene.lights
      .filter(light => light.getShadowGenerator())
      .map(light => light.getShadowGenerator()!);

    shadowGenerators.forEach(generator => {
      switch (quality) {
        case 'high':
          generator.mapSize = 2048;
          generator.useBlurExponentialShadowMap = true;
          generator.blurScale = 2;
          generator.setDarkness(0.5);
          break;
        case 'medium':
          generator.mapSize = 1024;
          generator.useBlurExponentialShadowMap = true;
          generator.blurScale = 1;
          generator.setDarkness(0.6);
          break;
        case 'low':
          generator.mapSize = 512;
          generator.useBlurExponentialShadowMap = false;
          generator.setDarkness(0.7);
          break;
        case 'off':
          generator.dispose();
          break;
      }
    });
  }

  /**
   * Update texture resolution multiplier
   */
  private updateTextureResolution(multiplier: number): void {
    this.scene.textures.forEach(texture => {
      if (texture instanceof BABYLON.Texture && !texture.name.includes('pool')) {
        // Store original size if not already stored
        if (!texture.metadata?.originalSize) {
          const size = texture.getSize();
          texture.metadata = { 
            ...texture.metadata, 
            originalSize: { width: size.width, height: size.height }
          };
        }

        // Note: Actual texture resizing would require reloading
        // This is a placeholder for the concept
        texture.updateSamplingMode(
          multiplier < 1 ? BABYLON.Texture.BILINEAR_SAMPLINGMODE : 
                          BABYLON.Texture.TRILINEAR_SAMPLINGMODE
        );
      }
    });
  }

  /**
   * Update post-processing effects
   */
  private updatePostProcessing(enabled: boolean): void {
    // Disable/enable post-process pipelines
    if (this.scene.postProcessRenderPipelineManager) {
      const pipelines = this.scene.postProcessRenderPipelineManager.supportedPipelines;
      pipelines.forEach(pipeline => {
        if (pipeline && 'setEnabled' in pipeline) {
          (pipeline as any).setEnabled(enabled);
        }
      });
    }

    // Disable expensive effects on mobile
    if (!enabled || this.deviceProfile.type === 'mobile') {
      this.scene.fogEnabled = false;
      this.scene.lensFlaresEnabled = false;
      this.scene.particlesEnabled = this.currentProfile.particleCount > 0;
    }
  }

  /**
   * Update particle system density
   */
  private updateParticleSystems(multiplier: number): void {
    this.scene.particleSystems.forEach(system => {
      if (!system.metadata?.originalEmitRate) {
        system.metadata = { 
          ...system.metadata, 
          originalEmitRate: system.emitRate 
        };
      }
      
      system.emitRate = Math.floor(
        (system.metadata.originalEmitRate || system.emitRate) * multiplier
      );
    });
  }

  /**
   * Update lighting constraints
   */
  private updateLighting(maxLights: number): void {
    const lights = this.scene.lights;
    
    // Sort lights by importance (intensity * range)
    const sortedLights = lights.slice().sort((a, b) => {
      const importanceA = a.intensity * (a.range || 1000);
      const importanceB = b.intensity * (b.range || 1000);
      return importanceB - importanceA;
    });

    // Enable only the most important lights
    sortedLights.forEach((light, index) => {
      light.setEnabled(index < maxLights);
    });
  }

  /**
   * Update reflection probes
   */
  private updateReflectionProbes(enabled: boolean): void {
    this.scene.reflectionProbes?.forEach(probe => {
      probe.setEnabled(enabled);
      
      if (enabled && this.deviceProfile.type === 'mobile') {
        // Reduce reflection probe quality on mobile
        probe.cubeTexture.lodGenerationScale = 0.5;
      }
    });
  }

  /**
   * Start automatic quality adjustment
   */
  private startAutoAdjustment(): void {
    if (this.adjustmentTimer) return;

    let frameCount = 0;
    let frameTimeSum = 0;
    let lastTime = performance.now();

    // Monitor FPS
    this.scene.registerBeforeRender(() => {
      const currentTime = performance.now();
      const deltaTime = currentTime - lastTime;
      lastTime = currentTime;

      frameTimeSum += deltaTime;
      frameCount++;

      if (frameTimeSum >= this.config.measurementDuration) {
        const avgFPS = (frameCount * 1000) / frameTimeSum;
        this.fpsHistory.push(avgFPS);
        
        if (this.fpsHistory.length > 10) {
          this.fpsHistory.shift();
        }

        frameCount = 0;
        frameTimeSum = 0;
      }
    });

    // Periodic quality adjustment
    this.adjustmentTimer = setInterval(() => {
      this.adjustQuality();
    }, this.config.adjustmentInterval);
  }

  /**
   * Adjust quality based on performance
   */
  private adjustQuality(): void {
    if (this.fpsHistory.length < 3) return;

    const avgFPS = this.fpsHistory.reduce((a, b) => a + b) / this.fpsHistory.length;
    const profileNames = Array.from(this.qualityProfiles.keys());
    const currentIndex = profileNames.indexOf(this.currentProfile.name);

    let reason = '';
    let newProfile: QualityProfile | null = null;

    // Check if we need to decrease quality
    if (avgFPS < this.config.fpsThresholdLow) {
      if (currentIndex < profileNames.length - 1) {
        newProfile = this.qualityProfiles.get(profileNames[currentIndex + 1])!;
        reason = `Low FPS: ${avgFPS.toFixed(1)}`;
      }
    }
    // Check if we can increase quality
    else if (avgFPS > this.config.fpsThresholdHigh && 
             avgFPS > this.currentProfile.targetFPS * 0.9) {
      if (currentIndex > 0) {
        const higherProfile = this.qualityProfiles.get(profileNames[currentIndex - 1])!;
        // Only upgrade if we're confident we can maintain target FPS
        if (avgFPS > higherProfile.targetFPS * 1.2) {
          newProfile = higherProfile;
          reason = `High FPS headroom: ${avgFPS.toFixed(1)}`;
        }
      }
    }

    // Check battery status
    if (this.deviceProfile.powerMode === 'battery' && 
        this.config.batteryOptimization &&
        currentIndex > 1) {
      const batteryProfile = this.qualityProfiles.get(profileNames[Math.max(currentIndex, 2)])!;
      if (batteryProfile !== this.currentProfile) {
        newProfile = batteryProfile;
        reason = 'Battery optimization';
      }
    }

    if (newProfile && newProfile !== this.currentProfile) {
      this.applyQualityProfile(newProfile);
      this.onQualityChanged.notifyObservers({ profile: newProfile, reason });
      console.log(`Quality adjusted to ${newProfile.name}: ${reason}`);
    }
  }

  /**
   * Setup battery monitoring
   */
  private async setupBatteryMonitoring(): Promise<void> {
    if (!this.config.batteryOptimization) return;

    try {
      if ('getBattery' in navigator) {
        this.batteryManager = await (navigator as any).getBattery();
        
        const updatePowerMode = () => {
          this.deviceProfile.powerMode = this.batteryManager.charging ? 'charging' : 'battery';
        };

        updatePowerMode();
        this.batteryManager.addEventListener('chargingchange', updatePowerMode);
        this.batteryManager.addEventListener('levelchange', () => {
          if (this.batteryManager.level < 0.2 && !this.batteryManager.charging) {
            // Force low quality on low battery
            this.setQualityProfile('low');
          }
        });
      }
    } catch (error) {
      console.log('Battery API not available');
    }
  }

  /**
   * Setup thermal throttling monitoring
   */
  private setupThermalMonitoring(): void {
    if (!this.config.thermalThrottling) return;

    // Monitor for thermal events (if available)
    if ('thermal' in navigator) {
      try {
        this.thermalObserver = new (window as any).ThermalObserver((entries: any[]) => {
          entries.forEach(entry => {
            if (entry.state === 'critical' || entry.state === 'serious') {
              // Reduce quality on thermal throttling
              const currentIndex = Array.from(this.qualityProfiles.keys())
                .indexOf(this.currentProfile.name);
              if (currentIndex < this.qualityProfiles.size - 1) {
                this.adjustQuality();
              }
            }
          });
        });
        
        this.thermalObserver.observe();
      } catch (error) {
        console.log('Thermal API not available');
      }
    }
  }

  /**
   * Manually set quality profile
   */
  public setQualityProfile(profileName: string): void {
    const profile = this.qualityProfiles.get(profileName);
    if (profile) {
      this.applyQualityProfile(profile);
      this.onQualityChanged.notifyObservers({ 
        profile, 
        reason: 'Manual adjustment' 
      });
    }
  }

  /**
   * Get current quality profile
   */
  public getCurrentProfile(): QualityProfile {
    return { ...this.currentProfile };
  }

  /**
   * Get device profile
   */
  public getDeviceProfile(): DeviceProfile {
    return { ...this.deviceProfile };
  }

  /**
   * Get performance metrics
   */
  public getPerformanceMetrics(): {
    currentFPS: number;
    averageFPS: number;
    minFPS: number;
    maxFPS: number;
  } {
    const currentFPS = this.engine.getFps();
    const averageFPS = this.fpsHistory.length > 0 
      ? this.fpsHistory.reduce((a, b) => a + b) / this.fpsHistory.length 
      : currentFPS;
    const minFPS = Math.min(...this.fpsHistory, currentFPS);
    const maxFPS = Math.max(...this.fpsHistory, currentFPS);

    return { currentFPS, averageFPS, minFPS, maxFPS };
  }

  /**
   * Enable/disable auto adjustment
   */
  public setAutoAdjust(enabled: boolean): void {
    this.config.enableAutoAdjust = enabled;
    
    if (enabled && !this.adjustmentTimer) {
      this.startAutoAdjustment();
    } else if (!enabled && this.adjustmentTimer) {
      clearInterval(this.adjustmentTimer);
      this.adjustmentTimer = null;
    }
  }

  /**
   * Dispose adaptive quality system
   */
  public dispose(): void {
    if (this.adjustmentTimer) {
      clearInterval(this.adjustmentTimer);
    }

    if (this.thermalObserver) {
      this.thermalObserver.disconnect();
    }

    this.onQualityChanged.clear();
    this.onDeviceProfileDetected.clear();
  }
}