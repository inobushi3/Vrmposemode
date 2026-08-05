const fs = require('node:fs/promises');
const path = require('node:path');
const { safeStorage } = require('electron');

const DEFAULT_SETTINGS = {
  provider: 'LM Studio',
  endpoint: 'http://127.0.0.1:1234/v1',
  model: '',
  temperature: 0.45,
  encryptedApiKey: null,
};

const BASE_BONES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
];

function cleanEndpoint(value) {
  const endpoint = String(value || DEFAULT_SETTINGS.endpoint).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(endpoint)) {
    throw new Error('O endpoint precisa começar com http:// ou https://.');
  }
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
  try {
    return JSON.parse(source);
  } catch {
    // Continua para respostas envolvidas em markdown ou texto acidental.
  }
  const unfenced = source
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    // Procura o primeiro objeto JSON balanceado sem depender de regex gulosa.
  }
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
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return JSON.parse(source.slice(start, index + 1));
      }
    }
  }
  throw new Error('O modelo não retornou um JSON de movimento válido.');
}

function validateDraft(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('A especificação gerada não é um objeto.');
  if (!Array.isArray(spec.frames) || spec.frames.length < 2) {
    throw new Error('O movimento precisa ter pelo menos dois keyframes.');
  }
  if (!Number.isFinite(Number(spec.duration)) || Number(spec.duration) <= 0) {
    throw new Error('A duração gerada é inválida.');
  }
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
    ? 'O movimento precisa formar um loop contínuo: primeiro e último quadro devem ser equivalentes.'
    : requestedLoop === false
      ? 'O movimento não é loop e deve terminar em uma pose natural estável.'
      : 'Decida se deve ser loop com base no pedido.';

  return `Você é um animador técnico especializado no humanoide normalizado VRM 1.0.
Transforme a descrição do usuário em keyframes editáveis. Retorne somente um objeto JSON, sem markdown.

SISTEMA DE COORDENADAS
- A pose de repouso é T-pose e todas as rotações são offsets Euler em graus, ordem XYZ.
- +Y é para cima. O personagem olha para +Z. +X aponta para o lado esquerdo do personagem.
- Posição só é permitida em hips, como deslocamento em metros [x,y,z].
- Braços abaixados naturais: leftUpperArm aproximadamente [0,0,-65] e rightUpperArm [0,0,65].
- Dobrar joelho usa principalmente X positivo em lowerLeg. Nunca faça joelho inverter para X muito negativo.
- Distribua inclinação do tronco entre spine, chest e upperChest; evite colocar tudo em um único osso.
- Movimentos amplos precisam de preparação, ação principal, amortecimento e pose final.
- Preserve equilíbrio: quando uma perna sai do chão, mova discretamente hips para a perna de apoio.
- Não use rotações impossíveis, torções bruscas ou teletransporte entre quadros.

OSSOS DISPONÍVEIS
${bones.join(', ')}

FORMATO OBRIGATÓRIO
{
  "name": "nome curto",
  "duration": 4,
  "loop": false,
  "summary": "resumo curto do movimento",
  "frames": [
    {
      "t": 0,
      "easing": "smooth",
      "bones": {
        "hips": { "r": [0,0,0], "p": [0,0,0] },
        "leftUpperArm": { "r": [0,0,-65] }
      }
    }
  ]
}

REGRAS DO JSON
- frames deve estar em ordem crescente e conter t=0 e t=duration.
- Cada frame contém apenas os ossos que mudam naquele instante; valores anteriores permanecem ativos.
- easing aceita apenas smooth, linear ou step.
- Use de 2 a 8 keyframes por segundo, conforme necessário, sem ultrapassar 480 frames.
- Inclua os dois braços em t=0 para evitar começar em T-pose, salvo quando o pedido exigir T-pose.
- Para loop, todos os estados do último frame devem fechar com o primeiro.
- Duração: ${durationRule}
- Loop: ${loopRule}
- Estilo pedido: ${style || 'natural'}.
- Intensidade: ${Math.max(0, Math.min(100, Number(intensity) || 55))}/100.
- O projeto usa ${Math.max(1, Number(fps) || 30)} fps; escolha tempos que possam ser encaixados nesses frames.

QUALIDADE
- Coordene braços, tronco, cabeça, quadril e pernas, mas não mova tudo com a mesma amplitude.
- Gestos pequenos devem continuar legíveis em avatar estilizado.
- Em caminhada/corrida, braços e pernas trabalham em fases opostas e hips possui oscilação leve.
- Em salto, inclua agachamento de preparação, decolagem, ápice, aterrissagem e recuperação.
- Em aceno, posicione a mão perto da cabeça e faça a oscilação principalmente no antebraço.
- Se o pedido for complexo, divida-o em fases dentro da mesma timeline.`;
}

