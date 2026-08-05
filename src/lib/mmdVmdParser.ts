import * as THREE from 'three';
import { unzipSync } from 'fflate';
import type { QuatTuple, Vec3Tuple } from '../types';

export interface VmdBoneFrame {
  name: string;
  frame: number;
  time: number;
  position: Vec3Tuple;
  rotation: QuatTuple;
  interpolation: number[];
}

export interface VmdMorphFrame {
  name: string;
  frame: number;
  time: number;
  weight: number;
}

export interface ParsedVmd {
  modelName: string;
  boneFrameCount: number;
  morphFrameCount: number;
  cameraFrameCount: number;
  duration: number;
  maximumFrame: number;
  boneFrames: Map<string, VmdBoneFrame[]>;
  morphFrames: Map<string, VmdMorphFrame[]>;
}

export interface SampledVmdBone {
  position: Vec3Tuple;
  rotation: QuatTuple;
}

export interface MmdMotionSelection {
  files: File[];
  motions: File[];
  mappingFiles: File[];
  readmeFiles: File[];
}

export interface MmdExpressionMapping {
  sourceToTarget: Map<string, string>;
  mappedSources: string[];
  ignoredSources: string[];
}

interface VmdMorphMapJson {
  dataType?: string;
  morphs?: unknown;
  blendShapes?: unknown;
}

const VMD_FPS = 30;
const MAX_VMD_FRAMES = 5_000_000;
const PRESET_NAMES = new Set([
  'happy', 'angry', 'sad', 'relaxed', 'surprised',
  'aa', 'ih', 'ou', 'ee', 'oh',
  'blink', 'blinkLeft', 'blinkRight', 'neutral',
]);

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function mimeFor(name: string): string {
  if (/\.vmd$/i.test(name)) return 'application/octet-stream';
  if (/\.vpd$/i.test(name)) return 'text/plain';
  if (/\.json$/i.test(name)) return 'application/json';
  if (/\.txt$/i.test(name)) return 'text/plain';
  return 'application/octet-stream';
}

function relativePath(file: File): string {
  const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return path?.trim() || file.name;
}

function makeArchiveFile(path: string, bytes: Uint8Array): File {
  const normalized = path.replace(/\\/g, '/');
  const file = new File([copyBytes(bytes)], normalized, { type: mimeFor(normalized) });
  Object.defineProperty(file, 'webkitRelativePath', { value: normalized, configurable: true });
  return file;
}

export async function expandMmdMotionSelection(input: File[]): Promise<MmdMotionSelection> {
  const files: File[] = [];
  for (const source of input) {
    if (!/\.zip$/i.test(source.name)) {
      files.push(source);
      continue;
    }
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(new Uint8Array(await source.arrayBuffer()));
    } catch {
      throw new Error(`${source.name} não é um ZIP de movimento MMD válido.`);
    }
    for (const [path, bytes] of Object.entries(entries)) {
      if (path.endsWith('/') || !bytes.byteLength) continue;
      files.push(makeArchiveFile(path, bytes));
    }
  }

  const motions = files.filter((file) => /\.(vmd|vpd)$/i.test(relativePath(file)));
  const mappingFiles = files.filter((file) => /\.json$/i.test(relativePath(file)));
  const readmeFiles = files.filter((file) => /(?:readme|read me|説明|必ず)/i.test(relativePath(file)) && /\.txt$/i.test(relativePath(file)));
  return { files, motions, mappingFiles, readmeFiles };
}

function decodeShiftJis(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  const slice = end >= 0 ? bytes.subarray(0, end) : bytes;
  try {
    return new TextDecoder('shift_jis').decode(slice).trim();
  } catch {
    return new TextDecoder().decode(slice).trim();
  }
}

function requireBytes(offset: number, length: number, total: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > total) {
    throw new Error(`VMD truncado ao ler ${label}.`);
  }
}

function safeFrameCount(count: number, label: string): number {
  if (!Number.isInteger(count) || count < 0 || count > MAX_VMD_FRAMES) {
    throw new Error(`VMD inválido: ${label} contém ${count} registros.`);
  }
  return count;
}

