import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bot, Check, ChevronDown, CircleStop, Cloud, Cpu, KeyRound, LoaderCircle,
  Play, Save, Settings2, Sparkles, TestTube2, WandSparkles, X,
} from 'lucide-react';
import { useEditorStore } from '../store';
import {
  compileTextMotion,
  type CompiledTextMotion,
  type RawTextMotionSpec,
} from '../lib/textMotion';

interface ProviderPreset {
  name: string;
  endpoint: string;
  model: string;
  local: boolean;
}

const PROVIDERS: ProviderPreset[] = [
  { name: 'LM Studio', endpoint: 'http://127.0.0.1:1234/v1', model: '', local: true },
  { name: 'Ollama', endpoint: 'http://127.0.0.1:11434/v1', model: 'qwen3:8b', local: true },
  { name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1', model: '', local: false },
  { name: 'OpenAI', endpoint: 'https://api.openai.com/v1', model: '', local: false },
  { name: 'Personalizado', endpoint: '', model: '', local: false },
];

const PROMPT_PRESETS = [
  'Acenar alegremente com a mão direita e voltar à pose natural',
  'Fazer uma reverência elegante e lenta',
  'Pular de alegria com preparação e aterrissagem suave',
  'Dançar de forma fofa por alguns segundos',
  'Dar dois passos à frente e fazer uma pose heroica',
  'Cruzar os braços, olhar para o lado e demonstrar impaciência',
];

const STYLES = ['Natural', 'Fofo', 'Elegante', 'Enérgico', 'Dramático', 'Engraçado'];

type LoopMode = 'auto' | 'loop' | 'once';
type ImportMode = 'append' | 'replace';
type StudioStatus = 'idle' | 'testing' | 'generating' | 'ready' | 'error';

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || 'Falha desconhecida.');
}

function providerIcon(provider: string): JSX.Element {
  return provider === 'LM Studio' || provider === 'Ollama' ? <Cpu size={15} /> : <Cloud size={15} />;
}

