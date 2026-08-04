import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Box, ChevronDown, CircleDot, Clock3, Download, Eye, EyeOff, FolderOpen,
  Grid3X3, Image, KeyRound, Minus, MousePointer2, Move3D, Pause,
  Play, Plus, Redo2, Rotate3D, RotateCcw, Save, Search, Settings2, SkipBack,
  SlidersHorizontal, Sparkles, Square, Trash2, Undo2, Upload, X,
} from 'lucide-react';
import Viewport from './components/Viewport';
import { BONE_GROUPS, POSE_PRESETS, boneLabel } from './constants';
import { dispatchEditorEvent, editorEvent } from './lib/events';
import { useEditorStore } from './store';
import type { ProjectFile, Vec3Tuple } from './types';

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'vrm-animation';
}

function downloadFile(content: BlobPart, type: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function IconButton({ title, active, disabled, onClick, children }: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button className={`icon-button${active ? ' active' : ''}`} title={title} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function TitleBar(): JSX.Element {
  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <div className="brand-mark"><Box size={15} strokeWidth={2.3} /></div>
        <strong>VRM Pose Mode</strong>
        <span>Animation Studio</span>
      </div>
      <div className="titlebar-drag" />
      <div className="window-buttons">
        <button title="Minimizar" onClick={() => window.desktop?.minimize()}><Minus size={15} /></button>
        <button title="Maximizar" onClick={() => window.desktop?.maximize()}><Square size={12} /></button>
        <button className="close" title="Fechar" onClick={() => window.desktop?.close()}><X size={15} /></button>
      </div>
    </header>
  );
}

function Toolbar(): JSX.Element {
  const modelInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const modelInfo = useEditorStore((state) => state.modelInfo);
  const projectName = useEditorStore((state) => state.projectName);
  const duration = useEditorStore((state) => state.duration);
  const fps = useEditorStore((state) => state.fps);
  const interpolation = useEditorStore((state) => state.interpolation);
  const keyframes = useEditorStore((state) => state.keyframes);
  const modelFileName = useEditorStore((state) => state.modelFileName);
  const gizmoMode = useEditorStore((state) => state.gizmoMode);
  const history = useEditorStore((state) => state.history);
  const future = useEditorStore((state) => state.future);
  const setGizmoMode = useEditorStore((state) => state.setGizmoMode);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const loadProject = useEditorStore((state) => state.loadProject);
  const setStatus = useEditorStore((state) => state.setStatus);

  const saveProject = (): void => {
    const project: ProjectFile = {
      app: 'VRM Pose Mode',
      version: 1,
      name: projectName,
      duration,
      fps,
      interpolation,
      modelFileName: modelFileName ?? undefined,
      keyframes,
    };
    downloadFile(JSON.stringify(project, null, 2), 'application/json', `${safeFileName(projectName)}.vrmpose.json`);
    setStatus('Projeto salvo. O modelo VRM não é incorporado ao JSON.');
  };

  const importProject = async (file: File): Promise<void> => {
    try {
      const data = JSON.parse(await file.text()) as ProjectFile;
      if (data.app !== 'VRM Pose Mode' || data.version !== 1 || !Array.isArray(data.keyframes)) throw new Error();
      loadProject(data);
    } catch {
      setStatus('Esse arquivo não é um projeto válido do VRM Pose Mode.');
    }
  };

  return (
    <div className="toolbar">
      <input
        ref={modelInput}
        hidden
        type="file"
        accept=".vrm,.glb,.gltf"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) dispatchEditorEvent(editorEvent.loadModel, file);
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={projectInput}
        hidden
        type="file"
        accept=".json,.vrmpose.json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importProject(file);
          event.currentTarget.value = '';
        }}
      />

      <button className="primary-button" onClick={() => modelInput.current?.click()}>
        <FolderOpen size={16} /> Abrir modelo
      </button>
      <div className="toolbar-separator" />
      <IconButton title="Importar projeto" onClick={() => projectInput.current?.click()}><Upload size={17} /></IconButton>
      <IconButton title="Salvar projeto" onClick={saveProject}><Save size={17} /></IconButton>
      <div className="toolbar-separator" />
      <IconButton title="Desfazer" disabled={!history.length} onClick={undo}><Undo2 size={17} /></IconButton>
      <IconButton title="Refazer" disabled={!future.length} onClick={redo}><Redo2 size={17} /></IconButton>
      <div className="toolbar-separator" />
      <IconButton title="Rotacionar osso (R)" active={gizmoMode === 'rotate'} onClick={() => setGizmoMode('rotate')}><Rotate3D size={18} /></IconButton>
      <IconButton title="Mover quadril (G)" active={gizmoMode === 'translate'} onClick={() => setGizmoMode('translate')}><Move3D size={18} /></IconButton>
      <IconButton title="Resetar pose" disabled={!modelInfo} onClick={() => dispatchEditorEvent(editorEvent.resetPose)}><RotateCcw size={17} /></IconButton>
      <div className="toolbar-spacer" />
      <button className="secondary-button" onClick={() => dispatchEditorEvent(editorEvent.screenshot)} disabled={!modelInfo}>
        <Image size={16} /> Capturar PNG
      </button>
      <button className="export-button" onClick={() => dispatchEditorEvent(editorEvent.exportVrma)} disabled={!modelInfo}>
        <Download size={16} /> Exportar VRMA
      </button>
    </div>
  );
}

