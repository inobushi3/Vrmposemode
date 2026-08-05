import { unzipSync } from 'fflate';

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
  morphFrames: Map<string, VmdMorphFrame[]>;
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

  const readCount = (label: string): number => {
    requireBytes(offset, 4, data.byteLength, label);
    const count = view.getUint32(offset, true);
    offset += 4;
    return count;
  };

  const boneFrameCount = readCount('quantidade de frames de ossos');
  const boneBytes = boneFrameCount * 111;
  requireBytes(offset, boneBytes, data.byteLength, 'frames de ossos');
  offset += boneBytes;

  const morphFrameCount = readCount('quantidade de frames de morph');
  const morphFrames = new Map<string, VmdMorphFrame[]>();
  let maximumFrame = 0;
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
    morphFrames,
  };
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
