import * as THREE from 'three';
import type { Keyframe, PoseSnapshot, QuatTuple, Vec3Tuple } from '../types';

export interface PosePoint {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  presence?: number;
}

export interface DetectedPoseFrame {
  time: number;
  normalized: PosePoint[];
  world: PosePoint[];
  confidence: number;
}

export interface RetargetOptions {
  mirror: boolean;
  confidenceThreshold: number;
  smoothing: number;
  rootMotion: boolean;
}

const IDENTITY = new THREE.Quaternion();
const X_POS = new THREE.Vector3(1, 0, 0);
const X_NEG = new THREE.Vector3(-1, 0, 0);
const Y_POS = new THREE.Vector3(0, 1, 0);
const Y_NEG = new THREE.Vector3(0, -1, 0);
const Z_POS = new THREE.Vector3(0, 0, 1);

const MIRROR_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16],
  [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32],
];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function confidence(point: PosePoint | undefined): number {
  if (!point) return 0;
  return clamp01(Math.min(point.visibility ?? 1, point.presence ?? 1));
}

function minimumConfidence(points: PosePoint[], indices: number[]): number {
  return indices.reduce((result, index) => Math.min(result, confidence(points[index])), 1);
}

function averageConfidence(points: PosePoint[], indices: number[]): number {
  if (!indices.length) return 0;
  return indices.reduce((sum, index) => sum + confidence(points[index]), 0) / indices.length;
}

