import * as THREE from 'three';
import type { Keyframe, PoseSnapshot, QuatTuple, Vec3Tuple } from '../types';

export interface BuiltinMotionDefinition {
  id: string;
  name: string;
  description: string;
  duration: number;
  loop: boolean;
}

interface MotionBuildOptions {
  startTime: number;
  availableBones: string[];
  targetMetaVersion?: '0' | '1';
}

type EulerDegrees = readonly [number, number, number];

interface FrameDefinition {
  time: number;
  hipsPosition: Vec3Tuple;
  rotations: Record<string, EulerDegrees>;
}

export const BUILTIN_MOTIONS: BuiltinMotionDefinition[] = [
  {
    id: 'shy-anger',
    name: 'raiva de timidez',
    description: 'Loop curto com corpo encolhido, punhos alternados e tremor de irritação tímida.',
    duration: 1.2,
    loop: true,
  },
];

function canonicalQuaternion(rotation: EulerDegrees): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(rotation[0]),
    THREE.MathUtils.degToRad(rotation[1]),
    THREE.MathUtils.degToRad(rotation[2]),
    'XYZ',
  )).normalize();
}

function targetQuaternion(rotation: EulerDegrees, targetMetaVersion?: '0' | '1'): QuatTuple {
  const quaternion = canonicalQuaternion(rotation);
  if (targetMetaVersion === '0') {
    quaternion.set(-quaternion.x, quaternion.y, -quaternion.z, quaternion.w).normalize();
  }
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

function targetPosition(position: Vec3Tuple, targetMetaVersion?: '0' | '1'): Vec3Tuple {
  return targetMetaVersion === '0'
    ? [-position[0], position[1], -position[2]]
    : [position[0], position[1], position[2]];
}

function commonRotations(): Record<string, EulerDegrees> {
  return {
    hips: [2, 0, 0],
    spine: [7, 0, 0],
    chest: [8, 0, 0],
    upperChest: [9, 0, 0],
    neck: [4, 0, 0],
    head: [11, 0, -2],
    leftShoulder: [0, 0, 7],
    rightShoulder: [0, 0, -7],
    leftUpperArm: [10, -12, 54],
    rightUpperArm: [10, 12, -54],
    leftLowerArm: [0, -14, -106],
    rightLowerArm: [0, 14, 106],
    leftHand: [12, -8, -8],
    rightHand: [12, 8, 8],
    leftUpperLeg: [3, 0, -2],
    rightUpperLeg: [3, 0, 2],
    leftLowerLeg: [4, 0, 0],
    rightLowerLeg: [4, 0, 0],
  };
}

function shyAngerFrames(): FrameDefinition[] {
  const base = commonRotations();
  const frame = (
    time: number,
    hipsPosition: Vec3Tuple,
    overrides: Record<string, EulerDegrees>,
  ): FrameDefinition => ({
    time,
    hipsPosition,
    rotations: { ...base, ...overrides },
  });

  return [
    frame(0, [0, 0, 0], {
      head: [11, -2, -2],
      leftUpperArm: [10, -12, 53],
      rightUpperArm: [10, 12, -56],
      leftLowerArm: [0, -14, -108],
      rightLowerArm: [0, 14, 102],
    }),
    frame(0.12, [0, -0.025, 0], {
      hips: [4, 0, 0],
      spine: [10, 0, 0],
      chest: [11, 0, 0],
      upperChest: [12, 0, 0],
      head: [14, 0, 0],
      leftShoulder: [0, 0, 10],
      rightShoulder: [0, 0, -10],
      leftUpperArm: [12, -14, 57],
      rightUpperArm: [12, 14, -57],
      leftLowerArm: [0, -16, -114],
      rightLowerArm: [0, 16, 114],
    }),
    frame(0.25, [-0.012, 0.008, 0], {
      hips: [1, 0, -1],
      spine: [8, 0, -2],
      chest: [9, 0, -3],
      upperChest: [10, 0, -4],
      head: [12, -4, 3],
      leftShoulder: [0, 0, 12],
      rightShoulder: [0, 0, -5],
      leftUpperArm: [7, -18, 47],
      rightUpperArm: [12, 9, -59],
      leftLowerArm: [0, -20, -122],
      rightLowerArm: [0, 11, 96],
      leftHand: [15, -12, -13],
      rightHand: [9, 5, 5],
    }),
    frame(0.38, [0, -0.02, 0], {
      hips: [4, 0, 0],
      spine: [10, 0, 0],
      chest: [11, 0, 0],
      upperChest: [12, 0, 0],
      head: [14, 2, -1],
      leftUpperArm: [11, -13, 58],
      rightUpperArm: [11, 13, -56],
      leftLowerArm: [0, -15, -112],
      rightLowerArm: [0, 15, 112],
    }),
    frame(0.55, [0.012, 0.008, 0], {
      hips: [1, 0, 1],
      spine: [8, 0, 2],
      chest: [9, 0, 3],
      upperChest: [10, 0, 4],
      head: [12, 4, -3],
      leftShoulder: [0, 0, 5],
      rightShoulder: [0, 0, -12],
      leftUpperArm: [12, -9, 59],
      rightUpperArm: [7, 18, -47],
      leftLowerArm: [0, -11, -96],
      rightLowerArm: [0, 20, 122],
      leftHand: [9, -5, -5],
      rightHand: [15, 12, 13],
    }),
    frame(0.68, [0, -0.024, 0], {
      hips: [4, 0, 0],
      spine: [10, 0, 0],
      chest: [11, 0, 0],
      upperChest: [12, 0, 0],
      head: [14, -2, 1],
      leftUpperArm: [11, -14, 56],
      rightUpperArm: [11, 14, -58],
      leftLowerArm: [0, -15, -114],
      rightLowerArm: [0, 15, 112],
    }),
    frame(0.82, [-0.008, 0.006, 0], {
      spine: [8, 0, -1],
      chest: [9, 0, -2],
      upperChest: [10, 0, -2],
      head: [12, -3, 2],
      leftUpperArm: [8, -17, 49],
      rightUpperArm: [12, 10, -58],
      leftLowerArm: [0, -19, -120],
      rightLowerArm: [0, 12, 98],
    }),
    frame(0.96, [0.008, -0.012, 0], {
      spine: [9, 0, 1],
      chest: [10, 0, 2],
      upperChest: [11, 0, 2],
      head: [13, 3, -2],
      leftUpperArm: [12, -10, 58],
      rightUpperArm: [8, 17, -49],
      leftLowerArm: [0, -12, -98],
      rightLowerArm: [0, 19, 120],
    }),
    frame(1.08, [0, -0.012, 0], {
      hips: [3, 0, 0],
      spine: [9, 0, 0],
      chest: [10, 0, 0],
      upperChest: [11, 0, 0],
      head: [13, 0, 0],
      leftUpperArm: [11, -13, 56],
      rightUpperArm: [11, 13, -56],
      leftLowerArm: [0, -15, -112],
      rightLowerArm: [0, 15, 112],
    }),
    frame(1.2, [0, 0, 0], {
      head: [11, -2, -2],
      leftUpperArm: [10, -12, 53],
      rightUpperArm: [10, 12, -56],
      leftLowerArm: [0, -14, -108],
      rightLowerArm: [0, 14, 102],
    }),
  ];
}

function buildPose(
  definition: FrameDefinition,
  available: Set<string>,
  targetMetaVersion?: '0' | '1',
): PoseSnapshot {
  const pose: PoseSnapshot = {};
  for (const [bone, rotation] of Object.entries(definition.rotations)) {
    if (!available.has(bone)) continue;
    pose[bone] = { rotation: targetQuaternion(rotation, targetMetaVersion) };
  }
  if (pose.hips) pose.hips.position = targetPosition(definition.hipsPosition, targetMetaVersion);
  return pose;
}

export function createBuiltinMotion(
  id: string,
  options: MotionBuildOptions,
): Keyframe[] {
  if (id !== 'shy-anger') throw new Error(`Movimentação interna desconhecida: ${id}.`);
  const available = new Set(options.availableBones);
  const frames = shyAngerFrames();
  return frames.map((definition) => ({
    id: crypto.randomUUID(),
    time: options.startTime + definition.time,
    pose: buildPose(definition, available, options.targetMetaVersion),
    easing: 'smooth',
  }));
}
