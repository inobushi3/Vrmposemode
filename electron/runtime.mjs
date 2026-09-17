import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { app } from 'electron';
import axios from 'axios';
import AdmZip from 'adm-zip';

const LEMON_PORT = 13357;
const WHISPER_MODEL = 'Whisper-Large-v3-Turbo';
const TRANSLATION_MODEL = 'Qwen3-4B-GGUF';
const KOKORO_BASE = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main';
const KOKORO_MODEL_URL = `${KOKORO_BASE}/onnx/model.onnx?download=true`;
const KOKORO_VOICES = ['pf_dora', 'pm_alex', 'pm_santa'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

async function download(url, destination, onProgress, label) {
  await ensureDir(path.dirname(destination));
  const tmp = `${destination}.part`;
  const response = await axios.get(url, { responseType: 'stream', timeout: 30000 });
  const total = Number(response.headers['content-length'] || 0);
  let loaded = 0;
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    response.data.on('data', (chunk) => {
      loaded += chunk.length;
      if (total > 0 && onProgress) onProgress(loaded / total, label);
    });
    response.data.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    response.data.pipe(out);
  });
  await fsp.rm(destination, { force: true });
  await fsp.rename(tmp, destination);
}

async function findRecursive(dir, filename) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) return p;
    if (entry.isDirectory()) {
      const hit = await findRecursive(p, filename);
      if (hit) return hit;
    }
  }
  return null;
}

export class AIRuntime {
  constructor(onProgress = () => {}) {
    this.root = path.join(app.getPath('userData'), 'ai-runtime');
    this.lemonadeDir = path.join(this.root, 'lemonade');
    this.lemonadeCache = path.join(this.root, 'lemonade-cache');
    this.kokoroDir = path.join(this.root, 'kokoro');
    this.kokoroModel = path.join(this.kokoroDir, 'model.onnx');
    this.kokoroVoices = path.join(this.kokoroDir, 'voices');
    this.stateFile = path.join(this.root, 'state.json');
    this.apiKey = crypto.createHash('sha256').update(`${app.getName()}-local-dubber`).digest('hex');
    this.baseUrl = `http://127.0.0.1:${LEMON_PORT}`;
    this.process = null;
    this.backend = null;
    this.onProgress = onProgress;
  }