function midpoint(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 {
  return a.clone().add(b).multiplyScalar(0.5);
}

function safeDirection(from: THREE.Vector3, to: THREE.Vector3, fallback: THREE.Vector3): THREE.Vector3 {
  const direction = to.clone().sub(from);
  return direction.lengthSq() > 1e-8 ? direction.normalize() : fallback.clone();
}

function toThree(point: PosePoint | undefined): THREE.Vector3 {
  if (!point) return new THREE.Vector3();
  return new THREE.Vector3(point.x, -point.y, -point.z);
}

function quaternionTuple(value: THREE.Quaternion): QuatTuple {
  const normalized = value.clone().normalize();
  return [normalized.x, normalized.y, normalized.z, normalized.w];
}

function basisQuaternion(xInput: THREE.Vector3, yInput: THREE.Vector3, fallback: THREE.Quaternion): THREE.Quaternion {
  const x = xInput.clone().normalize();
  let y = yInput.clone().sub(x.clone().multiplyScalar(yInput.dot(x)));
  if (x.lengthSq() < 1e-8 || y.lengthSq() < 1e-8) return fallback.clone();
  y.normalize();
  const z = x.clone().cross(y).normalize();
  if (z.lengthSq() < 1e-8) return fallback.clone();
  y = z.clone().cross(x).normalize();
  const matrix = new THREE.Matrix4().makeBasis(x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(matrix).normalize();
}

function localFromWorld(parentWorld: THREE.Quaternion, world: THREE.Quaternion): THREE.Quaternion {
  return parentWorld.clone().invert().multiply(world).normalize();
}

function aimLocal(parentWorld: THREE.Quaternion, restAxis: THREE.Vector3, worldDirection: THREE.Vector3): THREE.Quaternion {
  const localDirection = worldDirection.clone().applyQuaternion(parentWorld.clone().invert()).normalize();
  if (localDirection.lengthSq() < 1e-8) return IDENTITY.clone();
  return new THREE.Quaternion().setFromUnitVectors(restAxis, localDirection).normalize();
}

function resolveRotation(
  bone: string,
  candidate: THREE.Quaternion,
  score: number,
  threshold: number,
  previous: PoseSnapshot | undefined,
): THREE.Quaternion {
  if (score >= threshold) return candidate.normalize();
  const prior = previous?.[bone]?.rotation;
  return prior ? new THREE.Quaternion().fromArray(prior).normalize() : IDENTITY.clone();
}

function setRotation(pose: PoseSnapshot, bone: string, rotation: THREE.Quaternion): void {
  pose[bone] = { rotation: quaternionTuple(rotation) };
}

function mirrored(points: PosePoint[], normalized: boolean): PosePoint[] {
  const result = points.map((point) => ({ ...point, x: normalized ? 1 - point.x : -point.x }));
  for (const [left, right] of MIRROR_PAIRS) {
    const temporary = result[left];
    result[left] = result[right];
    result[right] = temporary;
  }
  return result;
}

export function mirrorDetectedFrame(frame: DetectedPoseFrame): DetectedPoseFrame {
  return {
    ...frame,
    normalized: mirrored(frame.normalized, true),
    world: mirrored(frame.world, false),
  };
}

export function detectedFrameConfidence(points: PosePoint[]): number {
  return averageConfidence(points, [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]);
}

function retargetFrame(
  inputFrame: DetectedPoseFrame,
  options: RetargetOptions,
  previousPose: PoseSnapshot | undefined,
  rootOrigin: THREE.Vector2,
): PoseSnapshot {
  const frame = options.mirror ? mirrorDetectedFrame(inputFrame) : inputFrame;
  const world = frame.world;
  const normalized = frame.normalized;
  const threshold = options.confidenceThreshold;
  const pose: PoseSnapshot = {};

  const nose = toThree(world[0]);
  const leftEar = toThree(world[7]);
  const rightEar = toThree(world[8]);
  const leftShoulder = toThree(world[11]);
  const rightShoulder = toThree(world[12]);
  const leftElbow = toThree(world[13]);
  const rightElbow = toThree(world[14]);
  const leftWrist = toThree(world[15]);
  const rightWrist = toThree(world[16]);
  const leftPinky = toThree(world[17]);
  const rightPinky = toThree(world[18]);
  const leftIndex = toThree(world[19]);
  const rightIndex = toThree(world[20]);
  const leftHip = toThree(world[23]);
  const rightHip = toThree(world[24]);
  const leftKnee = toThree(world[25]);
  const rightKnee = toThree(world[26]);
  const leftAnkle = toThree(world[27]);
  const rightAnkle = toThree(world[28]);
  const leftHeel = toThree(world[29]);
  const rightHeel = toThree(world[30]);
  const leftFootIndex = toThree(world[31]);
  const rightFootIndex = toThree(world[32]);

  const hipCenter = midpoint(leftHip, rightHip);
  const shoulderCenter = midpoint(leftShoulder, rightShoulder);
  const torsoUp = safeDirection(hipCenter, shoulderCenter, Y_POS);
  const hipAxis = safeDirection(rightHip, leftHip, X_POS);
  const shoulderAxis = safeDirection(rightShoulder, leftShoulder, hipAxis);

  const pelvisCandidate = basisQuaternion(hipAxis, torsoUp, IDENTITY);
  const pelvisScore = minimumConfidence(world, [11, 12, 23, 24]);
  const hipsLocal = resolveRotation('hips', pelvisCandidate, pelvisScore, threshold, previousPose);
  const hipsWorld = hipsLocal.clone();
  setRotation(pose, 'hips', hipsLocal);

  if (options.rootMotion) {
    const normalizedHip = {
      x: ((normalized[23]?.x ?? 0.5) + (normalized[24]?.x ?? 0.5)) * 0.5,
      y: ((normalized[23]?.y ?? 0.5) + (normalized[24]?.y ?? 0.5)) * 0.5,
    };
    const normalizedShoulder = {
      x: ((normalized[11]?.x ?? 0.5) + (normalized[12]?.x ?? 0.5)) * 0.5,
      y: ((normalized[11]?.y ?? 0.5) + (normalized[12]?.y ?? 0.5)) * 0.5,
    };
    const scale = Math.max(0.08, Math.hypot(normalizedShoulder.x - normalizedHip.x, normalizedShoulder.y - normalizedHip.y));
    const position: Vec3Tuple = [
      ((normalizedHip.x - rootOrigin.x) / scale) * 0.35,
      (-(normalizedHip.y - rootOrigin.y) / scale) * 0.35,
      0,
    ];
    pose.hips.position = position;
  }

  const chestCandidate = basisQuaternion(shoulderAxis, torsoUp, hipsWorld);
  const chestScore = minimumConfidence(world, [11, 12, 23, 24]);
  const chestWorldTarget = chestScore >= threshold ? chestCandidate : hipsWorld.clone();
  const spineWorldCandidate = hipsWorld.clone().slerp(chestWorldTarget, 0.42);
  const spineLocal = resolveRotation('spine', localFromWorld(hipsWorld, spineWorldCandidate), chestScore, threshold, previousPose);
  const spineWorld = hipsWorld.clone().multiply(spineLocal);
  setRotation(pose, 'spine', spineLocal);

  const chestWorldCandidate = hipsWorld.clone().slerp(chestWorldTarget, 0.76);
  const chestLocal = resolveRotation('chest', localFromWorld(spineWorld, chestWorldCandidate), chestScore, threshold, previousPose);
  const chestWorld = spineWorld.clone().multiply(chestLocal);
  setRotation(pose, 'chest', chestLocal);

  const upperChestLocal = resolveRotation('upperChest', localFromWorld(chestWorld, chestWorldTarget), chestScore, threshold, previousPose);
  const upperChestWorld = chestWorld.clone().multiply(upperChestLocal);
  setRotation(pose, 'upperChest', upperChestLocal);

  const earCenter = midpoint(leftEar, rightEar);
  const headX = safeDirection(rightEar, leftEar, shoulderAxis);
  let headForward = nose.clone().sub(earCenter);
  headForward.sub(headX.clone().multiplyScalar(headForward.dot(headX)));
  if (headForward.lengthSq() < 1e-8) headForward = Z_POS.clone().applyQuaternion(upperChestWorld);
  headForward.normalize();
  let headY = headForward.clone().cross(headX).normalize();
  if (headY.lengthSq() < 1e-8) headY = Y_POS.clone().applyQuaternion(upperChestWorld);
  const headCandidate = basisQuaternion(headX, headY, upperChestWorld);
  const headScore = minimumConfidence(world, [0, 7, 8, 11, 12]);
  const headWorldTarget = headScore >= threshold ? headCandidate : upperChestWorld.clone();
  const neckWorldCandidate = upperChestWorld.clone().slerp(headWorldTarget, 0.45);
  const neckLocal = resolveRotation('neck', localFromWorld(upperChestWorld, neckWorldCandidate), headScore, threshold, previousPose);
  const neckWorld = upperChestWorld.clone().multiply(neckLocal);
  setRotation(pose, 'neck', neckLocal);
  const headLocal = resolveRotation('head', localFromWorld(neckWorld, headWorldTarget), headScore, threshold, previousPose);
  setRotation(pose, 'head', headLocal);

  const applyArm = (
    side: 'left' | 'right',
    shoulder: THREE.Vector3,
    elbow: THREE.Vector3,
    wrist: THREE.Vector3,
    index: THREE.Vector3,
    pinky: THREE.Vector3,
    indices: [number, number, number, number, number],
  ): void => {
    const signAxis = side === 'left' ? X_POS : X_NEG;
    const shoulderName = `${side}Shoulder`;
    const upperName = `${side}UpperArm`;
    const lowerName = `${side}LowerArm`;
    const handName = `${side}Hand`;

    const shoulderDirection = safeDirection(shoulderCenter, shoulder, signAxis.clone().applyQuaternion(upperChestWorld));
    const shoulderCandidate = aimLocal(upperChestWorld, signAxis, shoulderDirection);
    const shoulderScore = minimumConfidence(world, [indices[0], side === 'left' ? 12 : 11]);
    const shoulderLocal = resolveRotation(shoulderName, shoulderCandidate, shoulderScore, threshold, previousPose);
    const shoulderWorld = upperChestWorld.clone().multiply(shoulderLocal);
    setRotation(pose, shoulderName, shoulderLocal);

    const upperDirection = safeDirection(shoulder, elbow, signAxis.clone().applyQuaternion(shoulderWorld));
    const upperCandidate = aimLocal(shoulderWorld, signAxis, upperDirection);
    const upperScore = minimumConfidence(world, [indices[0], indices[1]]);
    const upperLocal = resolveRotation(upperName, upperCandidate, upperScore, threshold, previousPose);
    const upperWorld = shoulderWorld.clone().multiply(upperLocal);
    setRotation(pose, upperName, upperLocal);

    const lowerDirection = safeDirection(elbow, wrist, signAxis.clone().applyQuaternion(upperWorld));
    const lowerCandidate = aimLocal(upperWorld, signAxis, lowerDirection);
    const lowerScore = minimumConfidence(world, [indices[1], indices[2]]);
    const lowerLocal = resolveRotation(lowerName, lowerCandidate, lowerScore, threshold, previousPose);
    const lowerWorld = upperWorld.clone().multiply(lowerLocal);
    setRotation(pose, lowerName, lowerLocal);

    const handCenter = midpoint(index, pinky);
    const handDirection = safeDirection(wrist, handCenter, signAxis.clone().applyQuaternion(lowerWorld));
    const handCandidate = aimLocal(lowerWorld, signAxis, handDirection);
    const handScore = minimumConfidence(world, [indices[2], indices[3], indices[4]]);
    const handLocal = resolveRotation(handName, handCandidate, handScore, threshold, previousPose);
    setRotation(pose, handName, handLocal);
  };

  applyArm('left', leftShoulder, leftElbow, leftWrist, leftIndex, leftPinky, [11, 13, 15, 19, 17]);
  applyArm('right', rightShoulder, rightElbow, rightWrist, rightIndex, rightPinky, [12, 14, 16, 20, 18]);

  const applyLeg = (
    side: 'left' | 'right',
    hip: THREE.Vector3,
    knee: THREE.Vector3,
    ankle: THREE.Vector3,
    heel: THREE.Vector3,
    footIndex: THREE.Vector3,
    indices: [number, number, number, number, number],
  ): void => {
    const upperName = `${side}UpperLeg`;
    const lowerName = `${side}LowerLeg`;
    const footName = `${side}Foot`;
    const toesName = `${side}Toes`;

    const upperDirection = safeDirection(hip, knee, Y_NEG.clone().applyQuaternion(hipsWorld));
    const upperCandidate = aimLocal(hipsWorld, Y_NEG, upperDirection);
    const upperScore = minimumConfidence(world, [indices[0], indices[1]]);
    const upperLocal = resolveRotation(upperName, upperCandidate, upperScore, threshold, previousPose);
    const upperWorld = hipsWorld.clone().multiply(upperLocal);
    setRotation(pose, upperName, upperLocal);

    const lowerDirection = safeDirection(knee, ankle, Y_NEG.clone().applyQuaternion(upperWorld));
    const lowerCandidate = aimLocal(upperWorld, Y_NEG, lowerDirection);
    const lowerScore = minimumConfidence(world, [indices[1], indices[2]]);
    const lowerLocal = resolveRotation(lowerName, lowerCandidate, lowerScore, threshold, previousPose);
    const lowerWorld = upperWorld.clone().multiply(lowerLocal);
    setRotation(pose, lowerName, lowerLocal);

    const footTarget = midpoint(heel, footIndex);
    const footDirection = safeDirection(ankle, footTarget, Z_POS.clone().applyQuaternion(lowerWorld));
    const footCandidate = aimLocal(lowerWorld, Z_POS, footDirection);
    const footScore = minimumConfidence(world, [indices[2], indices[3], indices[4]]);
    const footLocal = resolveRotation(footName, footCandidate, footScore, threshold, previousPose);
    const footWorld = lowerWorld.clone().multiply(footLocal);
    setRotation(pose, footName, footLocal);

    const toeDirection = safeDirection(heel, footIndex, Z_POS.clone().applyQuaternion(footWorld));
    const toesCandidate = aimLocal(footWorld, Z_POS, toeDirection);
    const toesLocal = resolveRotation(toesName, toesCandidate, footScore, threshold, previousPose);
    setRotation(pose, toesName, toesLocal);
  };

  applyLeg('left', leftHip, leftKnee, leftAnkle, leftHeel, leftFootIndex, [23, 25, 27, 29, 31]);
  applyLeg('right', rightHip, rightKnee, rightAnkle, rightHeel, rightFootIndex, [24, 26, 28, 30, 32]);

  return pose;
}

function smoothPose(previous: PoseSnapshot | undefined, next: PoseSnapshot, smoothing: number): PoseSnapshot {
  if (!previous || smoothing <= 0) return next;
  const amount = Math.max(0.05, 1 - clamp01(smoothing));
  const result: PoseSnapshot = {};
  const names = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const name of names) {
    const before = previous[name] ?? next[name];
    const after = next[name] ?? previous[name];
    if (!before || !after) continue;
    const rotation = new THREE.Quaternion().fromArray(before.rotation)
      .slerp(new THREE.Quaternion().fromArray(after.rotation), amount)
      .normalize();
    result[name] = { rotation: quaternionTuple(rotation) };
    if (before.position || after.position) {
      const start = new THREE.Vector3().fromArray(before.position ?? [0, 0, 0]);
      const end = new THREE.Vector3().fromArray(after.position ?? [0, 0, 0]);
      result[name].position = start.lerp(end, amount).toArray() as Vec3Tuple;
    }
  }
  return result;
}

export function retargetDetectedFrames(frames: DetectedPoseFrame[], options: RetargetOptions): Keyframe[] {
  if (!frames.length) return [];
  const firstFrame = options.mirror ? mirrorDetectedFrame(frames[0]) : frames[0];
  const rootOrigin = new THREE.Vector2(
    ((firstFrame.normalized[23]?.x ?? 0.5) + (firstFrame.normalized[24]?.x ?? 0.5)) * 0.5,
    ((firstFrame.normalized[23]?.y ?? 0.5) + (firstFrame.normalized[24]?.y ?? 0.5)) * 0.5,
  );

  let previous: PoseSnapshot | undefined;
  return frames.map((frame) => {
    const raw = retargetFrame(frame, options, previous, rootOrigin);
    const pose = smoothPose(previous, raw, options.smoothing);
    previous = pose;
    return {
      id: crypto.randomUUID(),
      time: frame.time,
      pose,
      easing: 'smooth',
    };
  });
}
