const fs = require('node:fs/promises');
const path = require('node:path');
const { safeStorage } = require('electron');

const DEFAULT_SETTINGS = {
  provider: 'LM Studio',
  endpoint: 'http://127.0.0.1:1234/v1',
  model: '',
  temperature: 0.35,
  encryptedApiKey: null,
};

const BASE_BONES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
];

const SEMANTIC_ACTIONS = [
  'walk', 'run', 'heroPose', 'relaxedPose', 'cutePose', 'wave', 'bow',
  'jump', 'turn', 'nod', 'shakeHead', 'crouch',
];

function cleanEndpoint(value) {
  const endpoint = String(value || DEFAULT_SETTINGS.endpoint).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(endpoint)) throw new Error('O endpoint precisa começar com http:// ou https://.');
  return endpoint;
}

function completionUrl(endpoint) {
  const clean = cleanEndpoint(endpoint);
  return clean.endsWith('/chat/completions') ? clean : `${clean}/chat/completions`;
}

function modelsUrl(endpoint) {
  const clean = cleanEndpoint(endpoint);
  if (clean.endsWith('/chat/completions')) return clean.replace(/\/chat\/completions$/, '/models');
  return `${clean}/models`;
}

function extractJson(text) {
  const source = String(text || '').trim();
  if (!source) throw new Error('O modelo não retornou conteúdo.');
  try { return JSON.parse(source); } catch {}
  const unfenced = source.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(unfenced); } catch {}
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) return JSON.parse(source.slice(start, index + 1));
    }
  }
  throw new Error('O modelo não retornou um JSON de movimento válido.');
}

function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function wordNumber(value, fallback = 2) {
  const words = {
    um: 1, uma: 1, one: 1,
    dois: 2, duas: 2, two: 2,
    tres: 3, three: 3,
    quatro: 4, four: 4,
    cinco: 5, five: 5,
    seis: 6, six: 6,
    sete: 7, seven: 7,
    oito: 8, eight: 8,
    nove: 9, nine: 9,
    dez: 10, ten: 10,
  };
  const normalized = normalizeText(value).trim();
  if (normalized in words) return words[normalized];
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(20, Math.round(parsed))) : fallback;
}

function findIndex(text, patterns) {
  let best = -1;
  for (const pattern of patterns) {
    const index = text.search(pattern);
    if (index >= 0 && (best < 0 || index < best)) best = index;
  }
  return best;
}

