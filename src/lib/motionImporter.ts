import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMHumanBoneParentMap } from '@pixiv/three-vrm';
import { strFromU8, unzipSync } from 'fflate';
import { HUMAN_BONES, type HumanBoneName } from '../constants';
import type { Keyframe, PoseSnapshot, QuatTuple, Vec3Tuple } from '../types';
import { detectMotionFormat, isDirectlyConvertibleMotion, motionName, type MotionFormat } from './motionFormats';
import { importVrma, inspectVrma } from './vrmaImporter';

export interface MotionClipInfo {
  index: number;
  name: string;
  duration: number;
  embeddedPath?: string;
}

export interface MotionInspection {
  format: MotionFormat;
  name: string;
  author?: string;
  version?: string;
  convertible: boolean;
  clips: MotionClipInfo[];
  sourceBones: number;
  mappedBones: number;
  hasRootMotion: boolean;
  packageEntries?: string[];
  warnings: string[];
}

export interface MotionImportOptions {
  availableBones: string[];
  sampleFps: number;
  rootMotion: boolean;
  rootScale: number;
  clipIndex: number;
  targetHeight?: number;
  targetMetaVersion?: '0' | '1';
}

export interface ImportedMotion {
  name: string;
  format: MotionFormat;
  duration: number;
  sourceDuration: number;
  sourceBones: number;
  importedBones: number;
  keyframes: Keyframe[];
  effectiveFps: number;
  hasRootMotion: boolean;
  warnings: string[];
}

interface LoadedSource {
  root: THREE.Object3D;
  clips: THREE.AnimationClip[];
  format: Exclude<MotionFormat, 'vrma' | 'pmp' | 'pap'>;
}

interface SourceBoneRest {
  node: THREE.Object3D;
  restWorldRotation: THREE.Quaternion;
  restWorldPosition: THREE.Vector3;
}

interface RootMotionSource {
  node: THREE.Object3D;
  restWorldPosition: THREE.Vector3;
  trackName: string;
  amplitude: number;
}

interface ParsedTrackName {
  nodeName?: string;
  objectName?: string;
  objectIndex?: string | number;
  propertyName?: string;
}

const MAX_KEYFRAMES = 12000;
const DEFAULT_TARGET_HEIGHT = 1.65;
const DIRECT_PACKAGE_EXTENSIONS = new Set(['vrma', 'bvh', 'fbx', 'glb', 'gltf']);