const REFINE_PROMPT = `Revise criticamente a especificação anterior e devolva o JSON completo corrigido.
Verifique: anatomia, equilíbrio, joelhos, cotovelos, continuidade temporal, começo/fim, loop, duração, quantidade de keyframes e aderência ao pedido.
Não explique as correções e não use markdown. Não remova ações solicitadas pelo usuário.`;

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

  emit(payload) {
    this.onProgress?.(payload);
  }

  async loadSettings() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.settingsPath, 'utf8'));
      this.settings = { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  async writeSettings() {
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.writeFile(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf8');
  }

  decryptApiKey() {
    if (this.memoryApiKey) return this.memoryApiKey;
    const encrypted = this.settings.encryptedApiKey;
    if (!encrypted || !safeStorage.isEncryptionAvailable()) return '';
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch {
      return '';
    }
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

  async getSettings() {
    await this.ready;
    return this.publicSettings();
  }

  async saveSettings(input = {}) {
    await this.ready;
    this.settings.provider = String(input.provider || this.settings.provider || 'Personalizado').slice(0, 80);
    this.settings.endpoint = cleanEndpoint(input.endpoint || this.settings.endpoint);
    this.settings.model = String(input.model ?? this.settings.model ?? '').trim().slice(0, 200);
    this.settings.temperature = Math.max(0, Math.min(1.5, Number(input.temperature) || 0.45));

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
    const response = await fetch(modelsUrl(this.settings.endpoint), {
      method: 'GET',
      headers: this.requestHeaders(),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      throw new Error(`Falha ao testar o provedor (${response.status}): ${body || response.statusText}`);
    }
    const payload = await response.json().catch(() => ({}));
    const models = Array.isArray(payload?.data)
      ? payload.data.map((item) => String(item?.id || '')).filter(Boolean).slice(0, 200)
      : [];
    return { ok: true, models };
  }

  async callChat(messages, controller) {
    const model = String(this.settings.model || '').trim();
    if (!model) throw new Error('Selecione ou digite o nome do modelo de linguagem.');
    const response = await fetch(completionUrl(this.settings.endpoint), {
      method: 'POST',
      headers: this.requestHeaders(),
      body: JSON.stringify({
        model,
        messages,
        temperature: this.settings.temperature,
        max_tokens: 16000,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 1200);
      throw new Error(`O provedor recusou a geração (${response.status}): ${body || response.statusText}`);
    }
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('O provedor não retornou conteúdo no formato OpenAI-compatible.');
    }
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
    const userPrompt = `Crie este movimento: ${prompt}`;

    try {
      this.emit({ phase: 'draft', progress: 0.12, message: 'Planejando poses e ritmo…' });
      const draftText = await this.callChat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ], controller);
      const draft = validateDraft(extractJson(draftText));
      this.emit({ phase: 'draft-ready', progress: request.refine ? 0.58 : 0.92, message: 'Primeira animação estruturada.' });

      let result = draft;
      let refined = false;
      if (request.refine) {
        this.emit({ phase: 'refine', progress: 0.64, message: 'Revisando anatomia e continuidade…' });
        try {
          const refinedText = await this.callChat([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
            { role: 'assistant', content: JSON.stringify(draft) },
            { role: 'user', content: REFINE_PROMPT },
          ], controller);
          result = validateDraft(extractJson(refinedText));
          refined = true;
        } catch (error) {
          if (controller.signal.aborted) throw error;
          console.warn('A revisão automática falhou; usando o primeiro resultado.', error);
        }
      }
      this.emit({ phase: 'done', progress: 1, message: refined ? 'Movimento revisado e pronto.' : 'Movimento pronto.' });
      return { spec: result, refined };
    } finally {
      if (this.activeController === controller) this.activeController = null;
    }
  }

  cancel() {
    this.activeController?.abort();
    this.activeController = null;
  }
}

module.exports = { TextMotionService, extractJson, buildSystemPrompt };