function inferRequestedActions(prompt) {
  const text = normalizeText(prompt);
  const found = [];
  const push = (index, action) => { if (index >= 0) found.push({ index, action }); };
  const stepMatch = text.match(/(?:(\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+)?(?:passos?|steps?)/);
  const walkIndex = findIndex(text, [/\b(?:andar|caminhar|caminhe|walk|walking|passos?|steps?)\b/]);
  const runIndex = findIndex(text, [/\b(?:correr|corra|correndo|run|running)\b/]);
  const direction = /(?:para tras|backward|backwards)/.test(text)
    ? 'backward'
    : /(?:para esquerda|to the left)/.test(text)
      ? 'left'
      : /(?:para direita|to the right)/.test(text)
        ? 'right'
        : 'forward';
  if (runIndex >= 0) push(runIndex, { type: 'run', steps: wordNumber(stepMatch?.[1], 4), direction });
  else if (walkIndex >= 0) push(walkIndex, { type: 'walk', steps: wordNumber(stepMatch?.[1], 2), direction });

  push(findIndex(text, [/(?:pose|pode|postura)\s+(?:de\s+)?heroi/, /hero(?:ic)?\s+pose/, /pose\s+heroica/]), { type: 'heroPose' });
  push(findIndex(text, [/(?:pose|pode|postura)\s+fofa/, /cute\s+pose/]), { type: 'cutePose' });
  push(findIndex(text, [/(?:pose|pode|postura)\s+(?:natural|relaxada)/, /relaxed\s+pose/]), { type: 'relaxedPose' });
  push(findIndex(text, [/\b(?:acenar|acene|acenando|wave|waving)\b/]), {
    type: 'wave',
    side: /(?:mao|braco)\s+esquerd|left\s+(?:hand|arm)/.test(text) ? 'left' : 'right',
    repetitions: 3,
  });
  push(findIndex(text, [/\b(?:reverencia|curvar-se|bow|bowing)\b/]), { type: 'bow' });
  push(findIndex(text, [/\b(?:pular|pule|pulando|saltar|jump|jumping)\b/]), { type: 'jump' });
  push(findIndex(text, [/\b(?:agachar|agache|agachando|crouch|squat)\b/]), { type: 'crouch' });
  push(findIndex(text, [/\b(?:assentir|acenar com a cabeca|nod|nodding)\b/]), { type: 'nod', repetitions: 2 });
  push(findIndex(text, [/(?:negar|balancar)\s+(?:com\s+)?a\s+cabeca/, /shake\s+(?:her|his|the)?\s*head/]), { type: 'shakeHead', repetitions: 2 });

  const turnIndex = findIndex(text, [/\b(?:girar|gire|virar|vire|turn|rotate)\b/]);
  if (turnIndex >= 0) {
    const degreesMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:graus|degrees)/);
    const degrees = degreesMatch ? Number(degreesMatch[1].replace(',', '.')) : 90;
    push(turnIndex, { type: 'turn', degrees: degrees * (/(?:direita|right)/.test(text) ? -1 : 1) });
  }

  return found
    .sort((a, b) => a.index - b.index)
    .map((item) => item.action)
    .filter((action, index, list) => list.findIndex((candidate) => candidate.type === action.type) === index);
}

function ensureActionCoverage(spec, prompt) {
  const required = inferRequestedActions(prompt);
  const existing = Array.isArray(spec.actions)
    ? spec.actions.filter((action) => action && typeof action === 'object' && SEMANTIC_ACTIONS.includes(action.type))
    : [];
  const existingTypes = new Set(existing.map((action) => action.type));
  const added = [];
  for (const action of required) {
    if (!existingTypes.has(action.type)) {
      existing.push(action);
      existingTypes.add(action.type);
      added.push(action.type);
    }
  }
  spec.actions = existing;
  if (added.length) spec.coverageAdded = added;
  return spec;
}

function validateDraft(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('A especificação gerada não é um objeto.');
  const hasActions = Array.isArray(spec.actions) && spec.actions.length > 0;
  const hasFrames = Array.isArray(spec.frames) && spec.frames.length >= 2;
  if (!hasActions && !hasFrames) throw new Error('O movimento precisa conter ações semânticas ou pelo menos dois keyframes.');
  if (!Number.isFinite(Number(spec.duration)) || Number(spec.duration) <= 0) throw new Error('A duração gerada é inválida.');
  return spec;
}

