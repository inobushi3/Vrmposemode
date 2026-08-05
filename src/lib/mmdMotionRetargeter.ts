import * as THREE from 'three';
import { VRMHumanBoneParentMap } from '@pixiv/three-vrm';
import { MMDAnimationHelper } from 'three-mmd-runtime/examples/jsm/animation/MMDAnimationHelper.js';
import type { HumanBoneName } from '../constants';
import type { Keyframe, PoseSnapshot, QuatTuple, Vec3Tuple } from '../types';
import {
  loadMmdModel,
  loadVmdOnMmdModel,
  loadVpdFile,
  type LoadedMmdModel,
} from './mmdModelLoader';
import { findMmdRootMotionNode, mapMmdHumanoidBones } from './mmdHumanoid';
import {
  buildMmdExpressionMapping,
  parseVmd,
  sampleMmdExpressions,
  type MmdExpressionMapping,
  type ParsedVmd,
} from './mmdVmdParser';

export interface MmdMotionRetargetOptions {
  sourceModelFiles: File[];
  motionFile: File;
  motionPackageFiles?: File[];
  availableBones: string[];
  availableExpressions: string[];
  sampleFps: number;
  rootMotion: boolean;
  rootScale: number;
  targetHeight: number;
  targetMetaVersion?: '0' | '1';
}

export interface RetargetedMmdMotion {
  name: string;
  sourceModel: string;
  sourceFormat: 'VMD' | 'VPD';
  duration: number;
  effectiveFps: number;
  mappedBones: number;
  mappedExpressions: number;
  sourceMorphs: number;
  keyframes: Keyframe[];
  hasRootMotion: boolean;
  warnings: string[];
}

interface RestBone {
  node: THREE.Object3D;
  worldRotation: THREE.Quaternion;
}

const MAX_KEYFRAMES = 12000;

function cleanName(fileName: string): string {
  const base = fileName.replace(/\\/g, '/').split('/').pop() ?? fileName;
  return base.replace(/\.(vmd|vpd)$/i, '').trim() || 'Movimento MMD';
}

function tupleQuaternion(value: THREE.Quaternion, vrm0: boolean): QuatTuple {
  const quaternion = value.clone().normalize();
  if (vrm0) quaternion.set(-quaternion.x, quaternion.y, -quaternion.z, quaternion.w).normalize();
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

function tuplePosition(value: THREE.Vector3, vrm0: boolean): Vec3Tuple {
  return vrm0
    ? [-value.x, value.y, -value.z]
    : [value.x, value.y, value.z];
}

function sourceBasis(
  mapped: Map<HumanBoneName, THREE.Object3D>,
  root: THREE.Object3D,
): THREE.Quaternion {
  const left = mapped.get('leftShoulder') ?? mapped.get('leftUpperArm') ?? mapped.get('leftUpperLeg');
  const right = mapped.get('rightShoulder') ?? mapped.get('rightUpperArm') ?? mapped.get('rightUpperLeg');
  const hips = mapped.get('hips');
  const head = mapped.get('head') ?? mapped.get('neck');
  if (!left || !right || !hips || !head) return root.getWorldQuaternion(new THREE.Quaternion()).normalize();

  const x = left.getWorldPosition(new THREE.Vector3())
    .sub(right.getWorldPosition(new THREE.Vector3()))
    .normalize();
  const yRaw = head.getWorldPosition(new THREE.Vector3())
    .sub(hips.getWorldPosition(new THREE.Vector3()));
  const y = yRaw.sub(x.clone().multiplyScalar(yRaw.dot(x))).normalize();
  const z = x.clone().cross(y).normalize();
  if (x.lengthSq() < 0.5 || y.lengthSq() < 0.5 || z.lengthSq() < 0.5) {
    return root.getWorldQuaternion(new THREE.Quaternion()).normalize();
  }
  const correctedY = z.clone().cross(x).normalize();
  return new THREE.Quaternion()
    .setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, correctedY, z))
    .normalize();
}

function sourceHeight(mapped: Map<HumanBoneName, THREE.Object3D>, root: THREE.Object3D): number {
  const head = mapped.get('head');
  const leftFoot = mapped.get('leftFoot');
  const rightFoot = mapped.get('rightFoot');
  if (head && (leftFoot || rightFoot)) {
    const headPosition = head.getWorldPosition(new THREE.Vector3());
    const footPosition = leftFoot && rightFoot
      ? leftFoot.getWorldPosition(new THREE.Vector3())
        .add(rightFoot.getWorldPosition(new THREE.Vector3()))
        .multiplyScalar(0.5)
      : (leftFoot ?? rightFoot)!.getWorldPosition(new THREE.Vector3());
    const measured = headPosition.distanceTo(footPosition);
    if (Number.isFinite(measured) && measured > 0.001) return measured;
  }
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  return Math.max(0.001, size.y || size.length() || 1);
}

