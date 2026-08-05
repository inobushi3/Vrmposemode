import { HUMAN_BONES, REQUIRED_VRMA_BONES } from '../constants';
import type { Keyframe, PoseSnapshot, QuatTuple, Vec3Tuple } from '../types';
import { useEditorStore } from '../store';

interface ExportOptions {
  name: string;
  keyframes: Keyframe[];
  duration: number;
  interpolation: 'LINEAR' | 'STEP';
  sourceMetaVersion?: '0' | '1';
}

interface BufferView {
  buffer: number;
  byteOffset: number;
  byteLength: number;
}

interface Accessor {
  bufferView: number;
  byteOffset: number;
  componentType: number;
  count: number;
  type: 'SCALAR' | 'VEC3' | 'VEC4';
  min?: number[];
  max?: number[];
}

class BinaryBuilder {
  private chunks: Uint8Array[] = [];
  private length = 0;

  appendFloat32(values: number[]): { byteOffset: number; byteLength: number } {
    this.align(4);
    const array = new Float32Array(values);
    const bytes = new Uint8Array(array.buffer.slice(0));
    const byteOffset = this.length;
    this.chunks.push(bytes);
    this.length += bytes.byteLength;
    return { byteOffset, byteLength: bytes.byteLength };
  }

  private align(alignment: number): void {
    const padding = (alignment - (this.length % alignment)) % alignment;
    if (!padding) return;
    this.chunks.push(new Uint8Array(padding));
    this.length += padding;
  }

  build(): Uint8Array {
    this.align(4);
    const output = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }
}