function buildSystemPrompt({ availableBones, fps, requestedDuration, requestedLoop, style, intensity }) {
  const bones = Array.isArray(availableBones) && availableBones.length
    ? availableBones.filter((bone) => BASE_BONES.includes(bone))
    : BASE_BONES;
  const durationRule = Number.isFinite(Number(requestedDuration)) && Number(requestedDuration) > 0
    ? `Use exatamente ${Number(requestedDuration).toFixed(2)} segundos.`
    : 'Escolha entre 1 e 120 segundos conforme a complexidade do pedido.';
  const loopRule = requestedLoop === true
    ? 'O movimento precisa formar um loop contínuo.'
    : requestedLoop === false
      ? 'O movimento não é loop e deve terminar na pose final solicitada ou em uma pose natural.'
      : 'Decida se deve ser loop com base no pedido.';

  return `Você é um diretor de movimento para avatares VRM humanoides. Retorne somente JSON.

ARQUITETURA
- Para ações conhecidas, NÃO invente rotações. Gere uma lista semântica em actions.
- O aplicativo executa as ações com rotinas determinísticas nos normalizedHumanBones do VRM.
- Use frames somente para detalhes extras que não existam na lista de ações.
- Preserve exatamente a ordem e a quantidade das ações pedidas.

AÇÕES DISPONÍVEIS
walk {type,steps,direction,distance}; run {type,steps,direction,distance}; heroPose; relaxedPose; cutePose; wave {side,repetitions}; bow; jump; turn {degrees}; nod {repetitions}; shakeHead {repetitions}; crouch.

CONVENÇÃO VRM
- T-pose normalizada. VRM 1.0 olha para +Z; VRM 0.x é rotacionado pelo carregador para a mesma direção.
- forward = +Z local do avatar; backward = -Z; left = +X; right = -X; +Y = cima; metros.
- O mapeamento de ossos vem do humanoide do arquivo VRM. Não invente nomes.

FORMATO
{"name":"nome","duration":4,"loop":false,"summary":"resumo","actions":[{"type":"walk","steps":2,"direction":"forward","distance":1.04},{"type":"heroPose"}],"frames":[]}

REGRAS
- actions segue a ordem da frase.
- 2 passos significa steps=2.
- Para frente significa direction="forward". Nunca troque por backward por causa da câmera.
- A pose final pedida deve ser a última action.
- Não substitua heroPose/cutePose/relaxedPose por ângulos improvisados.
- start e duration por ação são opcionais; o app pode distribuir o tempo.
- frames aceita somente ajustes extras e estes ossos: ${bones.join(', ')}.
- ${durationRule}
- ${loopRule}
- Estilo: ${style || 'Natural'}. Intensidade: ${Math.max(0, Math.min(100, Number(intensity) || 55))}/100. FPS: ${Math.max(1, Number(fps) || 30)}.
- Não remova nenhuma ação explicitamente solicitada.`;
}

const REFINE_PROMPT = `Revise o JSON contra o pedido original. Confirme ordem, quantidade, direção e pose final. Passos para frente usam direction "forward". Não converta ações conhecidas em rotações manuais. Retorne o JSON completo sem explicação.`;

class TextMotionService {
  constructor({ app, onProgress }) {
    this.app = app;
    this.onProgress = onProgress;
    this.settingsPath = path.join(app.getPath('userData'), 'text-motion-settings.json');
    this.settings = { ...DEFAULT_SETTINGS };
    this.memoryApiKey = '';
    this.activeController = null;
    this.ready = this.loadSettings();
  }

  emit(payload) { this.onProgress?.(payload); }