  authHeaders() {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  async api(method, url, data, config = {}) {
    try {
      return await axios({
        ...config,
        method,
        url: `${this.baseUrl}${url}`,
        data,
        timeout: config.timeout ?? 120000,
        headers: { ...this.authHeaders(), ...(config.headers || {}) }
      });
    } catch (e) {
      const status = e?.response?.status;
      const body = e?.response?.data;
      let detail = '';
      if (typeof body === 'string') detail = body;
      else if (body?.error?.message) detail = body.error.message;
      else if (body?.error) detail = typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
      else if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
      else if (body) {
        try { detail = JSON.stringify(body); } catch {}
      }
      const prefix = `Lemonade ${status || 'erro'} em ${String(method).toUpperCase()} ${url}`;
      const err = new Error(detail ? `${prefix}: ${detail}` : `${prefix}: ${e?.message || 'falha desconhecida'}`);
      err.status = status;
      err.cause = e;
      throw err;
    }
  }

  emit(progress, message) {
    this.onProgress({ progress, message });
  }

  async status() {
    const lemonExe = await findRecursive(this.lemonadeDir, 'lemond.exe').catch(() => null);
    const voicesReady = (await Promise.all(KOKORO_VOICES.map(v => exists(path.join(this.kokoroVoices, `${v}.bin`))))).every(Boolean);
    const ttsReady = await exists(this.kokoroModel) && voicesReady;
    let state = {};
    try { state = JSON.parse(await fsp.readFile(this.stateFile, 'utf8')); } catch {}
    const runtimeInstalled = Boolean(lemonExe);
    const modelsReady = Boolean(state.modelsReady);
    const backend = state.backend || null;
    return {
      ready: runtimeInstalled && modelsReady && ttsReady,
      runtimeInstalled,
      modelsReady,
      backend,
      ttsReady
    };
  }

  async ensureLemonade() {
    let exe = await findRecursive(this.lemonadeDir, 'lemond.exe').catch(() => null);
    if (exe) return exe;

    this.emit(3, 'Baixando o runtime Lemonade para Windows...');
    await ensureDir(this.lemonadeDir);
    const rel = await axios.get('https://api.github.com/repos/lemonade-sdk/lemonade/releases/latest', {
      timeout: 30000,
      headers: { 'User-Agent': 'Dublagem-de-Video-AI' }
    });
    const assets = rel.data?.assets || [];
    const asset = assets.find((a) => /embeddable.*windows.*x64.*\.zip$/i.test(a.name))
      || assets.find((a) => /windows.*x64.*\.zip$/i.test(a.name));
    if (!asset) throw new Error('Não encontrei o pacote Windows x64 do Lemonade na release atual.');

    const zipPath = path.join(this.root, 'lemonade.zip');
    await download(asset.browser_download_url, zipPath, (p) => this.emit(3 + p * 12, `Baixando runtime: ${Math.round(p * 100)}%`));
    this.emit(16, 'Extraindo runtime local...');
    new AdmZip(zipPath).extractAllTo(this.lemonadeDir, true);
    await fsp.rm(zipPath, { force: true });
    exe = await findRecursive(this.lemonadeDir, 'lemond.exe');
    if (!exe) throw new Error('lemond.exe não apareceu depois da extração.');
    return exe;
  }

  async startServer() {
    try {
      await this.api('get', '/v1/health', undefined, { timeout: 1800 });
      return;
    } catch {}

    const exe = await this.ensureLemonade();
    await ensureDir(this.lemonadeCache);
    const configDir = path.dirname(exe);
    this.emit(18, 'Iniciando servidor de IA local...');
    this.process = spawn(exe, [configDir, '--port', String(LEMON_PORT), '--host', '127.0.0.1'], {
      cwd: configDir,
      windowsHide: true,
      env: { ...process.env, LEMONADE_API_KEY: this.apiKey }
    });
    this.process.stdout?.on('data', (d) => console.log(`[lemond] ${d}`));
    this.process.stderr?.on('data', (d) => console.warn(`[lemond] ${d}`));

    for (let i = 0; i < 90; i++) {
      await sleep(700);
      try {
        await this.api('get', '/v1/health', undefined, { timeout: 1500 });
        return;
      } catch {}
    }
    throw new Error('O servidor Lemonade não iniciou a tempo.');
  }

  async installBackend(recipe, preferred) {
    const tryBackend = async (backend) => {
      this.emit(preferred === backend ? 23 : 26, `Instalando ${recipe} com backend ${backend}...`);
      await this.api('post', '/v1/install', { recipe, backend }, { timeout: 30 * 60 * 1000 });
      return backend;
    };
    try {
      return await tryBackend(preferred);
    } catch (first) {
      if (preferred === 'vulkan') throw first;
      console.warn(`${recipe}/${preferred} falhou, tentando Vulkan`, first?.message || first);
      return tryBackend('vulkan');
    }
  }

  async pullModel(model, progress, message) {
    this.emit(progress, message);
    try {
      await this.api('post', '/v1/pull', { model_name: model }, { timeout: 90 * 60 * 1000 });
    } catch (e) {
      const detail = e?.response?.data?.error || e?.response?.data?.detail || e?.message;
      throw new Error(`Falha ao baixar ${model}: ${detail}`);
    }
  }

  async ensureKokoro() {
    await ensureDir(this.kokoroVoices);
    if (!(await exists(this.kokoroModel))) {
      this.emit(72, 'Baixando Kokoro 82M PT-BR...');
      await download(KOKORO_MODEL_URL, this.kokoroModel, (p) => this.emit(72 + p * 8, `Kokoro: ${Math.round(p * 100)}%`));
    }
    for (let i = 0; i < KOKORO_VOICES.length; i++) {
      const voice = KOKORO_VOICES[i];
      const dest = path.join(this.kokoroVoices, `${voice}.bin`);
      if (!(await exists(dest))) {
        this.emit(81 + i * 3, `Baixando voz ${voice}...`);
        await download(`${KOKORO_BASE}/voices/${voice}.bin?download=true`, dest);
      }
    }
  }

  async setup() {
    await ensureDir(this.root);
    await this.startServer();

    // Perfil estável para Radeon no Windows: Vulkan evita travamentos/watchdog do llama-server
    // que podem ocorrer com alguns builds ROCm em RDNA4. Continua sendo aceleração na GPU.
    const llmBackend = await this.installBackend('llamacpp', 'vulkan');
    const whisperBackend = await this.installBackend('whispercpp', 'vulkan');
    this.backend = 'Vulkan';

    await this.api('post', '/internal/set', {
      llamacpp_backend: 'vulkan',
      whispercpp_backend: 'vulkan',
      ctx_size: 4096,
      max_loaded_models: 1,
      llamacpp_args: '--parallel 1',
      models_dir: this.lemonadeCache,
      broadcast: false
    }, { timeout: 30000 });

    await this.pullModel(WHISPER_MODEL, 38, 'Baixando Whisper Large v3 Turbo...');
    await this.pullModel(TRANSLATION_MODEL, 52, 'Baixando Qwen 3 4B para tradução...');
    await this.ensureKokoro();

    await fsp.writeFile(this.stateFile, JSON.stringify({
      modelsReady: true,
      profileVersion: 2,
      backend: this.backend,
      llmBackend,
      whisperBackend
    }, null, 2));
    this.emit(100, 'IA pronta na Radeon (Vulkan estável).');
    return this.status();
  }

  async ensureModel(model, progress = 0, message = '') {
    await this.startServer();
    try {
      const response = await this.api('get', '/v1/models?show_all=true', undefined, { timeout: 15000 });
      const models = response.data?.data || [];
      const hit = models.find((x) => x.id === model);
      if (hit?.downloaded) return;
    } catch (e) {
      console.warn('Não consegui consultar os modelos antes do load:', e?.message || e);
    }
    await this.pullModel(model, progress, message || `Baixando ${model}...`);
  }

  async loadModel(model, { ensure = true, ...loadOptions } = {}) {
    await this.startServer();
    if (ensure) await this.ensureModel(model);
    await this.api('post', '/v1/load', {
      model_name: model,
      ...loadOptions
    }, { timeout: 15 * 60 * 1000 });
  }

  async unloadModel(model) {
    try { await this.api('post', '/v1/unload', { model_name: model }, { timeout: 30000 }); } catch {}
  }

  async transcribeWav(wavPath, language = 'auto') {
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('file', fs.createReadStream(wavPath));
    form.append('model', WHISPER_MODEL);
    form.append('response_format', 'verbose_json');
    if (language && language !== 'auto') form.append('language', language);
    const response = await this.api('post', '/v1/audio/transcriptions', form, {
      timeout: 30 * 60 * 1000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: form.getHeaders()
    });
    return response.data;
  }

  async translateBatch(items, sourceLanguage = 'auto', model = TRANSLATION_MODEL) {
    const source = sourceLanguage === 'auto' ? 'o idioma detectado' : sourceLanguage;
    const system = `Você traduz cursos para português do Brasil. Traduza de ${source} para pt-BR. Preserve nomes de programas, código, atalhos, comandos, números e termos técnicos. Não resuma e não explique. Mantenha cada id e retorne SOMENTE um array JSON válido no formato [{"id":0,"text":"..."}].`;
    const response = await this.api('post', '/v1/chat/completions', {
      model,
      temperature: 0.1,
      max_completion_tokens: 1536,
      enable_thinking: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(items) }
      ]
    }, { timeout: 8 * 60 * 1000 });
    return response.data?.choices?.[0]?.message?.content || '';
  }

  getKokoroPaths() {
    let cli;
    if (app.isPackaged) {
      cli = path.join(process.resourcesPath, 'bin', 'kokoro-cli.exe');
    } else {
      cli = path.join(app.getAppPath(), 'native', 'kokoro-cli', 'target', 'release', 'kokoro-cli.exe');
    }
    return { cli, model: this.kokoroModel, voices: this.kokoroVoices };
  }

  async stop() {
    if (this.process && !this.process.killed) this.process.kill();
    this.process = null;
  }
}

export { WHISPER_MODEL, TRANSLATION_MODEL, KOKORO_VOICES };
