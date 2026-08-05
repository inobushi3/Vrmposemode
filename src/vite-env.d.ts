/// <reference types="vite/client" />

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

declare global {
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
    };
  }
}

export {};
