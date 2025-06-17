/**
 * Advanced Animation System Service for glTF Models
 * Supports animation blending, morphing, skeletal animation, and performance optimization
 */

import {
  Scene,
  Engine,
  AnimationGroup,
  Animation,
  Animatable,
  AbstractMesh,
  Mesh,
  Skeleton,
  Bone,
  MorphTargetManager,
  MorphTarget,
  Vector3,
  Quaternion,
  Matrix,
  TransformNode,
  Observable,
  Tools,
  IAnimationKey,
  AnimationEvent,
  RuntimeAnimation,
} from '@babylonjs/core';

import {
  GLTFLoadingOptions,
  GLTFLoadingError,
  GLTFErrorCode,
  LoadingStage,
} from '@/types/gltf';

export interface AnimationConfig {
  autoStart?: boolean;
  loop?: boolean;
  speed?: number;
  blendMode?: AnimationBlendMode;
  weight?: number;
  enableMorphTargets?: boolean;
  enableSkeletalAnimation?: boolean;
  optimizeAnimations?: boolean;
  maxConcurrentAnimations?: number;
  animationQuality?: AnimationQuality;
}

export interface AnimationBlendConfig {
  fromAnimation: string;
  toAnimation: string;
  blendDuration: number;
  blendMode: AnimationBlendMode;
  easingFunction?: (t: number) => number;
}

export interface AnimationState {
  id: string;
  name: string;
  group: AnimationGroup;
  isPlaying: boolean;
  isPaused: boolean;
  currentFrame: number;
  totalFrames: number;
  speed: number;
  weight: number;
  loop: boolean;
  blendWeight: number;
  startTime: number;
  endTime: number;
  duration: number;
}

export interface MorphTargetState {
  meshId: string;
  targetName: string;
  currentWeight: number;
  targetWeight: number;
  isAnimating: boolean;
  animationDuration: number;
}

export interface SkeletalAnimationState {
  skeletonId: string;
  bones: Map<string, BoneState>;
  isAnimating: boolean;
  currentPose: Matrix[];
  targetPose: Matrix[];
  blendFactor: number;
}

export interface BoneState {
  name: string;
  bone: Bone;
  position: Vector3;
  rotation: Quaternion;
  scaling: Vector3;
  isAnimating: boolean;
}

export interface AnimationPerformanceStats {
  activeAnimations: number;
  animationUpdateTime: number;
  skeletalAnimations: number;
  morphTargetAnimations: number;
  blendingOperations: number;
  memoryUsage: number;
  cpuUsage: number;
}

export enum AnimationBlendMode {
  REPLACE = 'replace',
  ADDITIVE = 'additive',
  MULTIPLY = 'multiply',
  OVERLAY = 'overlay',
  SCREEN = 'screen',
}

export enum AnimationQuality {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  ULTRA = 'ultra',
}

export enum AnimationEventType {
  START = 'start',
  END = 'end',
  PAUSE = 'pause',
  RESUME = 'resume',
  LOOP = 'loop',
  BLEND_START = 'blend_start',
  BLEND_END = 'blend_end',
  MORPH_TARGET_CHANGED = 'morph_target_changed',
  BONE_TRANSFORM_CHANGED = 'bone_transform_changed',
}

export class AnimationSystemService {
  private scene: Scene;
  private engine: Engine;
  private animationStates = new Map<string, AnimationState>();
  private morphTargetStates = new Map<string, MorphTargetState>();
  private skeletalStates = new Map<string, SkeletalAnimationState>();
  private blendingQueue: AnimationBlendConfig[] = [];
  private performanceStats: AnimationPerformanceStats;
  private updateLoopRunning = false;
  private lastUpdateTime = 0;
  
  // Configuration
  private defaultConfig: AnimationConfig = {
    autoStart: false,
    loop: true,
    speed: 1.0,
    blendMode: AnimationBlendMode.REPLACE,
    weight: 1.0,
    enableMorphTargets: true,
    enableSkeletalAnimation: true,
    optimizeAnimations: true,
    maxConcurrentAnimations: 10,
    animationQuality: AnimationQuality.HIGH,
  };