function LeftSidebar(): JSX.Element {
  const [tab, setTab] = useState<'bones' | 'poses'>('bones');
  const [search, setSearch] = useState('');
  const availableBones = useEditorStore((state) => state.availableBones);
  const selectedBone = useEditorStore((state) => state.selectedBone);
  const selectBone = useEditorStore((state) => state.selectBone);
  const modelInfo = useEditorStore((state) => state.modelInfo);

  const groups = useMemo(() => BONE_GROUPS.map((group) => ({
    ...group,
    bones: group.bones.filter((bone) => availableBones.includes(bone) && boneLabel(bone).toLowerCase().includes(search.toLowerCase())),
  })).filter((group) => group.bones.length), [availableBones, search]);

  const ungrouped = availableBones.filter((bone) =>
    !BONE_GROUPS.some((group) => group.bones.some((item) => item === bone)) && bone.toLowerCase().includes(search.toLowerCase()));

  return (
    <aside className="left-sidebar panel">
      <div className="segmented-tabs">
        <button className={tab === 'bones' ? 'active' : ''} onClick={() => setTab('bones')}><CircleDot size={15} /> Ossos</button>
        <button className={tab === 'poses' ? 'active' : ''} onClick={() => setTab('poses')}><Sparkles size={15} /> Poses</button>
      </div>

      {tab === 'bones' ? (
        <>
          <div className="search-box"><Search size={14} /><input placeholder="Buscar osso…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          <div className="panel-section-heading"><span>Hierarquia humanoide</span><small>{availableBones.length}</small></div>
          <div className="bone-list scroll-area">
            {!modelInfo && <div className="empty-panel">Abra um VRM para ver e editar o esqueleto humanoide.</div>}
            {groups.map((group) => (
              <details key={group.title} open>
                <summary><ChevronDown size={13} /> {group.title}</summary>
                {group.bones.map((bone) => (
                  <button key={bone} className={selectedBone === bone ? 'selected' : ''} onClick={() => selectBone(bone)}>
                    <span className={`bone-dot ${bone.startsWith('left') ? 'left' : bone.startsWith('right') ? 'right' : ''}`} />
                    <span>{boneLabel(bone)}</span>
                    <small>{bone}</small>
                  </button>
                ))}
              </details>
            ))}
            {ungrouped.map((bone) => (
              <button key={bone} className={selectedBone === bone ? 'selected' : ''} onClick={() => selectBone(bone)}>
                <span className="bone-dot" /><span>{boneLabel(bone)}</span><small>{bone}</small>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="pose-library scroll-area">
          <div className="panel-intro">Aplique uma base, refine com o gizmo e salve um keyframe.</div>
          {POSE_PRESETS.map((preset, index) => (
            <button key={preset.id} disabled={!modelInfo} onClick={() => dispatchEditorEvent(editorEvent.applyPreset, preset.id)}>
              <span className={`pose-preview pose-${index + 1}`}><Sparkles size={18} /></span>
              <span><strong>{preset.name}</strong><small>{preset.description}</small></span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}

function NumberField({ value, onChange, step = 1, disabled }: { value: number; onChange: (value: number) => void; step?: number; disabled?: boolean }): JSX.Element {
  return <input type="number" value={Number.isFinite(value) ? Number(value.toFixed(2)) : 0} step={step} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />;
}

function TransformInspector(): JSX.Element {
  const selectedBone = useEditorStore((state) => state.selectedBone);
  const transform = useEditorStore((state) => state.selectedTransform);
  const modelInfo = useEditorStore((state) => state.modelInfo);
  const setTransformRotation = (axis: number, value: number): void => {
    const next = [...transform.rotation] as Vec3Tuple;
    next[axis] = value;
    dispatchEditorEvent(editorEvent.setBoneRotation, next);
  };
  const setTransformPosition = (axis: number, value: number): void => {
    const next = [...transform.position] as Vec3Tuple;
    next[axis] = value;
    dispatchEditorEvent(editorEvent.setBonePosition, next);
  };

  return (
    <section className="inspector-section">
      <div className="section-title"><SlidersHorizontal size={15} /><span>Transformação</span></div>
      <div className="selected-bone-card">
        <span className="selected-bone-icon"><CircleDot size={18} /></span>
        <span><strong>{selectedBone ? boneLabel(selectedBone) : 'Nenhum osso'}</strong><small>{selectedBone ?? 'Selecione um osso no modelo'}</small></span>
        <IconButton title="Resetar osso" disabled={!selectedBone} onClick={() => dispatchEditorEvent(editorEvent.resetBone)}><RotateCcw size={14} /></IconButton>
      </div>

      <label className="field-label">Rotação local</label>
      <div className="axis-grid">
        {(['X', 'Y', 'Z'] as const).map((axis, index) => (
          <label key={axis}><span className={`axis axis-${axis.toLowerCase()}`}>{axis}</span><NumberField value={transform.rotation[index]} disabled={!selectedBone} onChange={(value) => setTransformRotation(index, value)} /><small>°</small></label>
        ))}
      </div>

      <label className="field-label">Posição do quadril</label>
      <div className="axis-grid">
        {(['X', 'Y', 'Z'] as const).map((axis, index) => (
          <label key={axis}><span className={`axis axis-${axis.toLowerCase()}`}>{axis}</span><NumberField step={0.01} value={transform.position[index]} disabled={selectedBone !== 'hips'} onChange={(value) => setTransformPosition(index, value)} /><small>m</small></label>
        ))}
      </div>
      {modelInfo?.format !== 'VRM' && modelInfo && <div className="warning-note">GLB/GLTF pode ser posicionado, mas a exportação VRMA requer mapeamento humanoide VRM.</div>}
    </section>
  );
}

function SceneInspector(): JSX.Element {
  const showGrid = useEditorStore((state) => state.showGrid);
  const showHandles = useEditorStore((state) => state.showHandles);
  const background = useEditorStore((state) => state.background);
  const setShowGrid = useEditorStore((state) => state.setShowGrid);
  const setShowHandles = useEditorStore((state) => state.setShowHandles);
  const setBackground = useEditorStore((state) => state.setBackground);

  return (
    <section className="inspector-section">
      <div className="section-title"><Settings2 size={15} /><span>Cena e câmera</span></div>
      <div className="camera-buttons">
        {['front', 'three', 'left', 'right', 'back', 'head'].map((view) => (
          <button key={view} onClick={() => dispatchEditorEvent(editorEvent.camera, view)}>{({ front: 'Frente', three: '3/4', left: 'Esq.', right: 'Dir.', back: 'Costas', head: 'Rosto' } as Record<string, string>)[view]}</button>
        ))}
      </div>
      <label className="toggle-row"><span><Grid3X3 size={15} /> Grade</span><input type="checkbox" checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} /></label>
      <label className="toggle-row"><span>{showHandles ? <Eye size={15} /> : <EyeOff size={15} />} Controles dos ossos</span><input type="checkbox" checked={showHandles} onChange={(event) => setShowHandles(event.target.checked)} /></label>
      <label className="color-row"><span>Fundo</span><input type="color" value={background} onChange={(event) => setBackground(event.target.value)} /><code>{background}</code></label>
    </section>
  );
}

function ProjectInspector(): JSX.Element {
  const projectName = useEditorStore((state) => state.projectName);
  const duration = useEditorStore((state) => state.duration);
  const fps = useEditorStore((state) => state.fps);
  const interpolation = useEditorStore((state) => state.interpolation);
  const modelInfo = useEditorStore((state) => state.modelInfo);
  const setProjectName = useEditorStore((state) => state.setProjectName);
  const setDuration = useEditorStore((state) => state.setDuration);
  const setFps = useEditorStore((state) => state.setFps);
  const setInterpolation = useEditorStore((state) => state.setInterpolation);

  return (
    <section className="inspector-section">
      <div className="section-title"><Clock3 size={15} /><span>Projeto</span></div>
      <label className="stack-field"><span>Nome da animação</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label>
      <div className="two-fields">
        <label className="stack-field"><span>Duração</span><div><NumberField value={duration} step={0.1} onChange={setDuration} /><small>s</small></div></label>
        <label className="stack-field"><span>FPS</span><div><NumberField value={fps} onChange={setFps} /><small>fps</small></div></label>
      </div>
      <label className="stack-field"><span>Interpolação exportada</span><select value={interpolation} onChange={(event) => setInterpolation(event.target.value as 'LINEAR' | 'STEP')}><option value="LINEAR">Linear</option><option value="STEP">Sem interpolação</option></select></label>
      {modelInfo && (
        <div className="model-summary">
          <div><Box size={18} /><span><strong>{modelInfo.avatarName || modelInfo.name}</strong><small>{modelInfo.format} · {modelInfo.boneCount} ossos</small></span></div>
          {modelInfo.author && <small>Autor: {modelInfo.author}</small>}
        </div>
      )}
    </section>
  );
}

function RightInspector(): JSX.Element {
  return (
    <aside className="right-sidebar panel scroll-area">
      <TransformInspector />
      <SceneInspector />
      <ProjectInspector />
    </aside>
  );
}

function Timeline(): JSX.Element {
  const currentTime = useEditorStore((state) => state.currentTime);
  const duration = useEditorStore((state) => state.duration);
  const fps = useEditorStore((state) => state.fps);
  const playing = useEditorStore((state) => state.playing);
  const loop = useEditorStore((state) => state.loop);
  const keyframes = useEditorStore((state) => state.keyframes);
  const dirtyPose = useEditorStore((state) => state.dirtyPose);
  const setCurrentTime = useEditorStore((state) => state.setCurrentTime);
  const togglePlaying = useEditorStore((state) => state.togglePlaying);
  const setPlaying = useEditorStore((state) => state.setPlaying);
  const setLoop = useEditorStore((state) => state.setLoop);
  const removeKeyframe = useEditorStore((state) => state.removeKeyframe);
  const clearKeyframes = useEditorStore((state) => state.clearKeyframes);

  const frame = Math.round(currentTime * fps);
  const totalFrames = Math.round(duration * fps);
  const ticks = useMemo(() => Array.from({ length: 11 }, (_, index) => (duration / 10) * index), [duration]);
  const nearest = keyframes.reduce<{ id: string; distance: number } | null>((best, item) => {
    const distance = Math.abs(item.time - currentTime);
    return !best || distance < best.distance ? { id: item.id, distance } : best;
  }, null);

  return (
    <section className="timeline panel">
      <div className="timeline-controls">
        <IconButton title="Voltar ao início" onClick={() => { setPlaying(false); setCurrentTime(0); }}><SkipBack size={17} /></IconButton>
        <button className="play-button" onClick={togglePlaying}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
        <div className="time-readout"><strong>{currentTime.toFixed(2)}s</strong><span>F {frame} / {totalFrames}</span></div>
        <button className={`loop-button${loop ? ' active' : ''}`} onClick={() => setLoop(!loop)}><RotateCcw size={14} /> Loop</button>
        <div className="timeline-spacer" />
        {dirtyPose && <span className="unsaved-pose"><span /> Pose não salva</span>}
        <button className="add-key-button" onClick={() => dispatchEditorEvent(editorEvent.captureKeyframe)}><KeyRound size={15} /><Plus size={11} /> Keyframe</button>
        <IconButton title="Excluir keyframe mais próximo" disabled={!nearest} onClick={() => nearest && removeKeyframe(nearest.id)}><Trash2 size={16} /></IconButton>
        <IconButton title="Limpar timeline" disabled={!keyframes.length} onClick={clearKeyframes}><X size={16} /></IconButton>
      </div>
      <div className="timeline-track-wrap">
        <div className="timeline-ruler">
          {ticks.map((tick) => <span key={tick} style={{ left: `${(tick / duration) * 100}%` }}>{tick.toFixed(tick % 1 ? 1 : 0)}s</span>)}
        </div>
        <div className="timeline-track">
          <div className="timeline-fill" style={{ width: `${(currentTime / duration) * 100}%` }} />
          {keyframes.map((keyframe) => (
            <button
              key={keyframe.id}
              className={`keyframe-dot${Math.abs(keyframe.time - currentTime) < 0.015 ? ' active' : ''}`}
              style={{ left: `${(keyframe.time / duration) * 100}%` }}
              title={`${keyframe.time.toFixed(2)}s`}
              onClick={() => { setPlaying(false); setCurrentTime(keyframe.time); }}
            ><span /></button>
          ))}
          <div className="playhead" style={{ left: `${(currentTime / duration) * 100}%` }}><span /></div>
          <input
            aria-label="Tempo da timeline"
            type="range"
            min={0}
            max={duration}
            step={1 / fps}
            value={currentTime}
            onChange={(event) => { setPlaying(false); setCurrentTime(Number(event.target.value)); }}
          />
        </div>
      </div>
    </section>
  );
}

function StatusBar(): JSX.Element {
  const status = useEditorStore((state) => state.status);
  const model = useEditorStore((state) => state.modelInfo);
  return (
    <footer className="statusbar">
      <span className={`status-dot${model ? ' ready' : ''}`} />
      <span>{status}</span>
      <div className="status-spacer" />
      <span>VRMA 1.0</span><span>Three.js</span><span>Electron</span>
    </footer>
  );
}

export default function App(): JSX.Element {
  const setGizmoMode = useEditorStore((state) => state.setGizmoMode);
  const togglePlaying = useEditorStore((state) => state.togglePlaying);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select')) return;
      if (event.code === 'Space') { event.preventDefault(); togglePlaying(); }
      if (event.key.toLowerCase() === 'r') setGizmoMode('rotate');
      if (event.key.toLowerCase() === 'g') setGizmoMode('translate');
      if (event.key.toLowerCase() === 'k') dispatchEditorEvent(editorEvent.captureKeyframe);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [redo, setGizmoMode, togglePlaying, undo]);

  return (
    <div className="app-shell">
      <TitleBar />
      <Toolbar />
      <main className="workspace">
        <LeftSidebar />
        <section className="center-workspace">
          <div className="viewport-shell">
            <Viewport />
            <div className="viewport-badge"><MousePointer2 size={13} /> Edição local</div>
          </div>
          <Timeline />
        </section>
        <RightInspector />
      </main>
      <StatusBar />
    </div>
  );
}
