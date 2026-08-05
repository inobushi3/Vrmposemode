import type { Vec3Tuple } from '../types';

export type SemanticMotionActionType =
  | 'walk'
  | 'run'
  | 'heroPose'
  | 'relaxedPose'
  | 'cutePose'
  | 'wave'
  | 'bow'
  | 'jump'
  | 'turn'
  | 'nod'
  | 'shakeHead'
  | 'crouch';

export interface RawSemanticMotionAction {
  type?: unknown;
  start?: unknown;
  duration?: unknown;
  steps?: unknown;
  distance?: unknown;
  direction?: unknown;
  side?: unknown;
  repetitions?: unknown;
  degrees?: unknown;
}

export interface ProceduralBoneTransform {
  r: Vec3Tuple;
  p?: Vec3Tuple;
}

export interface ProceduralMotionFrame {
  t: number;
  easing: 'smooth' | 'linear' | 'step';
  bones: Record<string, ProceduralBoneTransform>;
}

export interface ProceduralMotionResult {
  frames: ProceduralMotionFrame[];
  actionsUsed: SemanticMotionActionType[];
  warnings: string[];
}

interface ScheduledAction {
  type: SemanticMotionActionType;
  start: number;
  duration: number;
  steps: number;
  distance: number;
  direction: 'forward' | 'backward' | 'left' | 'right';
  side: 'left' | 'right' | 'both';
  repetitions: number;
  degrees: number;
}

const ACTION_TYPES = new Set<SemanticMotionActionType>([
  'walk', 'run', 'heroPose', 'relaxedPose', 'cutePose', 'wave', 'bow',
  'jump', 'turn', 'nod', 'shakeHead', 'crouch',
]);

const DEFAULT_DURATIONS: Record<SemanticMotionActionType, number> = {
  walk: 2.4,
  run: 2,
  heroPose: 1.8,
  relaxedPose: 1.2,
  cutePose: 1.8,
  wave: 2.4,
  bow: 2.2,
  jump: 1.8,
  turn: 1.6,
  nod: 1.2,
  shakeHead: 1.4,
  crouch: 1.6,
};

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function snap(time: number, fps: number): number {
  return Math.round(Math.max(0, time) * fps) / fps;
}

function clone3(value: Vec3Tuple): Vec3Tuple {
  return [value[0], value[1], value[2]];
}

function copyPose(
  pose: Record<string, ProceduralBoneTransform>,
): Record<string, ProceduralBoneTransform> {
  return Object.fromEntries(Object.entries(pose).map(([bone, transform]) => [
    bone,
    {
      r: clone3(transform.r),
      ...(transform.p ? { p: clone3(transform.p) } : {}),
    },
  ]));
}

/**
 * These rotations intentionally match the presets already used by Viewport.tsx.
 * They are normalized VRM pose offsets, not raw source-skeleton rotations.
 */
export function normalizedRelaxedPose(): Record<string, ProceduralBoneTransform> {
  return {
    hips: { r: [0, 0, 0], p: [0, 0, 0] },
    spine: { r: [0, 0, -2] },
    chest: { r: [0, 0, 0] },
    upperChest: { r: [0, 0, 0] },
    neck: { r: [0, 0, 0] },
    head: { r: [1, 0, 2] },
    leftShoulder: { r: [0, 0, 0] },
    rightShoulder: { r: [0, 0, 0] },
    leftUpperArm: { r: [0, 0, 68] },
    rightUpperArm: { r: [0, 0, -68] },
    leftLowerArm: { r: [0, 0, -12] },
    rightLowerArm: { r: [0, 0, 12] },
    leftHand: { r: [0, 0, 0] },
    rightHand: { r: [0, 0, 0] },
    leftUpperLeg: { r: [0, 0, 0] },
    rightUpperLeg: { r: [0, 0, 0] },
    leftLowerLeg: { r: [0, 0, 0] },
    rightLowerLeg: { r: [0, 0, 0] },
    leftFoot: { r: [0, 0, 0] },
    rightFoot: { r: [0, 0, 0] },
  };
}

