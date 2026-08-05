const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { unzipSync } = require('fflate');

const XAT_DOWNLOAD_URL = 'https://github.com/Etheirys/XAT/releases/latest/download/XAT.zip';
const MAX_TOOL_DOWNLOAD_BYTES = 750 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 180_000;

function readAscii(bytes, start, length) {
  return Buffer.from(bytes.subarray(start, start + length))
    .toString('ascii')
    .replace(/\0.*$/s, '')
    .trim();
}

function ensureRange(bytes, offset, length, label) {
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw new Error(`${label} está fora dos limites do arquivo.`);
  }
}

function parsePap(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 26 || readAscii(bytes, 0, 4) !== 'pap') {
    throw new Error('Arquivo PAP inválido: cabeçalho “pap ” não encontrado.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getInt32(4, true);
  const animationCount = view.getInt16(8, true);
  const skeletonId = view.getInt32(10, true);
  const infoOffset = view.getInt32(14, true);
  const havokOffset = view.getInt32(18, true);
  const timelineOffset = view.getInt32(22, true);

  if (animationCount <= 0 || animationCount > 4096) {
    throw new Error(`Arquivo PAP inválido: quantidade de animações ${animationCount}.`);
  }
  ensureRange(bytes, infoOffset, animationCount * 40, 'Tabela de animações PAP');
  if (havokOffset < 0 || timelineOffset <= havokOffset || timelineOffset > bytes.byteLength) {
    throw new Error('Arquivo PAP inválido: offsets Havok/timeline inconsistentes.');
  }

  const animations = [];
  for (let index = 0; index < animationCount; index += 1) {
    const offset = infoOffset + index * 40;
    animations.push({
      index,
      name: readAscii(bytes, offset, 32) || `Animação ${index + 1}`,
      havokIndex: view.getInt16(offset + 34, true),
    });
  }

  return {
    version,
    skeletonId,
    animations,
    havokData: bytes.slice(havokOffset, timelineOffset),
  };
}

function parseSklb(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 32 || readAscii(bytes, 0, 4) !== 'blks') {
    throw new Error('Arquivo SKLB inválido: cabeçalho “blks” não encontrado.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header1 = view.getInt16(4, true);
  const header2 = view.getInt16(6, true);
  const oldHeader = header2 === 0x3132;
  const unknownOffset = oldHeader ? view.getUint16(8, true) : view.getUint32(8, true);
  const havokOffset = oldHeader ? view.getUint16(10, true) : view.getUint32(12, true);
  const skeletonOffset = oldHeader ? 12 : 20;
  ensureRange(bytes, skeletonOffset, 4, 'Identificador do esqueleto SKLB');
  const skeletonId = view.getInt32(skeletonOffset, true);
  if (havokOffset <= 0 || havokOffset >= bytes.byteLength) {
    throw new Error('Arquivo SKLB inválido: offset Havok inconsistente.');
  }
  if (unknownOffset > havokOffset) {
    throw new Error('Arquivo SKLB inválido: offsets internos inconsistentes.');
  }
  return {
    header1,
    header2,
    oldHeader,
    skeletonId,
    havokData: bytes.slice(havokOffset),
  };
}

function safeArchivePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some((part) => part === '..')) return null;
  return normalized;
}

async function findFileRecursive(root, targetName) {
  const stack = [root];
  const wanted = targetName.toLowerCase();
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.name.toLowerCase() === wanted) return fullPath;
    }
  }
  return null;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function toBuffer(value, label) {
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (Buffer.isBuffer(value)) return value;
  throw new Error(`${label} não foi recebido como dados binários.`);
}

class PapConverterService {
  constructor({ app, onProgress }) {
    this.app = app;
    this.onProgress = onProgress;
    this.toolRoot = path.join(app.getPath('userData'), 'tools', 'xat');
    this.downloadPath = path.join(this.toolRoot, 'XAT.download.zip');
    this.installRoot = path.join(this.toolRoot, 'runtime');
    this.executablePath = null;
    this.preparing = null;
  }

  emit(payload) {
    this.onProgress?.(payload);
  }

  async locateExecutable() {
    if (this.executablePath && await pathExists(this.executablePath)) return this.executablePath;
    const found = await findFileRecursive(this.installRoot, 'XATHavokInterop.exe');
    this.executablePath = found;
    return found;
  }

