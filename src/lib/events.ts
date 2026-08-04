export const editorEvent = {
  loadModel: 'vrmpose:load-model',
  captureKeyframe: 'vrmpose:capture-keyframe',
  resetPose: 'vrmpose:reset-pose',
  applyPreset: 'vrmpose:apply-preset',
  exportVrma: 'vrmpose:export-vrma',
  setBoneRotation: 'vrmpose:set-bone-rotation',
  setBonePosition: 'vrmpose:set-bone-position',
  resetBone: 'vrmpose:reset-bone',
  camera: 'vrmpose:camera',
  screenshot: 'vrmpose:screenshot',
} as const;

export function dispatchEditorEvent<T>(name: string, detail?: T): void {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}
