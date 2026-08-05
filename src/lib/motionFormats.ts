export type MotionFormat = 'vrma' | 'bvh' | 'fbx' | 'glb' | 'gltf' | 'pmp' | 'pap';

export const MOTION_FILE_ACCEPT = '.vrma,.bvh,.fbx,.glb,.gltf,.pmp,.pap';

export const MOTION_FORMAT_LABELS: Record<MotionFormat, string> = {
  vrma: 'VRMA',
  bvh: 'BVH',
  fbx: 'FBX',
  glb: 'GLB',
  gltf: 'glTF',
  pmp: 'Penumbra PMP',
  pap: 'FFXIV PAP',
};

export function detectMotionFormat(fileName: string): MotionFormat | null {
  const extension = fileName.split('.').pop()?.toLowerCase();
  if (extension === 'vrma' || extension === 'bvh' || extension === 'fbx'
    || extension === 'glb' || extension === 'gltf' || extension === 'pmp' || extension === 'pap') {
    return extension;
  }
  return null;
}

export function isDirectlyConvertibleMotion(format: MotionFormat): boolean {
  return format === 'vrma' || format === 'bvh' || format === 'fbx' || format === 'glb' || format === 'gltf';
}

export function motionName(fileName: string): string {
  return fileName.replace(/\.(vrma|bvh|fbx|glb|gltf|pmp|pap)$/i, '').trim() || 'Motion';
}
