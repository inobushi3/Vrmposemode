const STORAGE_KEY = 'vrm-pose-mode:rtmw3d-depth-strength';
const DEFAULT_STRENGTH = 0.65;

function clamp(value: number): number {
  return Math.max(0, Math.min(1.5, value));
}

function initialValue(): number {
  if (typeof window === 'undefined') return DEFAULT_STRENGTH;
  const stored = Number(window.localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(stored) ? clamp(stored) : DEFAULT_STRENGTH;
}

let depthStrength = initialValue();

export function getRtmw3dDepthStrength(): number {
  return depthStrength;
}

export function setRtmw3dDepthStrength(value: number): number {
  depthStrength = clamp(value);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, String(depthStrength));
  }
  return depthStrength;
}

export function resetRtmw3dDepthStrength(): number {
  return setRtmw3dDepthStrength(DEFAULT_STRENGTH);
}