function captureRest(mapped: Map<HumanBoneName, THREE.Object3D>): Map<HumanBoneName, RestBone> {
  const result = new Map<HumanBoneName, RestBone>();
  for (const [bone, node] of mapped) {
    result.set(bone, {
      node,
      worldRotation: node.getWorldQuaternion(new THREE.Quaternion()).normalize(),
    });
  }
  return result;
}

function parentWorldDelta(
  bone: HumanBoneName,
  worldDeltas: Map<HumanBoneName, THREE.Quaternion>,
): THREE.Quaternion {
  let parent = VRMHumanBoneParentMap[bone] as HumanBoneName | null;
  while (parent) {
    const delta = worldDeltas.get(parent);
    if (delta) return delta;
    parent = VRMHumanBoneParentMap[parent] as HumanBoneName | null;
  }
  return new THREE.Quaternion();
}

function capturePose(
  rest: Map<HumanBoneName, RestBone>,
  basis: THREE.Quaternion,
  rootNode: THREE.Object3D | null,
  rootOrigin: THREE.Vector3,
  rootScale: number,
  includeRoot: boolean,
  vrm0: boolean,
): PoseSnapshot {
  const inverseBasis = basis.clone().invert();
  const worldDeltas = new Map<HumanBoneName, THREE.Quaternion>();
  for (const [bone, state] of rest) {
    const current = state.node.getWorldQuaternion(new THREE.Quaternion()).normalize();
    const sourceDelta = current.multiply(state.worldRotation.clone().invert()).normalize();
    const canonicalDelta = inverseBasis.clone().multiply(sourceDelta).multiply(basis).normalize();
    worldDeltas.set(bone, canonicalDelta);
  }

  const pose: PoseSnapshot = {};
  for (const [bone, worldDelta] of worldDeltas) {
    const parentDelta = parentWorldDelta(bone, worldDeltas);
    const localDelta = parentDelta.clone().invert().multiply(worldDelta).normalize();
    pose[bone] = { rotation: tupleQuaternion(localDelta, vrm0) };
  }

  if (includeRoot && pose.hips && rootNode) {
    const displacement = rootNode.getWorldPosition(new THREE.Vector3())
      .sub(rootOrigin)
      .applyQuaternion(inverseBasis)
      .multiplyScalar(rootScale);
    pose.hips.position = tuplePosition(displacement, vrm0);
  }
  return pose;
}

function prepareSource(
  loaded: LoadedMmdModel,
  availableBones: string[],
  targetHeight: number,
  rootScale: number,
): {
  mapped: Map<HumanBoneName, THREE.Object3D>;
  rest: Map<HumanBoneName, RestBone>;
  basis: THREE.Quaternion;
  rootNode: THREE.Object3D | null;
  rootOrigin: THREE.Vector3;
  displacementScale: number;
} {
  const mesh = loaded.mesh;
  mesh.pose();
  mesh.updateMatrixWorld(true);
  const mapped = mapMmdHumanoidBones(mesh, new Set(availableBones));
  if (!mapped.size) {
    throw new Error('Nenhum osso humanoide padrão foi reconhecido no modelo MMD de origem.');
  }
  const basis = sourceBasis(mapped, mesh);
  const measuredHeight = sourceHeight(mapped, mesh);
  const safeTargetHeight = Math.max(0.5, Math.min(3, Number(targetHeight) || 1.65));
  const safeRootScale = Math.max(0, Math.min(3, Number(rootScale) || 1));
  const rootNode = findMmdRootMotionNode(mesh) ?? mapped.get('hips') ?? null;
  return {
    mapped,
    rest: captureRest(mapped),
    basis,
    rootNode,
    rootOrigin: rootNode?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(),
    displacementScale: (safeTargetHeight / measuredHeight) * safeRootScale,
  };
}

function warningsFor(loaded: LoadedMmdModel, mappedBones: number): string[] {
  const warnings = [...loaded.warnings];
  if (mappedBones < 15) {
    warnings.push(`Somente ${mappedBones} ossos humanoides foram reconhecidos. O resultado pode exigir correção manual.`);
  }
  return warnings;
}

function sampling(duration: number, requested: number): { effectiveFps: number; frameCount: number } {
  const requestedFps = Math.max(1, Math.min(60, Math.round(requested || 30)));
  const effectiveFps = Math.min(requestedFps, Math.max(1, Math.floor((MAX_KEYFRAMES - 1) / Math.max(duration, 1e-6))));
  return {
    effectiveFps,
    frameCount: Math.max(1, Math.ceil(duration * effectiveFps)),
  };
}