const ALIASES: Record<HumanBoneName, string[]> = {
  hips: ['hips', 'hip', 'pelvis', 'j_kosi'],
  spine: ['spine', 'spine0', 'spine01', 'abdomen', 'lowerbody', 'j_sebo_a'],
  chest: ['chest', 'spine1', 'spine02', 'upperbody', 'upperbody1', 'j_sebo_b'],
  upperChest: ['upperchest', 'spine2', 'spine03', 'chest2', 'upperbody2', 'j_sebo_c'],
  neck: ['neck', 'neck1', 'j_kubi'],
  head: ['head', 'head1', 'j_kao'],
  jaw: ['jaw', 'chin', 'j_ago'],
  leftEye: ['lefteye', 'eyeleft', 'eye_l', 'j_f_eye_l'],
  rightEye: ['righteye', 'eyeright', 'eye_r', 'j_f_eye_r'],
  leftShoulder: ['leftshoulder', 'shoulderleft', 'shoulder_l', 'lshoulder', 'leftclavicle', 'clavicle_l', 'j_sako_l'],
  leftUpperArm: ['leftupperarm', 'leftarm', 'upperarmleft', 'upperarm_l', 'lupperarm', 'larm', 'j_ude_a_l'],
  leftLowerArm: ['leftlowerarm', 'leftforearm', 'forearmleft', 'forearm_l', 'lowerarm_l', 'lforearm', 'j_ude_b_l'],
  leftHand: ['lefthand', 'handleft', 'hand_l', 'lwrist', 'wrist_l', 'j_te_l'],
  rightShoulder: ['rightshoulder', 'shoulderright', 'shoulder_r', 'rshoulder', 'rightclavicle', 'clavicle_r', 'j_sako_r'],
  rightUpperArm: ['rightupperarm', 'rightarm', 'upperarmright', 'upperarm_r', 'rupperarm', 'rarm', 'j_ude_a_r'],
  rightLowerArm: ['rightlowerarm', 'rightforearm', 'forearmright', 'forearm_r', 'lowerarm_r', 'rforearm', 'j_ude_b_r'],
  rightHand: ['righthand', 'handright', 'hand_r', 'rwrist', 'wrist_r', 'j_te_r'],
  leftUpperLeg: ['leftupperleg', 'leftupleg', 'leftthigh', 'thighleft', 'thigh_l', 'lthigh', 'j_asi_a_l'],
  leftLowerLeg: ['leftlowerleg', 'leftleg', 'leftcalf', 'calfleft', 'calf_l', 'lcalf', 'shin_l', 'j_asi_b_l'],
  leftFoot: ['leftfoot', 'footleft', 'foot_l', 'lfoot', 'ankle_l', 'j_asi_c_l'],
  leftToes: ['lefttoes', 'lefttoebase', 'toeleft', 'toe_l', 'ltoe', 'j_asi_d_l'],
  rightUpperLeg: ['rightupperleg', 'rightupleg', 'rightthigh', 'thighright', 'thigh_r', 'rthigh', 'j_asi_a_r'],
  rightLowerLeg: ['rightlowerleg', 'rightleg', 'rightcalf', 'calfright', 'calf_r', 'rcalf', 'shin_r', 'j_asi_b_r'],
  rightFoot: ['rightfoot', 'footright', 'foot_r', 'rfoot', 'ankle_r', 'j_asi_c_r'],
  rightToes: ['righttoes', 'righttoebase', 'toeright', 'toe_r', 'rtoe', 'j_asi_d_r'],
  leftThumbMetacarpal: ['leftthumbmetacarpal', 'leftthumb0', 'thumb0_l'],
  leftThumbProximal: ['leftthumbproximal', 'leftthumb1', 'thumb1_l'],
  leftThumbDistal: ['leftthumbdistal', 'leftthumb2', 'thumb2_l', 'thumb3_l'],
  leftIndexProximal: ['leftindexproximal', 'leftindex1', 'index1_l'],
  leftIndexIntermediate: ['leftindexintermediate', 'leftindex2', 'index2_l'],
  leftIndexDistal: ['leftindexdistal', 'leftindex3', 'index3_l'],
  leftMiddleProximal: ['leftmiddleproximal', 'leftmiddle1', 'middle1_l'],
  leftMiddleIntermediate: ['leftmiddleintermediate', 'leftmiddle2', 'middle2_l'],
  leftMiddleDistal: ['leftmiddledistal', 'leftmiddle3', 'middle3_l'],
  leftRingProximal: ['leftringproximal', 'leftring1', 'ring1_l'],
  leftRingIntermediate: ['leftringintermediate', 'leftring2', 'ring2_l'],
  leftRingDistal: ['leftringdistal', 'leftring3', 'ring3_l'],
  leftLittleProximal: ['leftlittleproximal', 'leftpinky1', 'leftlittle1', 'pinky1_l'],
  leftLittleIntermediate: ['leftlittleintermediate', 'leftpinky2', 'leftlittle2', 'pinky2_l'],
  leftLittleDistal: ['leftlittledistal', 'leftpinky3', 'leftlittle3', 'pinky3_l'],
  rightThumbMetacarpal: ['rightthumbmetacarpal', 'rightthumb0', 'thumb0_r'],
  rightThumbProximal: ['rightthumbproximal', 'rightthumb1', 'thumb1_r'],
  rightThumbDistal: ['rightthumbdistal', 'rightthumb2', 'thumb2_r', 'thumb3_r'],
  rightIndexProximal: ['rightindexproximal', 'rightindex1', 'index1_r'],
  rightIndexIntermediate: ['rightindexintermediate', 'rightindex2', 'index2_r'],
  rightIndexDistal: ['rightindexdistal', 'rightindex3', 'index3_r'],
  rightMiddleProximal: ['rightmiddleproximal', 'rightmiddle1', 'middle1_r'],
  rightMiddleIntermediate: ['rightmiddleintermediate', 'rightmiddle2', 'middle2_r'],
  rightMiddleDistal: ['rightmiddledistal', 'rightmiddle3', 'middle3_r'],
  rightRingProximal: ['rightringproximal', 'rightring1', 'ring1_r'],
  rightRingIntermediate: ['rightringintermediate', 'rightring2', 'ring2_r'],
  rightRingDistal: ['rightringdistal', 'rightring3', 'ring3_r'],
  rightLittleProximal: ['rightlittleproximal', 'rightpinky1', 'rightlittle1', 'pinky1_r'],
  rightLittleIntermediate: ['rightlittleintermediate', 'rightpinky2', 'rightlittle2', 'pinky2_r'],
  rightLittleDistal: ['rightlittledistal', 'rightpinky3', 'rightlittle3', 'pinky3_r'],
};

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/^mixamorig[:_\-]*/i, '')
    .replace(/^armature[|:_\-]*/i, '')
    .replace(/[^a-z0-9_]+/g, '')
    .replace(/_/g, '');
}

