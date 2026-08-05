import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Download, FolderOpen, Save, Trash2 } from 'lucide-react';
import { useEditorStore } from '../store';
import {
  deleteStoredPose,
  importPoseFile,
  listStoredPoses,
  poseToFile,
  saveStoredPose,
  type StoredPose,
} from '../lib/poseLibrary';

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Falha desconhecida.');
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'pose';
}

function downloadJson(data: unknown, fileName: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function PersonalPoseLibrary(): JSX.Element | null {
  const inputRef = useRef<HTMLInputElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [poses, setPoses] = useState<StoredPose[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('Minha pose');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const modelInfo = useEditorStore((state) => state.modelInfo);
  const keyframes = useEditorStore((state) => state.keyframes);
  const currentTime = useEditorStore((state) => state.currentTime);
  const fps = useEditorStore((state) => state.fps);
  const upsertKeyframe = useEditorStore((state) => state.upsertKeyframe);
  const setCurrentTime = useEditorStore((state) => state.setCurrentTime);
  const setStatus = useEditorStore((state) => state.setStatus);

  const selected = useMemo(
    () => poses.find((pose) => pose.id === selectedId) ?? null,
    [poses, selectedId],
  );

  useEffect(() => {
    const container = document.querySelector<HTMLElement>('.pose-library');
    if (!container) return;
    const node = document.createElement('div');
    node.className = 'personal-pose-library-host';
    container.appendChild(node);
    setHost(node);
    return () => node.remove();
  }, []);

  const refresh = async (preferredId?: string): Promise<void> => {
    const records = await listStoredPoses();
    setPoses(records);
    const nextId = preferredId && records.some((record) => record.id === preferredId)
      ? preferredId
      : selectedId && records.some((record) => record.id === selectedId)
        ? selectedId
        : records[0]?.id ?? null;
    setSelectedId(nextId);
  };

  useEffect(() => {
    void refresh().catch((loadError) => setError(readableError(loadError)));
  }, []);

  const currentFrame = (): typeof keyframes[number] | null => {
    const targetFrame = Math.round(currentTime * Math.max(1, fps));
    return keyframes.find((frame) => Math.round(frame.time * Math.max(1, fps)) === targetFrame) ?? null;
  };

  const saveCurrent = async (): Promise<void> => {
    if (!modelInfo || modelInfo.format !== 'VRM') {
      setError('Abra um modelo VRM antes de salvar poses.');
      return;
    }
    const frame = currentFrame();
    if (!frame) {
      setError('Salve primeiro um keyframe da pose atual usando “+ Keyframe”.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const record = await saveStoredPose(name, frame.pose);
      await refresh(record.id);
      setName('Minha pose');
      setStatus(`Pose “${record.name}” salva na biblioteca pessoal.`);
    } catch (saveError) {
      setError(readableError(saveError));
    } finally {
      setBusy(false);
    }
  };

  const applySelected = (): void => {
    if (!selected) return;
    if (!modelInfo || modelInfo.format !== 'VRM') {
      setError('Abra um modelo VRM antes de aplicar a pose.');
      return;
    }
    setError('');
    upsertKeyframe({
      id: crypto.randomUUID(),
      time: currentTime,
      pose: structuredClone(selected.pose),
      easing: 'smooth',
    });
    const originalTime = currentTime;
    const nudge = Math.min(useEditorStore.getState().duration, originalTime + 1 / Math.max(1, fps));
    setCurrentTime(nudge);
    requestAnimationFrame(() => setCurrentTime(originalTime));
    setStatus(`Pose “${selected.name}” aplicada como keyframe em ${currentTime.toFixed(2)}s.`);
  };

  const removeSelected = async (): Promise<void> => {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await deleteStoredPose(selected.id);
      await refresh();
      setStatus(`Pose “${selected.name}” removida.`);
    } catch (deleteError) {
      setError(readableError(deleteError));
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const record = await importPoseFile(file);
      await refresh(record.id);
      setStatus(`Pose “${record.name}” importada.`);
    } catch (importError) {
      setError(readableError(importError));
    } finally {
      setBusy(false);
    }
  };

  if (!host) return null;

  return createPortal(
    <section className="personal-pose-library">
      <div className="personal-pose-divider"><span>Poses pessoais</span></div>
      <p>Monte a pose no VRM, salve um keyframe e guarde o snapshot normalizado aqui.</p>

      <input
        ref={inputRef}
        hidden
        type="file"
        accept=".json,.vrmpose.pose.json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importFile(file);
          event.currentTarget.value = '';
        }}
      />

      <div className="personal-pose-save-row">
        <input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="Nome da pose" />
        <button disabled={busy || !modelInfo} onClick={() => void saveCurrent()} title="Salvar o keyframe atual como pose reutilizável"><Save size={14} /></button>
        <button disabled={busy} onClick={() => inputRef.current?.click()} title="Importar arquivo de pose"><FolderOpen size={14} /></button>
      </div>

      <div className="personal-pose-list">
        {poses.length === 0 && <div className="personal-pose-empty">Nenhuma pose pessoal salva.</div>}
        {poses.map((pose) => (
          <button key={pose.id} className={pose.id === selectedId ? 'selected' : ''} onClick={() => setSelectedId(pose.id)}>
            <span><strong>{pose.name}</strong><small>{Object.keys(pose.pose).length} ossos normalizados</small></span>
            {pose.id === selectedId && <Check size={13} />}
          </button>
        ))}
      </div>

      <div className="personal-pose-actions">
        <button disabled={!selected || busy || !modelInfo} onClick={applySelected}><Check size={13} /> Aplicar como keyframe</button>
        <button disabled={!selected || busy} title="Exportar pose" onClick={() => {
          if (selected) downloadJson(poseToFile(selected), `${safeFileName(selected.name)}.vrmpose.pose.json`);
        }}><Download size={13} /></button>
        <button disabled={!selected || busy} title="Remover pose" onClick={() => void removeSelected()}><Trash2 size={13} /></button>
      </div>

      {error && <div className="personal-pose-error">{error}</div>}
    </section>,
    host,
  );
}
