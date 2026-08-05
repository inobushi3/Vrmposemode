declare module 'three-mmd-runtime/examples/jsm/loaders/MMDLoader.js' {
  import type {
    AnimationClip,
    Camera,
    LoadingManager,
    SkinnedMesh,
  } from 'three';

  export interface MmdVpdBone {
    name: string;
    translation: [number, number, number] | number[];
    quaternion: [number, number, number, number] | number[];
  }

  export interface MmdVpd {
    metadata?: Record<string, unknown>;
    bones: MmdVpdBone[];
    morphs?: Array<{ name: string; weight: number }>;
  }

  export class MMDLoader {
    constructor(manager?: LoadingManager);
    setPath(path: string): this;
    setResourcePath(path: string): this;
    setAnimationPath(path: string): this;
    load(
      url: string,
      onLoad: (mesh: SkinnedMesh) => void,
      onProgress?: (event: ProgressEvent<EventTarget>) => void,
      onError?: (error: unknown) => void,
    ): void;
    loadAnimation(
      url: string | string[],
      object: SkinnedMesh | Camera,
      onLoad: (clip: AnimationClip) => void,
      onProgress?: (event: ProgressEvent<EventTarget>) => void,
      onError?: (error: unknown) => void,
    ): void;
    loadVPD(
      url: string,
      isUnicode: boolean,
      onLoad: (vpd: MmdVpd) => void,
      onProgress?: (event: ProgressEvent<EventTarget>) => void,
      onError?: (error: unknown) => void,
    ): void;
  }
}