const IDENTITY: QuatTuple = [0, 0, 0, 1];
const ZERO: Vec3Tuple = [0, 0, 0];
const EXPRESSION_PRESETS = new Set([
  'happy', 'angry', 'sad', 'relaxed', 'surprised',
  'aa', 'ih', 'ou', 'ee', 'oh',
  'blink', 'blinkLeft', 'blinkRight', 'neutral',
]);
const BLOCKED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function normalizeQuaternion(q: QuatTuple): QuatTuple {
  const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

function canonicalRotation(rotation: QuatTuple, sourceMetaVersion?: '0' | '1'): QuatTuple {
  const normalized = normalizeQuaternion(rotation);
  if (sourceMetaVersion !== '0') return normalized;
  return [-normalized[0], normalized[1], -normalized[2], normalized[3]];
}

function canonicalPosition(position: Vec3Tuple, sourceMetaVersion?: '0' | '1'): Vec3Tuple {
  if (sourceMetaVersion !== '0') return position;
  return [-position[0], position[1], -position[2]];
}

function ensureFrames(keyframes: Keyframe[], duration: number): Keyframe[] {
  const frames = [...keyframes].sort((a, b) => a.time - b.time);
  if (frames.length === 0) throw new Error('Adicione pelo menos um keyframe antes de exportar.');
  if (frames.length === 1) {
    frames.push({ ...structuredClone(frames[0]), id: `${frames[0].id}-end`, time: Math.max(0.001, duration) });
  }
  return frames;
}

function poseValue(
  pose: PoseSnapshot,
  bone: string,
  sourceMetaVersion?: '0' | '1',
): { rotation: QuatTuple; position: Vec3Tuple } {
  const value = pose[bone];
  return {
    rotation: canonicalRotation(value?.rotation ?? IDENTITY, sourceMetaVersion),
    position: canonicalPosition(value?.position ?? ZERO, sourceMetaVersion),
  };
}

function expressionValue(frame: Keyframe, name: string): number {
  return Math.max(0, Math.min(1, Number(frame.expressions?.[name]) || 0));
}

export function exportVrma(options: ExportOptions): ArrayBuffer {
  const frames = ensureFrames(options.keyframes, options.duration);
  const times = frames.map((frame) => Math.max(0, frame.time));
  const maxTime = Math.max(...times, 0.001);
  const sourceMetaVersion = options.sourceMetaVersion
    ?? useEditorStore.getState().modelInfo?.metaVersion;

  const animatedBones = new Set<string>(REQUIRED_VRMA_BONES);
  const animatedExpressions = new Set<string>();
  for (const frame of frames) {
    for (const bone of Object.keys(frame.pose)) animatedBones.add(bone);
    for (const name of Object.keys(frame.expressions ?? {})) {
      if (name && !BLOCKED_OBJECT_KEYS.has(name)) animatedExpressions.add(name);
    }
  }
  const bones = HUMAN_BONES.filter((bone) => animatedBones.has(bone));
  const expressionNames = [...animatedExpressions].sort((a, b) => a.localeCompare(b));

  const builder = new BinaryBuilder();
  const bufferViews: BufferView[] = [];
  const accessors: Accessor[] = [];

  const addAccessor = (values: number[], type: Accessor['type'], count: number, min?: number[], max?: number[]): number => {
    const chunk = builder.appendFloat32(values);
    const bufferView = bufferViews.push({ buffer: 0, byteOffset: chunk.byteOffset, byteLength: chunk.byteLength }) - 1;
    return accessors.push({ bufferView, byteOffset: 0, componentType: 5126, count, type, min, max }) - 1;
  };

  const timeAccessor = addAccessor(times, 'SCALAR', times.length, [Math.min(...times)], [maxTime]);
  const nodes: Array<{ name: string; translation?: Vec3Tuple }> = bones.map((bone) => ({ name: bone }));
  const humanBones: Record<string, { node: number }> = {};
  bones.forEach((bone, index) => { humanBones[bone] = { node: index }; });

  const samplers: Array<{ input: number; output: number; interpolation: 'LINEAR' | 'STEP' }> = [];
  const channels: Array<{ sampler: number; target: { node: number; path: 'rotation' | 'translation' } }> = [];

  bones.forEach((bone, nodeIndex) => {
    const rotations = frames.flatMap((frame) => poseValue(frame.pose, bone, sourceMetaVersion).rotation);
    const rotationAccessor = addAccessor(rotations, 'VEC4', frames.length);
    const sampler = samplers.push({ input: timeAccessor, output: rotationAccessor, interpolation: options.interpolation }) - 1;
    channels.push({ sampler, target: { node: nodeIndex, path: 'rotation' } });
  });

  const hipsIndex = bones.indexOf('hips');
  if (hipsIndex >= 0) {
    const translations = frames.flatMap((frame) => poseValue(frame.pose, 'hips', sourceMetaVersion).position);
    const translationAccessor = addAccessor(translations, 'VEC3', frames.length);
    const sampler = samplers.push({ input: timeAccessor, output: translationAccessor, interpolation: options.interpolation }) - 1;
    channels.push({ sampler, target: { node: hipsIndex, path: 'translation' } });
  }

  const expressionPreset: Record<string, { node: number }> = Object.create(null) as Record<string, { node: number }>;
  const expressionCustom: Record<string, { node: number }> = Object.create(null) as Record<string, { node: number }>;
  for (const name of expressionNames) {
    const nodeIndex = nodes.push({ name: `expression:${name}`, translation: [0, 0, 0] }) - 1;
    const values = frames.flatMap((frame) => [expressionValue(frame, name), 0, 0]);
    const accessor = addAccessor(values, 'VEC3', frames.length);
    const sampler = samplers.push({ input: timeAccessor, output: accessor, interpolation: options.interpolation }) - 1;
    channels.push({ sampler, target: { node: nodeIndex, path: 'translation' } });
    if (EXPRESSION_PRESETS.has(name)) expressionPreset[name] = { node: nodeIndex };
    else expressionCustom[name] = { node: nodeIndex };
  }

  const animationExtension: {
    specVersion: string;
    humanoid: { humanBones: Record<string, { node: number }> };
    expressions?: {
      preset?: Record<string, { node: number }>;
      custom?: Record<string, { node: number }>;
    };
  } = {
    specVersion: '1.0',
    humanoid: { humanBones },
  };
  if (expressionNames.length) {
    animationExtension.expressions = {
      ...(Object.keys(expressionPreset).length ? { preset: expressionPreset } : {}),
      ...(Object.keys(expressionCustom).length ? { custom: expressionCustom } : {}),
    };
  }

  const binary = builder.build();
  const gltf = {
    asset: { version: '2.0', generator: 'VRM Pose Mode 1.0' },
    extensionsUsed: ['VRMC_vrm_animation'],
    extensionsRequired: ['VRMC_vrm_animation'],
    extensions: {
      VRMC_vrm_animation: animationExtension,
    },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, index) => index) }],
    nodes,
    animations: [{ name: options.name || 'VRM Animation', samplers, channels }],
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews,
    accessors,
  };

  const encoder = new TextEncoder();
  const jsonRaw = encoder.encode(JSON.stringify(gltf));
  const jsonPadding = (4 - (jsonRaw.byteLength % 4)) % 4;
  const json = new Uint8Array(jsonRaw.byteLength + jsonPadding);
  json.set(jsonRaw);
  json.fill(0x20, jsonRaw.byteLength);

  const totalLength = 12 + 8 + json.byteLength + 8 + binary.byteLength;
  const output = new ArrayBuffer(totalLength);
  const view = new DataView(output);
  const bytes = new Uint8Array(output);
  let offset = 0;

  view.setUint32(offset, 0x46546c67, true); offset += 4;
  view.setUint32(offset, 2, true); offset += 4;
  view.setUint32(offset, totalLength, true); offset += 4;
  view.setUint32(offset, json.byteLength, true); offset += 4;
  view.setUint32(offset, 0x4e4f534a, true); offset += 4;
  bytes.set(json, offset); offset += json.byteLength;
  view.setUint32(offset, binary.byteLength, true); offset += 4;
  view.setUint32(offset, 0x004e4942, true); offset += 4;
  bytes.set(binary, offset);

  return output;
}
