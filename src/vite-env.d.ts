/// <reference types="vite/client" />

declare global {
  interface Rtmw3dKeypoint {
    x: number;
    y: number;
    z: number;
    score: number;
  }

  interface Rtmw3dStatus {
    installed: boolean;
    ready: boolean;
    preparing: boolean;
    provider: string | null;
    modelPath: string | null;
    inputSize: [number, number];
    platform: string;
    gpuAvailable: boolean;
  }

  interface Rtmw3dProgress {
    phase: 'download' | 'load' | 'ready';
    progress: number;
    message: string;
    received?: number;
    total?: number;
  }

  interface Rtmw3dInferenceResult {
    keypoints: Rtmw3dKeypoint[];
    provider: string;
    elapsedMs: number;
    inputSize: [number, number];
  }

  interface PapConverterStatus {
    platform: string;
    supported: boolean;
    installed: boolean;
    preparing: boolean;
    executablePath: string | null;
    downloadUrl: string;
  }

  interface PapConverterProgress {
    phase: 'download' | 'extract' | 'ready' | 'convert' | 'done';
    progress: number;
    message: string;
    received?: number;
    total?: number;
  }

  interface PapConversionResult {
    fbx: Uint8Array;
    fileName: string;
    animationName: string;
    animationIndex: number;
    animationCount: number;
    papSkeletonId: number;
    sklbSkeletonId: number;
    warning: string | null;
  }

  interface Window {
    desktop?: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      rtmw3d: {
        status: () => Promise<Rtmw3dStatus>;
        prepare: () => Promise<Rtmw3dStatus>;
        infer: (request: { rgba: Uint8Array }) => Promise<Rtmw3dInferenceResult>;
        onProgress: (callback: (progress: Rtmw3dProgress) => void) => () => void;
      };
      pap: {
        status: () => Promise<PapConverterStatus>;
        prepare: () => Promise<PapConverterStatus>;
        convert: (request: {
          pap: Uint8Array;
          sklb: Uint8Array;
          animationIndex: number;
          expectedSkeletonCode?: string;
          sklbFileName?: string;
        }) => Promise<PapConversionResult>;
        onProgress: (callback: (progress: PapConverterProgress) => void) => () => void;
      };
    };
  }
}

export {};
