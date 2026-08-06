import { useEffect, useMemo, useState, type DragEvent } from 'react';
import {
  AlertTriangle,
  Archive,
  Box,
  Check,
  ChevronRight,
  CircleDot,
  Download,
  FileArchive,
  FileBox,
  FileJson,
  FolderOpen,
  Gauge,
  Image,
  Layers3,
  LoaderCircle,
  Music2,
  PackageCheck,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  SquareTerminal,
  UploadCloud,
  WandSparkles,
  X,
} from 'lucide-react';
import type {
  AnalysisResult,
  AnalyzedFile,
  AssetCategory,
  RunUnityResult,
  UnityInstallation,
  WorkspaceResult,
} from './types';

const CATEGORY_LABELS: Record<AssetCategory, string> = {
  model: 'Modelos',
  animation: 'Animações',
  'animation-controller': 'Controllers',
  texture: 'Texturas',
  material: 'Materiais',
  shader: 'Shaders',
  prefab: 'Prefabs',
  scene: 'Cenas',
  'unity-asset': 'Assets Unity',
  metadata: 'Metadados',
  audio: 'Áudios',
  script: 'Scripts',
  binary: 'Binários',
  data: 'Dados',
  document: 'Documentos',
  package: 'Pacotes',
  other: 'Outros',
};