export function normalizedHeroPose(): Record<string, ProceduralBoneTransform> {
  return {
    hips: { r: [0, 0, -3] },
    spine: { r: [-4, 0, 0] },
    chest: { r: [-3, 0, 0] },
    upperChest: { r: [-2, 0, 1] },
    neck: { r: [-1, 0, 0] },
    head: { r: [-3, 0, -2] },
    leftUpperArm: { r: [8, 6, 52] },
    rightUpperArm: { r: [8, -6, -52] },
    leftLowerArm: { r: [0, 10, -78] },
    rightLowerArm: { r: [0, -10, 78] },
    leftHand: { r: [0, 0, -8] },
    rightHand: { r: [0, 0, 8] },
    leftUpperLeg: { r: [-3, 0, 4] },
    rightUpperLeg: { r: [5, 0, -8] },
    leftLowerLeg: { r: [2, 0, 0] },
    rightLowerLeg: { r: [4, 0, 0] },
    leftFoot: { r: [0, 0, -3] },
    rightFoot: { r: [0, 0, 4] },
  };
}

export function normalizedCutePose(): Record<string, ProceduralBoneTransform> {
  return {
    hips: { r: [0, 0, -3] },
    spine: { r: [0, 0, -3] },
    chest: { r: [0, 0, -2] },
    head: { r: [2, -8, 6] },
    leftUpperArm: { r: [15, -20, 118] },
    rightUpperArm: { r: [15, 20, -118] },
    leftLowerArm: { r: [-10, 0, -95] },
    rightLowerArm: { r: [-10, 0, 95] },
    leftHand: { r: [5, 0, -18] },
    rightHand: { r: [5, 0, 18] },
    leftUpperLeg: { r: [-3, 0, 5] },
    rightUpperLeg: { r: [3, 0, -5] },
  };
}