export default function TextMotionStudio(): JSX.Element | null {
  const [toolbarHost, setToolbarHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<StudioStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('Descreva o movimento que deseja criar.');
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('Natural');
  const [intensity, setIntensity] = useState(55);
  const [customDuration, setCustomDuration] = useState(true);
  const [duration, setDuration] = useState(4);
  const [loopMode, setLoopMode] = useState<LoopMode>('once');
  const [refine, setRefine] = useState(true);
  const [importMode, setImportMode] = useState<ImportMode>('append');
  const [provider, setProvider] = useState('LM Studio');
  const [endpoint, setEndpoint] = useState('http://127.0.0.1:1234/v1');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKeyCanBeStored, setApiKeyCanBeStored] = useState(true);
  const [temperature, setTemperature] = useState(0.45);
  const [models, setModels] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [result, setResult] = useState<CompiledTextMotion | null>(null);
  const [error, setError] = useState('');
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const modelInfo = useEditorStore((state) => state.modelInfo);
  const availableBones = useEditorStore((state) => state.availableBones);
  const fps = useEditorStore((state) => state.fps);
  const currentTime = useEditorStore((state) => state.currentTime);
  const importKeyframes = useEditorStore((state) => state.importKeyframes);
  const setEditorStatus = useEditorStore((state) => state.setStatus);
  const setLoop = useEditorStore((state) => state.setLoop);

  const selectedProvider = useMemo(
    () => PROVIDERS.find((item) => item.name === provider) ?? PROVIDERS[4],
    [provider],
  );

  useEffect(() => {
    const toolbar = document.querySelector<HTMLElement>('.toolbar');
    if (!toolbar) return;
    const host = document.createElement('div');
    host.className = 'text-motion-toolbar-host';
    const spacer = toolbar.querySelector('.toolbar-spacer');
    toolbar.insertBefore(host, spacer);
    setToolbarHost(host);
    return () => host.remove();
  }, []);

  useEffect(() => {
    const remove = window.desktop?.textMotion.onProgress((event) => {
      setProgress(event.progress);
      setProgressMessage(event.message);
    });
    return () => remove?.();
  }, []);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError('');
    setStatus('idle');
    setProgress(0);
    void window.desktop?.textMotion.getSettings().then((settings) => {
      setProvider(settings.provider || 'Personalizado');
      setEndpoint(settings.endpoint);
      setModel(settings.model);
      setTemperature(settings.temperature);
      setHasApiKey(settings.hasApiKey);
      setApiKeyCanBeStored(settings.apiKeyCanBeStored);
    }).catch((settingsError) => {
      setError(readableError(settingsError));
      setStatus('error');
    });
    requestAnimationFrame(() => promptRef.current?.focus());
  }, [open]);

  const chooseProvider = (name: string): void => {
    const preset = PROVIDERS.find((item) => item.name === name);
    setProvider(name);
    setModels([]);
    if (!preset || name === 'Personalizado') return;
    setEndpoint(preset.endpoint);
    if (preset.model) setModel(preset.model);
  };

  const saveSettings = async (): Promise<void> => {
    const bridge = window.desktop?.textMotion;
    if (!bridge) throw new Error('O gerador por texto só funciona na janela Electron iniciada por npm start.');
    const saved = await bridge.saveSettings({
      provider,
      endpoint,
      model,
      temperature,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    });
    setHasApiKey(saved.hasApiKey);
    setApiKeyCanBeStored(saved.apiKeyCanBeStored);
    setApiKey('');
  };

  const testConnection = async (): Promise<void> => {
    setStatus('testing');
    setError('');
    setProgressMessage('Testando conexão com o provedor…');
    try {
      await saveSettings();
      const response = await window.desktop!.textMotion.testConnection();
      setModels(response.models);
      if (!model && response.models[0]) setModel(response.models[0]);
      setProgressMessage(response.models.length
        ? `Conexão aprovada · ${response.models.length} modelo(s) encontrado(s).`
        : 'Conexão aprovada. Digite o identificador do modelo manualmente.');
      setStatus('idle');
    } catch (testError) {
      setError(readableError(testError));
      setStatus('error');
    }
  };

  const generate = async (): Promise<void> => {
    if (!modelInfo || modelInfo.format !== 'VRM') {
      setError('Abra um modelo VRM humanoide antes de gerar o movimento.');
      setStatus('error');
      return;
    }
    if (!prompt.trim()) {
      setError('Descreva o movimento que deseja criar.');
      setStatus('error');
      return;
    }
    setStatus('generating');
    setResult(null);
    setError('');
    setProgress(0.04);
    try {
      await saveSettings();
      const response = await window.desktop!.textMotion.generate({
        prompt: prompt.trim(),
        duration: customDuration ? duration : null,
        loop: loopMode === 'auto' ? null : loopMode === 'loop',
        style,
        intensity,
        refine,
        fps,
        availableBones,
      });
      const compiled = compileTextMotion(response.spec as RawTextMotionSpec, {
        availableBones,
        fps,
        requestedDuration: customDuration ? duration : null,
        requestedLoop: loopMode === 'auto' ? null : loopMode === 'loop',
      });
      setResult(compiled);
      setStatus('ready');
      setProgress(1);
      setProgressMessage(response.refined
        ? 'Movimento gerado, revisado e validado.'
        : 'Movimento gerado e validado.');
    } catch (generationError) {
      setError(readableError(generationError));
      setStatus('error');
      setProgress(0);
    }
  };

  const cancelGeneration = (): void => {
    window.desktop?.textMotion.cancel();
    setStatus('idle');
    setProgress(0);
    setProgressMessage('Geração cancelada.');
  };

  const apply = (): void => {
    if (!result) return;
    const offset = importMode === 'append' ? currentTime : 0;
    const positioned = result.keyframes.map((frame) => ({
      ...frame,
      id: crypto.randomUUID(),
      time: frame.time + offset,
    }));
    importKeyframes(positioned, importMode);
    setLoop(result.loop);
    const first = positioned[0]?.time ?? currentTime;
    const store = useEditorStore.getState();
    store.setCurrentTime(Math.min(store.duration, first + 1 / Math.max(1, fps)));
    requestAnimationFrame(() => useEditorStore.getState().setCurrentTime(first));
    setEditorStatus(
      `“${result.name}” adicionado com ${result.keyframes.length} keyframes e ${result.boneCount} ossos. Revise a animação antes de exportar.`,
    );
    setOpen(false);
  };

  const close = (): void => {
    if (status === 'generating') window.desktop?.textMotion.cancel();
    setOpen(false);
  };

  if (!toolbarHost) return null;

  const toolbarButton = createPortal(
    <button
      className="secondary-button text-motion-toolbar-button"
      title="Criar movimento editável a partir de uma descrição"
      onClick={() => setOpen(true)}
    >
      <WandSparkles size={16} /> Criar por texto
    </button>,
    toolbarHost,
  );

  if (!open) return toolbarButton;

  return (
    <>
      {toolbarButton}
      {createPortal(
        <div className="text-motion-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) close();
        }}>
          <section className="text-motion-studio" role="dialog" aria-modal="true" aria-label="Criar movimento por texto">
            <header className="text-motion-header">
              <span className="text-motion-logo"><WandSparkles size={20} /></span>
              <div><strong>Criar movimento por texto</strong><small>LLM → keyframes validados → timeline editável</small></div>
              <div className={`text-motion-provider-badge ${selectedProvider.local ? 'local' : ''}`}>
                {providerIcon(provider)} {provider}
              </div>
              <button className="text-motion-close" onClick={close}><X size={18} /></button>
            </header>

            <div className="text-motion-body">
              <main className="text-motion-compose">
                <div className="text-motion-section-title"><Sparkles size={15} /> Descrição do movimento</div>
                <div className="text-motion-prompt-wrap">
                  <textarea
                    ref={promptRef}
                    value={prompt}
                    maxLength={1600}
                    placeholder="Ex.: Ela dá dois passos para frente, acena com a mão direita, gira levemente o corpo e termina em uma pose fofa."
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && status !== 'generating') void generate();
                    }}
                  />
                  <span>{prompt.length}/1600 · Ctrl+Enter para gerar</span>
                </div>

                <div className="text-motion-presets">
                  {PROMPT_PRESETS.map((preset) => (
                    <button key={preset} onClick={() => setPrompt(preset)}>{preset}</button>
                  ))}
                </div>

                <div className="text-motion-options-grid">
                  <label><span>Estilo</span><select value={style} onChange={(event) => setStyle(event.target.value)}>{STYLES.map((item) => <option key={item}>{item}</option>)}</select></label>
                  <label><span>Intensidade <strong>{intensity}%</strong></span><input type="range" min={10} max={100} step={5} value={intensity} onChange={(event) => setIntensity(Number(event.target.value))} /></label>
                  <label><span>Duração</span><div className="text-motion-duration"><input type="checkbox" checked={customDuration} onChange={(event) => setCustomDuration(event.target.checked)} /><input type="number" min={0.2} max={300} step={0.1} disabled={!customDuration} value={duration} onChange={(event) => setDuration(Math.max(0.2, Math.min(300, Number(event.target.value) || 4)))} /><small>s</small></div></label>
                  <label><span>Repetição</span><select value={loopMode} onChange={(event) => setLoopMode(event.target.value as LoopMode)}><option value="once">Executar uma vez</option><option value="loop">Loop perfeito</option><option value="auto">Decisão automática</option></select></label>
                </div>

                <div className="text-motion-switch-row">
                  <label><input type="checkbox" checked={refine} onChange={(event) => setRefine(event.target.checked)} /><span><strong>Revisão automática em duas etapas</strong><small>Um segundo passe procura poses impossíveis, cortes e movimentos incompletos.</small></span></label>
                  <label><span><strong>Destino da timeline</strong><small>O resultado entra como keyframes normais e pode ser corrigido manualmente.</small></span><select value={importMode} onChange={(event) => setImportMode(event.target.value as ImportMode)}><option value="append">Inserir no cursor</option><option value="replace">Substituir timeline</option></select></label>
                </div>

                <button className="text-motion-settings-toggle" onClick={() => setSettingsOpen((value) => !value)}>
                  <Settings2 size={15} /><span>Provedor e modelo</span><ChevronDown size={14} className={settingsOpen ? 'open' : ''} />
                </button>

                {settingsOpen && (
                  <div className="text-motion-settings-panel">
                    <div className="text-motion-provider-tabs">
                      {PROVIDERS.map((item) => <button key={item.name} className={provider === item.name ? 'active' : ''} onClick={() => chooseProvider(item.name)}>{providerIcon(item.name)}{item.name}</button>)}
                    </div>
                    <div className="text-motion-settings-grid">
                      <label><span>Endpoint OpenAI-compatible</span><input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="http://127.0.0.1:1234/v1" /></label>
                      <label><span>Modelo</span><input list="text-motion-models" value={model} onChange={(event) => setModel(event.target.value)} placeholder="Identificador do modelo" /><datalist id="text-motion-models">{models.map((item) => <option key={item} value={item} />)}</datalist></label>
                      <label><span>API key {hasApiKey && <em>salva</em>}</span><div className="text-motion-secret"><KeyRound size={14} /><input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={hasApiKey ? 'Manter chave salva' : selectedProvider.local ? 'Opcional para servidor local' : 'Cole sua chave'} /></div></label>
                      <label><span>Temperatura <strong>{temperature.toFixed(2)}</strong></span><input type="range" min={0} max={1.2} step={0.05} value={temperature} onChange={(event) => setTemperature(Number(event.target.value))} /></label>
                    </div>
                    <div className="text-motion-settings-actions">
                      <small>{apiKeyCanBeStored ? 'A chave é criptografada pelo sistema operacional e não é enviada ao renderer.' : 'A chave ficará somente na memória desta sessão porque o cofre do sistema está indisponível.'}</small>
                      <button onClick={() => void saveSettings()}><Save size={14} /> Salvar</button>
                      <button onClick={() => void testConnection()} disabled={status === 'testing'}>{status === 'testing' ? <LoaderCircle className="text-motion-spin" size={14} /> : <TestTube2 size={14} />} Testar</button>
                    </div>
                  </div>
                )}
              </main>

              <aside className="text-motion-result-column">
                <div className="text-motion-engine-card"><Bot size={19} /><div><strong>Gerador estruturado</strong><small>O modelo descreve poses e tempos. O app limita articulações, converte Euler para quaternion e só então cria keyframes.</small></div></div>

                {(status === 'generating' || status === 'testing') && (
                  <div className="text-motion-working">
                    <LoaderCircle className="text-motion-spin" size={30} />
                    <strong>{status === 'testing' ? 'Testando provedor' : 'Criando animação'}</strong>
                    <span>{progressMessage}</span>
                    <div><i style={{ width: `${Math.max(4, progress * 100)}%` }} /></div>
                  </div>
                )}

                {error && <div className="text-motion-error">{error}</div>}

                {result ? (
                  <div className="text-motion-result">
                    <div className="text-motion-result-check"><Check size={20} /></div>
                    <strong>{result.name}</strong>
                    <p>{result.summary || 'Movimento estruturado e pronto para entrar na timeline.'}</p>
                    <div className="text-motion-result-stats">
                      <span><b>{result.duration.toFixed(2)}s</b>Duração</span>
                      <span><b>{result.keyframes.length}</b>Keyframes</span>
                      <span><b>{result.boneCount}</b>Ossos</span>
                      <span><b>{result.loop ? 'Sim' : 'Não'}</b>Loop</span>
                    </div>
                    {result.warnings.length > 0 && <details><summary>{result.warnings.length} correção(ões) automática(s)</summary>{result.warnings.map((warning) => <small key={warning}>{warning}</small>)}</details>}
                  </div>
                ) : status === 'idle' || status === 'error' ? (
                  <div className="text-motion-empty"><WandSparkles size={31} /><strong>O movimento aparecerá aqui</strong><span>Descreva ações, ritmo, emoção e pose final. Quanto mais concreto o pedido, melhor o resultado.</span></div>
                ) : null}

                <div className="text-motion-privacy"><KeyRound size={14} /><span>Somente a descrição do movimento é enviada ao provedor selecionado. O modelo VRM e seus arquivos permanecem locais.</span></div>
              </aside>
            </div>

            <footer className="text-motion-footer">
              <button className="text-motion-cancel" onClick={close}>Cancelar</button>
              {status === 'generating' ? (
                <button className="text-motion-stop" onClick={cancelGeneration}><CircleStop size={15} /> Parar geração</button>
              ) : (
                <button className="text-motion-generate" onClick={() => void generate()} disabled={!prompt.trim() || status === 'testing'}><Play size={15} fill="currentColor" /> {result ? 'Gerar novamente' : 'Gerar movimento'}</button>
              )}
              <button className="text-motion-apply" onClick={apply} disabled={!result || status !== 'ready'}><Check size={16} /> Adicionar à timeline</button>
            </footer>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
