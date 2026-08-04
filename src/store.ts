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

export const useEditorStore = create<EditorState>((set, get) => ({
  projectName: 'Minha animação',
  modelInfo: null,
  modelFileName: null,
  availableBones: [],
  selectedBone: null,
  selectedTransform: defaultTransform,
  duration: 3,
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
  setDuration: (duration) => set({ duration: Math.max(0.1, duration), currentTime: Math.min(get().currentTime, Math.max(0.1, duration)) }),
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
    duration: project.duration,
    fps: project.fps,
    interpolation: project.interpolation ?? 'LINEAR',
    keyframes: cloneFrames(project.keyframes),
    currentTime: 0,
    playing: false,
    history: [],
    future: [],
    status: `Projeto “${project.name}” carregado. Abra o modelo correspondente para visualizar.`,
  }),
}));
