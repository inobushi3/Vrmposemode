export type AssetCategory =
  | 'model'
  | 'animation'
  | 'animation-controller'
  | 'texture'
  | 'material'
  | 'shader'
  | 'prefab'
  | 'scene'
  | 'unity-asset'
  | 'metadata'
  | 'audio'
  | 'script'
  | 'binary'
  | 'data'
  | 'document'
  | 'package'
  | 'other';

export interface AssetDetails {
  meshes?: number;
  skins?: number;
  animations?: number;
  nodes?: number;
  materials?: number;
  textures?: number;
  isVrm?: boolean;
  isVrma?: boolean;
  binary?: boolean;
  hasGeometry?: boolean;
  hasSkin?: boolean;
  hasSkeleton?: boolean;
  hasAnimation?: boolean;
}

export interface AnalyzedFile {
  relativePath: string;
  name: string;
  size: number;
  extension: string;
  category: AssetCategory;
  details: AssetDetails | null;
  guid: string | null;
  referencedGuids: string[];
  resolvedDependencies: string[];
  unresolvedGuids: string[];
  modelScore: number;
  modelReasons: string[];
  animationScore: number;
  animationReasons: string[];
}

export interface AnalysisResult {
  analysisId: string;
  sourcePath: string;
  sourceName: string;
  sourceKind: 'zip' | 'folder' | 'file';
  analyzedAt: string;
  totalFiles: number;
  totalBytes: number;
  counts: Partial<Record<AssetCategory, number>>;
  modelCandidates: AnalyzedFile[];
  animationCandidates: AnalyzedFile[];
  unresolvedGuids: string[];
  dependencyCount: number;
  shaderFiles: string[];
  warnings: string[];
  files: AnalyzedFile[];
}

export interface UnityInstallation {
  version: string;
  path: string;
}

export interface WorkspaceResult {
  workspacePath: string;
  unityProjectPath: string;
  jobPath: string;
  logPath: string;
  outputPath: string;
  modelCandidate: string;
  animationCount: number;
}

export interface WorkerOutput {
  type: string;
  source: string;
  output?: string;
  status: 'success' | 'failed' | 'skipped';
  message: string;
}

export interface WorkerResult {
  status: string;
  startedAt: string;
  finishedAt: string;
  modelAsset: string;
  humanoidAvatar: boolean;
  convertedMaterials: number;
  exportedAnimations: number;
  warnings: string[];
  outputs: WorkerOutput[];
}

export interface RunUnityResult {
  code: number;
  result: WorkerResult | null;
  logPath: string;
}