  async loadSettings() {
    try { this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(await fs.readFile(this.settingsPath, 'utf8')) }; }
    catch { this.settings = { ...DEFAULT_SETTINGS }; }
  }

  async writeSettings() {
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.writeFile(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf8');
  }

  decryptApiKey() {
    if (this.memoryApiKey) return this.memoryApiKey;
    const encrypted = this.settings.encryptedApiKey;
    if (!encrypted || !safeStorage.isEncryptionAvailable()) return '';
    try { return safeStorage.decryptString(Buffer.from(encrypted, 'base64')); } catch { return ''; }
  }

  publicSettings() {
    return {
      provider: this.settings.provider,
      endpoint: this.settings.endpoint,
      model: this.settings.model,
      temperature: this.settings.temperature,
      hasApiKey: Boolean(this.decryptApiKey()),
      apiKeyCanBeStored: safeStorage.isEncryptionAvailable(),
    };
  }

  async getSettings() { await this.ready; return this.publicSettings(); }

  async saveSettings(input = {}) {
    await this.ready;
    this.settings.provider = String(input.provider || this.settings.provider || 'Personalizado').slice(0, 80);
    this.settings.endpoint = cleanEndpoint(input.endpoint || this.settings.endpoint);
    this.settings.model = String(input.model ?? this.settings.model ?? '').trim().slice(0, 200);
    this.settings.temperature = Math.max(0, Math.min(1.5, Number(input.temperature) || 0.35));
    if (input.clearApiKey) {
      this.settings.encryptedApiKey = null;
      this.memoryApiKey = '';
    } else if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
      const secret = input.apiKey.trim();
      if (safeStorage.isEncryptionAvailable()) {
        this.settings.encryptedApiKey = safeStorage.encryptString(secret).toString('base64');
        this.memoryApiKey = '';
      } else {
        this.settings.encryptedApiKey = null;
        this.memoryApiKey = secret;
      }
    }
    await this.writeSettings();
    return this.publicSettings();
  }

  requestHeaders() {
    const headers = { 'content-type': 'application/json' };
    const apiKey = this.decryptApiKey();
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    if (this.settings.endpoint.includes('openrouter.ai')) {
      headers['HTTP-Referer'] = 'https://github.com/inobushi3/Vrmposemode';
      headers['X-Title'] = 'VRM Pose Mode';
    }
    return headers;
  }

  async testConnection() {
    await this.ready;
    const response = await fetch(modelsUrl(this.settings.endpoint), { method: 'GET', headers: this.requestHeaders(), signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      throw new Error(`Falha ao testar o provedor (${response.status}): ${body || response.statusText}`);
    }
    const payload = await response.json().catch(() => ({}));
    const models = Array.isArray(payload?.data) ? payload.data.map((item) => String(item?.id || '')).filter(Boolean).slice(0, 200) : [];
    return { ok: true, models };
  }

  async callChat(messages, controller) {
    const model = String(this.settings.model || '').trim();
    if (!model) throw new Error('Selecione ou digite o nome do modelo de linguagem.');
    const response = await fetch(completionUrl(this.settings.endpoint), {
      method: 'POST',
      headers: this.requestHeaders(),
      body: JSON.stringify({ model, messages, temperature: this.settings.temperature, max_tokens: 12000 }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 1200);
      throw new Error(`O provedor recusou a geração (${response.status}): ${body || response.statusText}`);
    }
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('O provedor não retornou conteúdo no formato OpenAI-compatible.');
    return content;
  }

  async generate(request = {}) {
    await this.ready;
    if (this.activeController) this.activeController.abort();
    const controller = new AbortController();
    this.activeController = controller;
    const prompt = String(request.prompt || '').trim();
    if (!prompt) throw new Error('Descreva o movimento que deseja criar.');
    const systemPrompt = buildSystemPrompt({
      availableBones: request.availableBones,
      fps: request.fps,
      requestedDuration: request.duration,
      requestedLoop: request.loop,
      style: request.style,
      intensity: request.intensity,
    });
    const userPrompt = `Crie este movimento preservando todas as ações e sua ordem: ${prompt}`;
    try {
      this.emit({ phase: 'draft', progress: 0.12, message: 'Separando ações e direção do movimento…' });
      const draftText = await this.callChat([{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], controller);
      const draft = validateDraft(ensureActionCoverage(extractJson(draftText), prompt));
      this.emit({ phase: 'draft-ready', progress: request.refine ? 0.58 : 0.92, message: 'Plano semântico criado.' });
      let result = draft;
      let refined = false;
      if (request.refine) {
        this.emit({ phase: 'refine', progress: 0.64, message: 'Conferindo passos, direção e pose final…' });
        try {
          const refinedText = await this.callChat([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
            { role: 'assistant', content: JSON.stringify(draft) },
            { role: 'user', content: REFINE_PROMPT },
          ], controller);
          result = validateDraft(ensureActionCoverage(extractJson(refinedText), prompt));
          refined = true;
        } catch (error) {
          if (controller.signal.aborted) throw error;
          console.warn('A revisão automática falhou; usando o primeiro resultado.', error);
        }
      }
      result = ensureActionCoverage(result, prompt);
      this.emit({ phase: 'done', progress: 1, message: refined ? 'Plano revisado e compilável.' : 'Plano pronto para compilar.' });
      return { spec: result, refined };
    } finally {
      if (this.activeController === controller) this.activeController = null;
    }
  }

  cancel() { this.activeController?.abort(); this.activeController = null; }
}

module.exports = { TextMotionService, extractJson, buildSystemPrompt, inferRequestedActions, ensureActionCoverage };
