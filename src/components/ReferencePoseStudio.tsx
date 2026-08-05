import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check, FileImage, Film, LoaderCircle, PersonStanding, Play, RotateCcw,
  ScanLine, SlidersHorizontal, Sparkles, Upload, X,
} from 'lucide-react';
import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import { decompressFrames, parseGIF } from 'gifuct-js';
import { useEditorStore } from '../store';
import {
  detectedFrameConfidence,
  retargetDetectedFrames,
  type DetectedPoseFrame,
  type PosePoint,
} from '../lib/poseRetargeter';

const MEDIAPIPE_VERSION = '0.10.35';
const WASM_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const MAX_ANALYSIS_SIDE = 960;

const POSE_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [7, 8], [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [11, 23], [12, 24],
  [23, 24], [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32], [0, 7], [0, 8],
];

type SourceKind = 'image' | 'gif' | 'video';
type StudioStatus = 'idle' | 'loading' | 'analyzing' | 'ready' | 'error';
type ImportMode = 'replace' | 'append';

interface SourceInfo {
  file: File;
  kind: SourceKind;
  url: string;
  width: number;
  height: number;
  duration: number;
}

interface GifFrameData {
  delay: number;
  disposalType: number;
  dims: { top: number; left: number; width: number; height: number };
  patch: Uint8ClampedArray | number[];
}

interface GifData {
  lsd: { width: number; height: number };
}

