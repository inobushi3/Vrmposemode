import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, Check, Cpu, Database, Download, FileArchive, FolderPlus, Gauge,
  KeyRound, Library, LoaderCircle, Move3D, PackageOpen, Play, Trash2, Upload, X,
} from 'lucide-react';
import { useEditorStore } from '../store';
import {
  importMotionFile,
  inspectMotionFile,
  type ImportedMotion,
  type MotionInspection,
} from '../lib/motionImporter';
import {
  deleteStoredMotion,
  listStoredMotions,
  saveMotionFile,
  type StoredMotion,
} from '../lib/motionLibrary';
import {
  MOTION_FILE_ACCEPT,
  MOTION_FORMAT_LABELS,
  detectMotionFormat,
} from '../lib/motionFormats';
import {
  extractPmpPap,
  listPmpPapEntries,
  parsePapBytes,
  skeletonCodeFromPath,
  type PmpPapEntry,
} from '../lib/papPackage';

type ImportMode = 'replace' | 'append';

type MotionChoice =
  | { key: string; kind: 'standard'; clipIndex: number; name: string; duration: number }
  | { key: string; kind: 'pap'; pap: PmpPapEntry; name: string; duration: number };

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

function seconds(value: number): string {
  return value > 0 ? `${value.toFixed(2)}s` : 'calculada após converter';
}

