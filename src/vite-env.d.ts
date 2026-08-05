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

interface TextMotionSettings {
  provider: string;
  endpoint: string;
  model: string;
  temperature: number;
  hasApiKey: boolean;
  apiKeyCanBeStored: boolean;
}

interface TextMotionProgress {
  phase: 'draft' | 'draft-ready' | 'refine' | 'done';
  progress: number;
  message: string;
}

interface TextMotionGenerationRequest {
  prompt: string;
  duration: number | null;
  loop: boolean | null;
  style: string;
  intensity: number;
  refine: boolean;
  fps: number;
  availableBones: string[];
}

interface TextMotionGenerationResult {
  spec: unknown;
  refined: boolean;
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
      textMotion: {
        getSettings: () => Promise<TextMotionSettings>;
        saveSettings: (request: {
          provider: string;
          endpoint: string;
          model: string;
          temperature: number;
          apiKey?: string;
          clearApiKey?: boolean;
        }) => Promise<TextMotionSettings>;
        testConnection: () => Promise<{ ok: boolean; models: string[] }>;
        generate: (request: TextMotionGenerationRequest) => Promise<TextMotionGenerationResult>;
        cancel: () => void;
        onProgress: (callback: (progress: TextMotionProgress) => void) => () => void;
      };
    };
  }
}

export {};