function sourceKind(file: File): SourceKind {
  const name = file.name.toLowerCase();
  if (file.type.startsWith('video/')) return 'video';
  if (file.type === 'image/gif' || name.endsWith('.gif')) return 'gif';
  return 'image';
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Pose estática';
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds - minutes * 60;
  return minutes ? `${minutes}m ${remaining.toFixed(1)}s` : `${remaining.toFixed(2)}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function waitForImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Não foi possível decodificar a imagem.'));
    image.src = url;
  });
}

function waitForVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => reject(new Error('O codec desse vídeo não é suportado pelo Electron.'));
    video.src = url;
    video.load();
  });
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.0005 && video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    const onSeeked = (): void => { cleanup(); resolve(); };
    const onError = (): void => { cleanup(); reject(new Error('Falha ao acessar um quadro do vídeo.')); };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = Math.max(0, Math.min(video.duration || time, time));
  });
}

function drawSourceToAnalysisCanvas(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): HTMLCanvasElement {
  const scale = Math.min(1, MAX_ANALYSIS_SIDE / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas 2D indisponível.');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function drawPreview(
  target: HTMLCanvasElement | null,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  landmarks?: PosePoint[],
  mirror = false,
): void {
  if (!target) return;
  const width = Math.max(1, sourceWidth);
  const height = Math.max(1, sourceHeight);
  const scale = Math.min(1, 1000 / Math.max(width, height));
  target.width = Math.max(1, Math.round(width * scale));
  target.height = Math.max(1, Math.round(height * scale));
  const context = target.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, target.width, target.height);
  context.save();
  if (mirror) {
    context.translate(target.width, 0);
    context.scale(-1, 1);
  }
  context.drawImage(source, 0, 0, target.width, target.height);
  context.restore();

  if (!landmarks?.length) return;
  const mapped = landmarks.map((point) => ({
    x: (mirror ? 1 - point.x : point.x) * target.width,
    y: point.y * target.height,
    visibility: point.visibility ?? 1,
  }));

  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = Math.max(2, target.width / 360);
  for (const [from, to] of POSE_CONNECTIONS) {
    const a = mapped[from];
    const b = mapped[to];
    if (!a || !b || Math.min(a.visibility, b.visibility) < 0.15) continue;
    const gradient = context.createLinearGradient(a.x, a.y, b.x, b.y);
    gradient.addColorStop(0, '#9d85ff');
    gradient.addColorStop(1, '#ff78bd');
    context.strokeStyle = gradient;
    context.globalAlpha = 0.88;
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
  }
  context.globalAlpha = 1;
  for (let index = 0; index < mapped.length; index += 1) {
    const point = mapped[index];
    if (!point || point.visibility < 0.15) continue;
    context.fillStyle = index % 2 ? '#bcadff' : '#ff9bce';
    context.strokeStyle = 'rgba(13, 10, 20, .9)';
    context.lineWidth = Math.max(1, target.width / 650);
    context.beginPath();
    context.arc(point.x, point.y, Math.max(2.3, target.width / 260), 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
}

function resultFrame(result: PoseLandmarkerResult, time: number): DetectedPoseFrame | null {
  const normalized = result.landmarks[0] as PosePoint[] | undefined;
  const world = result.worldLandmarks[0] as PosePoint[] | undefined;
  if (!normalized?.length || !world?.length) return null;
  return {
    time,
    normalized: normalized.map((point) => ({ ...point })),
    world: world.map((point) => ({ ...point })),
    confidence: detectedFrameConfidence(normalized),
  };
}

function composeGifFrames(file: File): Promise<{ width: number; height: number; frames: Array<{ time: number; canvas: HTMLCanvasElement }> }> {
  return file.arrayBuffer().then((buffer) => {
    const gif = parseGIF(buffer) as unknown as GifData;
    const decoded = decompressFrames(gif as never, true) as unknown as GifFrameData[];
    const width = gif.lsd.width;
    const height = gif.lsd.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D indisponível.');
    const output: Array<{ time: number; canvas: HTMLCanvasElement }> = [];
    let elapsed = 0;
    let previous: GifFrameData | null = null;
    let restoreSnapshot: ImageData | null = null;

    for (const frame of decoded) {
      if (previous?.disposalType === 2) {
        context.clearRect(previous.dims.left, previous.dims.top, previous.dims.width, previous.dims.height);
      } else if (previous?.disposalType === 3 && restoreSnapshot) {
        context.putImageData(restoreSnapshot, 0, 0);
      }
      restoreSnapshot = frame.disposalType === 3 ? context.getImageData(0, 0, width, height) : null;
      const patchCanvas = document.createElement('canvas');
      patchCanvas.width = frame.dims.width;
      patchCanvas.height = frame.dims.height;
      const patchContext = patchCanvas.getContext('2d');
      if (!patchContext) throw new Error('Canvas 2D indisponível.');
      const patch = new Uint8ClampedArray(frame.patch);
      patchContext.putImageData(new ImageData(patch, frame.dims.width, frame.dims.height), 0, 0);
      context.drawImage(patchCanvas, frame.dims.left, frame.dims.top);

      const snapshot = document.createElement('canvas');
      snapshot.width = width;
      snapshot.height = height;
      snapshot.getContext('2d')?.drawImage(canvas, 0, 0);
      output.push({ time: elapsed / 1000, canvas: snapshot });
      elapsed += Math.max(20, frame.delay || 100);
      previous = frame;
    }
    return { width, height, frames: output };
  });
}

export default function ReferencePoseStudio(): JSX.Element | null {
  const [toolbarHost, setToolbarHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<SourceInfo | null>(null);
  const [status, setStatus] = useState<StudioStatus>('idle');
  const [message, setMessage] = useState('Selecione uma imagem, GIF ou vídeo com uma pessoa visível.');
  const [progress, setProgress] = useState(0);
  const [detectedFrames, setDetectedFrames] = useState<DetectedPoseFrame[]>([]);
  const [analysisFps, setAnalysisFps] = useState(12);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.45);
  const [smoothing, setSmoothing] = useState(0.42);
  const [mirror, setMirror] = useState(false);
  const [rootMotion, setRootMotion] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>('append');
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const abortRef = useRef(false);
  const modelInfo = useEditorStore((state) => state.modelInfo);
  const currentTime = useEditorStore((state) => state.currentTime);
  const projectFps = useEditorStore((state) => state.fps);
  const importKeyframes = useEditorStore((state) => state.importKeyframes);
  const setStatusMessage = useEditorStore((state) => state.setStatus);

  const averageConfidence = useMemo(() => detectedFrames.length
    ? detectedFrames.reduce((sum, frame) => sum + frame.confidence, 0) / detectedFrames.length
    : 0, [detectedFrames]);

  useEffect(() => {
    const toolbar = document.querySelector<HTMLElement>('.toolbar');
    if (!toolbar) return;
    const host = document.createElement('div');
    host.className = 'reference-pose-toolbar-host';
    const spacer = toolbar.querySelector('.toolbar-spacer');
    toolbar.insertBefore(host, spacer);
    setToolbarHost(host);
    return () => host.remove();
  }, []);

  useEffect(() => () => {
    abortRef.current = true;
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
  }, []);

  useEffect(() => () => {
    if (source?.url) URL.revokeObjectURL(source.url);
  }, [source]);

  const ensureLandmarker = async (mode: 'IMAGE' | 'VIDEO'): Promise<PoseLandmarker> => {
    setStatus('loading');
    setMessage('Carregando o detector corporal… Na primeira utilização o modelo oficial é baixado uma vez.');
    if (!landmarkerRef.current) {
      const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
      const create = (delegate: 'GPU' | 'CPU'): Promise<PoseLandmarker> => PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: mode,
        numPoses: 1,
        minPoseDetectionConfidence: confidenceThreshold,
        minPosePresenceConfidence: confidenceThreshold,
        minTrackingConfidence: confidenceThreshold,
        outputSegmentationMasks: false,
      });
      try {
        landmarkerRef.current = await create('GPU');
      } catch (gpuError) {
        console.warn('MediaPipe GPU indisponível; usando CPU.', gpuError);
        landmarkerRef.current = await create('CPU');
      }
    } else {
      await landmarkerRef.current.setOptions({
        runningMode: mode,
        minPoseDetectionConfidence: confidenceThreshold,
        minPosePresenceConfidence: confidenceThreshold,
        minTrackingConfidence: confidenceThreshold,
      });
    }
    return landmarkerRef.current;
  };

  const resetAnalysis = (): void => {
    abortRef.current = false;
    setDetectedFrames([]);
    setProgress(0);
    setStatus('idle');
    setMessage('Arquivo pronto. Ajuste as opções e execute a análise.');
  };

  const chooseFile = async (file: File): Promise<void> => {
    if (source?.url) URL.revokeObjectURL(source.url);
    const kind = sourceKind(file);
    const url = URL.createObjectURL(file);
    try {
      let width = 0;
      let height = 0;
      let duration = 0;
      if (kind === 'video') {
        const video = await waitForVideo(url);
        width = video.videoWidth;
        height = video.videoHeight;
        duration = Number.isFinite(video.duration) ? video.duration : 0;
        await seekVideo(video, 0);
        drawPreview(previewRef.current, video, width, height);
      } else if (kind === 'gif') {
        const gif = await composeGifFrames(file);
        width = gif.width;
        height = gif.height;
        duration = gif.frames.length ? gif.frames[gif.frames.length - 1].time : 0;
        if (gif.frames[0]) drawPreview(previewRef.current, gif.frames[0].canvas, width, height);
      } else {
        const image = await waitForImage(url);
        width = image.naturalWidth;
        height = image.naturalHeight;
        drawPreview(previewRef.current, image, width, height);
      }
      const next = { file, kind, url, width, height, duration };
      setSource(next);
      setRangeStart(0);
      setRangeEnd(duration);
      resetAnalysis();
    } catch (error) {
      URL.revokeObjectURL(url);
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Não foi possível abrir o arquivo.');
    }
  };

  const analyzeImage = async (landmarker: PoseLandmarker, sourceInfo: SourceInfo): Promise<DetectedPoseFrame[]> => {
    const image = await waitForImage(sourceInfo.url);
    const analysisCanvas = drawSourceToAnalysisCanvas(image, sourceInfo.width, sourceInfo.height);
    const result = landmarker.detect(analysisCanvas);
    const frame = resultFrame(result, 0);
    drawPreview(previewRef.current, image, sourceInfo.width, sourceInfo.height, frame?.normalized, mirror);
    return frame ? [frame] : [];
  };

  const analyzeVideo = async (landmarker: PoseLandmarker, sourceInfo: SourceInfo): Promise<DetectedPoseFrame[]> => {
    const video = await waitForVideo(sourceInfo.url);
    const start = Math.max(0, Math.min(rangeStart, sourceInfo.duration));
    const end = Math.max(start, Math.min(rangeEnd || sourceInfo.duration, sourceInfo.duration));
    const step = 1 / analysisFps;
    const count = Math.max(1, Math.floor((end - start) / step) + 1);
    const frames: DetectedPoseFrame[] = [];
    for (let index = 0; index < count; index += 1) {
      if (abortRef.current) break;
      const sourceTime = Math.min(end, start + index * step);
      await seekVideo(video, sourceTime);
      const analysisCanvas = drawSourceToAnalysisCanvas(video, sourceInfo.width, sourceInfo.height);
      const result = landmarker.detectForVideo(analysisCanvas, Math.round(index * step * 1000));
      const frame = resultFrame(result, sourceTime - start);
      if (frame) frames.push(frame);
      if (index % Math.max(1, Math.floor(analysisFps / 4)) === 0 || index === count - 1) {
        drawPreview(previewRef.current, video, sourceInfo.width, sourceInfo.height, frame?.normalized, mirror);
      }
      setProgress((index + 1) / count);
      setMessage(`Analisando quadro ${index + 1} de ${count}…`);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return frames;
  };

  const analyzeGif = async (landmarker: PoseLandmarker, sourceInfo: SourceInfo): Promise<DetectedPoseFrame[]> => {
    const gif = await composeGifFrames(sourceInfo.file);
    const step = 1 / analysisFps;
    const frames: DetectedPoseFrame[] = [];
    let nextSample = 0;
    const selected = gif.frames.filter((frame, index) => {
      if (index === gif.frames.length - 1) return true;
      if (frame.time + 0.0001 < nextSample) return false;
      nextSample += step;
      return true;
    });
    for (let index = 0; index < selected.length; index += 1) {
      if (abortRef.current) break;
      const sourceFrame = selected[index];
      const analysisCanvas = drawSourceToAnalysisCanvas(sourceFrame.canvas, gif.width, gif.height);
      const result = landmarker.detectForVideo(analysisCanvas, Math.round(sourceFrame.time * 1000));
      const frame = resultFrame(result, sourceFrame.time);
      if (frame) frames.push(frame);
      drawPreview(previewRef.current, sourceFrame.canvas, gif.width, gif.height, frame?.normalized, mirror);
      setProgress((index + 1) / selected.length);
      setMessage(`Analisando quadro ${index + 1} de ${selected.length}…`);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return frames;
  };

  const runAnalysis = async (): Promise<void> => {
    if (!source) return;
    abortRef.current = false;
    setDetectedFrames([]);
    setProgress(0);
    setStatus('analyzing');
    try {
      const mode = source.kind === 'image' ? 'IMAGE' : 'VIDEO';
      const landmarker = await ensureLandmarker(mode);
      setStatus('analyzing');
      const frames = source.kind === 'image'
        ? await analyzeImage(landmarker, source)
        : source.kind === 'video'
          ? await analyzeVideo(landmarker, source)
          : await analyzeGif(landmarker, source);
      if (abortRef.current) {
        setStatus('idle');
        setMessage('Análise cancelada.');
        return;
      }
      if (!frames.length) throw new Error('Nenhuma pessoa foi detectada com confiança suficiente nesse arquivo.');
      setDetectedFrames(frames);
      setProgress(1);
      setStatus('ready');
      setMessage(source.kind === 'image'
        ? 'Pose detectada. Revise o esqueleto e aplique ao modelo.'
        : `${frames.length} quadros válidos detectados. O movimento está pronto para a timeline.`);
    } catch (error) {
      console.error(error);
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Falha durante a análise corporal.');
    }
  };

  const applyResult = (): void => {
    if (!detectedFrames.length || !source) return;
    if (!modelInfo || modelInfo.format !== 'VRM') {
      setStatus('error');
      setMessage('Abra um modelo VRM com humanoide antes de aplicar a captura.');
      return;
    }
    const generated = retargetDetectedFrames(detectedFrames, {
      mirror,
      confidenceThreshold,
      smoothing: source.kind === 'image' ? 0 : smoothing,
      rootMotion: source.kind === 'image' ? false : rootMotion,
    });
    const offset = source.kind === 'image' || importMode === 'append' ? currentTime : 0;
    const positioned = generated.map((frame) => ({ ...frame, time: frame.time + offset }));
    importKeyframes(positioned, source.kind === 'image' ? 'append' : importMode);
    const firstTime = positioned[0]?.time ?? currentTime;
    const state = useEditorStore.getState();
    const nudge = Math.min(state.duration, firstTime + 1 / Math.max(1, projectFps));
    state.setCurrentTime(nudge === firstTime ? Math.max(0, firstTime - 1 / Math.max(1, projectFps)) : nudge);
    requestAnimationFrame(() => useEditorStore.getState().setCurrentTime(firstTime));
    setStatusMessage(source.kind === 'image'
      ? `Pose de referência adicionada em ${firstTime.toFixed(2)}s. Ajuste os ossos manualmente e salve novamente se necessário.`
      : `${positioned.length} keyframes de captura adicionados. Revise o movimento e corrija os ossos necessários.`);
    setOpen(false);
  };

  const closeStudio = (): void => {
    abortRef.current = true;
    setOpen(false);
  };

  if (!toolbarHost) return null;

  const toolbarButton = createPortal(
    <button
      className="secondary-button reference-pose-button"
      title="Criar pose ou movimento usando imagem, GIF ou vídeo"
      onClick={() => { abortRef.current = false; setOpen(true); }}
    >
      <ScanLine size={16} /> Pose por referência
    </button>,
    toolbarHost,
  );

  if (!open) return toolbarButton;

  return (
    <>
      {toolbarButton}
      {createPortal(
        <div className="reference-studio-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeStudio();
        }}>
          <section className="reference-studio" role="dialog" aria-modal="true" aria-label="Pose por referência">
            <header className="reference-studio-header">
              <div className="reference-studio-title">
                <span><PersonStanding size={20} /></span>
                <div><strong>Pose por referência</strong><small>Imagem, GIF ou vídeo para humanoide VRM</small></div>
              </div>
              <button className="reference-close" title="Fechar" onClick={closeStudio}><X size={18} /></button>
            </header>

            <div className="reference-studio-body">
              <div className="reference-preview-column">
                <div className={`reference-preview${source ? ' has-source' : ''}`}>
                  <canvas ref={previewRef} />
                  {!source && (
                    <button className="reference-drop-card" onClick={() => fileInputRef.current?.click()}>
                      <span><Upload size={24} /></span>
                      <strong>Selecione uma referência</strong>
                      <small>PNG, JPG, WEBP, GIF, MP4, WebM e outros formatos reconhecidos pelo Electron</small>
                    </button>
                  )}
                  {(status === 'loading' || status === 'analyzing') && (
                    <div className="reference-processing-overlay">
                      <LoaderCircle size={30} className="reference-spinner" />
                      <strong>{status === 'loading' ? 'Preparando detector' : 'Analisando movimento'}</strong>
                      <span>{Math.round(progress * 100)}%</span>
                    </div>
                  )}
                </div>
                <div className="reference-progress"><span style={{ width: `${progress * 100}%` }} /></div>
                <div className={`reference-message ${status}`}>
                  <span className="reference-message-dot" />
                  <span>{message}</span>
                </div>
                {source && (
                  <div className="reference-file-card">
                    <span>{source.kind === 'video' ? <Film size={18} /> : <FileImage size={18} />}</span>
                    <div><strong>{source.file.name}</strong><small>{source.width}×{source.height} · {formatDuration(source.duration)} · {formatBytes(source.file.size)}</small></div>
                    <button title="Trocar arquivo" onClick={() => fileInputRef.current?.click()}><RotateCcw size={15} /></button>
                  </div>
                )}
              </div>

              <aside className="reference-settings">
                <div className="reference-section-heading"><SlidersHorizontal size={15} /><span>Configuração da captura</span></div>

                <label className="reference-field">
                  <span>Confiança mínima <strong>{Math.round(confidenceThreshold * 100)}%</strong></span>
                  <input type="range" min={0.2} max={0.85} step={0.05} value={confidenceThreshold} onChange={(event) => setConfidenceThreshold(Number(event.target.value))} />
                  <small>Pontos abaixo desse limite preservam a rotação anterior em vez de gerar saltos.</small>
                </label>

                {source?.kind !== 'image' && (
                  <>
                    <div className="reference-two-fields">
                      <label className="reference-field compact"><span>FPS de análise</span><select value={analysisFps} onChange={(event) => setAnalysisFps(Number(event.target.value))}><option value={6}>6 fps</option><option value={12}>12 fps</option><option value={20}>20 fps</option><option value={30}>30 fps</option></select></label>
                      <label className="reference-field compact"><span>Destino</span><select value={importMode} onChange={(event) => setImportMode(event.target.value as ImportMode)}><option value="append">Inserir no cursor</option><option value="replace">Substituir timeline</option></select></label>
                    </div>
                    <label className="reference-field">
                      <span>Suavização <strong>{Math.round(smoothing * 100)}%</strong></span>
                      <input type="range" min={0} max={0.9} step={0.05} value={smoothing} onChange={(event) => setSmoothing(Number(event.target.value))} />
                      <small>Reduz tremores entre quadros sem impedir correções manuais posteriores.</small>
                    </label>
                  </>
                )}

                {source?.kind === 'video' && (
                  <div className="reference-range-box">
                    <span>Trecho do vídeo</span>
                    <div>
                      <label>Início<input type="number" min={0} max={rangeEnd} step={0.1} value={Number(rangeStart.toFixed(2))} onChange={(event) => setRangeStart(Math.max(0, Math.min(Number(event.target.value), rangeEnd)))} /><small>s</small></label>
                      <label>Fim<input type="number" min={rangeStart} max={source.duration} step={0.1} value={Number(rangeEnd.toFixed(2))} onChange={(event) => setRangeEnd(Math.max(rangeStart, Math.min(Number(event.target.value), source.duration)))} /><small>s</small></label>
                    </div>
                  </div>
                )}

                <label className="reference-toggle"><span><strong>Espelhar referência</strong><small>Inverte esquerda e direita para vídeos gravados como selfie.</small></span><input type="checkbox" checked={mirror} onChange={(event) => setMirror(event.target.checked)} /></label>
                {source?.kind !== 'image' && <label className="reference-toggle"><span><strong>Movimento do quadril</strong><small>Transfere deslocamento lateral e vertical estimado da pessoa.</small></span><input type="checkbox" checked={rootMotion} onChange={(event) => setRootMotion(event.target.checked)} /></label>}

                <div className="reference-quality-card">
                  <Sparkles size={17} />
                  <div><strong>{detectedFrames.length ? `${detectedFrames.length} quadros detectados` : 'Revisão antes de aplicar'}</strong><small>{detectedFrames.length ? `Confiança média de ${Math.round(averageConfidence * 100)}%.` : 'O esqueleto aparece sobre a referência. Depois de aplicar, todos os keyframes continuam editáveis.'}</small></div>
                </div>

                <div className="reference-local-note">O arquivo analisado não é enviado para servidor. A primeira utilização requer internet apenas para obter o runtime e o modelo oficial do MediaPipe.</div>
              </aside>
            </div>

            <footer className="reference-studio-footer">
              <input ref={fileInputRef} hidden type="file" accept="image/*,video/*,.gif" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void chooseFile(file);
                event.currentTarget.value = '';
              }} />
              <button className="reference-cancel" onClick={closeStudio}>Cancelar</button>
              {status === 'analyzing' ? (
                <button className="reference-stop" onClick={() => { abortRef.current = true; }}>Parar análise</button>
              ) : (
                <button className="reference-analyze" disabled={!source || status === 'loading'} onClick={() => void runAnalysis()}><Play size={15} fill="currentColor" /> {detectedFrames.length ? 'Analisar novamente' : 'Analisar referência'}</button>
              )}
              <button className="reference-apply" disabled={status !== 'ready' || !detectedFrames.length} onClick={applyResult}><Check size={16} /> {source?.kind === 'image' ? 'Aplicar pose' : 'Criar keyframes'}</button>
            </footer>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
