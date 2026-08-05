export type Vec3Tuple = [number, number, number];
export type QuatTuple = [number, number, number, number];

export interface BonePose {
  rotation: QuatTuple;
  position?: Vec3Tuple;
}

export type PoseSnapshot = Record<string, BonePose>;
export type ExpressionSnapshot = Record<string, number>;

export interface Keyframe {
  id: string;
  time: number;
  pose: PoseSnapshot;
  expressions?: ExpressionSnapshot;
  easing: 'linear' | 'smooth' | 'step';
}

export interface HumanoidRigBoneSnapshot {
  parent: string | null;
  restLocalRotation: QuatTuple;
  restWorldRotation: QuatTuple;
  restWorldPosition: Vec3Tuple;
}

export interface HumanoidRigSnapshot {
  rootWorldRotation: QuatTuple;
  heightMeters: number;
  hipsHeight: number;
  bones: Record<string, HumanoidRigBoneSnapshot>;
}

export interface ModelInfo {
  name: string;
  format: 'VRM' | 'GLB' | 'GLTF';
  avatarName?: string;
  author?: string;
  version?: string;
  metaVersion?: '0' | '1';
  boneCount: number;
  availableExpressions?: string[];
  humanoidValid?: boolean;
  missingRequiredBones?: string[];
  heightMeters?: number;
  normalizedHipsHeight?: number;
  forwardAxis?: '+Z';
  humanoidRig?: HumanoidRigSnapshot;
}

export interface ProjectFile {
  app: 'VRM Pose Mode';
  version: 1;
  name: string;
  duration: number;
  fps: number;
  interpolation: 'LINEAR' | 'STEP';
  modelFileName?: string;
  keyframes: Keyframe[];
}

export interface SelectedTransform {
  rotation: Vec3Tuple;
  position: Vec3Tuple;
}