function arrayBufferFromView(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

export default function MotionLibraryStudio(): JSX.Element | null {
  const inputRef = useRef<HTMLInputElement>(null);
  const sklbInputRef = useRef<HTMLInputElement>(null);
  const [toolbarHost, setToolbarHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [motions, setMotions] = useState<StoredMotion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspection, setInspection] = useState<MotionInspection | null>(null);
  const [result, setResult] = useState<ImportedMotion | null>(null);
  const [papEntries, setPapEntries] = useState<PmpPapEntry[]>([]);
  const [choiceKey, setChoiceKey] = useState('');
  const [sklbFile, setSklbFile] = useState<File | null>(null);
  const [papStatus, setPapStatus] = useState<PapConverterStatus | null>(null);
  const [papProgress, setPapProgress] = useState<PapConverterProgress | null>(null);
  const [sampleFps, setSampleFps] = useState(30);
  const [rootMotion, setRootMotion] = useState(true);
  const [rootScale, setRootScale] = useState(1);
  const [importMode, setImportMode] = useState<ImportMode>('replace');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Importe movimentos 3D e converta-os para keyframes VRM editáveis.');
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

  const choices = useMemo<MotionChoice[]>(() => {
    const standard: MotionChoice[] = (inspection?.clips ?? []).map((clip) => ({
      key: `standard:${clip.index}:${clip.embeddedPath ?? clip.name}`,
      kind: 'standard',
      clipIndex: clip.index,
      name: clip.name,
      duration: clip.duration,
    }));
    const pap: MotionChoice[] = papEntries.map((entry) => ({
      key: `pap:${entry.path}:${entry.index}`,
      kind: 'pap',
      pap: entry,
      name: `${entry.fileName} · ${entry.name}`,
      duration: 0,
    }));
    return [...standard, ...pap];
  }, [inspection, papEntries]);

  const selectedChoice = choices.find((choice) => choice.key === choiceKey) ?? choices[0] ?? null;
  const selectedPap = selectedChoice?.kind === 'pap' ? selectedChoice.pap : null;
  const expectedSkeletonCode = selectedPap?.skeletonCode ?? null;
  const expectedSklbName = expectedSkeletonCode ? `skl_${expectedSkeletonCode}b0001.sklb` : 'arquivo .sklb correspondente';
  const sklbMismatch = Boolean(
    selectedPap?.skeletonCode
    && sklbFile
    && !sklbFile.name.toLowerCase().includes(selectedPap.skeletonCode),
  );
  const papProgressActive = Boolean(
    busy
    && papProgress
    && ['download', 'extract', 'convert'].includes(papProgress.phase),
  );
  const canConvert = Boolean(
    selected
    && inspection
    && selectedChoice
    && modelInfo?.format === 'VRM'
    && !busy
    && (selectedChoice.kind === 'standard'
      ? inspection.convertible
      : papStatus?.supported && sklbFile && !sklbMismatch),
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

  useEffect(() => {
    if (!choices.length) {
      setChoiceKey('');
      return;
    }
    if (!choices.some((choice) => choice.key === choiceKey)) setChoiceKey(choices[0].key);
  }, [choices, choiceKey]);

  useEffect(() => {
    if (!open || !window.desktop?.pap) return;
    let active = true;
    const removeProgress = window.desktop.pap.onProgress((progress) => {
      if (!active) return;
      setPapProgress(progress.phase === 'ready' || progress.phase === 'done' ? null : progress);
      setMessage(progress.message);
    });
    void window.desktop.pap.status().then((status) => {
      if (!active) return;
      setPapStatus(status);
      if (status.installed) setPapProgress(null);
    }).catch(() => {
      if (active) setPapStatus(null);
    });
    return () => {
      active = false;
      removeProgress();
    };
  }, [open]);

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

  function inspectPapSources(record: StoredMotion): PmpPapEntry[] {
    if (record.format === 'pmp') return listPmpPapEntries(record.data.slice(0));
    if (record.format === 'pap') {
      const parsed = parsePapBytes(record.data.slice(0));
      const skeletonCode = skeletonCodeFromPath(record.fileName);
      return parsed.animations.map((animation) => ({
        ...animation,
        path: record.fileName,
        fileName: record.fileName,
        skeletonCode,
      }));
    }
    return [];
  }

  useEffect(() => {
    setInspection(null);
    setPapEntries([]);
    setResult(null);
    setChoiceKey('');
    setSklbFile(null);
    setPapProgress(null);
    if (!selected) return;
    let cancelled = false;
    setBusy(true);
    setMessage(`Inspecionando ${selected.fileName}…`);
    void inspectMotionFile(selected.fileName, selected.data.slice(0), availableBones).then((value) => {
      if (cancelled) return;
      const detectedPap = inspectPapSources(selected);
      setInspection(value);
      setPapEntries(detectedPap);
      if (detectedPap.length) {
        setMessage(`${detectedPap.length} animação(ões) PAP encontrada(s). Nenhuma conversão está rodando: selecione o SKLB correspondente.`);
      } else {
        setMessage(value.convertible
          ? `${MOTION_FORMAT_LABELS[value.format]} pronto para conversão.`
          : `${MOTION_FORMAT_LABELS[value.format]} reconhecido, mas não contém animação conversível.`);
      }
    }).catch((inspectError) => {
      if (!cancelled) setError(readableError(inspectError));
    }).finally(() => {
      if (!cancelled) setBusy(false);
    });
    return () => { cancelled = true; };
  }, [selected?.id, availableBones.join('|')]);

  const addFile = async (file: File): Promise<void> => {
    const format = detectMotionFormat(file.name);
    if (!format) {
      setError('Use VRMA, BVH, FBX, GLB, glTF, PMP ou PAP.');
      return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    setMessage(`Validando ${file.name}…`);
    try {
      const data = await file.arrayBuffer();
      const info = await inspectMotionFile(file.name, data.slice(0), availableBones);
      const record = await saveMotionFile(file, data);
      const detectedPap = inspectPapSources(record);
      await refresh(record.id);
      setInspection(info);
      setPapEntries(detectedPap);
      setChoiceKey('');
      setSklbFile(null);
      setPapProgress(null);
      setMessage(detectedPap.length
        ? `${record.name} salvo. Nenhuma conversão está rodando: selecione o SKLB para começar.`
        : info.convertible
          ? `${record.name} salvo e pronto para converter.`
          : `${record.name} salvo, mas não contém uma animação esquelética conversível.`);
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
      setPapEntries([]);
      setResult(null);
      setSklbFile(null);
      setPapProgress(null);
      setMessage('Movimento removido da biblioteca local.');
    } catch (deleteError) {
      setError(readableError(deleteError));
    } finally {
      setBusy(false);
    }
  };

  const preparePapConverter = async (): Promise<void> => {
    const bridge = window.desktop?.pap;
    if (!bridge) {
      setError('O conversor PAP só funciona na janela Electron iniciada por npm start.');
      return;
    }
    setBusy(true);
    setError('');
    setPapProgress(null);
    try {
      const status = await bridge.prepare();
      setPapStatus(status);
      setMessage(sklbFile
        ? 'Conversor XAT preparado. Clique em Converter PAP para timeline.'
        : `Conversor XAT preparado. Nenhuma conversão está rodando; selecione ${expectedSklbName}.`);
    } catch (prepareError) {
      setError(readableError(prepareError));
    } finally {
      setPapProgress(null);
      setBusy(false);
    }
  };

  const convertSelectedSource = async (): Promise<ImportedMotion> => {
    if (!selected || !selectedChoice || !modelInfo) throw new Error('Selecione uma animação válida.');
    const options = {
      availableBones,
      sampleFps,
      rootMotion,
      rootScale,
      clipIndex: selectedChoice.kind === 'standard' ? selectedChoice.clipIndex : 0,
      targetHeight: modelInfo.heightMeters ?? 1.65,
      targetMetaVersion: modelInfo.metaVersion,
    };

    if (selectedChoice.kind === 'standard') {
      return importMotionFile(selected.fileName, selected.data.slice(0), options);
    }

    if (!sklbFile) throw new Error(`Selecione ${expectedSklbName} para esta animação PAP.`);
    if (sklbMismatch) throw new Error(`O PAP usa ${selectedChoice.pap.skeletonCode}, mas o SKLB escolhido é ${sklbFile.name}.`);
    const bridge = window.desktop?.pap;
    if (!bridge) throw new Error('O conversor PAP não está disponível fora do Electron.');
    const papBytes = selected.format === 'pmp'
      ? extractPmpPap(selected.data.slice(0), selectedChoice.pap.path)
      : new Uint8Array(selected.data.slice(0));
    const sklbBytes = new Uint8Array(await sklbFile.arrayBuffer());
    const converted = await bridge.convert({
      pap: papBytes,
      sklb: sklbBytes,
      animationIndex: selectedChoice.pap.index,
      expectedSkeletonCode: selectedChoice.pap.skeletonCode ?? undefined,
      sklbFileName: sklbFile.name,
    });
    const imported = await importMotionFile(
      converted.fileName,
      arrayBufferFromView(converted.fbx),
      { ...options, clipIndex: 0 },
    );
    imported.name = converted.animationName || imported.name;
    if (converted.warning) imported.warnings.push(converted.warning);
    imported.warnings.push('Fonte PAP/Havok convertida localmente pelo runtime oficial do XAT antes do retargeting VRM.');
    return imported;
  };

  const applySelected = async (): Promise<void> => {
    if (!selected || !inspection || !selectedChoice) {
      setError('Importe ou selecione um arquivo de movimento.');
      return;
    }
    if (selectedChoice.kind === 'standard' && !inspection.convertible) {
      setError(inspection.warnings.join(' '));
      return;
    }
    if (!modelInfo || modelInfo.format !== 'VRM') {
      setError('Abra primeiro o modelo VRM que receberá o movimento.');
      return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    setPapProgress(null);
    setMessage(selectedChoice.kind === 'pap'
      ? 'Extraindo PAP, vinculando o SKLB e convertendo Havok para FBX…'
      : 'Retargeting do esqueleto original para o humanoide normalizado VRM…');
    try {
      const imported = await convertSelectedSource();
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
      setMessage(`${imported.name} convertido para o humanoide normalizado.`);
      setStatus(`${imported.name}: ${positioned.length} keyframes importados de ${imported.importedBones} ossos e prontos para exportar como VRMA.`);
    } catch (applyError) {
      setError(readableError(applyError));
    } finally {
      setPapProgress(null);
      setBusy(false);
    }
  };

  if (!toolbarHost) return null;

  const toolbarButton = createPortal(
    <button className="secondary-button motion-library-toolbar-button" onClick={() => setOpen(true)} title="Importar VRMA, BVH, FBX, GLB, glTF, PMP e PAP">
      <Library size={16} /> Movimentos
    </button>,
    toolbarHost,
  );

  if (!open) return toolbarButton;

  const visibleWarnings = (inspection?.warnings ?? []).filter((warning) => {
    if (!papEntries.length) return true;
    return !/PAP uses proprietary|No directly convertible|formato interno exige|matching FFXIV skeleton/i.test(warning);
  });

  return (
    <>
      {toolbarButton}
      {createPortal(
        <div className="motion-library-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) setOpen(false);
        }}>
          <section className="motion-library-studio" role="dialog" aria-modal="true" aria-label="Biblioteca de movimentos 3D">
            <header className="motion-library-header">
              <span className="motion-library-logo"><Library size={20} /></span>
              <div><strong>Biblioteca de movimentos</strong><small>VRMA · BVH · FBX · GLB/glTF · PMP/PAP + SKLB</small></div>
              <span className="motion-library-count"><Database size={14} /> {motions.length} salvo(s)</span>
              <button onClick={() => !busy && setOpen(false)}><X size={18} /></button>
            </header>

            <input ref={inputRef} hidden type="file" accept={MOTION_FILE_ACCEPT} onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void addFile(file);
              event.currentTarget.value = '';
            }} />
            <input ref={sklbInputRef} hidden type="file" accept=".sklb" onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setSklbFile(file);
              setResult(null);
              setError('');
              setPapProgress(null);
              setMessage(file
                ? `${file.name} selecionado. Clique em Converter PAP para timeline.`
                : `Nenhuma conversão está rodando; selecione ${expectedSklbName}.`);
              event.currentTarget.value = '';
            }} />

            <div className="motion-library-body">
              <aside className="motion-library-list-panel">
                <button className="motion-library-add" disabled={busy} onClick={() => inputRef.current?.click()}>
                  <FolderPlus size={16} /> Importar movimento
                </button>
                <div className="motion-library-list">
                  {motions.length === 0 && (
                    <div className="motion-library-empty-list"><FileArchive size={27} /><strong>Nenhum movimento salvo</strong><span>Adicione VRMA, BVH, FBX, GLB, glTF, PMP ou PAP.</span></div>
                  )}
                  {motions.map((motion) => (
                    <button key={motion.id} className={selectedId === motion.id ? 'selected' : ''} onClick={() => setSelectedId(motion.id)}>
                      <span className="motion-library-file-icon"><FileArchive size={17} /></span>
                      <span><strong>{motion.name}</strong><small><b className={`motion-format-badge format-${motion.format}`}>{MOTION_FORMAT_LABELS[motion.format]}</b>{fileSize(motion.size)} · {shortDate(motion.importedAt)}</small></span>
                    </button>
                  ))}
                </div>
                <button className="motion-library-delete" disabled={!selected || busy} onClick={() => void removeSelected()}><Trash2 size={14} /> Remover selecionado</button>
              </aside>

              <main className="motion-library-main">
                {selected ? (
                  <>
                    <div className="motion-library-selected">
                      <span>{selected.format === 'pmp' ? <PackageOpen size={23} /> : <FileArchive size={23} />}</span>
                      <div><strong>{inspection?.name ?? selected.name}</strong><small>{selected.fileName}{inspection?.author ? ` · ${inspection.author}` : ''}{inspection?.version ? ` · v${inspection.version}` : ''}</small></div>
                      <b className={`motion-format-badge large format-${selected.format}`}>{MOTION_FORMAT_LABELS[selected.format]}</b>
                    </div>

                    <div className="motion-library-stats">
                      <span><b>{seconds(selectedChoice?.duration ?? 0)}</b>Duração</span>
                      <span><b>{selectedChoice?.kind === 'pap' ? 'após XAT' : inspection?.mappedBones ?? '—'}</b>Ossos mapeados</span>
                      <span><b>{selectedChoice?.kind === 'pap' ? 'detectado após converter' : inspection ? (inspection.hasRootMotion ? 'Sim' : 'Não') : '—'}</b>Root motion</span>
                      <span><b>{fileSize(selected.size)}</b>Arquivo</span>
                    </div>

                    {choices.length > 1 && (
                      <label className="motion-library-clip-select"><span>Clipe ou animação do pacote</span><select value={selectedChoice?.key ?? ''} onChange={(event) => {
                        setChoiceKey(event.target.value);
                        setSklbFile(null);
                        setPapProgress(null);
                      }}>{choices.map((choice) => <option key={choice.key} value={choice.key}>{choice.kind === 'pap' ? `[PAP${choice.pap.skeletonCode ? ` ${choice.pap.skeletonCode}` : ''}] ` : ''}{choice.name}{choice.duration ? ` · ${choice.duration.toFixed(2)}s` : ''}</option>)}</select></label>
                    )}

                    {selectedChoice?.kind === 'pap' && (
                      <section className="motion-pap-bridge">
                        <div className="motion-pap-title"><Cpu size={16} /><span><strong>Conversão PAP/Havok</strong><small>O PMP contém uma dança real. Para decodificá-la, o PAP precisa do esqueleto FFXIV correspondente.</small></span></div>
                        <div className="motion-pap-files">
                          <button disabled={busy} onClick={() => sklbInputRef.current?.click()}><KeyRound size={14} /> {sklbFile?.name ?? `Selecionar ${expectedSklbName}`}</button>
                          <button disabled={busy || papStatus?.installed || papStatus?.supported === false} onClick={() => void preparePapConverter()}>
                            {papStatus?.installed ? <Check size={14} /> : <Download size={14} />}
                            {papStatus?.installed ? 'XAT preparado' : 'Preparar conversor XAT'}
                          </button>
                        </div>
                        <div className={`motion-pap-waiting ${sklbFile ? 'ready' : ''}`}>
                          <KeyRound size={14} />
                          <span>{sklbFile
                            ? `${sklbFile.name} selecionado. O botão de conversão está pronto.`
                            : `Aguardando ${expectedSklbName}. O app não está processando nada agora.`}</span>
                        </div>
                        <div className="motion-pap-status">
                          <span>{papStatus?.supported === false
                            ? 'PAP/Havok exige Windows.'
                            : papProgressActive && papProgress
                              ? papProgress.message
                              : papStatus?.installed
                                ? 'Runtime XATHavokInterop instalado e ocioso.'
                                : 'O XAT oficial será baixado uma vez e reutilizado offline.'}</span>
                          {papProgressActive && papProgress && <div><i style={{ width: `${Math.max(2, Math.min(100, papProgress.progress * 100))}%` }} /></div>}
                        </div>
                        {sklbMismatch && <div className="motion-library-warning"><AlertTriangle size={14} /><span>Esse PAP usa {selectedPap?.skeletonCode}, mas você escolheu {sklbFile?.name}. Selecione {expectedSklbName}.</span></div>}
                      </section>
                    )}

                    <div className="motion-library-settings">
                      <label><span><Gauge size={14} /> Amostragem</span><select value={sampleFps} onChange={(event) => setSampleFps(Number(event.target.value))}><option value={15}>15 FPS · leve</option><option value={30}>30 FPS · recomendado</option><option value={60}>60 FPS · máximo</option></select></label>
                      <label><span><Upload size={14} /> Destino</span><select value={importMode} onChange={(event) => setImportMode(event.target.value as ImportMode)}><option value="replace">Substituir timeline</option><option value="append">Inserir no cursor</option></select></label>
                      <label className="motion-library-toggle"><span><Move3D size={14} /> Manter deslocamento</span><input type="checkbox" checked={rootMotion} onChange={(event) => setRootMotion(event.target.checked)} /></label>
                      <label><span>Escala do deslocamento <b>{rootScale.toFixed(2)}×</b></span><input type="range" min={0} max={2} step={0.05} disabled={!rootMotion} value={rootScale} onChange={(event) => setRootScale(Number(event.target.value))} /></label>
                    </div>

                    <div className="motion-library-note">
                      O app executa a animação no esqueleto original, separa o motion root do quadril anatômico, calcula a diferença para a pose de repouso e converte o resultado para o humanoide VRM. O movimento de saída do lugar é gravado no canal de posição dos quadris.
                    </div>

                    {inspection?.packageEntries && (
                      <div className="motion-package-summary"><PackageOpen size={16} /><span><strong>{inspection.packageEntries.length} arquivo(s) no pacote</strong><small>{papEntries.length} animação(ões) PAP · {inspection.clips.length} animação(ões) padrão</small></span></div>
                    )}

                    {visibleWarnings.map((warning) => (
                      <div className="motion-library-warning" key={warning}><AlertTriangle size={14} /><span>{warning}</span></div>
                    ))}

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
              <button className="motion-library-import-button" disabled={!canConvert} onClick={() => void applySelected()}>
                {busy ? <LoaderCircle className="motion-library-spin" size={15} /> : <Play size={15} fill="currentColor" />} {selectedChoice?.kind === 'pap' ? 'Converter PAP para timeline' : 'Converter para timeline'}
              </button>
            </footer>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