export async function parseVmd(file: File): Promise<ParsedVmd> {
  const data = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  requireBytes(0, 54, data.byteLength, 'cabeçalho');
  const header = new TextDecoder('ascii').decode(data.subarray(0, 30)).replace(/\0/g, '').trim();
  if (!header.startsWith('Vocaloid Motion Data')) {
    throw new Error(`${file.name} não possui um cabeçalho VMD válido.`);
  }
  const modelName = decodeShiftJis(data.subarray(30, 50));
  let offset = 50;
  let maximumFrame = 0;

  const readCount = (label: string): number => {
    requireBytes(offset, 4, data.byteLength, label);
    const count = safeFrameCount(view.getUint32(offset, true), label);
    offset += 4;
    return count;
  };

  const boneFrameCount = readCount('quantidade de frames de ossos');
  const boneFrames = new Map<string, VmdBoneFrame[]>();
  for (let index = 0; index < boneFrameCount; index += 1) {
    requireBytes(offset, 111, data.byteLength, `frame de osso ${index + 1}`);
    const name = decodeShiftJis(data.subarray(offset, offset + 15));
    const frame = view.getUint32(offset + 15, true);
    const rawPosition: Vec3Tuple = [
      view.getFloat32(offset + 19, true),
      view.getFloat32(offset + 23, true),
      view.getFloat32(offset + 27, true),
    ];
    const rawRotation: QuatTuple = [
      view.getFloat32(offset + 31, true),
      view.getFloat32(offset + 35, true),
      view.getFloat32(offset + 39, true),
      view.getFloat32(offset + 43, true),
    ];
    const interpolation = Array.from(data.subarray(offset + 47, offset + 111));
    offset += 111;
    maximumFrame = Math.max(maximumFrame, frame);
    if (!name) continue;

    // MMD is left-handed. This matches mmd-parser/Three.js leftToRightVmd.
    const position: Vec3Tuple = [rawPosition[0], rawPosition[1], -rawPosition[2]];
    const quaternion = new THREE.Quaternion(-rawRotation[0], -rawRotation[1], rawRotation[2], rawRotation[3]).normalize();
    const entry: VmdBoneFrame = {
      name,
      frame,
      time: frame / VMD_FPS,
      position,
      rotation: quaternion.toArray() as QuatTuple,
      interpolation,
    };
    const list = boneFrames.get(name) ?? [];
    list.push(entry);
    boneFrames.set(name, list);
  }
  for (const list of boneFrames.values()) list.sort((a, b) => a.frame - b.frame);

  const morphFrameCount = readCount('quantidade de frames de morph');
  const morphFrames = new Map<string, VmdMorphFrame[]>();
  for (let index = 0; index < morphFrameCount; index += 1) {
    requireBytes(offset, 23, data.byteLength, `morph ${index + 1}`);
    const name = decodeShiftJis(data.subarray(offset, offset + 15));
    const frame = view.getUint32(offset + 15, true);
    const weight = Math.max(0, Math.min(1, view.getFloat32(offset + 19, true)));
    offset += 23;
    maximumFrame = Math.max(maximumFrame, frame);
    if (!name) continue;
    const entry: VmdMorphFrame = { name, frame, time: frame / VMD_FPS, weight };
    const list = morphFrames.get(name) ?? [];
    list.push(entry);
    morphFrames.set(name, list);
  }
  for (const list of morphFrames.values()) list.sort((a, b) => a.frame - b.frame);

  const cameraFrameCount = offset + 4 <= data.byteLength ? readCount('quantidade de frames de câmera') : 0;
  const cameraBytes = cameraFrameCount * 61;
  requireBytes(offset, cameraBytes, data.byteLength, 'frames de câmera');
  offset += cameraBytes;

  return {
    modelName,
    boneFrameCount,
    morphFrameCount,
    cameraFrameCount,
    duration: maximumFrame / VMD_FPS,
    maximumFrame,
    boneFrames,
    morphFrames,
  };
}

function cubicCoordinate(t: number, p1: number, p2: number): number {
  const inv = 1 - t;
  return 3 * inv * inv * t * p1 + 3 * inv * t * t * p2 + t * t * t;
}

