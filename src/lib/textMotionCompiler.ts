import * as THREE from 'three';
import type { Keyframe, PoseSnapshot, QuatTuple, Vec3Tuple } from '../types';
import {
  compileSemanticActions,
  normalizedRelaxedPose,
  type ProceduralMotionFrame,
  type SemanticMotionActionType,
} from './vrmSemanticMotion';

export const TEXT_MOTION_BONES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
] as const;

export const REQUIRED_TEXT_MOTION_BONES = [
  'hips', 'spine', 'head',
  'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
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
interface WorkingTransform { r: Vec3Tuple; p?: Vec3Tuple }
interface SanitizedFrame {
  t: number;
  easing: TextMotionEasing;
  changes: Partial<Record<TextMotionBoneName, WorkingTransform>>;
}

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
const MAX_DURATION = 300;
const MAX_CUSTOM_FRAMES = 720;
const DEG_TO_RAD = Math.PI / 180;

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clone3(value: Vec3Tuple): Vec3Tuple {
  return [value[0], value[1], value[2]];
}

function tuple3(value: unknown): Vec3Tuple | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const values = value.map(Number);
  return values.every(Number.isFinite) ? values as Vec3Tuple : null;
}

function easing(value: unknown): TextMotionEasing {
  return value === 'linear' || value === 'step' ? value : 'smooth';
}

function quaternion(rotation: Vec3Tuple): QuatTuple {
  const value = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    rotation[0] * DEG_TO_RAD,
    rotation[1] * DEG_TO_RAD,
    rotation[2] * DEG_TO_RAD,
    'XYZ',
  )).normalize();
  return [value.x, value.y, value.z, value.w];
}

function baseRotation(bone: TextMotionBoneName): Vec3Tuple {
  const relaxed = normalizedRelaxedPose()[bone];
  return relaxed ? clone3(relaxed.r) : [0, 0, 0];
}

function clampRotation(
  bone: TextMotionBoneName,
  rotation: Vec3Tuple,
  warnings: string[],
): Vec3Tuple {
  const limits = ROTATION_LIMITS[bone] ?? DEFAULT_LIMIT;
  const result: Vec3Tuple = [
    clamp(rotation[0], -limits[0], limits[0]),
    clamp(rotation[1], -limits[1], limits[1]),
    clamp(rotation[2], -limits[2], limits[2]),
  ];
  if (bone === 'leftLowerLeg' || bone === 'rightLowerLeg') {
    result[0] = clamp(rotation[0], -3, 150);
    result[1] = clamp(rotation[1], -15, 15);
    result[2] = clamp(rotation[2], -15, 15);
  }
  if (bone === 'leftLowerArm' || bone === 'rightLowerArm') {
    result[0] = clamp(rotation[0], -25, 25);
  }
  if (result.some((value, index) => Math.abs(value - rotation[index]) > 0.001)) {
    warnings.push(`Rotação fora do limite corrigida em ${bone}.`);
  }
  return result;
}