const CATEGORY_ICONS: Partial<Record<AssetCategory, typeof Box>> = {
  model: Box,
  animation: Music2,
  texture: Image,
  material: Layers3,
  prefab: FileBox,
  shader: Sparkles,
  audio: Music2,
  package: Archive,
  data: FileJson,
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent > 1 ? 2 : 0)} ${units[exponent]}`;
}

function scoreTone(score: number): string {
  if (score >= 80) return 'excellent';
  if (score >= 55) return 'good';
  return 'weak';
}

function shortPath(value: string, max = 66): string {
  if (value.length <= max) return value;
  return `…${value.slice(-(max - 1))}`;
}

function CandidateCard({
  file,
  kind,
  selected,
  checked,
  onSelect,
  onToggle,
}: {
  file: AnalyzedFile;
  kind: 'model' | 'animation';
  selected?: boolean;
  checked?: boolean;
  onSelect?: () => void;
  onToggle?: () => void;
}) {
  const score = kind === 'model' ? file.modelScore : file.animationScore;
  const reasons = kind === 'model' ? file.modelReasons : file.animationReasons;
  return (
    <button
      className={`candidate-card ${selected || checked ? 'selected' : ''}`}
      onClick={onSelect ?? onToggle}
      type="button"
    >
      <span className={`candidate-check ${selected || checked ? 'active' : ''}`}>
        {selected || checked ? <Check size={13} /> : <CircleDot size={12} />}
      </span>
      <span className="candidate-main">
        <strong>{file.name}</strong>
        <small title={file.relativePath}>{shortPath(file.relativePath)}</small>
        <span className="reason-row">
          {reasons.slice(0, 2).map((reason) => <em key={reason}>{reason}</em>)}
        </span>
      </span>
      <span className={`score score-${scoreTone(score)}`}>{score}</span>
    </button>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <FileArchive size={34} />
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

const NAV_ITEMS = [
  { id: 'overview', icon: PackageCheck, label: 'Resumo' },
  { id: 'inventory', icon: Layers3, label: 'Inventário' },
  { id: 'model', icon: Box, label: 'Modelo VRM' },
  { id: 'animations', icon: Music2, label: 'Animações VRMA' },
  { id: 'convert', icon: Play, label: 'Conversão' },
] as const;

export default function App() {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [activeView, setActiveView] = useState<'overview' | 'inventory' | 'model' | 'animations' | 'convert'>('overview');
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedAnimations, setSelectedAnimations] = useState<Set<string>>(new Set());
  const [author, setAuthor] = useState('Auto VRM Converter');
  const [workspace, setWorkspace] = useState<WorkspaceResult | null>(null);
  const [unityInstallations, setUnityInstallations] = useState<UnityInstallation[]>([]);
  const [unityPath, setUnityPath] = useState('');
  const [workerLogs, setWorkerLogs] = useState<string[]>([]);
  const [runResult, setRunResult] = useState<RunUnityResult | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const dispose = window.autoVrm.onWorkerLog((message) => {
      if (!message) return;
      setWorkerLogs((current) => [...current.slice(-399), message]);
    });
    void window.autoVrm.detectUnity().then((items) => {
      setUnityInstallations(items);
      if (items[0]) setUnityPath(items[0].path);
    });
    return dispose;
  }, []);

  useEffect(() => {
    if (!analysis) return;
    setSelectedModel(analysis.modelCandidates[0]?.relativePath ?? '');
    setSelectedAnimations(new Set(analysis.animationCandidates.map((file) => file.relativePath)));
    setWorkspace(null);
    setRunResult(null);
    setWorkerLogs([]);
  }, [analysis]);

  const filteredFiles = useMemo(() => {
    if (!analysis) return [];
    const normalized = search.trim().toLowerCase();
    if (!normalized) return analysis.files;
    return analysis.files.filter((file) =>
      file.relativePath.toLowerCase().includes(normalized)
      || file.category.toLowerCase().includes(normalized),
    );
  }, [analysis, search]);

  const topCounts = useMemo(() => {
    if (!analysis) return [];
    return Object.entries(analysis.counts)
      .filter(([, value]) => Boolean(value))
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, 8) as [AssetCategory, number][];
  }, [analysis]);

  async function analyzePath(inputPath: string | null) {
    if (!inputPath) return;
    setBusy(true);
    setError('');
    try {
      const result = await window.autoVrm.analyzePath(inputPath);
      setAnalysis(result);
      setActiveView('overview');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      setDragging(false);
    }
  }

  async function chooseArchive() {
    await analyzePath(await window.autoVrm.pickArchive());
  }

  async function chooseFolder() {
    await analyzePath(await window.autoVrm.pickFolder());
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (!file) return;
    await analyzePath(window.autoVrm.getPathForFile(file));
  }

  function toggleAnimation(relativePath: string) {
    setSelectedAnimations((current) => {
      const next = new Set(current);
      if (next.has(relativePath)) next.delete(relativePath);
      else next.add(relativePath);
      return next;
    });
  }

  async function prepareWorkspace() {
    if (!analysis || !selectedModel) return;
    setBusy(true);
    setError('');
    try {
      const result = await window.autoVrm.prepareWorkspace(analysis.analysisId, {
        modelPath: selectedModel,
        animationPaths: [...selectedAnimations],
        author,
      });
      if (result) {
        setWorkspace(result);
        setActiveView('convert');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function pickUnity() {
    const picked = await window.autoVrm.pickUnity();
    if (picked) setUnityPath(picked);
  }

  async function runUnity() {
    if (!workspace || !unityPath) return;
    setBusy(true);
    setRunResult(null);
    setWorkerLogs([]);
    setError('');
    try {
      const result = await window.autoVrm.runUnity({
        unityPath,
        unityProjectPath: workspace.unityProjectPath,
        jobPath: workspace.jobPath,
        logPath: workspace.logPath,
      });
      setRunResult(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="title-brand">
          <span className="brand-icon"><WandSparkles size={17} /></span>
          <strong>Auto VRM Converter</strong>
          <small>Unity package → VRM 1.0 + VRMA</small>
        </div>
        <div className="title-drag" />
        <span className="version-pill">MVP 0.1</span>
      </header>

      <aside className="sidebar">
        <div className="sidebar-heading">Pipeline</div>
        {NAV_ITEMS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            className={activeView === id ? 'active' : ''}
            onClick={() => setActiveView(id)}
            disabled={!analysis && id !== 'overview'}
          >
            <Icon size={17} />
            <span>{label}</span>
            <ChevronRight size={14} />
          </button>
        ))}

        <div className="sidebar-heading secondary">Estado</div>
        <div className="pipeline-status">
          <span className={analysis ? 'done' : ''}><i>{analysis ? <Check size={11} /> : '1'}</i> Pacote analisado</span>
          <span className={selectedModel ? 'done' : ''}><i>{selectedModel ? <Check size={11} /> : '2'}</i> Modelo escolhido</span>
          <span className={workspace ? 'done' : ''}><i>{workspace ? <Check size={11} /> : '3'}</i> Workspace criado</span>
          <span className={runResult?.result?.status === 'success' ? 'done' : ''}><i>4</i> Arquivos exportados</span>
        </div>

        <div className="sidebar-note">
          <AlertTriangle size={15} />
          <span>Shaders, expressões e spring bones podem exigir correção manual.</span>
        </div>
      </aside>

      <main className="main-content">
        {error && (
          <div className="error-banner">
            <AlertTriangle size={17} />
            <span>{error}</span>
            <button onClick={() => setError('')}><X size={15} /></button>
          </div>
        )}

        {!analysis ? (
          <section className="welcome-view">
            <div className="hero-copy">
              <span className="eyebrow">Conversão orientada por evidências</span>
              <h1>Solte um pacote Unity.<br /><em>O app separa o que é cada coisa.</em></h1>
              <p>
                ZIPs, pastas, FBX, prefabs, texturas, materiais e AnimationClips são inventariados antes de qualquer exportação.
                Depois, um worker Unity + UniVRM produz o VRM e os VRMA possíveis.
              </p>
              <div className="hero-actions">
                <button className="primary" onClick={chooseArchive} disabled={busy}><FileArchive size={18} /> Abrir ZIP ou modelo</button>
                <button className="secondary" onClick={chooseFolder} disabled={busy}><FolderOpen size={18} /> Abrir pasta</button>
              </div>
            </div>

            <div
              className={`drop-zone ${dragging ? 'dragging' : ''}`}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              {busy ? <LoaderCircle className="spin" size={46} /> : <UploadCloud size={46} />}
              <strong>{busy ? 'Analisando pacote…' : 'Arraste o ZIP ou pasta aqui'}</strong>
              <span>O conteúdo original não é alterado.</span>
            </div>

            <div className="feature-strip">
              <span><Search size={17} /><b>Detecta conteúdo real</b><small>Não depende só da extensão.</small></span>
              <span><Layers3 size={17} /><b>Reconstrói GUIDs</b><small>Prefabs, materiais e clips Unity.</small></span>
              <span><Settings2 size={17} /><b>Automatiza Unity</b><small>Batch mode com logs verificáveis.</small></span>
            </div>
          </section>
        ) : (
          <>
            {activeView === 'overview' && (
              <section className="view-section">
                <div className="page-heading">
                  <div>
                    <span className="eyebrow">Pacote analisado</span>
                    <h1>{analysis.sourceName}</h1>
                    <p>{analysis.totalFiles} arquivos · {formatBytes(analysis.totalBytes)} · {analysis.dependencyCount} referências resolvidas</p>
                  </div>
                  <div className="heading-actions">
                    <button className="secondary" onClick={() => void window.autoVrm.exportReport(analysis.analysisId)}><Download size={16} /> Relatório JSON</button>
                    <button className="secondary" onClick={chooseArchive}><RefreshCw size={16} /> Trocar pacote</button>
                  </div>
                </div>

                <div className="stat-grid">
                  <article><Box size={19} /><span><strong>{analysis.modelCandidates.length}</strong><small>candidatos de modelo</small></span></article>
                  <article><Music2 size={19} /><span><strong>{analysis.animationCandidates.length}</strong><small>candidatos de animação</small></span></article>
                  <article><Image size={19} /><span><strong>{analysis.counts.texture ?? 0}</strong><small>texturas</small></span></article>
                  <article><AlertTriangle size={19} /><span><strong>{analysis.unresolvedGuids.length}</strong><small>GUIDs ausentes</small></span></article>
                </div>

                <div className="overview-grid">
                  <div className="panel">
                    <div className="panel-title"><Gauge size={17} /><span>Confiança da detecção</span></div>
                    <div className="confidence-block">
                      <div className="confidence-line">
                        <span>Modelo principal</span>
                        <strong>{analysis.modelCandidates[0]?.modelScore ?? 0}%</strong>
                      </div>
                      <div className="meter"><i style={{ width: `${Math.min(100, analysis.modelCandidates[0]?.modelScore ?? 0)}%` }} /></div>
                      <p>{analysis.modelCandidates[0]?.relativePath ?? 'Nenhum modelo detectado.'}</p>
                    </div>
                    <div className="confidence-block">
                      <div className="confidence-line">
                        <span>Animações</span>
                        <strong>{analysis.animationCandidates.length}</strong>
                      </div>
                      <div className="meter"><i style={{ width: `${Math.min(100, analysis.animationCandidates.length * 8)}%` }} /></div>
                      <p>FBX, .anim, BVH e VRMA são tratados separadamente.</p>
                    </div>
                  </div>

                  <div className="panel">
                    <div className="panel-title"><Layers3 size={17} /><span>Conteúdo do pacote</span></div>
                    <div className="category-grid">
                      {topCounts.map(([category, count]) => {
                        const Icon = CATEGORY_ICONS[category] ?? FileBox;
                        return <span key={category}><Icon size={15} /><b>{count}</b><small>{CATEGORY_LABELS[category]}</small></span>;
                      })}
                    </div>
                  </div>
                </div>

                <div className="panel warnings-panel">
                  <div className="panel-title"><AlertTriangle size={17} /><span>O que precisa de atenção</span></div>
                  {analysis.warnings.length ? analysis.warnings.map((warning) => <p key={warning}><AlertTriangle size={14} /> {warning}</p>) : <p className="success-line"><Check size={14} /> Nenhum problema estrutural óbvio foi encontrado.</p>}
                </div>

                <div className="next-action">
                  <div><strong>Próxima etapa</strong><span>Confirme qual arquivo representa o personagem principal.</span></div>
                  <button className="primary" onClick={() => setActiveView('model')}>Escolher modelo <ChevronRight size={16} /></button>
                </div>
              </section>
            )}

            {activeView === 'inventory' && (
              <section className="view-section">
                <div className="page-heading compact">
                  <div><span className="eyebrow">Inventário completo</span><h1>{analysis.totalFiles} arquivos identificados</h1></div>
                  <div className="search-field"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nome, pasta ou tipo…" /></div>
                </div>
                <div className="inventory-table panel">
                  <div className="inventory-head"><span>Arquivo</span><span>Tipo</span><span>Tamanho</span><span>Referências</span></div>
                  <div className="inventory-body">
                    {filteredFiles.map((file) => {
                      const Icon = CATEGORY_ICONS[file.category] ?? FileBox;
                      return (
                        <div className="inventory-row" key={file.relativePath}>
                          <span><Icon size={15} /><span><strong>{file.name}</strong><small>{file.relativePath}</small></span></span>
                          <span><em>{CATEGORY_LABELS[file.category]}</em></span>
                          <span>{formatBytes(file.size)}</span>
                          <span className={file.unresolvedGuids.length ? 'danger-text' : ''}>{file.resolvedDependencies.length} / {file.unresolvedGuids.length}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            )}

            {activeView === 'model' && (
              <section className="view-section">
                <div className="page-heading compact">
                  <div><span className="eyebrow">Modelo de saída</span><h1>Qual arquivo é o personagem?</h1><p>O worker tentará gerar Avatar Humanoid e exportar VRM 1.0.</p></div>
                </div>
                <div className="selection-layout">
                  <div className="candidate-list panel">
                    <div className="panel-title"><Box size={17} /><span>Candidatos classificados</span><small>{analysis.modelCandidates.length}</small></div>
                    {analysis.modelCandidates.length ? analysis.modelCandidates.map((file) => (
                      <CandidateCard key={file.relativePath} file={file} kind="model" selected={selectedModel === file.relativePath} onSelect={() => setSelectedModel(file.relativePath)} />
                    )) : <EmptyState title="Nenhum modelo detectado" text="O pacote não possui FBX, GLB, VRM ou prefab com malha identificável." />}
                  </div>
                  <div className="selection-info panel">
                    <div className="panel-title"><Settings2 size={17} /><span>Estratégia de conversão</span></div>
                    <div className="process-list">
                      <span><i>1</i><b>Importar</b><small>Preserva .meta e referências do pacote.</small></span>
                      <span><i>2</i><b>Humanoid</b><small>Configura FBX e valida Avatar humano.</small></span>
                      <span><i>3</i><b>Materiais</b><small>Shaders incompatíveis recebem fallback PBR.</small></span>
                      <span><i>4</i><b>VRM 1.0</b><small>Exporta pelo UniVRM com relatório de erro.</small></span>
                    </div>
                    <label className="field-label">Autor nos metadados VRM<input value={author} onChange={(event) => setAuthor(event.target.value)} /></label>
                    <div className="honesty-note"><AlertTriangle size={15} /><span>Blendshapes são mantidos como morph targets, mas presets de expressão e spring bones ainda não são inferidos automaticamente.</span></div>
                  </div>
                </div>
                <div className="next-action">
                  <div><strong>{selectedModel ? 'Modelo selecionado' : 'Selecione um candidato'}</strong><span>{selectedModel || 'Nenhum arquivo escolhido.'}</span></div>
                  <button className="primary" disabled={!selectedModel} onClick={() => setActiveView('animations')}>Configurar animações <ChevronRight size={16} /></button>
                </div>
              </section>
            )}

            {activeView === 'animations' && (
              <section className="view-section">
                <div className="page-heading compact">
                  <div><span className="eyebrow">Exportação VRMA</span><h1>Escolha os movimentos</h1><p>{selectedAnimations.size} de {analysis.animationCandidates.length} candidatos serão processados.</p></div>
                  <div className="heading-actions">
                    <button className="secondary" onClick={() => setSelectedAnimations(new Set(analysis.animationCandidates.map((file) => file.relativePath)))}>Selecionar tudo</button>
                    <button className="secondary" onClick={() => setSelectedAnimations(new Set())}>Limpar</button>
                  </div>
                </div>
                <div className="candidate-list panel animation-list">
                  <div className="panel-title"><Music2 size={17} /><span>Animações encontradas</span><small>{analysis.animationCandidates.length}</small></div>
                  {analysis.animationCandidates.length ? analysis.animationCandidates.map((file) => (
                    <CandidateCard key={file.relativePath} file={file} kind="animation" checked={selectedAnimations.has(file.relativePath)} onToggle={() => toggleAnimation(file.relativePath)} />
                  )) : <EmptyState title="Nenhuma animação detectada" text="O modelo ainda poderá ser convertido, mas nenhum VRMA será criado." />}
                </div>
                <div className="next-action">
                  <div><strong>Preparar projeto temporário</strong><span>O app copiará o pacote e instalará UniVRM 0.131.0 no workspace.</span></div>
                  <button className="primary" disabled={!selectedModel || busy} onClick={prepareWorkspace}>{busy ? <LoaderCircle className="spin" size={16} /> : <WandSparkles size={16} />} Criar workspace</button>
                </div>
              </section>
            )}

            {activeView === 'convert' && (
              <section className="view-section">
                <div className="page-heading compact">
                  <div><span className="eyebrow">Worker Unity</span><h1>Executar conversão real</h1><p>O resultado vem do Unity em batch mode, não de uma simulação da interface.</p></div>
                </div>

                {!workspace ? (
                  <div className="panel workspace-empty">
                    <SquareTerminal size={36} />
                    <strong>O workspace ainda não foi criado.</strong>
                    <p>Volte em “Animações VRMA”, confirme os arquivos e crie o projeto temporário.</p>
                    <button className="primary" onClick={() => setActiveView('animations')}>Ir para animações</button>
                  </div>
                ) : (
                  <div className="convert-layout">
                    <div className="panel conversion-config">
                      <div className="panel-title"><Settings2 size={17} /><span>Configuração</span></div>
                      <label className="field-label">Unity Editor
                        <div className="path-picker">
                          <input value={unityPath} onChange={(event) => setUnityPath(event.target.value)} placeholder="C:\Program Files\Unity\Hub\Editor\...\Unity.exe" />
                          <button onClick={pickUnity}><FolderOpen size={15} /></button>
                        </div>
                      </label>
                      {unityInstallations.length > 0 && (
                        <div className="unity-chips">
                          {unityInstallations.slice(0, 4).map((item) => <button key={item.path} className={unityPath === item.path ? 'active' : ''} onClick={() => setUnityPath(item.path)}>Unity {item.version}</button>)}
                        </div>
                      )}
                      <div className="workspace-summary">
                        <span><b>Modelo</b><small>{workspace.modelCandidate}</small></span>
                        <span><b>Animações</b><small>{workspace.animationCount} candidatas</small></span>
                        <span><b>Saída</b><small>{workspace.outputPath}</small></span>
                      </div>
                      <button className="primary wide" disabled={!unityPath || busy} onClick={runUnity}>
                        {busy ? <LoaderCircle className="spin" size={17} /> : <Play size={17} />}
                        {busy ? 'Unity processando…' : 'Converter para VRM + VRMA'}
                      </button>
                      <button className="secondary wide" onClick={() => void window.autoVrm.openPath(workspace.workspacePath)}><FolderOpen size={16} /> Abrir workspace</button>
                    </div>

                    <div className="panel terminal-panel">
                      <div className="panel-title"><SquareTerminal size={17} /><span>Log do worker</span><small>{workerLogs.length} linhas</small></div>
                      <div className="terminal-output">
                        {workerLogs.length ? workerLogs.map((line, index) => <code key={`${index}-${line}`}>{line}</code>) : <span>Aguardando execução do Unity…</span>}
                      </div>
                    </div>
                  </div>
                )}

                {runResult && (
                  <div className={`panel result-panel ${runResult.result?.status === 'success' ? 'success' : 'failed'}`}>
                    <div className="result-heading">
                      {runResult.result?.status === 'success' ? <Check size={24} /> : <AlertTriangle size={24} />}
                      <span>
                        <strong>{runResult.result?.status === 'success' ? 'Conversão finalizada' : 'Conversão terminou com falhas'}</strong>
                        <small>Código do Unity: {runResult.code} · {runResult.result?.exportedAnimations ?? 0} VRMA exportados</small>
                      </span>
                      {workspace && <button className="secondary" onClick={() => void window.autoVrm.openPath(workspace.outputPath)}><FolderOpen size={15} /> Abrir saída</button>}
                    </div>
                    <div className="output-list">
                      {runResult.result?.outputs?.map((output, index) => (
                        <span key={`${output.source}-${index}`} className={output.status}>
                          {output.status === 'success' ? <Check size={14} /> : <AlertTriangle size={14} />}
                          <span><b>{output.type.toUpperCase()} · {output.source}</b><small>{output.message}</small></span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
