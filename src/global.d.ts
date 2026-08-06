import type { AnalysisResult, RunUnityResult, UnityInstallation, WorkspaceResult } from './types';

declare global {
  interface Window {
    autoVrm: {
      pickArchive(): Promise<string | null>;
      pickFolder(): Promise<string | null>;
      analyzePath(inputPath: string): Promise<AnalysisResult>;
      exportReport(analysisId: string): Promise<string | null>;
      prepareWorkspace(analysisId: string, options: {
        modelPath?: string;
        animationPaths?: string[];
        author?: string;
      }): Promise<WorkspaceResult | null>;
      detectUnity(): Promise<UnityInstallation[]>;
      pickUnity(): Promise<string | null>;
      runUnity(payload: {
        unityPath: string;
        unityProjectPath: string;
        jobPath: string;
        logPath: string;
      }): Promise<RunUnityResult>;
      openPath(targetPath: string): Promise<string>;
      getPathForFile(file: File): string;
      onWorkerLog(callback: (message: string) => void): () => void;
    };
  }
}

export {};