  // Event observables
  public onAnimationEvent = new Observable<{ type: AnimationEventType; data: any }>();
  public onPerformanceUpdate = new Observable<AnimationPerformanceStats>();
  public onAnimationBlendComplete = new Observable<AnimationBlendConfig>();
  public onMorphTargetUpdate = new Observable<MorphTargetState>();
  public onSkeletalUpdate = new Observable<SkeletalAnimationState>();

  constructor(scene: Scene, engine: Engine) {
    this.scene = scene;
    this.engine = engine;
    
    this.performanceStats = {
      activeAnimations: 0,
      animationUpdateTime: 0,
      skeletalAnimations: 0,
      morphTargetAnimations: 0,
      blendingOperations: 0,
      memoryUsage: 0,
      cpuUsage: 0,
    };

    this.setupAnimationSystem();
    this.startUpdateLoop();
  }

  /**
   * Initialize animation system
   */
  private setupAnimationSystem(): void {
    // Optimize Babylon.js animation settings
    Animation.AllowMatricesInterpolation = true;
    Animation.AllowMatrixDecomposeForInterpolation = true;
    
    // Set up performance monitoring
    this.setupPerformanceMonitoring();
  }

  /**
   * Process and setup animations from loaded glTF
   */
  public processAnimations(
    animationGroups: AnimationGroup[],
    meshes: AbstractMesh[],
    config: Partial<AnimationConfig> = {}
  ): string[] {
    const processedAnimations: string[] = [];
    const finalConfig = { ...this.defaultConfig, ...config };

    try {
      // Process each animation group
      animationGroups.forEach((group, index) => {
        const animationId = this.generateAnimationId(group.name || `animation_${index}`);
        
        // Create animation state
        const state: AnimationState = {
          id: animationId,
          name: group.name || `Animation ${index + 1}`,
          group,
          isPlaying: false,
          isPaused: false,
          currentFrame: 0,
          totalFrames: this.calculateTotalFrames(group),
          speed: finalConfig.speed!,
          weight: finalConfig.weight!,
          loop: finalConfig.loop!,
          blendWeight: 1.0,
          startTime: group.from,
          endTime: group.to,
          duration: (group.to - group.from) / this.scene.getAnimationRatio(),
        };

        // Optimize animation if requested
        if (finalConfig.optimizeAnimations) {
          this.optimizeAnimationGroup(group, finalConfig.animationQuality!);
        }

        // Setup skeletal animations
        if (finalConfig.enableSkeletalAnimation) {
          this.setupSkeletalAnimation(group, meshes);
        }

        // Setup morph target animations
        if (finalConfig.enableMorphTargets) {
          this.setupMorphTargetAnimation(group, meshes);
        }

        // Store state
        this.animationStates.set(animationId, state);
        processedAnimations.push(animationId);

        // Auto-start if configured
        if (finalConfig.autoStart) {
          this.playAnimation(animationId);
        }
      });

      this.updatePerformanceStats();
      return processedAnimations;

    } catch (error) {
      throw new GLTFLoadingError({
        code: GLTFErrorCode.ANIMATION_ERROR,
        message: `Animation processing failed: ${error}`,
        stage: LoadingStage.SETTING_UP_ANIMATIONS,
        recoverable: true,
        suggestions: [
          'Check animation data integrity',
          'Verify skeleton hierarchy',
          'Try disabling problematic animations',
        ],
      });
    }
  }

  /**
   * Play animation with optional blending
   */
  public playAnimation(
    animationId: string,
    blendConfig?: Partial<AnimationBlendConfig>
  ): void {
    const state = this.animationStates.get(animationId);
    if (!state) {
      throw new Error(`Animation '${animationId}' not found`);
    }

    // Handle blending if another animation is playing
    if (blendConfig) {
      this.blendToAnimation(state, blendConfig);
    } else {
      // Start animation directly
      state.group.start(state.loop, state.speed);
      state.isPlaying = true;
      state.isPaused = false;
      
      this.emitAnimationEvent(AnimationEventType.START, state);
    }

    this.updatePerformanceStats();
  }