function proceduralFrames(frames: ProceduralMotionFrame[]): RawTextMotionFrame[] {
  return frames.map((frame) => ({ t: frame.t, easing: frame.easing, bones: frame.bones }));
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
  const timeScale = targetDuration / Math.max(0.001, sourceDuration);
  const byFrame = new Map<number, SanitizedFrame>();

  for (const raw of rawFrames.slice(0, MAX_CUSTOM_FRAMES) as RawTextMotionFrame[]) {
    const rawTime = finiteNumber(raw?.t, Number.NaN);
    if (!Number.isFinite(rawTime)) continue;
    const frameNumber = Math.round(clamp(rawTime * timeScale, 0, targetDuration) * fps);
    const t = frameNumber / fps;
    const changes: SanitizedFrame['changes'] = {};
    if (!raw?.bones || typeof raw.bones !== 'object' || Array.isArray(raw.bones)) continue;

    for (const [name, rawTransform] of Object.entries(raw.bones as Record<string, RawBoneTransform>)) {
      if (!TEXT_MOTION_BONES.includes(name as TextMotionBoneName) || !allowedBones.has(name)) continue;
      if (!rawTransform || typeof rawTransform !== 'object') continue;
      const bone = name as TextMotionBoneName;
      const transform: WorkingTransform = {
        r: clampRotation(bone, tuple3(rawTransform.r) ?? baseRotation(bone), warnings),
      };
      if (bone === 'hips') {
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

    const existing = byFrame.get(frameNumber);
    if (existing) {
      Object.assign(existing.changes, changes);
      existing.easing = easing(raw.easing);
    } else {
      byFrame.set(frameNumber, { t, easing: easing(raw.easing), changes });
    }
  }

  if (rawFrames.length > MAX_CUSTOM_FRAMES) {
    warnings.push(`A resposta excedeu ${MAX_CUSTOM_FRAMES} keyframes e foi reduzida.`);
  }
  return [...byFrame.values()].sort((a, b) => a.t - b.t);
}

function mergeFrames(...groups: SanitizedFrame[][]): SanitizedFrame[] {
  const byTime = new Map<number, SanitizedFrame>();
  for (const group of groups) {
    for (const frame of group) {
      const key = Math.round(frame.t * 100000);
      const existing = byTime.get(key);
      if (existing) {
        Object.assign(existing.changes, frame.changes);
        existing.easing = frame.easing;
      } else {
        byTime.set(key, structuredClone(frame));
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

  const available = new Set(options.availableBones);
  const missing = REQUIRED_TEXT_MOTION_BONES.filter((bone) => !available.has(bone));
  if (missing.length) {
    throw new Error(`O VRM não possui todos os ossos humanoides obrigatórios: ${missing.join(', ')}.`);
  }

  const fps = clamp(Math.round(finiteNumber(options.fps, 30)), 1, 120);
  const sourceDuration = clamp(finiteNumber(raw.duration, 4), 0.2, MAX_DURATION);
  const requestedDuration = Number(options.requestedDuration);
  const duration = Number.isFinite(requestedDuration) && requestedDuration > 0
    ? clamp(requestedDuration, 0.2, MAX_DURATION)
    : sourceDuration;
  const loop = typeof options.requestedLoop === 'boolean'
    ? options.requestedLoop
    : raw.loop === true;
  const allowedBones = new Set(TEXT_MOTION_BONES.filter((bone) => available.has(bone)));
  const warnings: string[] = [];

  const semantic = compileSemanticActions(raw.actions, duration, fps);
  warnings.push(...semantic.warnings);
  const custom = sanitizeFrames(raw.frames, allowedBones, sourceDuration, duration, fps, warnings);
  const deterministic = sanitizeFrames(
    proceduralFrames(semantic.frames),
    allowedBones,
    duration,
    duration,
    fps,
    warnings,
  );

  // Free-form LLM details are merged first. Deterministic actions are merged
  // last and therefore own direction, step count, locomotion and final poses.
  const frames = mergeFrames(custom, deterministic);
  if (!frames.length) throw new Error('Nenhuma ação ou pose válida foi produzida.');

  const usedBones = new Set<TextMotionBoneName>();
  for (const frame of frames) {
    for (const bone of Object.keys(frame.changes) as TextMotionBoneName[]) usedBones.add(bone);
  }

  const relaxed = normalizedRelaxedPose();
  const state = new Map<TextMotionBoneName, WorkingTransform>();
  for (const bone of usedBones) {
    const base = relaxed[bone];
    state.set(bone, {
      r: base ? clone3(base.r) : [0, 0, 0],
      ...(bone === 'hips' ? { p: [0, 0, 0] as Vec3Tuple } : {}),
    });
  }

  if (frames[0].t > 0) frames.unshift({ t: 0, easing: 'smooth', changes: {} });
  if (Math.abs(frames[frames.length - 1].t - duration) > 1 / fps / 2) {
    frames.push({ t: duration, easing: 'smooth', changes: {} });
  }

  const keyframes: Keyframe[] = [];
  let firstPose: PoseSnapshot | null = null;
  for (const frame of frames) {
    for (const [bone, next] of Object.entries(frame.changes) as Array<[TextMotionBoneName, WorkingTransform]>) {
      const previous = state.get(bone);
      state.set(bone, {
        r: clone3(next.r),
        ...(next.p ? { p: clone3(next.p) } : previous?.p ? { p: clone3(previous.p) } : {}),
      });
    }

    const pose: PoseSnapshot = {};
    for (const [bone, transform] of state) {
      pose[bone] = {
        rotation: quaternion(transform.r),
        ...(bone === 'hips' && transform.p ? { position: clone3(transform.p) } : {}),
      };
    }
    if (!firstPose) firstPose = structuredClone(pose);
    keyframes.push({
      id: crypto.randomUUID(),
      time: clamp(frame.t, 0, duration),
      pose,
      easing: frame.easing,
    });
  }

  if (loop && firstPose && keyframes.length > 1) {
    keyframes[keyframes.length - 1] = {
      ...keyframes[keyframes.length - 1],
      time: duration,
      pose: structuredClone(firstPose),
    };
  }

  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : 'Movimento por texto',
    summary: typeof raw.summary === 'string' ? raw.summary.trim().slice(0, 240) : '',
    duration,
    loop,
    keyframes,
    boneCount: usedBones.size,
    actionsUsed: semantic.actionsUsed,
    warnings: [...new Set(warnings)].slice(0, 16),
  };
}
