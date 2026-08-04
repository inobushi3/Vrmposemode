import { create } from 'zustand';
import type { Keyframe, ModelInfo, ProjectFile, SelectedTransform } from './types';

interface EditorState {
  projectName: string;
  modelInfo: ModelInfo | null;
  modelFileName: string | null;
  availableBones: string[];
  selectedBone: string | null;
  selectedTransform: SelectedTransform;
  duration: number;
  fps: number;
  currentTime: number;
  playing: boolean;
  loop: boolean;
  interpolation: 'LINEAR' | 'STEP';
  keyframes: Keyframe[];
  history: Keyframe[][];
  future: Keyframe[][];
  gizmoMode: 'rotate' | 'translate';
  showGrid: boolean;
  showHandles: boolean;
  background: string;
  status: string;
  dirtyPose: boolean;
  setProjectName: (name: string) => void;
  setModel: (info: ModelInfo | null, fileName?: string | null) => void;
  setAvailableBones: (bones: string[]) => void;
  selectBone: (bone: string | null) => void;
  setSelectedTransform: (transform: SelectedTransform) => void;
  setDuration: (duration: number) => void;
  setFps: (fps: number) => void;
  setCurrentTime: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  togglePlaying: () => void;
  setLoop: (loop: boolean) => void;
  setInterpolation: (value: 'LINEAR' | 'STEP') => void;
  upsertKeyframe: (keyframe: Keyframe) => void;
  importKeyframes: (keyframes: Keyframe[], mode: 'replace' | 'append') => void;
  previewKeyframeTime: (id: string, time: number) => void;
  commitKeyframeTime: (before: Keyframe[]) => void;
  removeKeyframe: (id: string) => void;
  clearKeyframes: () => void;
  undo: () => void;
  redo: () => void;
  setGizmoMode: (mode: 'rotate' | 'translate') => void;
  setShowGrid: (show: boolean) => void;
  setShowHandles: (show: boolean) => void;
  setBackground: (background: string) => void;
  setStatus: (status: string) => void;
  setDirtyPose: (dirty: boolean) => void;
  loadProject: (project: ProjectFile) => void;
}

const defaultTransform: SelectedTransform = {
  rotation: [0, 0, 0],
  position: [0, 0, 0],
};

function cloneFrames(frames: Keyframe[]): Keyframe[] {
  return structuredClone(frames);
}

function lastKeyframeTime(frames: Keyframe[]): number {
  return frames.reduce((last, frame) => Math.max(last, frame.time), 0);
}

function normalizeDuration(value: number, frames: Keyframe[], fallback = 10): number {
  const safeValue = Number.isFinite(value) ? value : fallback;
  return Math.max(0.1, Math.min(3600, safeValue), lastKeyframeTime(frames));
}

function keyframeTimesChanged(before: Keyframe[], after: Keyframe[]): boolean {
  if (before.length !== after.length) return true;
  return before.some((frame) => {
    const next = after.find((candidate) => candidate.id === frame.id);
    return !next || Math.abs(next.time - frame.time) > 0.000001;
  });
}

function frameNumber(time: number, fps: number): number {
  return Math.round(time * Math.max(1, fps));
}