  /**
   * Stop animation
   */
  public stopAnimation(animationId: string): void {
    const state = this.animationStates.get(animationId);
    if (!state) return;

    state.group.stop();
    state.isPlaying = false;
    state.isPaused = false;
    state.currentFrame = 0;

    this.emitAnimationEvent(AnimationEventType.END, state);
    this.updatePerformanceStats();
  }

  /**
   * Pause animation
   */
  public pauseAnimation(animationId: string): void {
    const state = this.animationStates.get(animationId);
    if (!state || !state.isPlaying) return;

    state.group.pause();
    state.isPaused = true;

    this.emitAnimationEvent(AnimationEventType.PAUSE, state);
  }

  /**
   * Resume animation
   */
  public resumeAnimation(animationId: string): void {
    const state = this.animationStates.get(animationId);
    if (!state || !state.isPaused) return;

    state.group.restart();
    state.isPaused = false;

    this.emitAnimationEvent(AnimationEventType.RESUME, state);
  }

  /**
   * Blend between animations
   */
  public blendAnimations(
    fromAnimationId: string,
    toAnimationId: string,
    blendDuration: number,
    blendMode: AnimationBlendMode = AnimationBlendMode.REPLACE
  ): void {
    const fromState = this.animationStates.get(fromAnimationId);
    const toState = this.animationStates.get(toAnimationId);

    if (!fromState || !toState) {
      throw new Error('Animation states not found for blending');
    }

    const blendConfig: AnimationBlendConfig = {
      fromAnimation: fromAnimationId,
      toAnimation: toAnimationId,
      blendDuration,
      blendMode,
      easingFunction: this.getDefaultEasingFunction(),
    };

    this.blendingQueue.push(blendConfig);
    this.emitAnimationEvent(AnimationEventType.BLEND_START, blendConfig);
  }

  /**
   * Set animation speed
   */
  public setAnimationSpeed(animationId: string, speed: number): void {
    const state = this.animationStates.get(animationId);
    if (!state) return;

    state.speed = speed;
    state.group.speedRatio = speed;
  }

  /**
   * Set animation weight for blending
   */
  public setAnimationWeight(animationId: string, weight: number): void {
    const state = this.animationStates.get(animationId);
    if (!state) return;

    state.weight = Math.max(0, Math.min(1, weight));
    state.group.setWeightForAllAnimatables(state.weight);
  }

  /**
   * Control morph target weights
   */
  public setMorphTargetWeight(
    meshId: string,
    targetName: string,
    weight: number,
    animationDuration = 0
  ): void {
    const mesh = this.scene.getMeshById(meshId);
    if (!mesh || !mesh.morphTargetManager) return;

    const target = mesh.morphTargetManager.getTarget(targetName);
    if (!target) return;

    const stateId = `${meshId}_${targetName}`;
    const currentWeight = target.influence;

    if (animationDuration > 0) {
      // Animate to target weight
      const state: MorphTargetState = {
        meshId,
        targetName,
        currentWeight,
        targetWeight: weight,
        isAnimating: true,
        animationDuration,
      };

      this.morphTargetStates.set(stateId, state);
      this.animateMorphTarget(state, target);
    } else {
      // Set immediately
      target.influence = weight;
    }

    this.emitAnimationEvent(AnimationEventType.MORPH_TARGET_CHANGED, {
      meshId,
      targetName,
      weight,
    });
  }

  /**
   * Get animation state
   */
  public getAnimationState(animationId: string): AnimationState | null {
    return this.animationStates.get(animationId) || null;
  }

  /**
   * Get all animation states
   */
  public getAllAnimationStates(): AnimationState[] {
    return Array.from(this.animationStates.values());
  }

  /**
   * Get performance statistics
   */
  public getPerformanceStats(): AnimationPerformanceStats {
    return { ...this.performanceStats };
  }