function cubicBezierWeight(alpha: number, interpolation: number[], channel: number): number {
  const x1 = Math.max(0, Math.min(1, (interpolation[channel] ?? 20) / 127));
  const x2 = Math.max(0, Math.min(1, (interpolation[channel + 8] ?? 107) / 127));
  const y1 = Math.max(0, Math.min(1, (interpolation[channel + 4] ?? 20) / 127));
  const y2 = Math.max(0, Math.min(1, (interpolation[channel + 12] ?? 107) / 127));
  const target = Math.max(0, Math.min(1, alpha));
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 15; iteration += 1) {
    const middle = (low + high) * 0.5;
    if (cubicCoordinate(middle, x1, x2) < target) low = middle;
    else high = middle;
  }
  return cubicCoordinate((low + high) * 0.5, y1, y2);
}

function framePair(frames: VmdBoneFrame[], time: number): [VmdBoneFrame | null, VmdBoneFrame | null] {
  if (!frames.length) return [null, null];
  if (time <= frames[0].time) return [null, frames[0]];
  const last = frames[frames.length - 1];
  if (time >= last.time) return [last, null];
  let low = 0;
  let high = frames.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (frames[middle].time <= time) low = middle;
    else high = middle;
  }
  return [frames[low], frames[high]];
}

export function sampleVmdBoneTrack(frames: VmdBoneFrame[], time: number): SampledVmdBone {
  const [left, right] = framePair(frames, time);
  if (!left && !right) return { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  if (!left && right) {
    if (right.frame > 0) return { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    return { position: [...right.position] as Vec3Tuple, rotation: [...right.rotation] as QuatTuple };
  }
  if (left && !right) return { position: [...left.position] as Vec3Tuple, rotation: [...left.rotation] as QuatTuple };

  const a = left!;
  const b = right!;
  const span = Math.max(1e-6, b.time - a.time);
  const linearAlpha = Math.max(0, Math.min(1, (time - a.time) / span));
  // Three.js MMD interpolation intentionally holds the previous value for adjacent 30 FPS frames.
  const adjacent = span < (1 / VMD_FPS) * 1.5;
  const position: Vec3Tuple = [0, 0, 0];
  for (let axis = 0; axis < 3; axis += 1) {
    const weight = adjacent ? 0 : cubicBezierWeight(linearAlpha, b.interpolation, axis);
    position[axis] = a.position[axis] + (b.position[axis] - a.position[axis]) * weight;
  }
  const rotationWeight = adjacent ? 0 : cubicBezierWeight(linearAlpha, b.interpolation, 3);
  const qa = new THREE.Quaternion().fromArray(a.rotation);
  const qb = new THREE.Quaternion().fromArray(b.rotation);
  qa.slerp(qb, rotationWeight).normalize();
  return { position, rotation: qa.toArray() as QuatTuple };
}

function normalizeName(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_.\-:/\\()[\]{}]+/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

const GENERIC_MORPH_TARGETS: Record<string, string[]> = {
  笑い: ['happy'],
  にやり: ['happy'],
  にやり2: ['happy'],
  まばたき: ['blink'],
  ウィンク: ['blinkLeft'],
  ウィンク2: ['blinkLeft'],
  ウィンク右: ['blinkRight'],
  ウィンク2右: ['blinkRight'],
  びっくり: ['surprised'],
  悲しい: ['sad'],
  困る: ['sad'],
  怒り: ['angry'],
  じと目: ['angry', 'relaxed'],
  あ: ['aa'],
  い: ['ih'],
  う: ['ou'],
  え: ['ee'],
  お: ['oh'],
  'お-': ['oh'],
  a: ['aa'],
  i: ['ih'],
  u: ['ou'],
  e: ['ee'],
  o: ['oh'],
  blink: ['blink'],
  winkl: ['blinkLeft'],
  winkr: ['blinkRight'],
  happy: ['happy'],
  angry: ['angry'],
  sad: ['sad'],
  surprised: ['surprised'],
};

const TARGET_ALIASES: Record<string, string> = {
  a: 'aa', moutha: 'aa',
  i: 'ih', mouthi: 'ih',
  u: 'ou', mouthu: 'ou',
  e: 'ee', mouthe: 'ee',
  o: 'oh', moutho: 'oh',
  blink: 'blink', eyeclose: 'blink',
  winkl: 'blinkLeft', blinkl: 'blinkLeft', winkleft: 'blinkLeft',
  winkr: 'blinkRight', blinkr: 'blinkRight', winkright: 'blinkRight',
  eyesmile: 'happy', joy: 'happy', smile: 'happy',
  browangry: 'angry', eyeangry: 'angry',
  browtrouble: 'sad', eyesorrow: 'sad', sorrow: 'sad',
};

function availableLookup(availableExpressions: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const name of availableExpressions) result.set(normalizeName(name), name);
  return result;
}

function resolveTarget(candidate: string, available: Map<string, string>): string | null {
  const normalized = normalizeName(candidate);
  const direct = available.get(normalized);
  if (direct) return direct;
  const alias = TARGET_ALIASES[normalized];
  if (alias) {
    const target = available.get(normalizeName(alias));
    if (target) return target;
    if (PRESET_NAMES.has(alias)) return alias;
  }
  if (PRESET_NAMES.has(candidate)) return candidate;
  return null;
}

async function readMappingPairs(files: File[]): Promise<Array<[string, string]>> {
  const pairs: Array<[string, string]> = [];
  for (const file of files) {
    try {
      const json = JSON.parse(await file.text()) as VmdMorphMapJson;
      if (json.dataType !== 'VMDMorph' || !Array.isArray(json.morphs) || !Array.isArray(json.blendShapes)) continue;
      const length = Math.min(json.morphs.length, json.blendShapes.length);
      for (let index = 0; index < length; index += 1) {
        const source = String(json.morphs[index] ?? '').trim();
        const target = String(json.blendShapes[index] ?? '').trim();
        if (source && target) pairs.push([source, target]);
      }
    } catch {
      // Arquivos JSON não relacionados ao VMD são ignorados.
    }
  }
  return pairs;
}

export async function buildMmdExpressionMapping(
  parsed: ParsedVmd,
  availableExpressions: string[],
  mappingFiles: File[] = [],
): Promise<MmdExpressionMapping> {
  const available = availableLookup(availableExpressions);
  const packagePairs = await readMappingPairs(mappingFiles);
  const packageTargets = new Map<string, string[]>();
  for (const [source, target] of packagePairs) {
    const key = normalizeName(source);
    const list = packageTargets.get(key) ?? [];
    list.push(target);
    packageTargets.set(key, list);
  }

  const sourceToTarget = new Map<string, string>();
  const ignoredSources: string[] = [];
  for (const source of parsed.morphFrames.keys()) {
    const candidates = [
      ...(packageTargets.get(normalizeName(source)) ?? []),
      source,
      ...(GENERIC_MORPH_TARGETS[source.normalize('NFKC')] ?? []),
      ...(GENERIC_MORPH_TARGETS[normalizeName(source)] ?? []),
    ];
    let target: string | null = null;
    for (const candidate of candidates) {
      target = resolveTarget(candidate, available);
      if (target) break;
    }
    if (target) sourceToTarget.set(source, target);
    else ignoredSources.push(source);
  }

  return {
    sourceToTarget,
    mappedSources: [...sourceToTarget.keys()],
    ignoredSources,
  };
}

function sampleFrames(frames: VmdMorphFrame[], time: number): number {
  if (!frames.length) return 0;
  if (time <= frames[0].time) return frames[0].time <= 1e-6 ? frames[0].weight : 0;
  const last = frames[frames.length - 1];
  if (time >= last.time) return last.weight;
  let low = 0;
  let high = frames.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (frames[middle].time <= time) low = middle;
    else high = middle;
  }
  const left = frames[low];
  const right = frames[high];
  const span = Math.max(1e-6, right.time - left.time);
  const alpha = Math.max(0, Math.min(1, (time - left.time) / span));
  return left.weight + (right.weight - left.weight) * alpha;
}

export function sampleMmdExpressions(
  parsed: ParsedVmd,
  mapping: MmdExpressionMapping,
  time: number,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [source, target] of mapping.sourceToTarget) {
    const frames = parsed.morphFrames.get(source);
    if (!frames) continue;
    const weight = Math.max(0, Math.min(1, sampleFrames(frames, time)));
    result[target] = Math.max(result[target] ?? 0, weight);
  }
  return result;
}
