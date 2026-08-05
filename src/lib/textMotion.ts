import * as THREE from 'three';
import type { Keyframe, PoseSnapshot, QuatTuple, Vec3Tuple } from '../types';
import {
  compileSemanticActions,
  type ProceduralMotionFrame,
  type SemanticMotionActionType,
} from './proceduralMotion';

export const TEXT_MOTION_BONES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
] as const;

export type TextMotionBoneName = typeof TEXT_MOTION_BONES[number];
export type TextMotionEasing = 'smooth' | 'linear' | 'step';

interface RawBoneTransform {
  r?: unknown;
  p?: unknown;
}

interface RawTextMotionFrame {
  t?: unknown;
  easing?: unknown;
  bones?: unknown;
}

export interface RawTextMotionSpec {
  name?: unknown;
  duration?: unknown;
  loop?: unknown;
  summary?: unknown;
  actions?: unknown;
  frames?: unknown;
}

export interface CompiledTextMotion {
  name: string;
  summary: string;
  duration: number;
  loop: boolean;
  keyframes: Keyframe[];
  boneCount: number;
  actionsUsed: SemanticMotionActionType[];
  warnings: string[];
}

export interface CompileTextMotionOptions {
  availableBones: string[];
  fps: number;
  requestedDuration?: number | null;
  requestedLoop?: boolean | null;
}

type AxisLimits = readonly [number, number, number];

const ROTATION_LIMITS: Partial<Record<TextMotionBoneName, AxisLimits>> = {
  hips: [100, 180, 100],
  spine: [40, 55, 40],
  chest: [45, 65, 45],
  upperChest: [50, 70, 50],
  neck: [45, 60, 45],
  head: [60, 80, 60],
  leftShoulder: [35, 45, 45],
  rightShoulder: [35, 45, 45],
  leftUpperArm: [150, 130, 150],
  rightUpperArm: [150, 130, 150],
  leftLowerArm: [25, 145, 150],
  rightLowerArm: [25, 145, 150],
  leftHand: [65, 65, 65],
  rightHand: [65, 65, 65],
  leftUpperLeg: [135, 70, 80],
  rightUpperLeg: [135, 70, 80],
  leftLowerLeg: [150, 15, 15],
  rightLowerLeg: [150, 15, 15],
  leftFoot: [65, 45, 45],
  rightFoot: [65, 45, 45],
  leftToes: [40, 20, 20],
  rightToes: [40, 20, 20],
};

const DEFAULT_LIMIT: AxisLimits = [90, 90, 90];
const DEFAULT_DURATION = 4;
const MAX_DURATION = 300;
const MAX_FRAMES = 720;
const DEG_TO_RAD = Math.PI / 180;

function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function tuple3(value: unknown): Vec3Tuple | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const tuple = value.map((item) => Number(item));
  if (!tuple.every(Number.isFinite)) return null;
  return tuple as Vec3Tuple;
}

function easing(value: unknown): TextMotionEasing {
  return value === 'linear' || value === 'step' ? value : 'smooth';
}