  async status() {
    const executable = await this.locateExecutable();
    return {
      platform: process.platform,
      supported: process.platform === 'win32',
      installed: Boolean(executable),
      preparing: Boolean(this.preparing),
      executablePath: executable,
      downloadUrl: XAT_DOWNLOAD_URL,
    };
  }

  async downloadTool() {
    await fs.mkdir(this.toolRoot, { recursive: true });
    this.emit({ phase: 'download', progress: 0, message: 'Baixando o conversor XAT oficial…' });
    const response = await fetch(XAT_DOWNLOAD_URL, {
      redirect: 'follow',
      headers: { 'user-agent': 'VRM-Pose-Mode/1.0' },
    });
    if (!response.ok || !response.body) {
      throw new Error(`Não foi possível baixar o XAT (${response.status} ${response.statusText}).`);
    }
    const total = Number(response.headers.get('content-length')) || 0;
    if (total > MAX_TOOL_DOWNLOAD_BYTES) throw new Error('O pacote XAT excede o limite de segurança do aplicativo.');
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_TOOL_DOWNLOAD_BYTES) throw new Error('O download do XAT excedeu o limite de segurança.');
      chunks.push(value);
      this.emit({
        phase: 'download',
        progress: total ? Math.min(0.78, (received / total) * 0.78) : 0.25,
        message: total
          ? `Baixando XAT… ${Math.round((received / total) * 100)}%`
          : `Baixando XAT… ${Math.round(received / 1024 / 1024)} MB`,
        received,
        total,
      });
    }
    const archive = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    await fs.writeFile(this.downloadPath, archive);
    return archive;
  }

  async extractTool(archive) {
    this.emit({ phase: 'extract', progress: 0.8, message: 'Extraindo o runtime PAP/Havok…' });
    let entries;
    try {
      entries = unzipSync(new Uint8Array(archive));
    } catch (error) {
      throw new Error(`O pacote XAT baixado não pôde ser extraído: ${error instanceof Error ? error.message : error}`);
    }
    const staging = `${this.installRoot}.staging-${Date.now()}`;
    await fs.rm(staging, { recursive: true, force: true });
    await fs.mkdir(staging, { recursive: true });
    const pairs = Object.entries(entries);
    for (let index = 0; index < pairs.length; index += 1) {
      const [archivePath, bytes] = pairs[index];
      const safePath = safeArchivePath(archivePath);
      if (!safePath || archivePath.endsWith('/')) continue;
      const target = path.join(staging, ...safePath.split('/'));
      const relative = path.relative(staging, target);
      if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, Buffer.from(bytes));
      if (index % 25 === 0) {
        this.emit({
          phase: 'extract',
          progress: 0.8 + (index / Math.max(1, pairs.length)) * 0.18,
          message: `Extraindo XAT… ${index + 1}/${pairs.length}`,
        });
      }
    }
    const executable = await findFileRecursive(staging, 'XATHavokInterop.exe');
    if (!executable) {
      await fs.rm(staging, { recursive: true, force: true });
      throw new Error('O pacote oficial do XAT não contém XATHavokInterop.exe.');
    }
    await fs.rm(this.installRoot, { recursive: true, force: true });
    await fs.rename(staging, this.installRoot);
    await fs.rm(this.downloadPath, { force: true });
    this.executablePath = await findFileRecursive(this.installRoot, 'XATHavokInterop.exe');
    this.emit({ phase: 'ready', progress: 1, message: 'Conversor PAP/Havok pronto.' });
    return this.executablePath;
  }

  async prepare() {
    if (process.platform !== 'win32') {
      throw new Error('A conversão PAP/Havok pelo XAT está disponível apenas no Windows.');
    }
    const existing = await this.locateExecutable();
    if (existing) return this.status();
    if (this.preparing) return this.preparing;
    this.preparing = (async () => {
      const archive = await this.downloadTool();
      await this.extractTool(archive);
      return this.status();
    })().finally(() => {
      this.preparing = null;
    });
    return this.preparing;
  }

  runInterop(args, workingDirectory) {
    return new Promise(async (resolve, reject) => {
      const executable = await this.locateExecutable();
      if (!executable) {
        reject(new Error('O runtime XATHavokInterop.exe não está preparado.'));
        return;
      }
      const processHandle = spawn(executable, args, {
        cwd: path.dirname(executable),
        windowsHide: true,
        shell: false,
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        processHandle.kill();
        reject(new Error(`O XAT não respondeu ao comando ${args[0]} dentro do limite de tempo.`));
      }, COMMAND_TIMEOUT_MS);
      processHandle.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      processHandle.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      processHandle.on('error', (error) => {
        clearTimeout(timeout);
        const hint = /ENOENT|not found|dll/i.test(error.message)
          ? ' Verifique o Visual C++ Redistributable 2012 x86 exigido pelo XAT.'
          : '';
        reject(new Error(`Falha ao iniciar o XAT: ${error.message}.${hint}`));
      });
      processHandle.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`O XAT falhou no comando ${args[0]} (código ${code}). ${stdout || stderr || 'Sem detalhes.'}`));
          return;
        }
        resolve({ stdout, stderr, workingDirectory });
      });
    });
  }

  async convert(request = {}) {
    if (process.platform !== 'win32') throw new Error('A conversão de PAP está disponível apenas no Windows.');
    await this.prepare();
    const papBuffer = toBuffer(request.pap, 'PAP');
    const sklbBuffer = toBuffer(request.sklb, 'SKLB');
    const pap = parsePap(papBuffer);
    const sklb = parseSklb(sklbBuffer);
    const animationIndex = Math.max(0, Math.min(pap.animations.length - 1, Number(request.animationIndex) || 0));
    const animation = pap.animations[animationIndex];
    if (!animation) throw new Error('A animação escolhida não existe dentro do PAP.');

    const expectedCode = String(request.expectedSkeletonCode || '').toLowerCase();
    const sklbName = String(request.sklbFileName || '').toLowerCase();
    if (expectedCode && !sklbName.includes(expectedCode)) {
      throw new Error(`Este PAP foi criado para ${expectedCode}, mas o SKLB selecionado é ${request.sklbFileName || 'desconhecido'}. Selecione skl_${expectedCode}b0001.sklb.`);
    }

    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vrmpose-pap-'));
    const skeletonHavok = path.join(tempRoot, 'skeleton.hkx');
    const animationHavok = path.join(tempRoot, 'animation.hkx');
    const container = path.join(tempRoot, 'combined.hkx');
    const outputFbx = path.join(tempRoot, 'animation.fbx');
    const logs = [];
    try {
      await fs.writeFile(skeletonHavok, Buffer.from(sklb.havokData));
      await fs.writeFile(animationHavok, Buffer.from(pap.havokData));
      this.emit({ phase: 'convert', progress: 0.08, message: 'Criando contêiner Havok temporário…' });
      logs.push(await this.runInterop(['createContainer', container], tempRoot));
      this.emit({ phase: 'convert', progress: 0.26, message: 'Vinculando o esqueleto SKLB…' });
      logs.push(await this.runInterop(['addSkeleton', container, skeletonHavok, '0', container], tempRoot));
      this.emit({ phase: 'convert', progress: 0.48, message: `Extraindo “${animation.name}” do PAP…` });
      logs.push(await this.runInterop(['addAnimation', container, animationHavok, String(animation.havokIndex), container], tempRoot));
      this.emit({ phase: 'convert', progress: 0.72, message: 'Convertendo Havok para FBX…' });
      logs.push(await this.runInterop(['toFbxAnimation', container, '0', '0', outputFbx], tempRoot));
      const fbx = await fs.readFile(outputFbx);
      if (fbx.byteLength < 128) throw new Error('O XAT produziu um FBX vazio ou inválido.');
      this.emit({ phase: 'done', progress: 1, message: 'PAP convertido para FBX e pronto para retargeting VRM.' });
      return {
        fbx: new Uint8Array(fbx.buffer, fbx.byteOffset, fbx.byteLength),
        fileName: `${animation.name.replace(/[^a-z0-9._-]+/gi, '_') || 'pap-animation'}.fbx`,
        animationName: animation.name,
        animationIndex,
        animationCount: pap.animations.length,
        papSkeletonId: pap.skeletonId,
        sklbSkeletonId: sklb.skeletonId,
        warning: pap.skeletonId !== sklb.skeletonId
          ? 'Os identificadores internos PAP e SKLB são diferentes; confira visualmente o retargeting.'
          : null,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/0xc0000135|dll|redistributable|side-by-side/i.test(detail)) {
        throw new Error(`${detail} Instale o Microsoft Visual C++ Redistributable 2012 x86, exigido pelo XAT.`);
      }
      throw error;
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }
}

module.exports = {
  PapConverterService,
  parsePap,
  parseSklb,
  XAT_DOWNLOAD_URL,
};
