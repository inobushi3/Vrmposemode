import { PoseLandmarker } from '@mediapipe/tasks-vision';

interface PoseLandmarkerVideoPrototype {
  detectForVideo: (source: CanvasImageSource, timestamp: number, ...rest: unknown[]) => unknown;
}

const prototype = PoseLandmarker.prototype as unknown as PoseLandmarkerVideoPrototype & {
  __vrmPoseTimestampGuard?: boolean;
};

if (!prototype.__vrmPoseTimestampGuard) {
  const originalDetectForVideo = prototype.detectForVideo;
  const lastTimestamp = new WeakMap<object, number>();

  prototype.detectForVideo = function guardedDetectForVideo(
    this: object,
    source: CanvasImageSource,
    requestedTimestamp: number,
    ...rest: unknown[]
  ): unknown {
    const previous = lastTimestamp.get(this) ?? -1;
    const safeTimestamp = Number.isFinite(requestedTimestamp)
      ? Math.max(Math.round(requestedTimestamp), previous + 1)
      : previous + 1;
    lastTimestamp.set(this, safeTimestamp);
    return originalDetectForVideo.call(this, source, safeTimestamp, ...rest);
  };

  Object.defineProperty(prototype, '__vrmPoseTimestampGuard', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}