function quatFromDegrees(rotation: Vec3Tuple): QuatTuple {
  const euler = new THREE.Euler(
    rotation[0] * DEG_TO_RAD,
    rotation[1] * DEG_TO_RAD,
    rotation[2] * DEG_TO_RAD,
    'XYZ',
  );
  const quaternion = new THREE.Quaternion().setFromEuler(euler).normalize();
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

function clampRotation(
  bone: TextMotionBoneName,
  raw: Vec3Tuple,
  warnings: string[],
): Vec3Tuple {
  const limits = ROTATION_LIMITS[bone] ?? DEFAULT_LIMIT;
  const result: Vec3Tuple = [
    clamp(raw[0], -limits[0], limits[0]),
    clamp(raw[1], -limits[1], limits[1]),
    clamp(raw[2], -limits[2], limits[2]),
  ];

  if (bone === 'leftLowerLeg' || bone === 'rightLowerLeg') {
    result[0] = clamp(raw[0], -3, 150);
    result[1] = clamp(raw[1], -15, 15);
    result[2] = clamp(raw[2], -15, 15);
  }
  if (bone === 'leftLowerArm' || bone === 'rightLowerArm') {
    result[0] = clamp(raw[0], -25, 25);
  }

  if (result.some((value, index) => Math.abs(value - raw[index]) > 0.001)) {
    warnings.push(`Rotação fora do limite corrigida em ${bone}.`);
  }
  return result;
}

function baseRotation(bone: TextMotionBoneName): Vec3Tuple {
  if (bone === 'leftUpperArm') return [0, 0, -68];
  if (bone === 'rightUpperArm') return [0, 0, 68];
  if (bone === 'leftLowerArm') return [0, 0, -8];
  if (bone === 'rightLowerArm') return [0, 0, 8];
  return [0, 0, 0];
}

function cloneTuple(value: Vec3Tuple): Vec3Tuple {
  return [value[0], value[1], value[2]];
}

interface WorkingTransform {
  r: Vec3Tuple;
  p?: Vec3Tuple;
}

interface SanitizedFrame {
  t: number;
  easing: TextMotionEasing;
  changes: Partial<Record<TextMotionBoneName, WorkingTransform>>;
}

function sanitizeFrames(
  rawFrames: unknown,
  allowedBones: Set<string>,
  sourceDuration: number,
  targetDuration: number,
  fps: number,
  warnings: string[],
): SanitizedFrame[] {
  if (!Array.isArray(rawFrames)) return [];
  const durationScale = targetDuration / Math.max(0.001, sourceDuration);
  const byFrame = new Map<number, SanitizedFrame>();

  for (const rawFrame of rawFrames.slice(0, MAX_FRAMES) as RawTextMotionFrame[]) {
    const rawTime = finiteNumber(rawFrame?.t, Number.NaN);
    if (!Number.isFinite(rawTime)) {
      warnings.push('Um keyframe sem tempo válido foi removido.');
      continue;
    }
    const scaled = clamp(rawTime * durationScale, 0, targetDuration);
    const frameNumber = Math.round(scaled * fps);
    const time = frameNumber / fps;
    const changes: Partial<Record<TextMotionBoneName, WorkingTransform>> = {};
    const bones = rawFrame?.bones;
    if (!bones || typeof bones !== 'object' || Array.isArray(bones)) continue;

    for (const [boneName, rawTransform] of Object.entries(bones as Record<string, RawBoneTransform>)) {
      if (!TEXT_MOTION_BONES.includes(boneName as TextMotionBoneName) || !allowedBones.has(boneName)) {
        warnings.push(`Osso ignorado: ${boneName}.`);
        continue;
      }
      if (!rawTransform || typeof rawTransform !== 'object') continue;
      const bone = boneName as TextMotionBoneName;
      const rotationRaw = tuple3(rawTransform.r) ?? baseRotation(bone);
      const transform: WorkingTransform = {
        r: clampRotation(bone, rotationRaw, warnings),
      };
      if (bone === 'hips' && rawTransform.p !== undefined) {
        const position = tuple3(rawTransform.p);
        if (position) {
          transform.p = [
            clamp(position[0], -12, 12),
            clamp(position[1], -1.5, 2.5),
            clamp(position[2], -12, 12),
          ];
        }
      }
      changes[bone] = transform;
    }

    const previous = byFrame.get(frameNumber);
    if (previous) {
      Object.assign(previous.changes, changes);
      previous.easing = easing(rawFrame.easing);
    } else {
      byFrame.set(frameNumber, { t: time, easing: easing(rawFrame.easing), changes });
    }
  }

  if (rawFrames.length > MAX_FRAMES) {
    warnings.push(`A resposta tinha mais de ${MAX_FRAMES} keyframes e foi reduzida.`);
  }

  return [...byFrame.values()].sort((a, b) => a.t - b.t);
}

function proceduralToRaw(frames: ProceduralMotionFrame[]): RawTextMotionFrame[] {
  return frames.map((frame) => ({
    t: frame.t,
    easing: frame.easing,
    bones: frame.bones,
  }));
}

function mergeSanitizedFrames(...groups: SanitizedFrame[][]): SanitizedFrame[] {
  const byTime = new Map<number, SanitizedFrame>();
  for (const group of groups) {
    for (const frame of group) {
      const key = Math.round(frame.t * 100000);
      const existing = byTime.get(key);
      if (existing) {
        Object.assign(existing.changes, frame.changes);
        existing.easing = frame.easing;
      } else {
        byTime.set(key, {
          t: frame.t,
          easing: frame.easing,
          changes: structuredClone(frame.changes),
        });
      }
    }
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

export function compileTextMotion(
  raw: RawTextMotionSpec,
  options: CompileTextMotionOptions,
): CompiledTextMotion {
  if (!raw || typeof raw !== 'object') throw new Error('A resposta do modelo não contém um movimento válido.');
  const warnings: string[] = [];
  const fps = clamp(Math.round(finiteNumber(options.fps, 30)), 1, 120);
  const sourceDuration = clamp(finiteNumber(raw.duration, DEFAULT_DURATION), 0.2, MAX_DURATION);
  const requestedDuration = Number(options.requestedDuration);
  const targetDuration = Number.isFinite(requestedDuration) && requestedDuration > 0
    ? clamp(requestedDuration, 0.2, MAX_DURATION)
    : sourceDuration;
  const loop = typeof options.requestedLoop === 'boolean'
    ? options.requestedLoop
    : raw.loop === true;

  const available = new Set(options.availableBones);
  const allowedBones = new Set(
    TEXT_MOTION_BONES.filter((bone) => available.size === 0 || available.has(bone)),
  );
  if (!allowedBones.size) throw new Error('O modelo VRM aberto não possui ossos humanoides compatíveis.');

  const procedural = compileSemanticActions(raw.actions, targetDuration, fps);
  warnings.push(...procedural.warnings);
  const semanticFrames = sanitizeFrames(
    proceduralToRaw(procedural.frames),
    allowedBones,
    targetDuration,
    targetDuration,
    fps,
    warnings,
  );
  const customFrames = sanitizeFrames(
    raw.frames,
    allowedBones,
    sourceDuration,
    targetDuration,
    fps,
    warnings,
  );
  const frames = mergeSanitizedFrames(customFrames, semanticFrames);
  if (!frames.length) {
    throw new Error('O modelo não produziu ações semânticas nem keyframes válidos.');
  }

  const usedBones = new Set<TextMotionBoneName>();
  for (const frame of frames) {
    for (const bone of Object.keys(frame.changes) as TextMotionBoneName[]) usedBones.add(bone);
  }
  for (const arm of ['leftUpperArm', 'rightUpperArm'] as TextMotionBoneName[]) {
    if (allowedBones.has(arm)) usedBones.add(arm);
  }

  const state = new Map<TextMotionBoneName, WorkingTransform>();
  for (const bone of usedBones) {
    state.set(bone, {
      r: baseRotation(bone),
      ...(bone === 'hips' ? { p: [0, 0, 0] as Vec3Tuple } : {}),
    });
  }

  if (frames[0].t > 0) {
    frames.unshift({ t: 0, easing: 'smooth', changes: {} });
    warnings.push('Foi adicionado um keyframe inicial em 0s.');
  }
  if (Math.abs(frames[frames.length - 1].t - targetDuration) > 1 / fps / 2) {
    frames.push({ t: targetDuration, easing: 'smooth', changes: {} });
    warnings.push('Foi adicionado um keyframe final na duração escolhida.');
  }

  const compiled: Keyframe[] = [];
  let firstPose: PoseSnapshot | null = null;
  for (const frame of frames) {
    for (const [bone, transform] of Object.entries(frame.changes) as Array<[TextMotionBoneName, WorkingTransform]>) {
      const previousTransform = state.get(bone);
      state.set(bone, {
        r: cloneTuple(transform.r),
        ...(transform.p
          ? { p: cloneTuple(transform.p) }
          : previousTransform?.p
            ? { p: cloneTuple(previousTransform.p) }
            : {}),
      });
    }
    const pose: PoseSnapshot = {};
    for (const [bone, transform] of state) {
      pose[bone] = {
        rotation: quatFromDegrees(transform.r),
        ...(bone === 'hips' && transform.p ? { position: cloneTuple(transform.p) } : {}),
      };
    }
    if (!firstPose) firstPose = structuredClone(pose);
    compiled.push({
      id: crypto.randomUUID(),
      time: clamp(frame.t, 0, targetDuration),
      pose,
      easing: frame.easing,
    });
  }

  if (loop && firstPose && compiled.length > 1) {
    compiled[compiled.length - 1] = {
      ...compiled[compiled.length - 1],
      time: targetDuration,
      pose: structuredClone(firstPose),
    };
  }

  const uniqueWarnings = [...new Set(warnings)].slice(0, 16);
  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : 'Movimento por texto',
    summary: typeof raw.summary === 'string' ? raw.summary.trim().slice(0, 240) : '',
    duration: targetDuration,
    loop,
    keyframes: compiled,
    boneCount: usedBones.size,
    actionsUsed: procedural.actionsUsed,
    warnings: uniqueWarnings,
  };
}
