const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const ort = require('onnxruntime-node');

const MODEL_FILE = 'rtmw3d-x_8xb64_cocktail14-384x288-b0a0eab7_20240626.onnx';
const MODEL_URL = `https://huggingface.co/Soykaf/RTMW3D-x/resolve/main/onnx/${MODEL_FILE}`;
const INPUT_WIDTH = 288;
const INPUT_HEIGHT = 384;
const INPUT_PIXELS = INPUT_WIDTH * INPUT_HEIGHT;
const MIN_MODEL_BYTES = 10 * 1024 * 1024;
const Z_RANGE = 2.1744869;
const SIMCC_SPLIT_RATIO = 2;

function argmax(data, offset, length) {
  let bestIndex = 0;
  let bestValue = -Infinity;
  for (let index = 0; index < length; index += 1) {
    const value = data[offset + index];
    if (value > bestValue) {
      bestValue = value;
      bestIndex = index;
    }
  }
  return [bestIndex, bestValue];
}

function tensorData(value) {
  if (!value || !value.data || !ArrayBuffer.isView(value.data)) {
    throw new Error('Saída inválida recebida do RTMW3D.');
  }
  return value.data;
}

function tensorShape(value) {
  const dims = Array.isArray(value?.dims) ? value.dims.map(Number) : [];
  if (dims.length < 3) throw new Error('Formato de saída inesperado do RTMW3D.');
  return dims;
}

function findOutput(session, outputs, axis, fallbackIndex) {
  const exact = session.outputNames.find((name) => name.toLowerCase().includes(`simcc_${axis}`));
  const loose = session.outputNames.find((name) => new RegExp(`(^|[_-])${axis}($|[_-])`, 'i').test(name));
  const name = exact || loose || session.outputNames[fallbackIndex];
  const value = outputs[name];
  if (!value) throw new Error(`A saída ${axis.toUpperCase()} não foi encontrada no modelo RTMW3D.`);
  return value;
}

function decodeDepthIndex(zIndex) {
  // Implementação equivalente ao pós-processamento oficial do RTMPose3d:
  // 1) divide todas as coordenadas pelo simcc_split_ratio (2);
  // 2) normaliza Z pela metade da altura da entrada.
  const keypointZ = zIndex / SIMCC_SPLIT_RATIO;
  return (keypointZ / (INPUT_HEIGHT / 2) - 1) * Z_RANGE;
}

function decodeOutputs(session, outputs) {
  const simccX = findOutput(session, outputs, 'x', 0);
  const simccY = findOutput(session, outputs, 'y', 1);
  const simccZ = findOutput(session, outputs, 'z', 2);
  const shapeX = tensorShape(simccX);
  const shapeY = tensorShape(simccY);
  const shapeZ = tensorShape(simccZ);
  const keypointCount = shapeX[shapeX.length - 2];
  const binsX = shapeX[shapeX.length - 1];
  const binsY = shapeY[shapeY.length - 1];
  const binsZ = shapeZ[shapeZ.length - 1];
  if (keypointCount < 133) {
    throw new Error(`O modelo carregado retornou somente ${keypointCount} pontos; eram esperados 133.`);
  }

  const dataX = tensorData(simccX);
  const dataY = tensorData(simccY);
  const dataZ = tensorData(simccZ);
  const keypoints = [];
  for (let index = 0; index < keypointCount; index += 1) {
    const [xIndex, xScore] = argmax(dataX, index * binsX, binsX);
    const [yIndex, yScore] = argmax(dataY, index * binsY, binsY);
    const [zIndex] = argmax(dataZ, index * binsZ, binsZ);
    keypoints.push({
      x: xIndex / SIMCC_SPLIT_RATIO,
      y: yIndex / SIMCC_SPLIT_RATIO,
      z: decodeDepthIndex(zIndex),
      score: Math.min(xScore, yScore),
    });
  }
  return keypoints;
}

function buildInput(rgba) {
  const bytes = rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba);
  if (bytes.length !== INPUT_PIXELS * 4) {
    throw new Error(`Quadro RTMW3D inválido: ${bytes.length} bytes recebidos.`);
  }
  const data = new Float32Array(INPUT_PIXELS * 3);
  for (let index = 0; index < INPUT_PIXELS; index += 1) {
    const source = index * 4;
    const red = bytes[source];
    const green = bytes[source + 1];
    const blue = bytes[source + 2];
    data[index] = (blue - 123.675) / 58.395;
    data[INPUT_PIXELS + index] = (green - 116.28) / 57.12;
    data[INPUT_PIXELS * 2 + index] = (red - 103.53) / 57.375;
  }
  return new ort.Tensor('float32', data, [1, 3, INPUT_HEIGHT, INPUT_WIDTH]);
}

