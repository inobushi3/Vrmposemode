import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  Check, FileBox, FolderOpen, Gauge, LoaderCircle, Move3D, Play,
  RotateCcw, Sparkles, Upload, X,
} from 'lucide-react';
import { useEditorStore } from '../store';
import { loadMmdModel, type LoadedMmdModel } from '../lib/mmdModelLoader';
import { retargetMmdMotion, type RetargetedMmdMotion } from '../lib/mmdMotionRetargeter';
import {
  expandMmdMotionSelection,
  parseVmd,
  type ParsedVmd,
} from '../lib/mmdVmdParser';

type ImportMode = 'replace' | 'append';

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Falha desconhecida.');
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileSummary(files: File[]): string {
  const archive = files.find((file) => /\.zip$/i.test(file.name));
  if (archive) return archive.name;
  const models = files.filter((file) => /\.(pmx|pmd)$/i.test(file.name));
  const model = models.sort((a, b) => b.size - a.size)[0];
  return model?.name ?? `${files.length} arquivo(s)`;
}

function displayName(file: File): string {
  return file.name.replace(/\\/g, '/').split('/').pop() ?? file.name;
}

function disposeMaterial(material: THREE.Material): void {
  const record = material as unknown as Record<string, unknown>;
  for (const value of Object.values(record)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
  material.dispose();
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose?.();
    if (Array.isArray(mesh.material)) mesh.material.forEach(disposeMaterial);
    else if (mesh.material) disposeMaterial(mesh.material);
  });
}

