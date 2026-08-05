export const HUMAN_BONES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'jaw',
  'leftEye', 'rightEye',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
  'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
  'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
  'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
  'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
  'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
  'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
  'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
  'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
  'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
  'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal',
] as const;

export type HumanBoneName = (typeof HUMAN_BONES)[number];

export const REQUIRED_VRMA_BONES: HumanBoneName[] = [
  'hips', 'spine', 'head',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
  'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightUpperArm', 'rightLowerArm', 'rightHand',
];

export const BONE_GROUPS: Array<{ title: string; bones: HumanBoneName[] }> = [
  { title: 'Tronco', bones: ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'jaw', 'leftEye', 'rightEye'] },
  { title: 'Braço esquerdo', bones: ['leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand'] },
  { title: 'Braço direito', bones: ['rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand'] },
  { title: 'Perna esquerda', bones: ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes'] },
  { title: 'Perna direita', bones: ['rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes'] },
  {
    title: 'Mão esquerda',
    bones: HUMAN_BONES.filter((name) => name.startsWith('left') && /Thumb|Index|Middle|Ring|Little/.test(name)) as HumanBoneName[],
  },
  {
    title: 'Mão direita',
    bones: HUMAN_BONES.filter((name) => name.startsWith('right') && /Thumb|Index|Middle|Ring|Little/.test(name)) as HumanBoneName[],
  },
];

export const BONE_LABELS: Partial<Record<HumanBoneName, string>> = {
  hips: 'Quadril', spine: 'Coluna', chest: 'Peito', upperChest: 'Peito superior', neck: 'Pescoço', head: 'Cabeça', jaw: 'Mandíbula',
  leftEye: 'Olho esquerdo', rightEye: 'Olho direito',
  leftShoulder: 'Ombro esquerdo', leftUpperArm: 'Braço esquerdo', leftLowerArm: 'Antebraço esquerdo', leftHand: 'Mão esquerda',
  rightShoulder: 'Ombro direito', rightUpperArm: 'Braço direito', rightLowerArm: 'Antebraço direito', rightHand: 'Mão direita',
  leftUpperLeg: 'Coxa esquerda', leftLowerLeg: 'Canela esquerda', leftFoot: 'Pé esquerdo', leftToes: 'Dedos esquerdos',
  rightUpperLeg: 'Coxa direita', rightLowerLeg: 'Canela direita', rightFoot: 'Pé direito', rightToes: 'Dedos direitos',
};

export function boneLabel(name: string): string {
  const known = BONE_LABELS[name as HumanBoneName];
  if (known) return known;
  return name
    .replace(/^left/, 'Esq. ')
    .replace(/^right/, 'Dir. ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (letter) => letter.toUpperCase());
}

// As poses antigas eram ângulos Euler fixos e produziam resultados diferentes
// entre avatares. Só a T-pose neutra permanece como ação segura. Poses reais
// agora são snapshots normalizados salvos pela biblioteca pessoal.
export const POSE_PRESETS = [
  { id: 'tpose', name: 'T-Pose', description: 'Reset neutro do humanoide VRM' },
] as const;