const ROOT_CONTROL_NAMES = [
  'n_root',
  'n_hara',
  'rootmotion',
  'root',
  'master',
  'center',
  'armature',
].map(normalizeName);

const ALIAS_LOOKUP = new Map<string, HumanBoneName>();
for (const bone of HUMAN_BONES) {
  ALIAS_LOOKUP.set(normalizeName(bone), bone);
  for (const alias of ALIASES[bone]) ALIAS_LOOKUP.set(normalizeName(alias), bone);
}

function guessHumanBone(name: string): HumanBoneName | null {
  const normalized = normalizeName(name);
  const exact = ALIAS_LOOKUP.get(normalized);
  if (exact) return exact;

  const left = /(^l|left)/.test(normalized) || /l$/.test(normalized);
  const right = /(^r|right)/.test(normalized) || /r$/.test(normalized);
  const side = left && !right ? 'left' : right && !left ? 'right' : null;
  if (side) {
    if (normalized.includes('clavicle') || normalized.includes('shoulder')) return `${side}Shoulder` as HumanBoneName;
    if (normalized.includes('forearm') || normalized.includes('lowerarm')) return `${side}LowerArm` as HumanBoneName;
    if (normalized.includes('upperarm') || /arm/.test(normalized)) return `${side}UpperArm` as HumanBoneName;
    if (normalized.includes('wrist') || normalized.includes('hand')) return `${side}Hand` as HumanBoneName;
    if (normalized.includes('thigh') || normalized.includes('upleg') || normalized.includes('upperleg')) return `${side}UpperLeg` as HumanBoneName;
    if (normalized.includes('calf') || normalized.includes('shin') || normalized.includes('lowerleg')) return `${side}LowerLeg` as HumanBoneName;
    if (normalized.includes('toe')) return `${side}Toes` as HumanBoneName;
    if (normalized.includes('ankle') || normalized.includes('foot')) return `${side}Foot` as HumanBoneName;
  }
  return null;
}