export const useEditorStore = create<EditorState>((set, get) => ({
  projectName: 'Minha animação',
  modelInfo: null,
  modelFileName: null,
  availableBones: [],
  selectedBone: null,
  selectedTransform: defaultTransform,
  duration: 10,
  fps: 30,
  currentTime: 0,
  playing: false,
  loop: true,
  interpolation: 'LINEAR',
  keyframes: [],
  history: [],
  future: [],
  gizmoMode: 'rotate',
  showGrid: true,
  showHandles: true,
  background: '#171321',
  status: 'Abra ou arraste um modelo VRM para começar.',
  dirtyPose: false,

  setProjectName: (projectName) => set({ projectName }),
  setModel: (modelInfo, modelFileName = null) => set({ modelInfo, modelFileName }),
  setAvailableBones: (availableBones) => set({ availableBones }),
  selectBone: (selectedBone) => set({ selectedBone }),
  setSelectedTransform: (selectedTransform) => set({ selectedTransform }),
  setDuration: (duration) => {
    const frames = get().keyframes;
    const requested = Number.isFinite(duration) ? duration : get().duration;
    const finalDuration = normalizeDuration(requested, frames, get().duration);
    const finalKeyframe = lastKeyframeTime(frames);
    set({
      duration: finalDuration,
      currentTime: Math.min(get().currentTime, finalDuration),
      playing: get().currentTime >= finalDuration ? false : get().playing,
      status: requested < finalKeyframe
        ? `A duração mínima é ${finalKeyframe.toFixed(2)}s porque existe um keyframe nesse ponto.`
        : get().status,
    });
  },
  setFps: (fps) => set({ fps: Math.max(1, Math.min(120, Math.round(fps))) }),
  setCurrentTime: (currentTime) => set({ currentTime: Math.max(0, Math.min(get().duration, currentTime)) }),
  setPlaying: (playing) => set({ playing }),
  togglePlaying: () => set({ playing: !get().playing }),
  setLoop: (loop) => set({ loop }),
  setInterpolation: (interpolation) => set({ interpolation }),

  upsertKeyframe: (keyframe) => {
    const current = cloneFrames(get().keyframes);
    const tolerance = 0.0005;
    const existing = current.findIndex((item) => Math.abs(item.time - keyframe.time) < tolerance);
    if (existing >= 0) current[existing] = { ...keyframe, id: current[existing].id };
    else current.push(keyframe);
    current.sort((a, b) => a.time - b.time);
    set({ keyframes: current, history: [...get().history.slice(-49), cloneFrames(get().keyframes)], future: [], dirtyPose: false });
  },

  importKeyframes: (incoming, mode) => {
    if (!incoming.length) return;
    const before = cloneFrames(get().keyframes);
    const fps = get().fps;
    const next = mode === 'replace' ? [] : cloneFrames(get().keyframes);
    for (const frame of cloneFrames(incoming)) {
      const occupied = next.findIndex((item) => frameNumber(item.time, fps) === frameNumber(frame.time, fps));
      if (occupied >= 0) next[occupied] = frame;
      else next.push(frame);
    }
    next.sort((a, b) => a.time - b.time);
    const last = lastKeyframeTime(next);
    const duration = mode === 'replace'
      ? Math.max(0.1, Math.min(3600, last))
      : Math.max(get().duration, last);
    set({
      keyframes: next,
      duration,
      currentTime: Math.min(duration, Math.max(0, incoming[0].time)),
      playing: false,
      history: [...get().history.slice(-49), before],
      future: [],
      dirtyPose: false,
    });
  },

  previewKeyframeTime: (id, time) => {
    const safeTime = Math.max(0, Math.min(get().duration, Number.isFinite(time) ? time : 0));
    const current = cloneFrames(get().keyframes);
    const index = current.findIndex((frame) => frame.id === id);
    if (index < 0) return;
    current[index] = { ...current[index], time: safeTime };
    current.sort((a, b) => a.time - b.time);
    set({
      keyframes: current,
      currentTime: safeTime,
      playing: false,
    });
  },

  commitKeyframeTime: (before) => {
    const after = get().keyframes;
    if (!keyframeTimesChanged(before, after)) return;
    set({
      history: [...get().history.slice(-49), cloneFrames(before)],
      future: [],
      status: `Keyframe movido para ${get().currentTime.toFixed(2)}s.`,
    });
  },

  removeKeyframe: (id) => {
    const next = get().keyframes.filter((frame) => frame.id !== id);
    set({ keyframes: next, history: [...get().history.slice(-49), cloneFrames(get().keyframes)], future: [] });
  },

  clearKeyframes: () => {
    if (get().keyframes.length === 0) return;
    set({ keyframes: [], history: [...get().history.slice(-49), cloneFrames(get().keyframes)], future: [] });
  },

  undo: () => {
    const history = get().history;
    if (!history.length) return;
    const previous = history[history.length - 1];
    set({
      keyframes: cloneFrames(previous),
      history: history.slice(0, -1),
      future: [cloneFrames(get().keyframes), ...get().future.slice(0, 49)],
    });
  },

  redo: () => {
    const future = get().future;
    if (!future.length) return;
    const next = future[0];
    set({
      keyframes: cloneFrames(next),
      future: future.slice(1),
      history: [...get().history.slice(-49), cloneFrames(get().keyframes)],
    });
  },

  setGizmoMode: (gizmoMode) => set({ gizmoMode }),
  setShowGrid: (showGrid) => set({ showGrid }),
  setShowHandles: (showHandles) => set({ showHandles }),
  setBackground: (background) => set({ background }),
  setStatus: (status) => set({ status }),
  setDirtyPose: (dirtyPose) => set({ dirtyPose }),

  loadProject: (project) => set({
    projectName: project.name,
    duration: normalizeDuration(project.duration, project.keyframes),
    fps: Math.max(1, Math.min(120, Math.round(project.fps))),
    interpolation: project.interpolation ?? 'LINEAR',
    keyframes: cloneFrames(project.keyframes),
    currentTime: 0,
    playing: false,
    history: [],
    future: [],
    status: `Projeto “${project.name}” carregado. Abra o modelo correspondente para visualizar.`,
  }),
}));