async function expressionMapping(
  parsed: ParsedVmd,
  options: MmdMotionRetargetOptions,
): Promise<MmdExpressionMapping> {
  const packageFiles = options.motionPackageFiles ?? [options.motionFile];
  return buildMmdExpressionMapping(
    parsed,
    options.availableExpressions,
    packageFiles.filter((file) => /\.json$/i.test(file.name)),
  );
}

function expressionWarnings(parsed: ParsedVmd, mapping: MmdExpressionMapping): string[] {
  const warnings: string[] = [];
  if (parsed.morphFrameCount > 0 && mapping.sourceToTarget.size === 0) {
    warnings.push('O VMD contém morphs faciais, mas nenhum deles corresponde às expressões disponíveis no VRM aberto.');
  } else if (mapping.ignoredSources.length > 0) {
    warnings.push(`${mapping.ignoredSources.length} morph(s) MMD não encontraram expressão equivalente no VRM e foram ignorados.`);
  }
  return warnings;
}

async function retargetMorphOnlyVmd(
  parsed: ParsedVmd,
  options: MmdMotionRetargetOptions,
): Promise<RetargetedMmdMotion> {
  if (parsed.morphFrameCount <= 0 || parsed.duration <= 0) {
    throw new Error('O VMD não contém movimento corporal nem morphs faciais animados.');
  }
  const mapping = await expressionMapping(parsed, options);
  if (!mapping.sourceToTarget.size) {
    throw new Error('Nenhum morph do VMD pôde ser associado às expressões do VRM aberto.');
  }
  const { effectiveFps, frameCount } = sampling(parsed.duration, options.sampleFps);
  const keyframes: Keyframe[] = [];
  for (let frame = 0; frame <= frameCount; frame += 1) {
    const time = frame === frameCount ? parsed.duration : frame / effectiveFps;
    keyframes.push({
      id: crypto.randomUUID(),
      time,
      pose: {},
      expressions: sampleMmdExpressions(parsed, mapping, time),
      easing: 'linear',
    });
  }
  return {
    name: cleanName(options.motionFile.name),
    sourceModel: 'VMD facial/lip — modelo MMD não necessário',
    sourceFormat: 'VMD',
    duration: parsed.duration,
    effectiveFps,
    mappedBones: 0,
    mappedExpressions: new Set(mapping.sourceToTarget.values()).size,
    sourceMorphs: parsed.morphFrames.size,
    keyframes,
    hasRootMotion: false,
    warnings: [
      ...expressionWarnings(parsed, mapping),
      'Este arquivo possui somente morphs de rosto/lábios. Ele foi convertido diretamente para canais de expressão VRMA.',
    ],
  };
}

