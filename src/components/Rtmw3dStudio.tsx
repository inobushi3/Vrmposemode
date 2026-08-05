import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check, Cpu, FileImage, Film, Gauge, HardDriveDownload, LoaderCircle,
  Play, RotateCcw, ScanLine, Sparkles, Upload, X,
} from 'lucide-react';
import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import { decompressFrames, parseGIF } from 'gifuct-js';
import { useEditorStore } from '../store';
import { retargetDetectedFrames, type DetectedPoseFrame, type PosePoint } from '../lib/poseRetargeter';
import { createRtmw3dCrop, rtmw3dToDetectedFrame } from '../lib/rtmw3dAdapter';

const MEDIAPIPE_VERSION = '0.10.35';
const WASM_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const DETECTOR_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const MAX_DETECTOR_SIDE = 960;

const CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [7, 8], [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [11, 23], [12, 24],
  [23, 24], [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32], [0, 7], [0, 8],
];

type SourceKind = 'image' | 'gif' | 'video';
type CaptureStatus = 'idle' | 'preparing' | 'analyzing' | 'ready' | 'error';
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

interface ComposedGifFrame {
  time: number;
  canvas: HTMLCanvasElement;
}

function kindFor(file: File): SourceKind {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif')) return 'gif';
  return 'image';
}

function waitForImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Não foi possível abrir essa imagem.'));
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