function extension(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? '';
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function packageFiles(data: ArrayBuffer): Record<string, Uint8Array> {
  return unzipSync(new Uint8Array(data));
}

function inspectPmp(fileName: string, data: ArrayBuffer): MotionInspection {
  let files: Record<string, Uint8Array>;
  try {
    files = packageFiles(data);
  } catch {
    throw new Error('The PMP file is not a valid Penumbra ZIP package.');
  }
  const entries = Object.keys(files).sort();
  let meta: Record<string, unknown> = {};
  const metaBytes = files['meta.json'];
  if (metaBytes) {
    try { meta = JSON.parse(strFromU8(metaBytes)) as Record<string, unknown>; } catch { /* optional metadata */ }
  }
  const embedded = entries.filter((entry) => DIRECT_PACKAGE_EXTENSIONS.has(extension(entry)));
  const pap = entries.filter((entry) => extension(entry) === 'pap');
  const warnings: string[] = [];
  if (pap.length) {
    warnings.push(`${pap.length} FFXIV PAP animation file(s) found. PAP uses proprietary Havok data and needs the matching FFXIV skeleton before it can be retargeted.`);
  }
  if (!embedded.length) {
    warnings.push('No directly convertible VRMA, BVH, FBX, GLB or glTF animation was found inside this package.');
  }
  const clips = embedded.map((entry, index) => ({
    index,
    name: entry.split(/[\\/]/).pop() ?? entry,
    duration: 0,
    embeddedPath: entry,
  }));
  return {
    format: 'pmp',
    name: typeof meta.Name === 'string' ? meta.Name : motionName(fileName),
    author: typeof meta.Author === 'string' ? meta.Author : undefined,
    version: typeof meta.Version === 'string' ? meta.Version : undefined,
    convertible: embedded.length > 0,
    clips,
    sourceBones: 0,
    mappedBones: 0,
    hasRootMotion: false,
    packageEntries: entries,
    warnings,
  };
}

function inspectPap(fileName: string): MotionInspection {
  return {
    format: 'pap',
    name: motionName(fileName),
    convertible: false,
    clips: [],
    sourceBones: 0,
    mappedBones: 0,
    hasRootMotion: false,
    warnings: [
      'FFXIV PAP is a proprietary Havok animation container.',
      'Direct conversion requires the matching SKLB skeleton and a compatible PAP/Havok decoder. The app will not guess the skeleton because that would create corrupted VRMA motion.',
    ],
  };
}

async function loadGltf(data: ArrayBuffer, format: 'glb' | 'gltf'): Promise<LoadedSource> {
  const loader = new GLTFLoader();
  try {
    const source = format === 'gltf' ? new TextDecoder().decode(data) : data;
    const gltf = await loader.parseAsync(source, '');
    return { root: gltf.scene, clips: gltf.animations, format };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(format === 'gltf'
      ? `The glTF could not be opened. Use an embedded glTF or convert it to GLB when it references external BIN/textures. ${detail}`
      : `The GLB could not be opened. ${detail}`);
  }
}

async function loadStandardSource(format: MotionFormat, data: ArrayBuffer): Promise<LoadedSource> {
  if (format === 'bvh') {
    const result = new BVHLoader().parse(new TextDecoder().decode(data));
    const root = new THREE.Group();
    const rootBone = result.skeleton.bones.find((bone) => !bone.parent || !(bone.parent as THREE.Bone).isBone)
      ?? result.skeleton.bones[0];
    if (rootBone) root.add(rootBone);
    return { root, clips: [result.clip], format: 'bvh' };
  }
  if (format === 'fbx') {
    const root = new FBXLoader().parse(data, '');
    return { root, clips: root.animations, format: 'fbx' };
  }
  if (format === 'glb' || format === 'gltf') return loadGltf(data, format);
  throw new Error(`Unsupported standard motion format: ${format}.`);
}

function collectNamedNodes(root: THREE.Object3D): THREE.Object3D[] {
  const nodes: THREE.Object3D[] = [];
  root.traverse((node) => {
    if (node.name) nodes.push(node);
  });
  return nodes;
}

function mapSourceBones(root: THREE.Object3D, availableBones?: Set<string>): Map<HumanBoneName, THREE.Object3D> {
  const nodes = collectNamedNodes(root);
  const result = new Map<HumanBoneName, THREE.Object3D>();
  for (const node of nodes) {
    const bone = guessHumanBone(node.name);
    if (!bone || result.has(bone) || (availableBones && !availableBones.has(bone))) continue;
    result.set(bone, node);
  }

  if (!result.has('hips') && (!availableBones || availableBones.has('hips'))) {
    for (const fallbackName of ['n_hara', 'rootmotion', 'root', 'center']) {
      const wanted = normalizeName(fallbackName);
      const fallback = nodes.find((node) => normalizeName(node.name) === wanted);
      if (fallback) {
        result.set('hips', fallback);
        break;
      }
    }
  }
  return result;
}

function parseTrackName(track: THREE.KeyframeTrack): ParsedTrackName | null {
  try {
    return THREE.PropertyBinding.parseTrackName(track.name) as ParsedTrackName;
  } catch {
    return null;
  }
}

function trackTargetName(track: THREE.KeyframeTrack): string {
  const parsed = parseTrackName(track);
  if (!parsed) return '';
  if (parsed.objectName === 'bones' && parsed.objectIndex != null) return String(parsed.objectIndex);
  return String(parsed.nodeName ?? parsed.objectIndex ?? '');
}

function trackTargetNode(root: THREE.Object3D, track: THREE.KeyframeTrack): THREE.Object3D | null {
  const targetName = trackTargetName(track);
  if (!targetName) return null;
  const byUuid = root.getObjectByProperty('uuid', targetName);
  if (byUuid) return byUuid;
  const exact = root.getObjectByName(targetName);
  if (exact) return exact;
  const wanted = normalizeName(targetName);
  return collectNamedNodes(root).find((node) => normalizeName(node.name) === wanted) ?? null;
}

function positionTrackAmplitude(track: THREE.KeyframeTrack): number {
  const valueSize = track.getValueSize();
  if (valueSize < 3 || track.values.length < valueSize) return 0;
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let index = 0; index + 2 < track.values.length; index += valueSize) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = Number(track.values[index + axis]);
      if (!Number.isFinite(value)) continue;
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  if (min.some((value) => !Number.isFinite(value)) || max.some((value) => !Number.isFinite(value))) return 0;
  return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
}