  /**
   * Private methods
   */
  private blendToAnimation(
    toState: AnimationState,
    blendConfig: Partial<AnimationBlendConfig>
  ): void {
    // Find currently playing animation to blend from
    const currentlyPlaying = Array.from(this.animationStates.values())
      .find(state => state.isPlaying && state.id !== toState.id);

    if (currentlyPlaying && blendConfig.blendDuration) {
      const fullBlendConfig: AnimationBlendConfig = {
        fromAnimation: currentlyPlaying.id,
        toAnimation: toState.id,
        blendDuration: blendConfig.blendDuration,
        blendMode: blendConfig.blendMode || AnimationBlendMode.REPLACE,
        easingFunction: blendConfig.easingFunction || this.getDefaultEasingFunction(),
      };

      this.executeAnimationBlend(fullBlendConfig);
    } else {
      // No blending, start directly
      toState.group.start(toState.loop, toState.speed);
      toState.isPlaying = true;
      toState.isPaused = false;
    }
  }

  private executeAnimationBlend(blendConfig: AnimationBlendConfig): void {
    const fromState = this.animationStates.get(blendConfig.fromAnimation);
    const toState = this.animationStates.get(blendConfig.toAnimation);

    if (!fromState || !toState) return;

    // Start target animation
    toState.group.start(toState.loop, toState.speed);
    toState.isPlaying = true;
    toState.blendWeight = 0;

    // Create blend animation
    const blendAnimation = Animation.CreateAndStartAnimation(
      'animationBlend',
      toState,
      'blendWeight',
      30, // fps
      Math.ceil(blendConfig.blendDuration / 1000 * 30), // frames
      0,
      1,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
      blendConfig.easingFunction
    );

    // Update weights during blend
    blendAnimation?.onAnimationLoopObservable.add(() => {
      const blendWeight = toState.blendWeight;
      fromState.blendWeight = 1 - blendWeight;
      
      fromState.group.setWeightForAllAnimatables(fromState.blendWeight);
      toState.group.setWeightForAllAnimatables(blendWeight);
    });

    // Complete blend
    blendAnimation?.onAnimationEndObservable.add(() => {
      fromState.group.stop();
      fromState.isPlaying = false;
      fromState.blendWeight = 0;
      
      toState.blendWeight = 1;
      toState.group.setWeightForAllAnimatables(1);

      this.emitAnimationEvent(AnimationEventType.BLEND_END, blendConfig);
      this.onAnimationBlendComplete.notifyObservers(blendConfig);
    });

    this.performanceStats.blendingOperations++;
  }

  private animateMorphTarget(state: MorphTargetState, target: MorphTarget): void {
    const startTime = Date.now();
    const startWeight = state.currentWeight;
    const targetWeight = state.targetWeight;
    const duration = state.animationDuration;

    const updateMorphTarget = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Apply easing
      const easedProgress = this.getDefaultEasingFunction()(progress);
      const currentWeight = startWeight + (targetWeight - startWeight) * easedProgress;
      
      target.influence = currentWeight;
      state.currentWeight = currentWeight;

      if (progress < 1) {
        requestAnimationFrame(updateMorphTarget);
      } else {
        state.isAnimating = false;
        this.onMorphTargetUpdate.notifyObservers(state);
      }
    };

