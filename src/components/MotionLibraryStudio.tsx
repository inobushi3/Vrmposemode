import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check, Database, FileArchive, FolderPlus, Gauge, Library, LoaderCircle,
  Move3D, Play, Trash2, Upload, X,
} from 'lucide-react';
import { useEditorStore } from '../store';
import { importVrma, inspectVrma, type ImportedVrma } from '../lib/vrmaImporter';
import {
  deleteStoredMotion,
  listStoredMotions,
  saveMotionFile,
  type StoredMotion,
} from '../lib/motionLibrary';

type ImportMode = 'replace' | 'append';

interface MotionInspection {
  duration: number;
  boneCount: number;
  hasRootMotion: boolean;
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Falha desconhecida.');
}

function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function shortDate(timestamp: number): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(timestamp);
}

export default function MotionLibraryStudio(): JSX.Element | null {
  const inputRef = useRef<HTMLInputElement>(null);
  const [toolbarHost, setToolbarHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [motions, setMotions] = useState<StoredMotion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspection, setInspection] = useState<MotionInspection | null>(null);
  const [result, setResult] = useState<ImportedVrma | null>(null);
  const [sampleFps, setSampleFps] = useState(30);
  const [rootMotion, setRootMotion] = useState(true);
  const [rootScale, setRootScale] = useState(1);
  const [importMode, setImportMode] = useState<ImportMode>('replace');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Importe arquivos VRMA e reutilize-os em qualquer modelo humanoide.');
  const [error, setError] = useState('');

  const modelInfo = useEditorStore((state) => state.modelInfo);
  const availableBones = useEditorStore((state) => state.availableBones);
  const currentTime = useEditorStore((state) => state.currentTime);
  const importKeyframes = useEditorStore((state) => state.importKeyframes);
  const setLoop = useEditorStore((state) => state.setLoop);
  const setStatus = useEditorStore((state) => state.setStatus);

  const selected = useMemo(
    () => motions.find((motion) => motion.id === selectedId) ?? null,
    [motions, selectedId],
  );

  useEffect(() => {
    const toolbar = document.querySelector<HTMLElement>('.toolbar');
    if (!toolbar) return;
    const host = document.createElement('div');
    host.className = 'motion-library-toolbar-host';
    const spacer = toolbar.querySelector('.toolbar-spacer');
    toolbar.insertBefore(host, spacer);
    setToolbarHost(host);
    return () => host.remove();
  }, []);

  const refresh = async (preferredId?: string): Promise<void> => {
    const records = await listStoredMotions();
    setMotions(records);
    const nextId = preferredId && records.some((record) => record.id === preferredId)
      ? preferredId
      : selectedId && records.some((record) => record.id === selectedId)
        ? selectedId
        : records[0]?.id ?? null;
    setSelectedId(nextId);
  };

  useEffect(() => {
    if (!open) return;
    setError('');
    setResult(null);
    void refresh().catch((loadError) => setError(readableError(loadError)));
  }, [open]);

  useEffect(() => {
    setInspection(null);
    setResult(null);
    if (!selected) return;
    let cancelled = false;
    void inspectVrma(selected.data.slice(0)).then((value) => {
      if (!cancelled) setInspection(value);
    }).catch((inspectError) => {
      if (!cancelled) setError(readableError(inspectError));
    });
    return () => { cancelled = true; };
  }, [selected?.id]);

  const addFile = async (file: File): Promise<void> => {
    if (!file.name.toLowerCase().endsWith('.vrma')) {
      setError('Selecione um arquivo com extensão .vrma.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage(`Validando ${file.name}…`);
    try {
      const data = await file.arrayBuffer();
      const info = await inspectVrma(data.slice(0));
      const record = await saveMotionFile(file, data);
      await refresh(record.id);
      setInspection(info);
      setMessage(`${record.name} salvo na biblioteca local.`);
    } catch (addError) {
      setError(readableError(addError));
    } finally {
      setBusy(false);
    }
  };

  const removeSelected = async (): Promise<void> => {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await deleteStoredMotion(selected.id);
      await refresh();
      setInspection(null);
      setResult(null);
      setMessage('Movimento removido da biblioteca local.');
    } catch (deleteError) {
      setError(readableError(deleteError));
    } finally {
      setBusy(false);
    }
  };

  const applySelected = async (): Promise<void> => {
    if (!selected) {
      setError('Importe ou selecione um movimento VRMA.');
      return;
    }
    if (!modelInfo || modelInfo.format !== 'VRM') {
      setError('Abra primeiro o modelo VRM que receberá o movimento.');
      return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    setMessage('Convertendo canais humanoides em keyframes editáveis…');
    try {
      const imported = await importVrma(selected.fileName, selected.data.slice(0), {
        availableBones,
        sampleFps,
        rootMotion,
        rootScale,
      });
      const offset = importMode === 'append' ? currentTime : 0;
      const positioned = imported.keyframes.map((keyframe) => ({
        ...keyframe,
        id: crypto.randomUUID(),
        time: keyframe.time + offset,
      }));
      importKeyframes(positioned, importMode);
      setLoop(false);
      const firstTime = positioned[0]?.time ?? 0;
      const state = useEditorStore.getState();
      state.setCurrentTime(Math.min(state.duration, firstTime + 1 / Math.max(1, sampleFps)));
      requestAnimationFrame(() => useEditorStore.getState().setCurrentTime(firstTime));
      setResult(imported);
      setMessage(`${imported.name} aplicado ao humanoide normalizado.`);
      setStatus(`${imported.name}: ${positioned.length} keyframes importados de ${imported.importedBones} ossos.`);
    } catch (applyError) {
      setError(readableError(applyError));
    } finally {
      setBusy(false);
    }
  };

  if (!toolbarHost) return null;

  const toolbarButton = createPortal(
    <button className="secondary-button motion-library-toolbar-button" onClick={() => setOpen(true)} title="Biblioteca local de movimentos VRMA">
      <Library size={16} /> Movimentos
    </button>,
    toolbarHost,
  );

  if (!open) return toolbarButton;

  return (
    <>
      {toolbarButton}
      {createPortal(
        <div className="motion-library-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) setOpen(false);
        }}>
          <section className="motion-library-studio" role="dialog" aria-modal="true" aria-label="Biblioteca de movimentos VRMA">
            <header className="motion-library-header">
              <span className="motion-library-logo"><Library size={20} /></span>
              <div><strong>Biblioteca de movimentos</strong><small>VRMA oficial → humanoide normalizado → keyframes editáveis</small></div>
              <span className="motion-library-count"><Database size={14} /> {motions.length} salvo(s)</span>
              <button onClick={() => !busy && setOpen(false)}><X size={18} /></button>
            </header>

            <input ref={inputRef} hidden type="file" accept=".vrma" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void addFile(file);
              event.currentTarget.value = '';
            }} />

            <div className="motion-library-body">
              <aside className="motion-library-list-panel">
                <button className="motion-library-add" disabled={busy} onClick={() => inputRef.current?.click()}>
                  <FolderPlus size={16} /> Importar VRMA
                </button>
                <div className="motion-library-list">
                  {motions.length === 0 && (
                    <div className="motion-library-empty-list"><FileArchive size={27} /><strong>Nenhum movimento salvo</strong><span>Adicione arquivos .vrma baixados ou criados por outros programas.</span></div>
                  )}
                  {motions.map((motion) => (
                    <button key={motion.id} className={selectedId === motion.id ? 'selected' : ''} onClick={() => setSelectedId(motion.id)}>
                      <span className="motion-library-file-icon"><FileArchive size={17} /></span>
                      <span><strong>{motion.name}</strong><small>{fileSize(motion.size)} · {shortDate(motion.importedAt)}</small></span>
                    </button>
                  ))}
                </div>
                <button className="motion-library-delete" disabled={!selected || busy} onClick={() => void removeSelected()}><Trash2 size={14} /> Remover selecionado</button>
              </aside>

              <main className="motion-library-main">
                {selected ? (
                  <>
                    <div className="motion-library-selected">
                      <span><FileArchive size={23} /></span>
                      <div><strong>{selected.name}</strong><small>{selected.fileName}</small></div>
                    </div>

                    <div className="motion-library-stats">
                      <span><b>{inspection ? `${inspection.duration.toFixed(2)}s` : '—'}</b>Duração</span>
                      <span><b>{inspection?.boneCount ?? '—'}</b>Ossos</span>
                      <span><b>{inspection ? (inspection.hasRootMotion ? 'Sim' : 'Não') : '—'}</b>Root motion</span>
                      <span><b>{fileSize(selected.size)}</b>Arquivo</span>
                    </div>

                    <div className="motion-library-settings">
                      <label><span><Gauge size={14} /> Amostragem</span><select value={sampleFps} onChange={(event) => setSampleFps(Number(event.target.value))}><option value={15}>15 FPS · leve</option><option value={30}>30 FPS · recomendado</option><option value={60}>60 FPS · máximo</option></select></label>
                      <label><span><Upload size={14} /> Destino</span><select value={importMode} onChange={(event) => setImportMode(event.target.value as ImportMode)}><option value="replace">Substituir timeline</option><option value="append">Inserir no cursor</option></select></label>
                      <label className="motion-library-toggle"><span><Move3D size={14} /> Manter deslocamento</span><input type="checkbox" checked={rootMotion} onChange={(event) => setRootMotion(event.target.checked)} /></label>
                      <label><span>Escala do deslocamento <b>{rootScale.toFixed(2)}×</b></span><input type="range" min={0} max={2} step={0.05} disabled={!rootMotion} value={rootScale} onChange={(event) => setRootScale(Number(event.target.value))} /></label>
                    </div>

                    <div className="motion-library-note">
                      As rotações vêm dos canais humanoides oficiais do VRMA. A posição do quadril é convertida de absoluta para deslocamento relativo à T-pose antes de entrar no editor.
                    </div>

                    {result && (
                      <div className="motion-library-result">
                        <Check size={18} /><div><strong>Movimento aplicado</strong><span>{result.keyframes.length} keyframes · {result.importedBones}/{result.sourceBones} ossos · {result.effectiveFps} FPS</span>{result.warnings.map((warning) => <small key={warning}>{warning}</small>)}</div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="motion-library-empty-main"><Library size={35} /><strong>Escolha um movimento</strong><span>Os arquivos ficam salvos somente neste computador, dentro dos dados locais do aplicativo.</span></div>
                )}

                {error && <div className="motion-library-error">{error}</div>}
                <div className="motion-library-message">{busy && <LoaderCircle className="motion-library-spin" size={14} />}{message}</div>
              </main>
            </div>

            <footer className="motion-library-footer">
              <button className="motion-library-close-button" disabled={busy} onClick={() => setOpen(false)}>Fechar</button>
              <button className="motion-library-import-button" disabled={!selected || busy || modelInfo?.format !== 'VRM'} onClick={() => void applySelected()}>
                {busy ? <LoaderCircle className="motion-library-spin" size={15} /> : <Play size={15} fill="currentColor" />} Aplicar na timeline
              </button>
            </footer>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