function nodeDepth(node: THREE.Object3D): number {
  let depth = 0;
  let current = node.parent;
  while (current) {
    depth += 1;
    current = current.parent;
  }
  return depth;
}

function isAncestorOrSame(ancestor: THREE.Object3D, node: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function rootControlPriority(name: string): number {
  const normalized = normalizeName(name);
  const index = ROOT_CONTROL_NAMES.indexOf(normalized);
  if (index >= 0) return 170 - index * 12;
  if (normalized.includes('root')) return 85;
  if (normalized.includes('center') || normalized.includes('centre')) return 70;
  return 0;
}

function findRootMotionSource(
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
  mapped: Map<HumanBoneName, THREE.Object3D>,
): RootMotionSource | null {
  const hips = mapped.get('hips') ?? null;
  let best: { node: THREE.Object3D; trackName: string; amplitude: number; score: number } | null = null;

  for (const track of clip.tracks) {
    const parsed = parseTrackName(track);
    if (parsed?.propertyName !== 'position') continue;
    const amplitude = positionTrackAmplitude(track);
    if (amplitude <= 0.00001) continue;
    const node = trackTargetNode(root, track);
    if (!node) continue;

    const normalized = normalizeName(node.name);
    let score = rootControlPriority(node.name);
    score += Math.min(120, Math.log1p(amplitude * 10) * 35);
    score += Math.max(0, 32 - nodeDepth(node) * 3);
    if (hips && isAncestorOrSame(node, hips)) score += 100;
    if (node === hips) score += 50;
    if (/(left|right|hand|foot|toe|ankle|wrist|knee|elbow|shoulder|arm|leg)/.test(normalized)) score -= 220;
    if (hips && !isAncestorOrSame(node, hips) && rootControlPriority(node.name) === 0) score -= 80;

    if (!best || score > best.score) best = { node, trackName: track.name, amplitude, score };
  }

  if (!best) return null;
  return {
    node: best.node,
    restWorldPosition: best.node.getWorldPosition(new THREE.Vector3()),
    trackName: best.trackName,
    amplitude: best.amplitude,
  };
}

function clipHasRootMotion(
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
  mapped: Map<HumanBoneName, THREE.Object3D>,
): boolean {
  return findRootMotionSource(root, clip, mapped) != null;
}

function mappedSourceHeight(mapped: Map<HumanBoneName, THREE.Object3D>, root: THREE.Object3D): number {
  const head = mapped.get('head');
  const leftFoot = mapped.get('leftFoot');
  const rightFoot = mapped.get('rightFoot');
  if (head && (leftFoot || rightFoot)) {
    const headPosition = head.getWorldPosition(new THREE.Vector3());
    const footPosition = (leftFoot && rightFoot)
      ? leftFoot.getWorldPosition(new THREE.Vector3()).add(rightFoot.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5)
      : (leftFoot ?? rightFoot)!.getWorldPosition(new THREE.Vector3());
    const height = headPosition.distanceTo(footPosition);
    if (Number.isFinite(height) && height > 0.001) return height;
  }
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  return Math.max(0.001, size.y || size.length() || 1);
}

function sourceBasis(mapped: Map<HumanBoneName, THREE.Object3D>, root: THREE.Object3D): THREE.Quaternion {
  const left = mapped.get('leftShoulder') ?? mapped.get('leftUpperArm') ?? mapped.get('leftUpperLeg');
  const right = mapped.get('rightShoulder') ?? mapped.get('rightUpperArm') ?? mapped.get('rightUpperLeg');
  const hips = mapped.get('hips');
  const head = mapped.get('head') ?? mapped.get('neck');
  if (!left || !right || !hips || !head) return root.getWorldQuaternion(new THREE.Quaternion()).normalize();

  const x = left.getWorldPosition(new THREE.Vector3()).sub(right.getWorldPosition(new THREE.Vector3())).normalize();
  const yRaw = head.getWorldPosition(new THREE.Vector3()).sub(hips.getWorldPosition(new THREE.Vector3()));
  const y = yRaw.sub(x.clone().multiplyScalar(yRaw.dot(x))).normalize();
  const z = x.clone().cross(y).normalize();
  if (x.lengthSq() < 0.5 || y.lengthSq() < 0.5 || z.lengthSq() < 0.5) {
    return root.getWorldQuaternion(new THREE.Quaternion()).normalize();
  }
  const correctedY = z.clone().cross(x).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, correctedY, z)).normalize();
}