class Rtmw3dService {
  constructor({ app, onProgress }) {
    this.app = app;
    this.onProgress = onProgress;
    this.session = null;
    this.provider = null;
    this.preparing = null;
    this.modelPath = path.join(app.getPath('userData'), 'models', 'rtmw3d', MODEL_FILE);
  }

  async modelExists() {
    try {
      const stat = await fsp.stat(this.modelPath);
      return stat.isFile() && stat.size >= MIN_MODEL_BYTES;
    } catch {
      return false;
    }
  }

  async status() {
    const installed = await this.modelExists();
    return {
      installed,
      ready: Boolean(this.session),
      preparing: Boolean(this.preparing),
      provider: this.provider,
      modelPath: installed ? this.modelPath : null,
      inputSize: [INPUT_WIDTH, INPUT_HEIGHT],
      platform: process.platform,
      gpuAvailable: process.platform === 'win32',
    };
  }

  emit(payload) {
    this.onProgress?.(payload);
  }

  async downloadModel() {
    await fsp.mkdir(path.dirname(this.modelPath), { recursive: true });
    const temporary = `${this.modelPath}.download`;
    await fsp.rm(temporary, { force: true });
    this.emit({ phase: 'download', progress: 0, message: 'Baixando o RTMW3D-x…' });

    const response = await fetch(MODEL_URL, {
      redirect: 'follow',
      headers: { 'user-agent': 'VRM-Pose-Mode/1.0' },
    });
    if (!response.ok || !response.body) {
      throw new Error(`Falha ao baixar o RTMW3D (${response.status}).`);
    }
    const total = Number(response.headers.get('content-length')) || 0;
    let received = 0;
    const source = Readable.fromWeb(response.body);
    source.on('data', (chunk) => {
      received += chunk.length;
      this.emit({
        phase: 'download',
        progress: total > 0 ? Math.min(1, received / total) : 0,
        received,
        total,
        message: total > 0
          ? `Baixando RTMW3D-x · ${Math.round((received / total) * 100)}%`
          : 'Baixando RTMW3D-x…',
      });
    });
    try {
      await pipeline(source, fs.createWriteStream(temporary));
      const stat = await fsp.stat(temporary);
      if (stat.size < MIN_MODEL_BYTES) throw new Error('O arquivo RTMW3D baixado está incompleto.');
      await fsp.rename(temporary, this.modelPath);
    } catch (error) {
      await fsp.rm(temporary, { force: true });
      throw error;
    }
  }

  async createSession() {
    const common = {
      executionMode: 'sequential',
      graphOptimizationLevel: 'all',
      enableMemPattern: false,
      enableCpuMemArena: false,
      logSeverityLevel: 3,
    };
    if (process.platform === 'win32') {
      try {
        this.emit({ phase: 'load', progress: 0.92, message: 'Inicializando RTMW3D na GPU por DirectML…' });
        this.session = await ort.InferenceSession.create(this.modelPath, {
          ...common,
          executionProviders: [{ name: 'dml', deviceId: 0 }, 'cpu'],
        });
        this.provider = 'DirectML';
        return;
      } catch (error) {
        console.warn('RTMW3D DirectML indisponível; tentando CPU.', error);
      }
    }
    this.emit({ phase: 'load', progress: 0.94, message: 'Inicializando RTMW3D na CPU…' });
    this.session = await ort.InferenceSession.create(this.modelPath, {
      ...common,
      executionProviders: ['cpu'],
    });
    this.provider = 'CPU';
  }

  async prepare() {
    if (this.session) return this.status();
    if (this.preparing) return this.preparing;
    this.preparing = (async () => {
      if (!(await this.modelExists())) await this.downloadModel();
      await this.createSession();
      this.emit({ phase: 'ready', progress: 1, message: `RTMW3D pronto · ${this.provider}` });
      return this.status();
    })();
    try {
      return await this.preparing;
    } finally {
      this.preparing = null;
    }
  }

  async infer(request) {
    await this.prepare();
    if (!this.session) throw new Error('A sessão RTMW3D não foi inicializada.');
    const started = performance.now();
    const input = buildInput(request?.rgba);
    const inputName = this.session.inputNames[0];
    const outputs = await this.session.run({ [inputName]: input });
    const keypoints = decodeOutputs(this.session, outputs);
    return {
      keypoints,
      provider: this.provider,
      elapsedMs: performance.now() - started,
      inputSize: [INPUT_WIDTH, INPUT_HEIGHT],
    };
  }

  async dispose() {
    if (this.session) await this.session.release();
    this.session = null;
    this.provider = null;
  }
}

module.exports = {
  Rtmw3dService,
  MODEL_URL,
  MODEL_FILE,
  INPUT_WIDTH,
  INPUT_HEIGHT,
  decodeDepthIndex,
};
