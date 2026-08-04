import type { DetectedPoseFrame, PosePoint } from './poseRetargeter';

export const RTMW3D_INPUT_WIDTH = 288;
export const RTMW3D_INPUT_HEIGHT = 384;

export interface Rtmw3dCrop {
  rgba: Uint8Array;
  centerX: number;
  centerY: number;
  scaleWidth: number;
  scaleHeight: number;
  sourceWidth: number;
  sourceHeight: number;
}

export interface Rtmw3dRawPoint {
  x: number;
  y: number;
  z: number;
  score: number;
}

const BODY_BBOX_INDICES = [0, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

function valid(point: PosePoint | undefined): point is PosePoint {
  return Boolean(point) && Number.isFinite(point!.x) && Number.isFinite(point!.y)
    && Math.min(point!.visibility ?? 1, point!.presence ?? 1) >= 0.12;
}

export function createRtmw3dCrop(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  detectorLandmarks: PosePoint[],
): Rtmw3dCrop {
  const points = BODY_BBOX_INDICES.map((index) => detectorLandmarks[index]).filter(valid);
  let x1 = 0;
  let y1 = 0;
  let x2 = sourceWidth;
  let y2 = sourceHeight;
  if (points.length >= 6) {
    x1 = Math.min(...points.map((point) => point.x)) * sourceWidth;
    y1 = Math.min(...points.map((point) => point.y)) * sourceHeight;
    x2 = Math.max(...points.map((point) => point.x)) * sourceWidth;
    y2 = Math.max(...points.map((point) => point.y)) * sourceHeight;
  }

  const centerX = (x1 + x2) * 0.5;
  const centerY = (y1 + y2) * 0.5;
  let scaleWidth = Math.max(32, x2 - x1) * 1.25;
  let scaleHeight = Math.max(32, y2 - y1) * 1.25;
  const targetAspect = RTMW3D_INPUT_WIDTH / RTMW3D_INPUT_HEIGHT;
  if (scaleWidth > scaleHeight * targetAspect) scaleHeight = scaleWidth / targetAspect;
  else scaleWidth = scaleHeight * targetAspect;

  const canvas = document.createElement('canvas');
  canvas.width = RTMW3D_INPUT_WIDTH;
  canvas.height = RTMW3D_INPUT_HEIGHT;
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D indisponível para o RTMW3D.');
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.translate(canvas.width * 0.5, canvas.height * 0.5);
  context.scale(canvas.width / scaleWidth, canvas.height / scaleHeight);
  context.translate(-centerX, -centerY);
  context.drawImage(source, 0, 0, sourceWidth, sourceHeight);
  context.restore();
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

  return {
    rgba: new Uint8Array(imageData.data),
    centerX,
    centerY,
    scaleWidth,
    scaleHeight,
    sourceWidth,
    sourceHeight,
  };
}

function averageRaw(points: Rtmw3dRawPoint[], indices: number[]): Rtmw3dRawPoint {
  const available = indices.map((index) => points[index]).filter(Boolean);
  if (!available.length) return { x: 0, y: 0, z: 0, score: 0 };
  const factor = 1 / available.length;
  return available.reduce((result, point) => ({
    x: result.x + point.x * factor,
    y: result.y + point.y * factor,
    z: result.z + point.z * factor,
    score: result.score + point.score * factor,
  }), { x: 0, y: 0, z: 0, score: 0 });
}

function mapWholeBody(points: Rtmw3dRawPoint[]): Rtmw3dRawPoint[] {
  const point = (index: number): Rtmw3dRawPoint => points[index] ?? { x: 0, y: 0, z: 0, score: 0 };
  return [
    point(0),
    point(1), point(1), point(1),
    point(2), point(2), point(2),
    point(3), point(4),
    point(0), point(0),
    point(5), point(6),
    point(7), point(8),
    point(9), point(10),
    point(111), point(132),
    point(99), point(120),
    point(95), point(116),
    point(11), point(12),
    point(13), point(14),
    point(15), point(16),
    point(19), point(22),
    averageRaw(points, [17, 18]), averageRaw(points, [20, 21]),
  ];
}

function cropToSource(point: Rtmw3dRawPoint, crop: Rtmw3dCrop): { x: number; y: number } {
  return {
    x: crop.centerX + (point.x / RTMW3D_INPUT_WIDTH - 0.5) * crop.scaleWidth,
    y: crop.centerY + (point.y / RTMW3D_INPUT_HEIGHT - 0.5) * crop.scaleHeight,
  };
}

function distance(a: Rtmw3dRawPoint, b: Rtmw3dRawPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function rtmw3dToDetectedFrame(
  rawPoints: Rtmw3dRawPoint[],
  crop: Rtmw3dCrop,
  time: number,
): DetectedPoseFrame {
  const mapped = mapWholeBody(rawPoints);
  const hipCenter = averageRaw(mapped, [23, 24]);
  const shoulderCenter = averageRaw(mapped, [11, 12]);
  const torsoScale = Math.max(24, distance(hipCenter, shoulderCenter));
  const hipDepth = (mapped[23].z + mapped[24].z) * 0.5;

  const normalized: PosePoint[] = mapped.map((point) => {
    const source = cropToSource(point, crop);
    return {
      x: source.x / crop.sourceWidth,
      y: source.y / crop.sourceHeight,
      z: point.z - hipDepth,
      visibility: Math.max(0, Math.min(1, point.score)),
      presence: Math.max(0, Math.min(1, point.score)),
    };
  });

  const world: PosePoint[] = mapped.map((point) => ({
    x: (point.x - hipCenter.x) / torsoScale,
    y: (point.y - hipCenter.y) / torsoScale,
    z: point.z - hipDepth,
    visibility: Math.max(0, Math.min(1, point.score)),
    presence: Math.max(0, Math.min(1, point.score)),
  }));

  const confidenceIndices = [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
  const confidence = confidenceIndices.reduce((sum, index) => sum + (normalized[index].visibility ?? 0), 0) / confidenceIndices.length;
  return { time, normalized, world, confidence };
}