function captureRest(mapped: Map<HumanBoneName, THREE.Object3D>): Map<HumanBoneName, SourceBoneRest> {
  const rest = new Map<HumanBoneName, SourceBoneRest>();
  for (const [bone, node] of mapped) {
    rest.set(bone, {
      node,
      restWorldRotation: node.getWorldQuaternion(new THREE.Quaternion()).normalize(),
      restWorldPosition: node.getWorldPosition(new THREE.Vector3()),
    });
  }
  return rest;
}

function quaternionTuple(quaternion: THREE.Quaternion, targetMetaVersion?: '0' | '1'): QuatTuple {
  const value = quaternion.clone().normalize();
  if (targetMetaVersion === '0') value.set(-value.x, value.y, -value.z, value.w).normalize();
  return [value.x, value.y, value.z, value.w];
}

function vectorTuple(vector: THREE.Vector3, targetMetaVersion?: '0' | '1'): Vec3Tuple {
  return targetMetaVersion === '0'
    ? [-vector.x, vector.y, -vector.z]
    : [vector.x, vector.y, vector.z];
}

function parentWorldDelta(
  bone: HumanBoneName,
  deltas: Map<HumanBoneName, THREE.Quaternion>,
): THREE.Quaternion {
  let parent = VRMHumanBoneParentMap[bone] as HumanBoneName | null;
  while (parent) {
    const value = deltas.get(parent);
    if (value) return value;
    parent = VRMHumanBoneParentMap[parent] as HumanBoneName | null;
  }
  return new THREE.Quaternion();
}