    updateMorphTarget();
  }

  private setupSkeletalAnimation(group: AnimationGroup, meshes: AbstractMesh[]): void {
    meshes.forEach(mesh => {
      if (mesh.skeleton) {
        const skeletonId = mesh.skeleton.uniqueId.toString();
        
        if (!this.skeletalStates.has(skeletonId)) {
          const bones = new Map<string, BoneState>();
          
          mesh.skeleton.bones.forEach(bone => {
            bones.set(bone.name, {
              name: bone.name,
              bone,
              position: bone.getPosition().clone(),
              rotation: bone.getRotationQuaternion()?.clone() || Quaternion.Identity(),
              scaling: bone.getScaling().clone(),
              isAnimating: false,
            });
          });

          const skeletalState: SkeletalAnimationState = {
            skeletonId,
            bones,
            isAnimating: false,
            currentPose: [],
            targetPose: [],
            blendFactor: 0,
          };

          this.skeletalStates.set(skeletonId, skeletalState);
        }
      }
    });
  }

  private setupMorphTargetAnimation(group: AnimationGroup, meshes: AbstractMesh[]): void {
    meshes.forEach(mesh => {
      if (mesh.morphTargetManager) {
        for (let i = 0; i < mesh.morphTargetManager.numTargets; i++) {
          const target = mesh.morphTargetManager.getTarget(i);
          const stateId = `${mesh.id}_${target.name}`;
          
          const state: MorphTargetState = {
            meshId: mesh.id,
            targetName: target.name,
            currentWeight: target.influence,
            targetWeight: target.influence,
            isAnimating: false,
            animationDuration: 0,
          };

          this.morphTargetStates.set(stateId, state);
        }
      }
    });
  }

  private optimizeAnimationGroup(group: AnimationGroup, quality: AnimationQuality): void {
    // Optimize based on quality setting
    const optimizationFactors = {
      [AnimationQuality.LOW]: { keyframeReduction: 0.7, precisionReduction: 0.5 },
      [AnimationQuality.MEDIUM]: { keyframeReduction: 0.85, precisionReduction: 0.75 },
      [AnimationQuality.HIGH]: { keyframeReduction: 0.95, precisionReduction: 0.9 },
      [AnimationQuality.ULTRA]: { keyframeReduction: 1.0, precisionReduction: 1.0 },
    };

    const factors = optimizationFactors[quality];

    group.targetedAnimations.forEach(targetedAnimation => {
      const animation = targetedAnimation.animation;
      
      // Reduce keyframes if quality allows
      if (factors.keyframeReduction < 1.0) {
        this.reduceAnimationKeyframes(animation, factors.keyframeReduction);
      }

      // Adjust precision
      if (factors.precisionReduction < 1.0) {
        this.adjustAnimationPrecision(animation, factors.precisionReduction);
      }
    });
  }

  private reduceAnimationKeyframes(animation: Animation, reductionFactor: number): void {
    const originalKeys = animation.getKeys();
    const targetKeyCount = Math.ceil(originalKeys.length * reductionFactor);
    
    if (targetKeyCount < originalKeys.length) {
      const reducedKeys: IAnimationKey[] = [];
      const step = originalKeys.length / targetKeyCount;
      
      for (let i = 0; i < targetKeyCount; i++) {
        const index = Math.floor(i * step);
        reducedKeys.push(originalKeys[index]);
      }
      
      // Ensure we keep the last keyframe
      if (reducedKeys[reducedKeys.length - 1] !== originalKeys[originalKeys.length - 1]) {
        reducedKeys.push(originalKeys[originalKeys.length - 1]);
      }
      
      animation.setKeys(reducedKeys);
    }
  }

  private adjustAnimationPrecision(animation: Animation, precisionFactor: number): void {
    // Reduce precision for position/rotation values based on precision factor
    const keys = animation.getKeys();
    
    keys.forEach(key => {
      if (typeof key.value === 'number') {
        key.value = Math.round(key.value / precisionFactor) * precisionFactor;
      } else if (key.value instanceof Vector3) {
        key.value.x = Math.round(key.value.x / precisionFactor) * precisionFactor;
        key.value.y = Math.round(key.value.y / precisionFactor) * precisionFactor;
        key.value.z = Math.round(key.value.z / precisionFactor) * precisionFactor;
      }
    });
  }

  private calculateTotalFrames(group: AnimationGroup): number {
    return Math.ceil((group.to - group.from) * this.scene.getAnimationRatio());
  }

  private generateAnimationId(name: string): string {
    return `${name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getDefaultEasingFunction(): (t: number) => number {
    // Simple ease-in-out function
    return (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  private setupPerformanceMonitoring(): void {
    setInterval(() => {
      this.updatePerformanceStats();
      this.onPerformanceUpdate.notifyObservers(this.performanceStats);
    }, 1000);
  }

  private updatePerformanceStats(): void {
    const startTime = performance.now();
    
    this.performanceStats.activeAnimations = Array.from(this.animationStates.values())
      .filter(state => state.isPlaying).length;
    
    this.performanceStats.skeletalAnimations = this.skeletalStates.size;
    this.performanceStats.morphTargetAnimations = Array.from(this.morphTargetStates.values())
      .filter(state => state.isAnimating).length;
    
    // Estimate memory usage
    let memoryUsage = 0;
    this.animationStates.forEach(state => {
      memoryUsage += state.group.targetedAnimations.length * 1024; // Rough estimate
    });
    this.performanceStats.memoryUsage = memoryUsage;

    this.performanceStats.animationUpdateTime = performance.now() - startTime;
  }

  private startUpdateLoop(): void {
    if (this.updateLoopRunning) return;
    
    this.updateLoopRunning = true;
    
    const updateLoop = () => {
      if (!this.updateLoopRunning) return;
      
      const currentTime = performance.now();
      const deltaTime = currentTime - this.lastUpdateTime;
      this.lastUpdateTime = currentTime;

      // Update animation states
      this.updateAnimationStates(deltaTime);
      
      // Process blending queue
      this.processBlendingQueue();
      
      // Update skeletal animations
      this.updateSkeletalAnimations(deltaTime);
      
      // Update morph targets
      this.updateMorphTargets(deltaTime);

      requestAnimationFrame(updateLoop);
    };

    requestAnimationFrame(updateLoop);
  }

  private updateAnimationStates(deltaTime: number): void {
    this.animationStates.forEach(state => {
      if (state.isPlaying && !state.isPaused) {
        // Update current frame
        const frameRate = this.scene.getAnimationRatio();
        state.currentFrame += (deltaTime / 1000) * frameRate * state.speed;
        
        // Handle looping
        if (state.currentFrame >= state.totalFrames) {
          if (state.loop) {
            state.currentFrame = 0;
            this.emitAnimationEvent(AnimationEventType.LOOP, state);
          } else {
            state.isPlaying = false;
            state.currentFrame = state.totalFrames;
            this.emitAnimationEvent(AnimationEventType.END, state);
          }
        }
      }
    });
  }

  private processBlendingQueue(): void {
    // Process any pending blend operations
    this.blendingQueue = this.blendingQueue.filter(blendConfig => {
      // Implementation would handle active blends
      return false; // Remove processed blends
    });
  }

  private updateSkeletalAnimations(deltaTime: number): void {
    this.skeletalStates.forEach(state => {
      if (state.isAnimating) {
        // Update skeletal animation blending
        state.bones.forEach(boneState => {
          if (boneState.isAnimating) {
            this.emitAnimationEvent(AnimationEventType.BONE_TRANSFORM_CHANGED, {
              skeletonId: state.skeletonId,
              boneName: boneState.name,
              transform: boneState.bone.getAbsoluteTransform(),
            });
          }
        });
        
        this.onSkeletalUpdate.notifyObservers(state);
      }
    });
  }

  private updateMorphTargets(deltaTime: number): void {
    this.morphTargetStates.forEach(state => {
      if (state.isAnimating) {
        this.onMorphTargetUpdate.notifyObservers(state);
      }
    });
  }

  private emitAnimationEvent(type: AnimationEventType, data: any): void {
    this.onAnimationEvent.notifyObservers({ type, data });
  }

  /**
   * Public utility methods
   */
  public stopAllAnimations(): void {
    this.animationStates.forEach((state, id) => {
      if (state.isPlaying) {
        this.stopAnimation(id);
      }
    });
  }

  public pauseAllAnimations(): void {
    this.animationStates.forEach((state, id) => {
      if (state.isPlaying && !state.isPaused) {
        this.pauseAnimation(id);
      }
    });
  }

  public resumeAllAnimations(): void {
    this.animationStates.forEach((state, id) => {
      if (state.isPaused) {
        this.resumeAnimation(id);
      }
    });
  }

  public dispose(): void {
    // Stop update loop
    this.updateLoopRunning = false;

    // Stop all animations
    this.stopAllAnimations();

    // Clear all states
    this.animationStates.clear();
    this.morphTargetStates.clear();
    this.skeletalStates.clear();
    this.blendingQueue = [];

    // Clear observables
    this.onAnimationEvent.clear();
    this.onPerformanceUpdate.clear();
    this.onAnimationBlendComplete.clear();
    this.onMorphTargetUpdate.clear();
    this.onSkeletalUpdate.clear();
  }
}