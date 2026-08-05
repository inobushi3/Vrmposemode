import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMAnimationLoaderPlugin, type VRMAnimation } from '@pixiv/three-vrm-animation';
import type { Keyframe, PoseSnapshot, QuatTuple, Vec3Tuple } from '../types';
import { useEditorStore } from '../store';

interface TrackSampler {
  evaluate: (time: number) => ArrayLike<number>;
}

interface InterpolatableTrack extends THREE.KeyframeTrack {
  createInterpolant: (result: Float32Array) => TrackSampler;
}

export interface VrmaImportOptions {
  availableBones: string[];
  sampleFps: number;
  rootMotion: boolean;
  rootScale: number;
  targetMetaVersion?: '0' | '1';
}

export interface ImportedVrma {
  name: string;
  duration: number;
  sourceDuration: number;
  sourceBones: number;
  importedBones: number;
  keyframes: Keyframe[];
  effectiveFps: number;
  warnings: string[];
}

const MAX_KEYFRAMES = 12000;

function safeName(fileName: string): string {
  return fileName.replace(/\.vrma$/i, '').trim() || 'Movimento VRMA';
}

function createSampler(track: THREE.KeyframeTrack): TrackSampler {
  const buffer = new Float32Array(track.getValueSize());
  return (track as InterpolatableTrack).createInterpolant(buffer);
}

function quaternionTuple(value: ArrayLike<number>, targetMetaVersion?: '0' | '1'): QuatTuple {
  const vrm0 = targetMetaVersion === '0';
  const quaternion = new THREE.Quaternion(
    (Number(value[0]) || 0) * (vrm0 ? -1 : 1),
    Number(value[1]) || 0,
    (Number(value[2]) || 0) * (vrm0 ? -1 : 1),
    Number(value[3]) || 1,
  ).normalize();
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

function relativeHipsPosition(
  value: ArrayLike<number>,
  rest: THREE.Vector3,
  scale: number,
  targetMetaVersion?: '0' | '1',
): Vec3Tuple {
  const axisSign = targetMetaVersion === '0' ? -1 : 1;
  return [
    (Number(value[0]) - rest.x) * scale * axisSign,
    (Number(value[1]) - rest.y) * scale,
    (Number(value[2]) - rest.z) * scale * axisSign,
  ];
}

async function loadVrma(data: ArrayBuffer): Promise<VRMAnimation> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  const url = URL.createObjectURL(new Blob([data], { type: 'model/gltf-binary' }));
  try {
    const gltf = await loader.loadAsync(url);
    const animations = gltf.userData.vrmAnimations as VRMAnimation[] | undefined;
    const animation = animations?.[0];
    if (!animation) {
      throw new Error('O arquivo não contém a extensão oficial VRMC_vrm_animation.');
    }
    return animation;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function inspectVrma(data: ArrayBuffer): Promise<{
  duration: number;
  boneCount: number;
  hasRootMotion: boolean;
}> {
  const animation = await loadVrma(data);
  return {
    duration: Math.max(0, animation.duration),
    boneCount: animation.humanoidTracks.rotation.size,
    hasRootMotion: animation.humanoidTracks.translation.has('hips'),
  };
}

export async function importVrma(
  fileName: string,
  data: ArrayBuffer,
  options: VrmaImportOptions,
): Promise<ImportedVrma> {
  const animation = await loadVrma(data);
  const sourceDuration = Number(animation.duration);
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
    throw new Error('A animação VRMA não possui duração válida.');
  }

  const targetMetaVersion = options.targetMetaVersion
    ?? useEditorStore.getState().modelInfo?.metaVersion;
  const warnings: string[] = [];
  const requestedFps = Math.max(1, Math.min(120, Math.round(options.sampleFps || 30)));
  const maximumFps = Math.max(1, Math.floor((MAX_KEYFRAMES - 1) / sourceDuration));
  const effectiveFps = Math.min(requestedFps, maximumFps);
  if (effectiveFps < requestedFps) {
    warnings.push(`A amostragem foi reduzida para ${effectiveFps} FPS para limitar a timeline a ${MAX_KEYFRAMES} keyframes.`);
  }

  const available = new Set(options.availableBones);
  const rotationSamplers = new Map<string, TrackSampler>();
  for (const [bone, track] of animation.humanoidTracks.rotation) {
    if (available.has(bone)) rotationSamplers.set(bone, createSampler(track));
  }
  if (!rotationSamplers.size) {
    throw new Error('Nenhum osso humanoide do VRMA existe no modelo VRM aberto.');
  }

  const hipsTrack = animation.humanoidTracks.translation.get('hips');
  const hipsSampler = hipsTrack ? createSampler(hipsTrack) : null;
  const rootScale = Math.max(0, Math.min(3, Number(options.rootScale) || 1));
  const frameCount = Math.max(1, Math.ceil(sourceDuration * effectiveFps));
  const keyframes: Keyframe[] = [];

  for (let frame = 0; frame <= frameCount; frame += 1) {
    const time = frame === frameCount ? sourceDuration : frame / effectiveFps;
    const pose: PoseSnapshot = {};
    for (const [bone, sampler] of rotationSamplers) {
      pose[bone] = {
        rotation: quaternionTuple(sampler.evaluate(time), targetMetaVersion),
      };
    }
    if (pose.hips && options.rootMotion && hipsSampler) {
      pose.hips.position = relativeHipsPosition(
        hipsSampler.evaluate(time),
        animation.restHipsPosition,
        rootScale,
        targetMetaVersion,
      );
    }
    keyframes.push({
      id: crypto.randomUUID(),
      time,
      pose,
      easing: 'linear',
    });
  }

  if (!hipsSampler) warnings.push('Este VRMA não possui deslocamento do quadril; o movimento ficará no lugar.');
  if (!options.rootMotion && hipsSampler) warnings.push('O deslocamento do quadril foi removido pela configuração de root motion.');
  if (targetMetaVersion === '0') {
    warnings.push('Conversão de eixos VRM 0 aplicada ao root motion e às rotações normalizadas.');
  }
  const ignoredBones = animation.humanoidTracks.rotation.size - rotationSamplers.size;
  if (ignoredBones > 0) warnings.push(`${ignoredBones} canal(is) foram ignorados porque o modelo aberto não possui esses ossos.`);
  if (animation.expressionTracks.preset.size || animation.expressionTracks.custom.size) {
    warnings.push('Expressões faciais do VRMA ainda não entram na timeline corporal.');
  }
  if (animation.lookAtTrack) warnings.push('O canal de olhar do VRMA ainda não entra na timeline corporal.');

  return {
    name: safeName(fileName),
    duration: sourceDuration,
    sourceDuration,
    sourceBones: animation.humanoidTracks.rotation.size,
    importedBones: rotationSamplers.size,
    keyframes,
    effectiveFps,
    warnings,
  };
}