function sampleStandardClip(
  source: LoadedSource,
  clip: THREE.AnimationClip,
  mapped: Map<HumanBoneName, THREE.Object3D>,
  options: MotionImportOptions,
): ImportedMotion {
  const duration = Number(clip.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('The selected animation clip has no valid duration.');
  const requestedFps = Math.max(1, Math.min(120, Math.round(options.sampleFps || 30)));
  const effectiveFps = Math.min(requestedFps, Math.max(1, Math.floor((MAX_KEYFRAMES - 1) / duration)));
  const warnings: string[] = [];
  if (effectiveFps < requestedFps) warnings.push(`Sampling was reduced to ${effectiveFps} FPS to keep the timeline under ${MAX_KEYFRAMES} keyframes.`);

  source.root.updateWorldMatrix(true, true);
  const rest = captureRest(mapped);
  const basis = sourceBasis(mapped, source.root);
  const inverseBasis = basis.clone().invert();
  const sourceHeight = mappedSourceHeight(mapped, source.root);
  const targetHeight = Math.max(0.5, Math.min(3, Number(options.targetHeight) || DEFAULT_TARGET_HEIGHT));
  const motionScale = (targetHeight / sourceHeight) * Math.max(0, Math.min(3, Number(options.rootScale) || 1));
  const rootMotionSource = findRootMotionSource(source.root, clip, mapped);

  const mixer = new THREE.AnimationMixer(source.root);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 0);
  action.clampWhenFinished = true;
  action.play();

  const frameCount = Math.max(1, Math.ceil(duration * effectiveFps));
  const keyframes: Keyframe[] = [];
  const hasRootMotion = rootMotionSource != null;

  for (let frame = 0; frame <= frameCount; frame += 1) {
    const time = frame === frameCount ? duration : frame / effectiveFps;
    mixer.setTime(time);
    source.root.updateWorldMatrix(true, true);

    const worldDeltas = new Map<HumanBoneName, THREE.Quaternion>();
    for (const [bone, state] of rest) {
      const currentWorld = state.node.getWorldQuaternion(new THREE.Quaternion()).normalize();
      const sourceDelta = currentWorld.multiply(state.restWorldRotation.clone().invert()).normalize();
      const canonicalDelta = inverseBasis.clone().multiply(sourceDelta).multiply(basis).normalize();
      worldDeltas.set(bone, canonicalDelta);
    }

    const pose: PoseSnapshot = {};
    for (const [bone, worldDelta] of worldDeltas) {
      const parentDelta = parentWorldDelta(bone, worldDeltas);
      const localDelta = parentDelta.clone().invert().multiply(worldDelta).normalize();
      pose[bone] = { rotation: quaternionTuple(localDelta, options.targetMetaVersion) };
    }

    if (pose.hips && rootMotionSource && options.rootMotion) {
      const displacement = rootMotionSource.node.getWorldPosition(new THREE.Vector3())
        .sub(rootMotionSource.restWorldPosition)
        .applyQuaternion(inverseBasis)
        .multiplyScalar(motionScale);
      pose.hips.position = vectorTuple(displacement, options.targetMetaVersion);
    }

    keyframes.push({ id: crypto.randomUUID(), time, pose, easing: 'linear' });
  }

  action.stop();
  mixer.stopAllAction();
  mixer.uncacheRoot(source.root);

  if (!hasRootMotion) warnings.push('No animated root or hips translation track was found; the motion will stay in place.');
  if (hasRootMotion && !options.rootMotion) warnings.push('Root motion was removed by the import setting.');
  if (rootMotionSource) warnings.push(`Root motion extracted from ${rootMotionSource.node.name || rootMotionSource.trackName}.`);
  if (options.targetMetaVersion === '0') warnings.push('VRM 0 axis conversion was applied to rotations and root displacement.');
  if (mapped.size < 15) warnings.push(`Only ${mapped.size} humanoid bones were recognized. Check the source skeleton naming if the result is incomplete.`);

  return {
    name: clip.name?.trim() || 'Imported motion',
    format: source.format,
    duration,
    sourceDuration: duration,
    sourceBones: collectNamedNodes(source.root).length,
    importedBones: mapped.size,
    keyframes,
    effectiveFps,
    hasRootMotion,
    warnings,
  };
}