function detectorCanvas(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const scale = Math.min(1, MAX_DETECTOR_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas 2D indisponível.');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function resultLandmarks(result: PoseLandmarkerResult): PosePoint[] | null {
  const landmarks = result.landmarks[0] as PosePoint[] | undefined;
  return landmarks?.length ? landmarks.map((point) => ({ ...point })) : null;
}

function drawPreview(
  target: HTMLCanvasElement | null,
  source: CanvasImageSource,
  width: number,
  height: number,
  landmarks?: PosePoint[],
  mirror = false,
): void {
  if (!target) return;
  const scale = Math.min(1, 1200 / Math.max(width, height));
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

  const points = landmarks.map((point) => ({
    x: (mirror ? 1 - point.x : point.x) * target.width,
    y: point.y * target.height,
    confidence: Math.min(point.visibility ?? 1, point.presence ?? 1),
  }));
  context.lineWidth = Math.max(2, target.width / 360);
  context.lineCap = 'round';
  for (const [from, to] of CONNECTIONS) {
    const a = points[from];
    const b = points[to];
    if (!a || !b || Math.min(a.confidence, b.confidence) < 0.12) continue;
    const gradient = context.createLinearGradient(a.x, a.y, b.x, b.y);
    gradient.addColorStop(0, '#74d7ff');
    gradient.addColorStop(1, '#c287ff');
    context.strokeStyle = gradient;
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
  }
  for (const point of points) {
    if (point.confidence < 0.12) continue;
    context.fillStyle = '#e8dcff';
    context.strokeStyle = '#171020';
    context.lineWidth = Math.max(1, target.width / 700);
    context.beginPath();
    context.arc(point.x, point.y, Math.max(2.2, target.width / 280), 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
}

async function composeGif(file: File): Promise<{ width: number; height: number; frames: ComposedGifFrame[] }> {
  const parsed = parseGIF(await file.arrayBuffer()) as unknown as GifData;
  const decoded = decompressFrames(parsed as never, true) as unknown as GifFrameData[];
  const width = parsed.lsd.width;
  const height = parsed.lsd.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D indisponível.');
  const frames: ComposedGifFrame[] = [];
  let elapsed = 0;
  let previous: GifFrameData | null = null;
  let restore: ImageData | null = null;

  for (const frame of decoded) {
    if (previous?.disposalType === 2) {
      context.clearRect(previous.dims.left, previous.dims.top, previous.dims.width, previous.dims.height);
    } else if (previous?.disposalType === 3 && restore) {
      context.putImageData(restore, 0, 0);
    }
    restore = frame.disposalType === 3 ? context.getImageData(0, 0, width, height) : null;
    const patch = document.createElement('canvas');
    patch.width = frame.dims.width;
    patch.height = frame.dims.height;
    const patchContext = patch.getContext('2d');
    if (!patchContext) throw new Error('Canvas 2D indisponível.');
    patchContext.putImageData(new ImageData(new Uint8ClampedArray(frame.patch), frame.dims.width, frame.dims.height), 0, 0);
    context.drawImage(patch, frame.dims.left, frame.dims.top);
    const snapshot = document.createElement('canvas');
    snapshot.width = width;
    snapshot.height = height;
    snapshot.getContext('2d')?.drawImage(canvas, 0, 0);
    frames.push({ time: elapsed / 1000, canvas: snapshot });
    elapsed += Math.max(20, frame.delay || 100);
    previous = frame;
  }
  return { width, height, frames };
}

function durationLabel(seconds: number): string {
  if (!seconds) return 'Pose estática';
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`;
}

export default function Rtmw3dStudio(): JSX.Element | null {
  const [toolbarHost, setToolbarHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<SourceInfo | null>(null);
  const [status, setStatus] = useState<CaptureStatus>('idle');
  const [message, setMessage] = useState('RTMW3D-x usa 133 pontos 3D e roda localmente pela GPU no Windows.');
  const [progress, setProgress] = useState(0);
  const [frames, setFrames] = useState<DetectedPoseFrame[]>([]);
  const [provider, setProvider] = useState<string | null>(null);
  const [lastInferenceMs, setLastInferenceMs] = useState<number | null>(null);
  const [analysisFps, setAnalysisFps] = useState(6);
  const [confidence, setConfidence] = useState(0.35);
  const [smoothing, setSmoothing] = useState(0.5);
  const [mirror, setMirror] = useState(false);
  const [rootMotion, setRootMotion] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>('append');
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  const detectorRef = useRef<PoseLandmarker | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const abortRef = useRef(false);

  const modelInfo = useEditorStore((state) => state.modelInfo);
  const currentTime = useEditorStore((state) => state.currentTime);
  const projectFps = useEditorStore((state) => state.fps);
  const importKeyframes = useEditorStore((state) => state.importKeyframes);
  const setEditorStatus = useEditorStore((state) => state.setStatus);

  const averageConfidence = useMemo(() => frames.length
    ? frames.reduce((sum, frame) => sum + frame.confidence, 0) / frames.length
    : 0, [frames]);

  useEffect(() => {
    const toolbar = document.querySelector<HTMLElement>('.toolbar');
    if (!toolbar) return;
    const host = document.createElement('div');
    host.className = 'rtmw3d-toolbar-host';
    const spacer = toolbar.querySelector('.toolbar-spacer');
    toolbar.insertBefore(host, spacer);
    setToolbarHost(host);
    return () => host.remove();
  }, []);

  useEffect(() => {
    const remove = window.desktop?.rtmw3d.onProgress((event) => {
      setProgress(event.progress);
      setMessage(event.message);
      if (event.phase === 'ready') setStatus('idle');
    });
    void window.desktop?.rtmw3d.status().then((engine) => {
      setProvider(engine?.provider ?? null);
    });
    return () => remove?.();
  }, []);

  useEffect(() => () => {
    abortRef.current = true;
    detectorRef.current?.close();
    detectorRef.current = null;
  }, []);

  useEffect(() => () => {
    if (source?.url) URL.revokeObjectURL(source.url);
  }, [source]);

  const ensureDetector = async (mode: 'IMAGE' | 'VIDEO'): Promise<PoseLandmarker> => {
    if (!detectorRef.current) {
      const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
      detectorRef.current = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: DETECTOR_MODEL_URL, delegate: 'GPU' },
        runningMode: mode,
        numPoses: 1,
        minPoseDetectionConfidence: 0.25,
        minPosePresenceConfidence: 0.25,
        minTrackingConfidence: 0.25,
        outputSegmentationMasks: false,
      });
    } else {
      await detectorRef.current.setOptions({ runningMode: mode });
    }
    return detectorRef.current;
  };

  const selectFile = async (file: File): Promise<void> => {
    if (source?.url) URL.revokeObjectURL(source.url);
    const kind = kindFor(file);
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
        const gif = await composeGif(file);
        width = gif.width;
        height = gif.height;
        duration = gif.frames.at(-1)?.time ?? 0;
        if (gif.frames[0]) drawPreview(previewRef.current, gif.frames[0].canvas, width, height);
      } else {
        const image = await waitForImage(url);
        width = image.naturalWidth;
        height = image.naturalHeight;
        drawPreview(previewRef.current, image, width, height);
      }
      setSource({ file, kind, url, width, height, duration });
      setRangeStart(0);
      setRangeEnd(duration);
      setFrames([]);
      setProgress(0);
      setStatus('idle');
      setMessage('Referência pronta. O MediaPipe localizará a pessoa e o RTMW3D fará a pose 3D.');
    } catch (error) {
      URL.revokeObjectURL(url);
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Falha ao abrir a referência.');
    }
  };

  const analyzeOne = async (
    sourceFrame: CanvasImageSource,
    width: number,
    height: number,
    time: number,
    detector: PoseLandmarker,
    videoMode: boolean,
  ): Promise<DetectedPoseFrame | null> => {
    const detectionInput = detectorCanvas(sourceFrame, width, height);
    const detection = videoMode
      ? detector.detectForVideo(detectionInput, Math.round(performance.now() + time * 1000))
      : detector.detect(detectionInput);
    const detectorPoints = resultLandmarks(detection);
    if (!detectorPoints) return null;
    const crop = createRtmw3dCrop(sourceFrame, width, height, detectorPoints);
    const engine = window.desktop?.rtmw3d;
    if (!engine) throw new Error('A ponte nativa do RTMW3D não está disponível. Reinicie o app com npm start.');
    const result = await engine.infer({ rgba: crop.rgba });
    setProvider(result.provider);
    setLastInferenceMs(result.elapsedMs);
    return rtmw3dToDetectedFrame(result.keypoints, crop, time);
  };

  const analyze = async (): Promise<void> => {
    if (!source) return;
    abortRef.current = false;
    setStatus('preparing');
    setFrames([]);
    setProgress(0);
    try {
      const engine = window.desktop?.rtmw3d;
      if (!engine) throw new Error('RTMW3D exige a janela Electron. Execute o projeto com npm start.');
      const engineStatus = await engine.prepare();
      setProvider(engineStatus.provider);
      setStatus('analyzing');
      const detector = await ensureDetector(source.kind === 'image' ? 'IMAGE' : 'VIDEO');
      const detected: DetectedPoseFrame[] = [];

      if (source.kind === 'image') {
        const image = await waitForImage(source.url);
        const frame = await analyzeOne(image, source.width, source.height, 0, detector, false);
        if (frame) {
          detected.push(frame);
          drawPreview(previewRef.current, image, source.width, source.height, frame.normalized, mirror);
        }
        setProgress(1);
      } else if (source.kind === 'video') {
        const video = await waitForVideo(source.url);
        const start = Math.max(0, Math.min(rangeStart, source.duration));
        const end = Math.max(start, Math.min(rangeEnd || source.duration, source.duration));
        const step = 1 / analysisFps;
        const count = Math.max(1, Math.floor((end - start) / step) + 1);
        for (let index = 0; index < count; index += 1) {
          if (abortRef.current) break;
          const sourceTime = Math.min(end, start + index * step);
          await seekVideo(video, sourceTime);
          const frame = await analyzeOne(video, source.width, source.height, sourceTime - start, detector, true);
          if (frame) detected.push(frame);
          drawPreview(previewRef.current, video, source.width, source.height, frame?.normalized, mirror);
          setProgress((index + 1) / count);
          setMessage(`RTMW3D · quadro ${index + 1}/${count} · ${lastInferenceMs ? `${lastInferenceMs.toFixed(0)} ms` : provider ?? ''}`);
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
      } else {
        const gif = await composeGif(source.file);
        const step = 1 / analysisFps;
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
          const frame = await analyzeOne(sourceFrame.canvas, gif.width, gif.height, sourceFrame.time, detector, true);
          if (frame) detected.push(frame);
          drawPreview(previewRef.current, sourceFrame.canvas, gif.width, gif.height, frame?.normalized, mirror);
          setProgress((index + 1) / selected.length);
          setMessage(`RTMW3D · quadro ${index + 1}/${selected.length}`);
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
      }

      if (abortRef.current) {
        setStatus('idle');
        setMessage('Análise RTMW3D interrompida.');
        return;
      }
      if (!detected.length) throw new Error('Nenhuma pessoa foi localizada para o RTMW3D. Use uma imagem com o corpo mais visível.');
      setFrames(detected);
      setStatus('ready');
      setProgress(1);
      setMessage(`${detected.length} quadro(s) 3D prontos · ${provider ?? engineStatus.provider ?? 'ONNX Runtime'}.`);
    } catch (error) {
      console.error(error);
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Falha ao executar o RTMW3D.');
    }
  };

  const apply = (): void => {
    if (!frames.length || !source) return;
    if (!modelInfo || modelInfo.format !== 'VRM') {
      setStatus('error');
      setMessage('Abra um modelo VRM humanoide antes de aplicar a captura.');
      return;
    }
    const generated = retargetDetectedFrames(frames, {
      mirror,
      confidenceThreshold: confidence,
      smoothing: source.kind === 'image' ? 0 : smoothing,
      rootMotion: source.kind !== 'image' && rootMotion,
    });
    const offset = source.kind === 'image' || importMode === 'append' ? currentTime : 0;
    const positioned = generated.map((frame) => ({ ...frame, time: frame.time + offset }));
    importKeyframes(positioned, source.kind === 'image' ? 'append' : importMode);
    const first = positioned[0]?.time ?? currentTime;
    const state = useEditorStore.getState();
    state.setCurrentTime(Math.min(state.duration, first + 1 / Math.max(1, projectFps)));
    requestAnimationFrame(() => useEditorStore.getState().setCurrentTime(first));
    setEditorStatus(source.kind === 'image'
      ? `Pose RTMW3D aplicada em ${first.toFixed(2)}s. Revise e corrija os ossos necessários.`
      : `${positioned.length} keyframes RTMW3D adicionados. Revise o movimento antes de exportar.`);
    setOpen(false);
  };

  if (!toolbarHost) return null;
  const button = createPortal(
    <button className="secondary-button rtmw3d-toolbar-button" title="Captura 3D de alta qualidade com RTMW3D e DirectML" onClick={() => { abortRef.current = false; setOpen(true); }}>
      <Sparkles size={16} /> RTMW3D HQ
    </button>,
    toolbarHost,
  );
  if (!open) return button;

  return (
    <>
      {button}
      {createPortal(
        <div className="rtmw3d-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section className="rtmw3d-studio" role="dialog" aria-modal="true" aria-label="Captura RTMW3D">
            <header className="rtmw3d-header">
              <span className="rtmw3d-logo"><Sparkles size={20} /></span>
              <div><strong>Captura RTMW3D</strong><small>133 pontos 3D · ONNX Runtime · AMD DirectML</small></div>
              <div className={`rtmw3d-provider ${provider === 'DirectML' ? 'gpu' : ''}`}><Cpu size={13} />{provider ?? 'Não inicializado'}</div>
              <button onClick={() => setOpen(false)}><X size={18} /></button>
            </header>

            <div className="rtmw3d-body">
              <div className="rtmw3d-preview-column">
                <div className={`rtmw3d-preview ${source ? 'has-source' : ''}`}>
                  <canvas ref={previewRef} />
                  {!source && (
                    <button className="rtmw3d-drop" onClick={() => fileInputRef.current?.click()}>
                      <span><Upload size={25} /></span><strong>Selecionar referência</strong>
                      <small>Imagem, GIF ou vídeo com uma pessoa. O corpo inteiro produz resultados melhores.</small>
                    </button>
                  )}
                  {(status === 'preparing' || status === 'analyzing') && (
                    <div className="rtmw3d-overlay"><LoaderCircle className="rtmw3d-spinner" size={30} /><strong>{status === 'preparing' ? 'Preparando modelo' : 'Calculando pose 3D'}</strong><span>{Math.round(progress * 100)}%</span></div>
                  )}
                </div>
                <div className="rtmw3d-progress"><span style={{ width: `${progress * 100}%` }} /></div>
                <div className={`rtmw3d-message ${status}`}><span />{message}</div>
                {source && (
                  <div className="rtmw3d-file">
                    <span>{source.kind === 'video' ? <Film size={18} /> : <FileImage size={18} />}</span>
                    <div><strong>{source.file.name}</strong><small>{source.width}×{source.height} · {durationLabel(source.duration)}</small></div>
                    <button title="Trocar referência" onClick={() => fileInputRef.current?.click()}><RotateCcw size={15} /></button>
                  </div>
                )}
              </div>

              <aside className="rtmw3d-settings">
                <div className="rtmw3d-engine-card"><Gauge size={18} /><div><strong>Modo de alta qualidade</strong><small>MediaPipe Lite encontra a pessoa. RTMW3D-x calcula corpo, rosto, mãos e pés em 3D.</small></div></div>
                <label className="rtmw3d-field"><span>Confiança mínima <strong>{Math.round(confidence * 100)}%</strong></span><input type="range" min={0.15} max={0.75} step={0.05} value={confidence} onChange={(event) => setConfidence(Number(event.target.value))} /></label>
                {source?.kind !== 'image' && (
                  <>
                    <div className="rtmw3d-grid-fields">
                      <label className="rtmw3d-field"><span>FPS de análise</span><select value={analysisFps} onChange={(event) => setAnalysisFps(Number(event.target.value))}><option value={3}>3 fps</option><option value={6}>6 fps</option><option value={12}>12 fps</option><option value={20}>20 fps</option></select></label>
                      <label className="rtmw3d-field"><span>Destino</span><select value={importMode} onChange={(event) => setImportMode(event.target.value as ImportMode)}><option value="append">Inserir no cursor</option><option value="replace">Substituir timeline</option></select></label>
                    </div>
                    <label className="rtmw3d-field"><span>Suavização <strong>{Math.round(smoothing * 100)}%</strong></span><input type="range" min={0} max={0.9} step={0.05} value={smoothing} onChange={(event) => setSmoothing(Number(event.target.value))} /></label>
                  </>
                )}
                {source?.kind === 'video' && (
                  <div className="rtmw3d-range"><strong>Trecho do vídeo</strong><div><label>Início<input type="number" min={0} max={rangeEnd} step={0.1} value={Number(rangeStart.toFixed(2))} onChange={(event) => setRangeStart(Math.max(0, Math.min(Number(event.target.value), rangeEnd)))} />s</label><label>Fim<input type="number" min={rangeStart} max={source.duration} step={0.1} value={Number(rangeEnd.toFixed(2))} onChange={(event) => setRangeEnd(Math.max(rangeStart, Math.min(Number(event.target.value), source.duration)))} />s</label></div></div>
                )}
                <label className="rtmw3d-toggle"><span><strong>Espelhar referência</strong><small>Corrige vídeos gravados como selfie.</small></span><input type="checkbox" checked={mirror} onChange={(event) => setMirror(event.target.checked)} /></label>
                {source?.kind !== 'image' && <label className="rtmw3d-toggle"><span><strong>Movimento do quadril</strong><small>Transfere o deslocamento estimado para a animação.</small></span><input type="checkbox" checked={rootMotion} onChange={(event) => setRootMotion(event.target.checked)} /></label>}
                <div className="rtmw3d-stats"><ScanLine size={17} /><div><strong>{frames.length ? `${frames.length} quadro(s) 3D` : 'Aguardando análise'}</strong><small>{frames.length ? `Confiança média ${Math.round(averageConfidence * 100)}%${lastInferenceMs ? ` · ${lastInferenceMs.toFixed(0)} ms` : ''}` : 'O modelo será baixado uma vez e ficará salvo localmente.'}</small></div></div>
                <div className="rtmw3d-download-note"><HardDriveDownload size={14} /><span>O arquivo ONNX é grande e não fica no Git. Na primeira análise ele é baixado para a pasta local do aplicativo e reutilizado offline.</span></div>
              </aside>
            </div>

            <footer className="rtmw3d-footer">
              <input ref={fileInputRef} hidden type="file" accept="image/*,video/*,.gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) void selectFile(file); event.currentTarget.value = ''; }} />
              <button className="rtmw3d-cancel" onClick={() => setOpen(false)}>Cancelar</button>
              {status === 'analyzing' ? <button className="rtmw3d-stop" onClick={() => { abortRef.current = true; }}>Parar</button> : <button className="rtmw3d-analyze" disabled={!source || status === 'preparing'} onClick={() => void analyze()}><Play size={15} fill="currentColor" />{frames.length ? 'Analisar novamente' : 'Analisar com RTMW3D'}</button>}
              <button className="rtmw3d-apply" disabled={status !== 'ready' || !frames.length} onClick={apply}><Check size={16} />{source?.kind === 'image' ? 'Aplicar pose 3D' : 'Criar keyframes'}</button>
            </footer>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