async function retargetVmd(
  loaded: LoadedMmdModel,
  options: MmdMotionRetargetOptions,
  parsed: ParsedVmd,
): Promise<RetargetedMmdMotion> {
  const clip = await loadVmdOnMmdModel(loaded.mesh, options.motionFile);
  const duration = Math.max(Number(clip.duration) || 0, parsed.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('O VMD não contém uma duração de animação válida.');

  const source = prepareSource(
    loaded,
    options.availableBones,
    options.targetHeight,
    options.rootScale,
  );
  const { effectiveFps, frameCount } = sampling(duration, options.sampleFps);
  const mapping = await expressionMapping(parsed, options);
  const helper = new MMDAnimationHelper({ sync: false, pmxAnimation: true });
  helper.enabled.physics = false;
  helper.add(loaded.mesh, { animation: clip, physics: false, animationWarmup: false });

  const keyframes: Keyframe[] = [];
  const vrm0 = options.targetMetaVersion === '0';
  let previousSampleTime = 0;
  try {
    helper.update(0);
    for (let frame = 0; frame <= frameCount; frame += 1) {
      const timelineTime = frame === frameCount ? duration : frame / effectiveFps;
      const sampleTime = frame === frameCount
        ? Math.max(previousSampleTime, duration - 1e-5)
        : timelineTime;
      helper.update(Math.max(0, sampleTime - previousSampleTime));
      previousSampleTime = sampleTime;
      loaded.mesh.updateMatrixWorld(true);
      keyframes.push({
        id: crypto.randomUUID(),
        time: timelineTime,
        pose: capturePose(
          source.rest,
          source.basis,
          source.rootNode,
          source.rootOrigin,
          source.displacementScale,
          options.rootMotion,
          vrm0,
        ),
        ...(mapping.sourceToTarget.size
          ? { expressions: sampleMmdExpressions(parsed, mapping, timelineTime) }
          : {}),
        easing: 'linear',
      });
    }
  } finally {
    helper.remove(loaded.mesh);
  }

  const hasRootMotion = options.rootMotion && keyframes.some((frame) => {
    const position = frame.pose.hips?.position;
    return Boolean(position && Math.hypot(position[0], position[1], position[2]) > 0.001);
  });
  const warnings = [
    ...warningsFor(loaded, source.mapped.size),
    ...expressionWarnings(parsed, mapping),
  ];
  if (effectiveFps < Math.max(1, Math.min(60, Math.round(options.sampleFps || 30)))) {
    warnings.push(`Amostragem reduzida para ${effectiveFps} FPS para limitar a timeline.`);
  }
  warnings.push('IK e grants do modelo MMD de origem foram avaliados antes do retargeting. Física de cabelo e roupa não é exportada para VRMA.');

  return {
    name: cleanName(options.motionFile.name),
    sourceModel: loaded.modelFileName,
    sourceFormat: 'VMD',
    duration,
    effectiveFps,
    mappedBones: source.mapped.size,
    mappedExpressions: new Set(mapping.sourceToTarget.values()).size,
    sourceMorphs: parsed.morphFrames.size,
    keyframes,
    hasRootMotion,
    warnings,
  };
}

async function retargetVpd(
  loaded: LoadedMmdModel,
  options: MmdMotionRetargetOptions,
): Promise<RetargetedMmdMotion> {
  const source = prepareSource(
    loaded,
    options.availableBones,
    options.targetHeight,
    options.rootScale,
  );
  const vpd = await loadVpdFile(options.motionFile);
  const helper = new MMDAnimationHelper({ sync: false, pmxAnimation: true });
  helper.enabled.physics = false;
  helper.pose(loaded.mesh, vpd, { resetPose: true, ik: true, grant: true });
  loaded.mesh.updateMatrixWorld(true);

  const vrm0 = options.targetMetaVersion === '0';
  const pose = capturePose(
    source.rest,
    source.basis,
    source.rootNode,
    source.rootOrigin,
    source.displacementScale,
    options.rootMotion,
    vrm0,
  );
  const duration = 1 / Math.max(1, Math.min(60, Math.round(options.sampleFps || 30)));
  const keyframes: Keyframe[] = [
    { id: crypto.randomUUID(), time: 0, pose: structuredClone(pose), easing: 'step' },
    { id: crypto.randomUUID(), time: duration, pose: structuredClone(pose), easing: 'step' },
  ];
  return {
    name: cleanName(options.motionFile.name),
    sourceModel: loaded.modelFileName,
    sourceFormat: 'VPD',
    duration,
    effectiveFps: Math.round(1 / duration),
    mappedBones: source.mapped.size,
    mappedExpressions: 0,
    sourceMorphs: 0,
    keyframes,
    hasRootMotion: Boolean(pose.hips?.position),
    warnings: [
      ...warningsFor(loaded, source.mapped.size),
      'VPD é uma pose estática. Ela foi inserida como dois keyframes STEP para permanecer exportável como VRMA.',
    ],
  };
}

export async function retargetMmdMotion(options: MmdMotionRetargetOptions): Promise<RetargetedMmdMotion> {
  if (!/\.(vmd|vpd)$/i.test(options.motionFile.name)) {
    throw new Error('Selecione um movimento .vmd ou uma pose .vpd.');
  }

  if (/\.vmd$/i.test(options.motionFile.name)) {
    const parsed = await parseVmd(options.motionFile);
    if (parsed.boneFrameCount === 0 && parsed.morphFrameCount > 0) {
      return retargetMorphOnlyVmd(parsed, options);
    }
    if (parsed.boneFrameCount === 0 && parsed.morphFrameCount === 0) {
      throw new Error('Esse VMD não possui frames de ossos nem morphs faciais.');
    }
    if (!options.sourceModelFiles.length) {
      throw new Error('Este VMD contém movimento corporal. Selecione o PMX/PMD para resolver o esqueleto, IK e grants.');
    }
    const loaded = await loadMmdModel(options.sourceModelFiles);
    try {
      return await retargetVmd(loaded, options, parsed);
    } finally {
      loaded.release();
    }
  }

  if (!options.sourceModelFiles.length) {
    throw new Error('Uma pose VPD precisa do PMX/PMD de origem para resolver os nomes e o IK.');
  }
  const loaded = await loadMmdModel(options.sourceModelFiles);
  try {
    return await retargetVpd(loaded, options);
  } finally {
    loaded.release();
  }
}