function sanitizeActions(rawActions: unknown, totalDuration: number): ScheduledAction[] {
  if (!Array.isArray(rawActions)) return [];
  const parsed = rawActions
    .slice(0, 24)
    .map((raw): Omit<ScheduledAction, 'start' | 'duration'> & { start?: number; duration?: number } | null => {
      if (!raw || typeof raw !== 'object') return null;
      const action = raw as RawSemanticMotionAction;
      const type = String(action.type || '') as SemanticMotionActionType;
      if (!ACTION_TYPES.has(type)) return null;
      const directionValue = String(action.direction || 'forward');
      const sideValue = String(action.side || 'right');
      return {
        type,
        start: Number.isFinite(Number(action.start)) ? clamp(Number(action.start), 0, totalDuration) : undefined,
        duration: Number.isFinite(Number(action.duration)) ? clamp(Number(action.duration), 0.15, totalDuration) : undefined,
        steps: clamp(Math.round(numberValue(action.steps, type === 'run' ? 4 : 2)), 1, 20),
        distance: clamp(numberValue(action.distance, Number.NaN), 0.05, 12),
        direction: directionValue === 'backward' || directionValue === 'left' || directionValue === 'right'
          ? directionValue
          : 'forward',
        side: sideValue === 'left' || sideValue === 'both' ? sideValue : 'right',
        repetitions: clamp(Math.round(numberValue(action.repetitions, 3)), 1, 12),
        degrees: clamp(numberValue(action.degrees, 90), -360, 360),
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  if (!parsed.length) return [];
  const allExplicit = parsed.every((action) => action.start !== undefined && action.duration !== undefined);
  if (allExplicit) {
    return parsed.map((action) => ({
      ...action,
      start: clamp(action.start!, 0, totalDuration),
      duration: clamp(action.duration!, 0.15, Math.max(0.15, totalDuration - action.start!)),
      distance: Number.isFinite(action.distance)
        ? action.distance
        : (action.type === 'run' ? 0.8 : 0.52) * action.steps,
    }));
  }

  const defaultTotal = parsed.reduce((sum, action) => sum + (action.duration ?? DEFAULT_DURATIONS[action.type]), 0);
  const scale = totalDuration / Math.max(0.15, defaultTotal);
  let cursor = 0;
  return parsed.map((action, index) => {
    const remainingActions = parsed.length - index;
    const requested = (action.duration ?? DEFAULT_DURATIONS[action.type]) * scale;
    const available = Math.max(0.15, totalDuration - cursor - (remainingActions - 1) * 0.15);
    const duration = clamp(requested, 0.15, available);
    const scheduled: ScheduledAction = {
      ...action,
      start: cursor,
      duration,
      distance: Number.isFinite(action.distance)
        ? action.distance
        : (action.type === 'run' ? 0.8 : 0.52) * action.steps,
    };
    cursor += duration;
    return scheduled;
  });
}

function localDirection(
  direction: ScheduledAction['direction'],
  yawDegrees: number,
): Vec3Tuple {
  const local: Vec3Tuple = direction === 'backward'
    ? [0, 0, -1]
    : direction === 'left'
      ? [1, 0, 0]
      : direction === 'right'
        ? [-1, 0, 0]
        : [0, 0, 1];
  const yaw = yawDegrees * Math.PI / 180;
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  return [
    local[0] * cosine + local[2] * sine,
    0,
    -local[0] * sine + local[2] * cosine,
  ];
}

export function compileSemanticActions(
  rawActions: unknown,
  totalDuration: number,
  fps: number,
): ProceduralMotionResult {
  const safeDuration = clamp(numberValue(totalDuration, 4), 0.2, 300);
  const safeFps = clamp(Math.round(numberValue(fps, 30)), 1, 120);
  const actions = sanitizeActions(rawActions, safeDuration);
  const warnings: string[] = [];
  const frameMap = new Map<number, ProceduralMotionFrame>();

  const add = (
    time: number,
    bones: Record<string, ProceduralBoneTransform>,
    easing: ProceduralMotionFrame['easing'] = 'smooth',
  ): void => {
    const t = snap(clamp(time, 0, safeDuration), safeFps);
    const frameIndex = Math.round(t * safeFps);
    const existing = frameMap.get(frameIndex);
    if (existing) {
      Object.assign(existing.bones, copyPose(bones));
      existing.easing = easing;
    } else {
      frameMap.set(frameIndex, { t, easing, bones: copyPose(bones) });
    }
  };

  if (!actions.length) {
    return { frames: [], actionsUsed: [], warnings: ['Nenhuma ação semântica reconhecida.'] };
  }

  add(0, normalizedRelaxedPose());
  let rootPosition: Vec3Tuple = [0, 0, 0];
  let rootYaw = 0;

  const addLocomotion = (action: ScheduledAction, running: boolean): void => {
    const direction = localDirection(action.direction, rootYaw);
    const startPosition = clone3(rootPosition);
    const stepDuration = action.duration / action.steps;
    const distancePerStep = action.distance / action.steps;
    const stride = running ? 38 : 26;
    const knee = running ? 64 : 43;
    const armSwing = running ? 28 : 17;
    const bounce = running ? 0.055 : 0.025;

    for (let step = 0; step < action.steps; step += 1) {
      const leftLeads = step % 2 === 0;
      const stepStart = action.start + step * stepDuration;
      const baseDistance = step * distancePerStep;
      for (const phase of [0, 0.22, 0.5, 0.78, 1]) {
        const cycle = Math.sin(phase * Math.PI);
        const distance = baseDistance + distancePerStep * phase;
        const x = startPosition[0] + direction[0] * distance;
        const z = startPosition[2] + direction[2] * distance;
        const y = cycle * bounce;
        const leadLeg = cycle * stride;
        const trailingLeg = -cycle * stride * 0.55;
        const leadKnee = cycle * knee;
        const supportKnee = cycle * (running ? 30 : 18);
        const arm = cycle * armSwing;
        const leftLegX = leftLeads ? -leadLeg : -trailingLeg;
        const rightLegX = leftLeads ? -trailingLeg : -leadLeg;
        const leftArmY = leftLeads ? arm : -arm;
        const rightArmY = leftLeads ? -arm : arm;

        add(stepStart + phase * stepDuration, {
          hips: { r: [0, rootYaw, leftLeads ? -1.8 : 1.8], p: [x, y, z] },
          spine: { r: [running ? 6 : 2, leftLeads ? -2.5 : 2.5, -2] },
          chest: { r: [running ? 4 : 1, leftLeads ? -3 : 3, 0] },
          leftUpperArm: { r: [0, leftArmY, 68] },
          rightUpperArm: { r: [0, rightArmY, -68] },
          leftLowerArm: { r: [0, 0, running ? -18 : -12] },
          rightLowerArm: { r: [0, 0, running ? 18 : 12] },
          leftUpperLeg: { r: [leftLegX, 0, 0] },
          rightUpperLeg: { r: [rightLegX, 0, 0] },
          leftLowerLeg: { r: [leftLeads ? leadKnee : supportKnee, 0, 0] },
          rightLowerLeg: { r: [leftLeads ? supportKnee : leadKnee, 0, 0] },
          leftFoot: { r: [leftLeads ? -leadLeg * 0.25 : trailingLeg * 0.15, 0, 0] },
          rightFoot: { r: [leftLeads ? trailingLeg * 0.15 : -leadLeg * 0.25, 0, 0] },
        }, phase === 1 ? 'smooth' : 'linear');
      }
    }

    rootPosition = [
      startPosition[0] + direction[0] * action.distance,
      0,
      startPosition[2] + direction[2] * action.distance,
    ];
    add(action.start + action.duration, {
      ...normalizedRelaxedPose(),
      hips: { r: [0, rootYaw, 0], p: clone3(rootPosition) },
    });
  };

  for (const action of actions) {
    const end = action.start + action.duration;

    if (action.type === 'walk' || action.type === 'run') {
      addLocomotion(action, action.type === 'run');
      continue;
    }

    if (action.type === 'heroPose') {
      const pose = normalizedHeroPose();
      add(action.start, { hips: { r: [0, rootYaw, 0], p: clone3(rootPosition) } });
      add(action.start + action.duration * 0.38, pose);
      add(end, pose);
      continue;
    }

    if (action.type === 'relaxedPose') {
      add(end, {
        ...normalizedRelaxedPose(),
        hips: { r: [0, rootYaw, 0], p: clone3(rootPosition) },
      });
      continue;
    }

    if (action.type === 'cutePose') {
      const pose = normalizedCutePose();
      add(action.start + action.duration * 0.4, pose);
      add(end, pose);
      continue;
    }

    if (action.type === 'wave') {
      const left = action.side === 'left';
      const upper = left ? 'leftUpperArm' : 'rightUpperArm';
      const lower = left ? 'leftLowerArm' : 'rightLowerArm';
      const hand = left ? 'leftHand' : 'rightHand';
      const raisedUpper: Vec3Tuple = left ? [10, 5, 145] : [10, -5, -145];
      const bentLower: Vec3Tuple = left ? [0, -12, 70] : [0, 12, -70];
      add(action.start, {
        ...normalizedRelaxedPose(),
        hips: { r: [0, rootYaw, 0], p: clone3(rootPosition) },
      });
      add(action.start + action.duration * 0.22, {
        [upper]: { r: raisedUpper },
        [lower]: { r: bentLower },
        [hand]: { r: [0, 0, left ? 18 : -18] },
        spine: { r: [0, 0, left ? 4 : -4] },
        head: { r: [0, left ? 4 : -4, left ? -4 : 4] },
      });
      for (let index = 0; index < action.repetitions * 2; index += 1) {
        const phase = index / Math.max(1, action.repetitions * 2 - 1);
        const delta = index % 2 === 0 ? 14 : -10;
        add(action.start + action.duration * (0.3 + phase * 0.45), {
          [lower]: { r: [0, bentLower[1], bentLower[2] + (left ? -delta : delta)] },
          [hand]: { r: [0, 0, (index % 2 === 0 ? 13 : -13) * (left ? 1 : -1)] },
        }, 'linear');
      }
      add(end, {
        ...normalizedRelaxedPose(),
        hips: { r: [0, rootYaw, 0], p: clone3(rootPosition) },
      });
      continue;
    }

    if (action.type === 'bow') {
      add(action.start, {
        ...normalizedRelaxedPose(),
        hips: { r: [0, rootYaw, 0], p: clone3(rootPosition) },
      });
      const bowed = {
        hips: { r: [8, rootYaw, 0] as Vec3Tuple, p: [rootPosition[0], -0.03, rootPosition[2]] as Vec3Tuple },
        spine: { r: [18, 0, 0] as Vec3Tuple },
        chest: { r: [20, 0, 0] as Vec3Tuple },
        upperChest: { r: [12, 0, 0] as Vec3Tuple },
        neck: { r: [-8, 0, 0] as Vec3Tuple },
        head: { r: [-7, 0, 0] as Vec3Tuple },
      };
      add(action.start + action.duration * 0.34, bowed);
      add(action.start + action.duration * 0.7, bowed);
      add(end, {
        ...normalizedRelaxedPose(),
        hips: { r: [0, rootYaw, 0], p: clone3(rootPosition) },
      });
      continue;
    }

    if (action.type === 'jump') {
      add(action.start, {
        ...normalizedRelaxedPose(),
        hips: { r: [0, rootYaw, 0], p: clone3(rootPosition) },
      });
      add(action.start + action.duration * 0.18, {
        hips: { r: [8, rootYaw, 0], p: [rootPosition[0], -0.16, rootPosition[2]] },
        leftUpperLeg: { r: [-28, 0, 2] },
        rightUpperLeg: { r: [-28, 0, -2] },
        leftLowerLeg: { r: [58, 0, 0] },
        rightLowerLeg: { r: [58, 0, 0] },
        spine: { r: [8, 0, 0] },
      });
      add(action.start + action.duration * 0.48, {
        hips: { r: [-4, rootYaw, 0], p: [rootPosition[0], 0.32, rootPosition[2]] },
        leftUpperLeg: { r: [8, 0, 5] },
        rightUpperLeg: { r: [8, 0, -5] },
        leftLowerLeg: { r: [25, 0, 0] },
        rightLowerLeg: { r: [25, 0, 0] },
        leftUpperArm: { r: [0, 0, 48] },
        rightUpperArm: { r: [0, 0, -48] },
      });
      add(action.start + action.duration * 0.78, {
        hips: { r: [8, rootYaw, 0], p: [rootPosition[0], -0.1, rootPosition[2]] },
        leftUpperLeg: { r: [-24, 0, 2] },
        rightUpperLeg: { r: [-24, 0, -2] },
        leftLowerLeg: { r: [52, 0, 0] },
        rightLowerLeg: { r: [52, 0, 0] },
      });
      add(end, {
        ...normalizedRelaxedPose(),
        hips: { r: [0, rootYaw, 0], p: clone3(rootPosition) },
      });
      continue;
    }

    if (action.type === 'turn') {
      const targetYaw = rootYaw + action.degrees;
      add(action.start, { hips: { r: [0, rootYaw, 0], p: clone3(rootPosition) } });
      add(end, { hips: { r: [0, targetYaw, 0], p: clone3(rootPosition) } });
      rootYaw = targetYaw;
      continue;
    }

    if (action.type === 'nod' || action.type === 'shakeHead') {
      add(action.start, { head: { r: [0, 0, 0] }, neck: { r: [0, 0, 0] } });
      for (let index = 0; index < action.repetitions * 2; index += 1) {
        const t = action.start + action.duration * ((index + 1) / (action.repetitions * 2 + 1));
        add(t, action.type === 'nod'
          ? {
              head: { r: [index % 2 === 0 ? 16 : -5, 0, 0] },
              neck: { r: [index % 2 === 0 ? 6 : -2, 0, 0] },
            }
          : {
              head: { r: [0, index % 2 === 0 ? 18 : -18, 0] },
              neck: { r: [0, index % 2 === 0 ? 6 : -6, 0] },
            });
      }
      add(end, { head: { r: [0, 0, 0] }, neck: { r: [0, 0, 0] } });
      continue;
    }

    if (action.type === 'crouch') {
      add(action.start, {
        ...normalizedRelaxedPose(),
        hips: { r: [0, rootYaw, 0], p: clone3(rootPosition) },
      });
      add(action.start + action.duration * 0.45, {
        hips: { r: [5, rootYaw, 0], p: [rootPosition[0], -0.3, rootPosition[2]] },
        leftUpperLeg: { r: [-48, 0, 4] },
        rightUpperLeg: { r: [-48, 0, -4] },
        leftLowerLeg: { r: [90, 0, 0] },
        rightLowerLeg: { r: [90, 0, 0] },
        leftFoot: { r: [-30, 0, 0] },
        rightFoot: { r: [-30, 0, 0] },
        spine: { r: [10, 0, 0] },
      });
      add(end, {
        ...normalizedRelaxedPose(),
        hips: { r: [0, rootYaw, 0], p: clone3(rootPosition) },
      });
    }
  }

  const lastTime = Math.max(...[...frameMap.values()].map((frame) => frame.t));
  if (lastTime < safeDuration - 1 / safeFps) {
    add(safeDuration, { hips: { r: [0, rootYaw, 0], p: clone3(rootPosition) } });
  }

  return {
    frames: [...frameMap.values()].sort((a, b) => a.t - b.t),
    actionsUsed: actions.map((action) => action.type),
    warnings,
  };
}
