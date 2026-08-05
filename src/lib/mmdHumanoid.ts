import * as THREE from 'three';
import { HUMAN_BONES, type HumanBoneName } from '../constants';

const FULLWIDTH_DIGITS: Record<string, string> = {
  '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
};

function normalize(value: string): string {
  return value
    .trim()
    .replace(/[０-９]/g, (digit) => FULLWIDTH_DIGITS[digit] ?? digit)
    .replace(/^mixamorig[:_\-]*/i, '')
    .replace(/^armature[|:_\-]*/i, '')
    .replace(/[\s._\-|:・]/g, '')
    .toLowerCase();
}

const ALIASES: Partial<Record<HumanBoneName, string[]>> = {
  hips: ['下半身', '腰', 'pelvis', 'hips', 'hip'],
  spine: ['上半身', 'spine', 'spine01', 'lowerbody'],
  chest: ['上半身2', '上半身２', 'spine1', 'spine02', 'chest'],
  upperChest: ['上半身3', '上半身３', 'spine2', 'spine03', 'upperchest'],
  neck: ['首', 'neck'],
  head: ['頭', 'head'],
  jaw: ['あご', '顎', 'jaw'],
  leftEye: ['左目', 'lefteye', 'eye_l'],
  rightEye: ['右目', 'righteye', 'eye_r'],

  leftShoulder: ['左肩', '左肩p', 'leftshoulder', 'shoulder_l', 'clavicle_l'],
  leftUpperArm: ['左腕', '左腕捩', 'leftarm', 'leftupperarm', 'upperarm_l'],
  leftLowerArm: ['左ひじ', '左肘', 'leftelbow', 'leftforearm', 'lowerarm_l'],
  leftHand: ['左手首', 'lefthand', 'wrist_l', 'hand_l'],
  rightShoulder: ['右肩', '右肩p', 'rightshoulder', 'shoulder_r', 'clavicle_r'],
  rightUpperArm: ['右腕', '右腕捩', 'rightarm', 'rightupperarm', 'upperarm_r'],
  rightLowerArm: ['右ひじ', '右肘', 'rightelbow', 'rightforearm', 'lowerarm_r'],
  rightHand: ['右手首', 'righthand', 'wrist_r', 'hand_r'],

  leftUpperLeg: ['左足', '左脚', 'leftleg', 'leftthigh', 'upperleg_l', 'thigh_l'],
  leftLowerLeg: ['左ひざ', '左膝', 'leftknee', 'leftcalf', 'lowerleg_l', 'calf_l'],
  leftFoot: ['左足首', 'leftankle', 'leftfoot', 'foot_l'],
  leftToes: ['左つま先', '左爪先', 'lefttoe', 'toes_l'],
  rightUpperLeg: ['右足', '右脚', 'rightleg', 'rightthigh', 'upperleg_r', 'thigh_r'],
  rightLowerLeg: ['右ひざ', '右膝', 'rightknee', 'rightcalf', 'lowerleg_r', 'calf_r'],
  rightFoot: ['右足首', 'rightankle', 'rightfoot', 'foot_r'],
  rightToes: ['右つま先', '右爪先', 'righttoe', 'toes_r'],

  leftThumbMetacarpal: ['左親指0', '左親指０', 'leftthumb0', 'thumb0_l'],
  leftThumbProximal: ['左親指1', '左親指１', 'leftthumb1', 'thumb1_l'],
  leftThumbDistal: ['左親指2', '左親指２', 'leftthumb2', 'thumb2_l'],
  leftIndexProximal: ['左人指1', '左人指１', '左人差指1', 'leftindex1', 'index1_l'],
  leftIndexIntermediate: ['左人指2', '左人指２', '左人差指2', 'leftindex2', 'index2_l'],
  leftIndexDistal: ['左人指3', '左人指３', '左人差指3', 'leftindex3', 'index3_l'],
  leftMiddleProximal: ['左中指1', '左中指１', 'leftmiddle1', 'middle1_l'],
  leftMiddleIntermediate: ['左中指2', '左中指２', 'leftmiddle2', 'middle2_l'],
  leftMiddleDistal: ['左中指3', '左中指３', 'leftmiddle3', 'middle3_l'],
  leftRingProximal: ['左薬指1', '左薬指１', 'leftring1', 'ring1_l'],
  leftRingIntermediate: ['左薬指2', '左薬指２', 'leftring2', 'ring2_l'],
  leftRingDistal: ['左薬指3', '左薬指３', 'leftring3', 'ring3_l'],
  leftLittleProximal: ['左小指1', '左小指１', 'leftlittle1', 'leftpinky1', 'pinky1_l'],
  leftLittleIntermediate: ['左小指2', '左小指２', 'leftlittle2', 'leftpinky2', 'pinky2_l'],
  leftLittleDistal: ['左小指3', '左小指３', 'leftlittle3', 'leftpinky3', 'pinky3_l'],

  rightThumbMetacarpal: ['右親指0', '右親指０', 'rightthumb0', 'thumb0_r'],
  rightThumbProximal: ['右親指1', '右親指１', 'rightthumb1', 'thumb1_r'],
  rightThumbDistal: ['右親指2', '右親指２', 'rightthumb2', 'thumb2_r'],
  rightIndexProximal: ['右人指1', '右人指１', '右人差指1', 'rightindex1', 'index1_r'],
  rightIndexIntermediate: ['右人指2', '右人指２', '右人差指2', 'rightindex2', 'index2_r'],
  rightIndexDistal: ['右人指3', '右人指３', '右人差指3', 'rightindex3', 'index3_r'],
  rightMiddleProximal: ['右中指1', '右中指１', 'rightmiddle1', 'middle1_r'],
  rightMiddleIntermediate: ['右中指2', '右中指２', 'rightmiddle2', 'middle2_r'],
  rightMiddleDistal: ['右中指3', '右中指３', 'rightmiddle3', 'middle3_r'],
  rightRingProximal: ['右薬指1', '右薬指１', 'rightring1', 'ring1_r'],
  rightRingIntermediate: ['右薬指2', '右薬指２', 'rightring2', 'ring2_r'],
  rightRingDistal: ['右薬指3', '右薬指３', 'rightring3', 'ring3_r'],
  rightLittleProximal: ['右小指1', '右小指１', 'rightlittle1', 'rightpinky1', 'pinky1_r'],
  rightLittleIntermediate: ['右小指2', '右小指２', 'rightlittle2', 'rightpinky2', 'pinky2_r'],
  rightLittleDistal: ['右小指3', '右小指３', 'rightlittle3', 'rightpinky3', 'pinky3_r'],
};