async function inspectStandard(
  fileName: string,
  format: Exclude<MotionFormat, 'vrma' | 'pmp' | 'pap'>,
  data: ArrayBuffer,
  availableBones?: string[],
): Promise<MotionInspection> {
  const source = await loadStandardSource(format, data);
  source.root.updateWorldMatrix(true, true);
  const mapped = mapSourceBones(source.root, availableBones?.length ? new Set(availableBones) : undefined);
  const clips = source.clips.map((clip, index) => ({
    index,
    name: clip.name?.trim() || `Clip ${index + 1}`,
    duration: Math.max(0, Number(clip.duration) || 0),
  }));
  const warnings: string[] = [];
  if (!clips.length) warnings.push('The 3D file contains no animation clips.');
  if (!mapped.size) warnings.push('No known humanoid bone names were recognized in this file.');
  if (format === 'gltf') warnings.push('External GLTF resources are not bundled by the file picker. Prefer GLB for reliable one-file import.');
  return {
    format,
    name: motionName(fileName),
    convertible: clips.length > 0 && mapped.size > 0,
    clips,
    sourceBones: collectNamedNodes(source.root).length,
    mappedBones: mapped.size,
    hasRootMotion: source.clips.some((clip) => clipHasRootMotion(source.root, clip, mapped)),
    warnings,
  };
}

export async function inspectMotionFile(
  fileName: string,
  data: ArrayBuffer,
  availableBones: string[] = [],
): Promise<MotionInspection> {
  const format = detectMotionFormat(fileName);
  if (!format) throw new Error('Unsupported motion file. Use VRMA, BVH, FBX, GLB, glTF, PMP or PAP.');
  if (format === 'pmp') return inspectPmp(fileName, data);
  if (format === 'pap') return inspectPap(fileName);
  if (format === 'vrma') {
    const inspected = await inspectVrma(data);
    return {
      format,
      name: motionName(fileName),
      convertible: inspected.boneCount > 0,
      clips: [{ index: 0, name: motionName(fileName), duration: inspected.duration }],
      sourceBones: inspected.boneCount,
      mappedBones: availableBones.length
        ? availableBones.filter((bone) => HUMAN_BONES.includes(bone as HumanBoneName)).length
        : inspected.boneCount,
      hasRootMotion: inspected.hasRootMotion,
      warnings: [],
    };
  }
  return inspectStandard(fileName, format, data, availableBones);
}

async function importEmbeddedPmp(
  fileName: string,
  data: ArrayBuffer,
  options: MotionImportOptions,
): Promise<ImportedMotion> {
  const inspection = inspectPmp(fileName, data);
  const selected = inspection.clips[options.clipIndex] ?? inspection.clips[0];
  if (!selected?.embeddedPath) {
    throw new Error(inspection.warnings.join(' '));
  }
  const files = packageFiles(data);
  const bytes = files[selected.embeddedPath];
  if (!bytes) throw new Error('The selected embedded animation was not found in the PMP package.');
  return importMotionFile(selected.name, copyArrayBuffer(bytes), { ...options, clipIndex: 0 });
}

export async function importMotionFile(
  fileName: string,
  data: ArrayBuffer,
  options: MotionImportOptions,
): Promise<ImportedMotion> {
  const format = detectMotionFormat(fileName);
  if (!format) throw new Error('Unsupported motion file.');
  if (format === 'pmp') return importEmbeddedPmp(fileName, data, options);
  if (format === 'pap') throw new Error(inspectPap(fileName).warnings.join(' '));
  if (format === 'vrma') {
    const imported = await importVrma(fileName, data, options);
    return {
      ...imported,
      format: 'vrma',
      hasRootMotion: imported.keyframes.some((frame) => Boolean(frame.pose.hips?.position)),
    };
  }
  if (!isDirectlyConvertibleMotion(format)) throw new Error('This format cannot be converted directly.');

  const source = await loadStandardSource(format, data);
  const clip = source.clips[options.clipIndex] ?? source.clips[0];
  if (!clip) throw new Error('The file contains no animation clip.');
  source.root.updateWorldMatrix(true, true);
  const mapped = mapSourceBones(source.root, new Set(options.availableBones));
  if (!mapped.size) throw new Error('No source bones could be mapped to the opened VRM humanoid.');
  return sampleStandardClip(source, clip, mapped, options);
}