export default function MmdStudio(): JSX.Element | null {
  const [toolbarHost, setToolbarHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [modelFiles, setModelFiles] = useState<File[]>([]);
  const [motionPackageFiles, setMotionPackageFiles] = useState<File[]>([]);
  const [motionChoices, setMotionChoices] = useState<File[]>([]);
  const [motionFile, setMotionFile] = useState<File | null>(null);
  const [motionInfo, setMotionInfo] = useState<ParsedVmd | null>(null);
  const [sampleFps, setSampleFps] = useState(30);
  const [rootMotion, setRootMotion] = useState(true);
  const [rootScale, setRootScale] = useState(1);
  const [importMode, setImportMode] = useState<ImportMode>('replace');
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('Selecione um VMD para converter diretamente no VRM. PMX/PMD é opcional para o modo avançado.');
  const [previewInfo, setPreviewInfo] = useState<{ format: string; bones: number; files: number } | null>(null);
  const [result, setResult] = useState<RetargetedMmdMotion | null>(null);

  const modelInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const motionInputRef = useRef<HTMLInputElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const loadedPreviewRef = useRef<LoadedMmdModel | null>(null);

  const modelInfo = useEditorStore((state) => state.modelInfo);
  const availableBones = useEditorStore((state) => state.availableBones);
  const currentTime = useEditorStore((state) => state.currentTime);
  const importKeyframes = useEditorStore((state) => state.importKeyframes);
  const setLoop = useEditorStore((state) => state.setLoop);
  const setProjectName = useEditorStore((state) => state.setProjectName);
  const setStatus = useEditorStore((state) => state.setStatus);

  const modelBytes = useMemo(
    () => modelFiles.reduce((sum, file) => sum + file.size, 0),
    [modelFiles],
  );
  const facialOnly = Boolean(
    motionFile && /\.vmd$/i.test(motionFile.name)
    && motionInfo && motionInfo.boneFrameCount === 0 && motionInfo.morphFrameCount > 0,
  );
  const bodyVmd = Boolean(
    motionFile && /\.vmd$/i.test(motionFile.name)
    && motionInfo && motionInfo.boneFrameCount > 0,
  );
  const directVmd = bodyVmd && modelFiles.length === 0;
  const sourceModelRequired = Boolean(motionFile && /\.vpd$/i.test(motionFile.name));

  useEffect(() => {
    const toolbar = document.querySelector<HTMLElement>('.toolbar');
    if (!toolbar) return;
    const host = document.createElement('div');
    host.className = 'mmd-toolbar-host';
    const spacer = toolbar.querySelector('.toolbar-spacer');
    toolbar.insertBefore(host, spacer);
    setToolbarHost(host);
    return () => host.remove();
  }, []);

  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '');
    folderInputRef.current?.setAttribute('directory', '');
  }, [open]);

  useEffect(() => {
    setMotionInfo(null);
    if (!motionFile || !/\.vmd$/i.test(motionFile.name)) return;
    let cancelled = false;
    void parseVmd(motionFile).then((info) => {
      if (cancelled) return;
      setMotionInfo(info);
      if (info.boneFrameCount === 0 && info.morphFrameCount > 0) {
        setMessage(`${displayName(motionFile)}: VMD facial/lip com ${info.morphFrameCount} frames. Pode ser convertido diretamente.`);
      } else if (info.boneFrameCount > 0) {
        setMessage(`${displayName(motionFile)}: ${info.boneFrameCount} frames de ossos, ${info.duration.toFixed(2)}s. Pronto para VMD → VRM direto.`);
      } else {
        setMessage(`${displayName(motionFile)} não contém frames corporais nem faciais utilizáveis.`);
      }
    }).catch((parseError) => {
      if (!cancelled) setError(readableError(parseError));
    });
    return () => { cancelled = true; };
  }, [motionFile]);

  useEffect(() => {
    if (!open || !canvasHostRef.current || !modelFiles.length) {
      setPreviewInfo(null);
      return;
    }
    const mount = canvasHostRef.current;
    let disposed = false;
    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let loaded: LoadedMmdModel | null = null;
    let observer: ResizeObserver | null = null;
    let renderQueued = false;

    const run = async (): Promise<void> => {
      setPreviewBusy(true);
      setError('');
      setMessage('Carregando o modelo MMD e seus recursos…');
      try {
        loaded = await loadMmdModel(modelFiles);
        if (disposed) {
          loaded.release();
          disposeObject(loaded.mesh);
          return;
        }
        loadedPreviewRef.current = loaded;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color('#11101a');
        const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
        renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        mount.replaceChildren(renderer.domElement);

        const modelGroup = new THREE.Group();
        modelGroup.add(loaded.mesh);
        scene.add(modelGroup);
        loaded.mesh.updateMatrixWorld(true);
        const rawBox = new THREE.Box3().setFromObject(loaded.mesh);
        const rawSize = rawBox.getSize(new THREE.Vector3());
        const scale = 1.65 / Math.max(0.001, rawSize.y);
        modelGroup.scale.setScalar(scale);
        modelGroup.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(modelGroup);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        modelGroup.position.sub(center);
        modelGroup.position.y += size.y * 0.5;

        camera.position.set(size.y * 0.65, size.y * 0.58, size.y * 1.35);
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = false;
        controls.target.set(0, size.y * 0.52, 0);
        controls.update();

        scene.add(new THREE.HemisphereLight(0xd8e1ff, 0x261b32, 2.4));
        const key = new THREE.DirectionalLight(0xffffff, 3.2);
        key.position.set(2, 4, 3);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0xa98cff, 2);
        rim.position.set(-3, 2, -2);
        scene.add(rim);
        scene.add(new THREE.GridHelper(5, 20, 0x5d5570, 0x2c2838));

        const renderNow = (): void => {
          renderQueued = false;
          if (!disposed) renderer?.render(scene, camera);
        };
        const requestRender = (): void => {
          if (renderQueued || disposed) return;
          renderQueued = true;
          requestAnimationFrame(renderNow);
        };
        const resize = (): void => {
          if (!renderer) return;
          const width = Math.max(1, mount.clientWidth);
          const height = Math.max(1, mount.clientHeight);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height, false);
          requestRender();
        };
        resize();
        observer = new ResizeObserver(resize);
        observer.observe(mount);
        controls.addEventListener('change', requestRender);
        requestRender();

        setPreviewInfo({
          format: loaded.modelFormat,
          bones: loaded.mesh.skeleton.bones.length,
          files: loaded.sourceFileCount,
        });
        setMessage(`${loaded.modelFileName} carregado em preview econômico. O modelo não é renderizado continuamente.`);
      } catch (loadError) {
        if (!disposed) setError(readableError(loadError));
      } finally {
        if (!disposed) setPreviewBusy(false);
      }
    };
    void run();

    return () => {
      disposed = true;
      observer?.disconnect();
      controls?.dispose();
      renderer?.dispose();
      if (loaded) {
        loaded.release();
        disposeObject(loaded.mesh);
      }
      if (loadedPreviewRef.current === loaded) loadedPreviewRef.current = null;
      mount.replaceChildren();
    };
  }, [open, modelFiles]);

  const selectModelFiles = (files: FileList | null): void => {
    const selected = files ? Array.from(files) : [];
    if (!selected.length) return;
    if (!selected.some((file) => /\.(pmx|pmd|zip)$/i.test(file.name))) {
      setError('A seleção precisa conter um modelo .pmx/.pmd ou um ZIP MMD completo.');
      return;
    }
    setModelFiles(selected);
    setResult(null);
    setError('');
    setMessage('Modelo MMD selecionado. O VMD usará o modo avançado com IK e grants desse modelo.');
  };

  const selectMotionFiles = async (files: FileList | null): Promise<void> => {
    const selected = files ? Array.from(files) : [];
    if (!selected.length) return;
    setError('');
    setResult(null);
    try {
      const expanded = await expandMmdMotionSelection(selected);
      if (!expanded.motions.length) {
        throw new Error('O arquivo/ZIP não contém nenhum .vmd ou .vpd.');
      }
      setMotionPackageFiles(expanded.files);
      setMotionChoices(expanded.motions);
      setMotionFile(expanded.motions[0]);
      setMessage(expanded.motions.length > 1
        ? `${expanded.motions.length} movimentos encontrados no pacote. Escolha um na lista.`
        : `${displayName(expanded.motions[0])} carregado do pacote.`);
    } catch (selectionError) {
      setError(readableError(selectionError));
    }
  };

  const convert = async (): Promise<void> => {
    if (!motionFile) {
      setError('Selecione um movimento .vmd, uma pose .vpd ou um ZIP que contenha esses arquivos.');
      return;
    }
    if (sourceModelRequired && !modelFiles.length) {
      setError('VPD é uma pose dependente do modelo MMD. Selecione o PMX/PMD usado para criar essa pose.');
      return;
    }
    if (!modelInfo || modelInfo.format !== 'VRM') {
      setError('Abra um modelo VRM como destino antes de converter o movimento MMD.');
      return;
    }
    setBusy(true);
    setResult(null);
    setError('');
    setMessage(facialOnly
      ? 'Convertendo morphs MMD de rosto e lábios para expressões VRMA…'
      : directVmd
        ? 'Lendo curvas VMD, mapeando ossos padrão e aplicando diretamente no humanoide VRM…'
        : 'Executando o VMD no PMX/PMD, resolvendo IK e convertendo para o humanoide VRM…');
    try {
      const converted = await retargetMmdMotion({
        sourceModelFiles: modelFiles,
        motionFile,
        motionPackageFiles,
        availableBones,
        availableExpressions: modelInfo.availableExpressions ?? [],
        sampleFps,
        rootMotion,
        rootScale,
        targetHeight: modelInfo.heightMeters ?? 1.65,
        targetMetaVersion: modelInfo.metaVersion === '0' ? '0' : '1',
        targetRig: modelInfo.humanoidRig,
      });
      const offset = importMode === 'append' ? currentTime : 0;
      const positioned = converted.keyframes.map((frame) => ({
        ...frame,
        id: crypto.randomUUID(),
        time: frame.time + offset,
      }));
      importKeyframes(positioned, importMode);
      setLoop(false);
      if (importMode === 'replace') setProjectName(converted.name);
      const firstTime = positioned[0]?.time ?? offset;
      const state = useEditorStore.getState();
      state.setCurrentTime(Math.min(state.duration, firstTime + 1 / Math.max(1, sampleFps)));
      requestAnimationFrame(() => useEditorStore.getState().setCurrentTime(firstTime));
      setResult(converted);
      setMessage(`${converted.name} convertido para ${positioned.length} keyframes VRM.`);
      setStatus(`${converted.name}: ${converted.mappedBones} ossos e ${converted.mappedExpressions} expressões convertidos; pronto para exportar como VRMA.`);
    } catch (conversionError) {
      setError(readableError(conversionError));
    } finally {
      setBusy(false);
    }
  };

  if (!toolbarHost) return null;

  const toolbarButton = createPortal(
    <button className="secondary-button mmd-toolbar-button" onClick={() => setOpen(true)} title="Converter VMD direto para VRM ou usar PMX/PMD no modo avançado">
      <Sparkles size={16} /> MMD
    </button>,
    toolbarHost,
  );
  if (!open) return toolbarButton;

  return (
    <>
      {toolbarButton}
      {createPortal(
        <div className="mmd-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) setOpen(false);
        }}>
          <section className="mmd-studio" role="dialog" aria-modal="true" aria-label="Estúdio MMD">
            <header className="mmd-header">
              <span className="mmd-logo"><Sparkles size={20} /></span>
              <div><strong>Estúdio MMD</strong><small>VMD → VRM direto · PMX/PMD opcional · VPD/ZIP</small></div>
              <span className={`mmd-target ${modelInfo?.format === 'VRM' ? 'ready' : ''}`}>
                {modelInfo?.format === 'VRM' ? `Destino: ${modelInfo.name}` : 'Abra um VRM para converter'}
              </span>
              <button disabled={busy} onClick={() => setOpen(false)}><X size={18} /></button>
            </header>

            <input ref={modelInputRef} hidden multiple type="file" accept=".pmx,.pmd,.zip,.png,.jpg,.jpeg,.bmp,.tga,.spa,.sph" onChange={(event) => {
              selectModelFiles(event.target.files);
              event.currentTarget.value = '';
            }} />
            <input ref={folderInputRef} hidden multiple type="file" onChange={(event) => {
              selectModelFiles(event.target.files);
              event.currentTarget.value = '';
            }} />
            <input ref={motionInputRef} hidden multiple type="file" accept=".vmd,.vpd,.zip,.json,.txt" onChange={(event) => {
              void selectMotionFiles(event.target.files);
              event.currentTarget.value = '';
            }} />

            <div className="mmd-body">
              <main className="mmd-preview-column">
                <div className="mmd-preview">
                  <div ref={canvasHostRef} className="mmd-canvas-host" />
                  {!modelFiles.length && (
                    <div className="mmd-preview-empty"><FileBox size={40} /><strong>{facialOnly ? 'Modelo MMD desnecessário' : bodyVmd ? 'Modo direto no VRM' : 'Modelo MMD opcional'}</strong><span>{facialOnly ? 'Esse VMD possui somente rosto/lábios.' : bodyVmd ? 'O VMD corporal será mapeado diretamente para os ossos humanoides do VRM.' : 'Carregue PMX/PMD apenas para VPD ou para usar IK/grants específicos do modelo.'}</span></div>
                  )}
                  {previewBusy && <div className="mmd-preview-loading"><LoaderCircle size={30} /><span>Carregando MMD…</span></div>}
                </div>
                <div className="mmd-preview-toolbar">
                  <button onClick={() => modelInputRef.current?.click()} disabled={busy}><Upload size={14} /> PMX/PMD avançado</button>
                  <button onClick={() => folderInputRef.current?.click()} disabled={busy}><FolderOpen size={14} /> Pasta completa</button>
                  <span>{modelFiles.length ? `${fileSummary(modelFiles)} · ${formatSize(modelBytes)}` : 'Opcional para VMD corporal'}</span>
                  {previewInfo && <b>{previewInfo.format} · {previewInfo.bones} ossos · {previewInfo.files} arquivos</b>}
                </div>
              </main>

              <aside className="mmd-controls">
                <section className="mmd-card">
                  <div className="mmd-card-title"><FileBox size={15} /><span>Modelo de origem</span></div>
                  <strong>{modelFiles.length ? fileSummary(modelFiles) : directVmd ? 'VRM direto — PMX não necessário' : facialOnly ? 'Não necessário para este VMD' : 'Opcional para VMD · obrigatório para VPD'}</strong>
                  <small>Sem PMX, o app lê os canais VMD e aplica no humanoide VRM. Com PMX, usa o modo avançado para IK e grants específicos daquele modelo.</small>
                </section>

                <section className="mmd-card">
                  <div className="mmd-card-title"><Sparkles size={15} /><span>Movimento, pose ou pacote</span></div>
                  <button className="mmd-motion-picker" onClick={() => motionInputRef.current?.click()} disabled={busy}>
                    <Upload size={14} /> {motionFile ? displayName(motionFile) : 'Selecionar VMD/VPD/ZIP'}
                  </button>
                  {motionChoices.length > 1 && (
                    <select className="mmd-motion-select" value={motionChoices.indexOf(motionFile ?? motionChoices[0])} onChange={(event) => setMotionFile(motionChoices[Number(event.target.value)] ?? motionChoices[0])}>
                      {motionChoices.map((file, index) => <option key={`${file.name}-${index}`} value={index}>{displayName(file)}</option>)}
                    </select>
                  )}
                  {motionInfo && (
                    <small>{motionInfo.boneFrameCount} frames de ossos · {motionInfo.morphFrameCount} frames faciais · {motionInfo.duration.toFixed(2)}s</small>
                  )}
                  {!motionInfo && <small>ZIPs são abertos e os VMD/VPD internos aparecem para seleção.</small>}
                </section>

                <div className="mmd-settings-grid">
                  <label><span><Gauge size={14} /> Amostragem</span><select value={sampleFps} onChange={(event) => setSampleFps(Number(event.target.value))}><option value={15}>15 FPS</option><option value={30}>30 FPS</option><option value={60}>60 FPS</option></select></label>
                  <label><span><Upload size={14} /> Timeline</span><select value={importMode} onChange={(event) => setImportMode(event.target.value as ImportMode)}><option value="replace">Substituir</option><option value="append">Inserir no cursor</option></select></label>
                  <label className="mmd-toggle"><span><Move3D size={14} /> Root motion</span><input type="checkbox" disabled={facialOnly} checked={rootMotion} onChange={(event) => setRootMotion(event.target.checked)} /></label>
                  <label><span>Escala <b>{rootScale.toFixed(2)}×</b></span><input type="range" min={0} max={2} step={0.05} disabled={!rootMotion || facialOnly} value={rootScale} onChange={(event) => setRootScale(Number(event.target.value))} /></label>
                </div>

                <div className="mmd-note">
                  {directVmd
                    ? 'Modo direto: curvas Bézier, rotações, centro/groove, root motion e nomes de ossos MMD padrão são convertidos no próprio VRM. PMX não é carregado.'
                    : modelFiles.length
                      ? 'Modo avançado: o VMD é executado no PMX/PMD com IK e grants antes do retargeting.'
                      : 'VMD corporal funciona diretamente no VRM. VPD continua precisando do modelo MMD de origem.'}
                </div>

                {result && (
                  <div className="mmd-result">
                    <Check size={19} /><div><strong>{result.name}</strong><span>{result.duration.toFixed(2)}s · {result.keyframes.length} keyframes · {result.mappedBones} ossos · {result.mappedExpressions} expressões</span>{result.warnings.map((warning) => <small key={warning}>{warning}</small>)}</div>
                  </div>
                )}
                {error && <div className="mmd-error">{error}</div>}
                <div className="mmd-message">{busy && <LoaderCircle className="mmd-spin" size={14} />}{message}</div>
              </aside>
            </div>

            <footer className="mmd-footer">
              <button className="mmd-reset" disabled={busy} onClick={() => {
                setModelFiles([]);
                setMotionPackageFiles([]);
                setMotionChoices([]);
                setMotionFile(null);
                setMotionInfo(null);
                setResult(null);
                setError('');
                setMessage('Seleção MMD limpa. VMD corporal pode ser convertido sem PMX.');
              }}><RotateCcw size={14} /> Limpar</button>
              <button className="mmd-close" disabled={busy} onClick={() => setOpen(false)}>Fechar</button>
              <button className="mmd-convert" disabled={busy || !motionFile || (sourceModelRequired && !modelFiles.length) || modelInfo?.format !== 'VRM'} onClick={() => void convert()}>
                {busy ? <LoaderCircle className="mmd-spin" size={15} /> : <Play size={15} fill="currentColor" />} Converter para timeline
              </button>
            </footer>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