const LOOKUP = new Map<string, HumanBoneName>();
for (const bone of HUMAN_BONES) {
  LOOKUP.set(normalize(bone), bone);
  for (const alias of ALIASES[bone] ?? []) LOOKUP.set(normalize(alias), bone);
}

export function guessMmdHumanoidBone(name: string): HumanBoneName | null {
  return LOOKUP.get(normalize(name)) ?? null;
}

export function mapMmdHumanoidBones(
  root: THREE.Object3D,
  available?: ReadonlySet<string>,
): Map<HumanBoneName, THREE.Object3D> {
  const mapped = new Map<HumanBoneName, THREE.Object3D>();
  root.traverse((node) => {
    if (!node.name) return;
    const bone = guessMmdHumanoidBone(node.name);
    if (!bone || mapped.has(bone) || (available && !available.has(bone))) return;
    mapped.set(bone, node);
  });
  return mapped;
}

export function findMmdRootMotionNode(root: THREE.Object3D): THREE.Object3D | null {
  const priorities = ['センター', 'center', 'グルーブ', 'groove', '全ての親', 'master', 'root'];
  const nodes: THREE.Object3D[] = [];
  root.traverse((node) => {
    if (node.name) nodes.push(node);
  });
  for (const name of priorities) {
    const wanted = normalize(name);
    const found = nodes.find((node) => normalize(node.name) === wanted);
    if (found) return found;
  }
  return null;
}

export function isMmdIkBoneName(name: string): boolean {
  const normalized = normalize(name);
  return normalized.includes('ik') || normalized.includes('ｉｋ') || /足ik|つま先ik/.test(name.toLowerCase());
}
