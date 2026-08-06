const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const AdmZip = require('adm-zip');

const isDev = !app.isPackaged;
const sessions = new Map();
const temporaryRoots = new Set();
let mainWindow = null;

const CATEGORY_BY_EXTENSION = {
  '.fbx': 'model', '.glb': 'model', '.gltf': 'model', '.obj': 'model', '.dae': 'model',
  '.blend': 'model', '.pmx': 'model', '.pmd': 'model', '.vrm': 'model',
  '.anim': 'animation', '.bvh': 'animation', '.vmd': 'animation', '.vrma': 'animation',
  '.controller': 'animation-controller', '.overridecontroller': 'animation-controller',
  '.png': 'texture', '.jpg': 'texture', '.jpeg': 'texture', '.tga': 'texture', '.bmp': 'texture',
  '.psd': 'texture', '.dds': 'texture', '.exr': 'texture', '.hdr': 'texture', '.ktx': 'texture',
  '.ktx2': 'texture', '.webp': 'texture',
  '.mat': 'material', '.shader': 'shader', '.shadergraph': 'shader', '.cginc': 'shader',
  '.prefab': 'prefab', '.unity': 'scene', '.asset': 'unity-asset', '.meta': 'metadata',
  '.wav': 'audio', '.ogg': 'audio', '.mp3': 'audio', '.flac': 'audio', '.m4a': 'audio',
  '.cs': 'script', '.dll': 'binary', '.json': 'data', '.txt': 'document', '.md': 'document',
  '.unitypackage': 'package', '.zip': 'package',
};

const MODEL_EXTENSIONS = new Set(['.fbx', '.glb', '.gltf', '.obj', '.dae', '.blend', '.pmx', '.pmd', '.vrm', '.prefab']);
const ANIMATION_EXTENSIONS = new Set(['.anim', '.bvh', '.vmd', '.vrma', '.fbx']);
const TEXT_REFERENCE_EXTENSIONS = new Set(['.prefab', '.mat', '.anim', '.controller', '.overridecontroller', '.asset', '.unity', '.meta', '.gltf', '.json', '.shader', '.cs']);
const MODEL_WORDS = /(^|[\s_.\-\/])(model|character|avatar|body|mesh|base|girl|boy|human|humanoid|chara|キャラ|素体)([\s_.\-\/]|$)/i;
const ANIMATION_WORDS = /(^|[\s_.\-\/])(anim|animation|motion|idle|walk|run|talk|dance|pose|jump|sit|sleep|wave|loop|表情|待機|歩|走)([\s_.\-\/]|$)/i;
const SHADER_WORDS = /(liltoon|poiyomi|arktoon|uts2|unitychan|toon|mtoon|shader)/i;
const MAX_FILES = 60000;
const MAX_UNCOMPRESSED_BYTES = 25 * 1024 * 1024 * 1024;
const MAX_TEXT_READ = 8 * 1024 * 1024;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 930,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#090b12',
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'win32' ? {
      color: '#090b12',
      symbolColor: '#cdd3e8',
      height: 38,
    } : false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

function isBuiltinUnityGuid(guid) {
  return /^0{16}[a-f0-9]{16}$/i.test(guid) || /^0+$/.test(guid);
}

function normalizeRelative(value) {
  return value.split(path.sep).join('/').replace(/^\.\//, '');
}

function safeName(value) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim() || 'package';
}

async function pathExists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

async function extractZipSecure(zipPath) {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'auto-vrm-'));
  temporaryRoots.add(tempRoot);
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  let total = 0;

  if (entries.length > MAX_FILES) {
    throw new Error(`O ZIP contém ${entries.length} entradas. O limite de segurança é ${MAX_FILES}.`);
  }

  for (const entry of entries) {
    total += Number(entry.header.size || 0);
    if (total > MAX_UNCOMPRESSED_BYTES) {
      throw new Error('O ZIP ultrapassa o limite de 25 GB descompactados.');
    }

    const normalized = entry.entryName.replace(/\\/g, '/').replace(/^\/+/, '');
    const destination = path.resolve(tempRoot, normalized);
    if (destination !== tempRoot && !destination.startsWith(`${tempRoot}${path.sep}`)) {
      throw new Error(`Entrada insegura no ZIP: ${entry.entryName}`);
    }

    if (entry.isDirectory) {
      await fsp.mkdir(destination, { recursive: true });
      continue;
    }

    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.writeFile(destination, entry.getData());
  }

  return tempRoot;
}

async function walkFiles(root) {
  const files = [];
  const queue = [root];

  while (queue.length) {
    const current = queue.pop();
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        queue.push(absolutePath);
      } else if (entry.isFile()) {
        const stat = await fsp.stat(absolutePath);
        files.push({
          absolutePath,
          relativePath: normalizeRelative(path.relative(root, absolutePath)),
          name: entry.name,
          size: stat.size,
        });
        if (files.length > MAX_FILES) {
          throw new Error(`A pasta contém mais de ${MAX_FILES} arquivos.`);
        }
      }
    }
  }

  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function readTextSnippet(filePath, limit = MAX_TEXT_READ) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const size = Math.min(stat.size, limit);
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, 0);
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

async function inspectGltf(filePath, extension) {
  try {
    let json;
    if (extension === '.gltf') {
      json = JSON.parse(await readTextSnippet(filePath, 16 * 1024 * 1024));
    } else {
      const handle = await fsp.open(filePath, 'r');
      try {
        const header = Buffer.alloc(20);
        await handle.read(header, 0, 20, 0);
        if (header.toString('ascii', 0, 4) !== 'glTF') return null;
        const chunkLength = header.readUInt32LE(12);
        const chunkType = header.readUInt32LE(16);
        if (chunkType !== 0x4e4f534a || chunkLength > 32 * 1024 * 1024) return null;
        const chunk = Buffer.alloc(chunkLength);
        await handle.read(chunk, 0, chunkLength, 20);
        json = JSON.parse(chunk.toString('utf8').replace(/\u0000+$/g, '').trim());
      } finally {
        await handle.close();
      }
    }

    const extensionsUsed = Array.isArray(json.extensionsUsed) ? json.extensionsUsed : [];
    return {
      meshes: json.meshes?.length ?? 0,
      skins: json.skins?.length ?? 0,
      animations: json.animations?.length ?? 0,
      nodes: json.nodes?.length ?? 0,
      materials: json.materials?.length ?? 0,
      textures: json.textures?.length ?? 0,
      isVrm: extensionsUsed.some((name) => String(name).startsWith('VRMC_vrm')),
      isVrma: extensionsUsed.includes('VRMC_vrm_animation'),
    };
  } catch {
    return null;
  }
}

async function inspectFbx(filePath) {
  try {
    const handle = await fsp.open(filePath, 'r');
    try {
      const stat = await handle.stat();
      const size = Math.min(stat.size, 6 * 1024 * 1024);
      const buffer = Buffer.alloc(size);
      await handle.read(buffer, 0, size, 0);
      const binary = buffer.subarray(0, 23).toString('binary').includes('Kaydara FBX Binary');
      const text = binary ? buffer.toString('latin1') : buffer.toString('utf8');
      return {
        binary,
        hasGeometry: /Geometry|Mesh/i.test(text),
        hasSkin: /Deformer|Skin|Cluster/i.test(text),
        hasSkeleton: /LimbNode|Skeleton|Root/i.test(text),
        hasAnimation: /AnimationStack|AnimationLayer|AnimCurve/i.test(text),
      };
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

function scoreModel(file, details, text) {
  const ext = file.extension;
  let score = 0;
  const reasons = [];

  if (MODEL_EXTENSIONS.has(ext)) {
    score += ext === '.prefab' ? 28 : 42;
    reasons.push(`formato ${ext.slice(1).toUpperCase()} compatível`);
  }
  if (MODEL_WORDS.test(file.relativePath)) {
    score += 14;
    reasons.push('nome sugere modelo/personagem');
  }
  if (file.size > 256 * 1024) {
    score += 6;
    reasons.push('arquivo possui volume de malha provável');
  }
  if (details?.meshes > 0) {
    score += 22;
    reasons.push(`${details.meshes} malha(s) detectada(s)`);
  }
  if (details?.skins > 0) {
    score += 18;
    reasons.push(`${details.skins} skin/esqueleto detectado`);
  }
  if (details?.hasGeometry) {
    score += 18;
    reasons.push('geometria FBX detectada');
  }
  if (details?.hasSkin || details?.hasSkeleton) {
    score += 18;
    reasons.push('rig/esqueleto FBX detectado');
  }
  if (ext === '.prefab' && /SkinnedMeshRenderer|m_Avatar|Animator:/i.test(text || '')) {
    score += 28;
    reasons.push('prefab contém malha skinned ou Animator');
  }
  if (ANIMATION_WORDS.test(file.relativePath) && !MODEL_WORDS.test(file.relativePath)) score -= 12;
  if (ext === '.vrm') {
    score += 40;
    reasons.push('já é um modelo VRM');
  }

  return { score: Math.max(0, score), reasons };
}

function scoreAnimation(file, details, text) {
  const ext = file.extension;
  let score = 0;
  const reasons = [];

  if (ANIMATION_EXTENSIONS.has(ext)) {
    score += ext === '.fbx' ? 18 : 48;
    reasons.push(`formato ${ext.slice(1).toUpperCase()} pode conter animação`);
  }
  if (ANIMATION_WORDS.test(file.relativePath)) {
    score += 20;
    reasons.push('nome sugere movimento/animação');
  }
  if (details?.animations > 0) {
    score += 32;
    reasons.push(`${details.animations} animação(ões) glTF detectada(s)`);
  }
  if (details?.hasAnimation) {
    score += 30;
    reasons.push('AnimationStack FBX detectado');
  }
  if (ext === '.anim' && /AnimationClip|m_ClipBindingConstant|m_EditorCurves/i.test(text || '')) {
    score += 20;
    reasons.push('AnimationClip Unity confirmado');
  }
  if (ext === '.vrma' || details?.isVrma) {
    score += 40;
    reasons.push('já é uma animação VRMA');
  }
  if (ext === '.fbx' && details && !details.hasAnimation) score -= 12;

  return { score: Math.max(0, score), reasons };
}

async function analyzeRoot(root, sourcePath, sourceKind) {
  const rawFiles = await walkFiles(root);
  const guidMap = new Map();
  const textCache = new Map();

  for (const file of rawFiles) {
    if (path.extname(file.name).toLowerCase() !== '.meta') continue;
    try {
      const text = await readTextSnippet(file.absolutePath, 256 * 1024);
      textCache.set(file.absolutePath, text);
      const guid = text.match(/^guid:\s*([a-f0-9]{16,64})/mi)?.[1];
      if (guid) {
        const assetRelative = file.relativePath.replace(/\.meta$/i, '');
        guidMap.set(guid, assetRelative);
      }
    } catch {
      // A broken .meta is reported later as an unresolved dependency.
    }
  }

  const files = [];
  const dependencies = [];
  const unresolvedGuidSet = new Set();

  for (const raw of rawFiles) {
    const extension = path.extname(raw.name).toLowerCase();
    let category = CATEGORY_BY_EXTENSION[extension] || 'other';
    let text = textCache.get(raw.absolutePath) || '';
    let details = null;

    if (TEXT_REFERENCE_EXTENSIONS.has(extension) && !text && raw.size <= MAX_TEXT_READ) {
      try {
        text = await readTextSnippet(raw.absolutePath);
        textCache.set(raw.absolutePath, text);
      } catch {
        text = '';
      }
    }

    if (extension === '.gltf' || extension === '.glb' || extension === '.vrm' || extension === '.vrma') {
      details = await inspectGltf(raw.absolutePath, extension === '.vrm' || extension === '.vrma' ? '.glb' : extension);
      if (details?.isVrma) category = 'animation';
      if (details?.isVrm) category = 'model';
    } else if (extension === '.fbx') {
      details = await inspectFbx(raw.absolutePath);
    }

    const file = {
      ...raw,
      extension,
      category,
      details,
      guid: null,
      referencedGuids: [],
      resolvedDependencies: [],
      unresolvedGuids: [],
      modelScore: 0,
      modelReasons: [],
      animationScore: 0,
      animationReasons: [],
    };

    if (extension === '.meta') {
      file.guid = text.match(/^guid:\s*([a-f0-9]{16,64})/mi)?.[1] || null;
    }

    if (text) {
      const matches = [...text.matchAll(/guid:\s*([a-f0-9]{16,64})/gi)].map((match) => match[1]);
      file.referencedGuids = [...new Set(matches.filter((guid) => guid !== file.guid && !isBuiltinUnityGuid(guid)))];
      for (const guid of file.referencedGuids) {
        const target = guidMap.get(guid);
        if (target) {
          file.resolvedDependencies.push(target);
          dependencies.push({ from: file.relativePath, to: target, guid });
        } else {
          file.unresolvedGuids.push(guid);
          unresolvedGuidSet.add(guid);
        }
      }
    }

    const model = scoreModel(file, details, text);
    const animation = scoreAnimation(file, details, text);
    file.modelScore = model.score;
    file.modelReasons = model.reasons;
    file.animationScore = animation.score;
    file.animationReasons = animation.reasons;
    files.push(file);
  }

  const counts = {};
  for (const file of files) counts[file.category] = (counts[file.category] || 0) + 1;

  const modelCandidates = files
    .filter((file) => file.modelScore >= 24)
    .sort((a, b) => b.modelScore - a.modelScore || b.size - a.size)
    .slice(0, 30)
    .map(({ absolutePath, ...file }) => file);

  const animationCandidates = files
    .filter((file) => file.animationScore >= 24)
    .sort((a, b) => b.animationScore - a.animationScore || a.relativePath.localeCompare(b.relativePath))
    .slice(0, 300)
    .map(({ absolutePath, ...file }) => file);

  const shaderFiles = files.filter((file) => file.category === 'shader' || SHADER_WORDS.test(file.relativePath));
  const warnings = [];
  if (!modelCandidates.length) warnings.push('Nenhum modelo 3D confiável foi identificado.');
  if (!animationCandidates.length) warnings.push('Nenhuma animação separada foi identificada.');
  if (unresolvedGuidSet.size) warnings.push(`${unresolvedGuidSet.size} referência(s) GUID não foram encontradas no pacote.`);
  if (shaderFiles.length) warnings.push(`${shaderFiles.length} shader(es) personalizado(s) podem precisar de conversão para MToon/PBR.`);
  if ((counts.texture || 0) === 0) warnings.push('Nenhuma textura foi encontrada.');

  const analysisId = crypto.randomUUID();
  const result = {
    analysisId,
    sourcePath,
    sourceName: path.basename(sourcePath),
    sourceKind,
    analyzedAt: new Date().toISOString(),
    totalFiles: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    counts,
    modelCandidates,
    animationCandidates,
    unresolvedGuids: [...unresolvedGuidSet],
    dependencyCount: dependencies.length,
    shaderFiles: shaderFiles.slice(0, 100).map((file) => file.relativePath),
    warnings,
    files: files.map(({ absolutePath, ...file }) => file),
  };

  sessions.set(analysisId, { root, sourcePath, sourceKind, result, dependencies });
  return result;
}

async function analyzeInput(inputPath) {
  const stat = await fsp.stat(inputPath);
  if (stat.isDirectory()) return analyzeRoot(inputPath, inputPath, 'folder');
  if (!stat.isFile()) throw new Error('O caminho selecionado não é um arquivo nem uma pasta.');

  const extension = path.extname(inputPath).toLowerCase();
  if (extension === '.zip') {
    const root = await extractZipSecure(inputPath);
    return analyzeRoot(root, inputPath, 'zip');
  }

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'auto-vrm-single-'));
  temporaryRoots.add(root);
  await fsp.copyFile(inputPath, path.join(root, path.basename(inputPath)));
  const metaPath = `${inputPath}.meta`;
  if (await pathExists(metaPath)) await fsp.copyFile(metaPath, path.join(root, `${path.basename(inputPath)}.meta`));
  return analyzeRoot(root, inputPath, 'file');
}

function publicReport(session) {
  return {
    ...session.result,
    dependencies: session.dependencies,
    generatedBy: 'Auto VRM Converter 0.1.0',
  };
}

async function copyTree(source, destination) {
  await fsp.cp(source, destination, {
    recursive: true,
    force: true,
    preserveTimestamps: true,
    filter: (sourcePath) => {
      const parts = sourcePath.split(path.sep);
      return !parts.some((part) => ['Library', 'Temp', 'Obj', 'obj', 'node_modules', '.git'].includes(part));
    },
  });
}

function bundledUnityWorkerPath() {
  return path.join(__dirname, '..', 'unity', 'Editor', 'AutoVrmBatchRunner.cs');
}

async function prepareWorkspace(analysisId, options = {}) {
  const session = sessions.get(analysisId);
  if (!session) throw new Error('A análise expirou. Analise o pacote novamente.');

  const picked = await dialog.showOpenDialog(mainWindow, {
    title: 'Escolha onde criar o workspace de conversão',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (picked.canceled || !picked.filePaths[0]) return null;

  const modelCandidate = options.modelPath || session.result.modelCandidates[0]?.relativePath || '';
  const selectedAnimations = Array.isArray(options.animationPaths) && options.animationPaths.length
    ? options.animationPaths
    : session.result.animationCandidates.map((file) => file.relativePath);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const workspaceName = `AutoVRM-${safeName(path.parse(session.result.sourceName).name)}-${timestamp}`;
  const workspacePath = path.join(picked.filePaths[0], workspaceName);
  const unityProjectPath = path.join(workspacePath, 'UnityProject');
  const assetsInputPath = path.join(unityProjectPath, 'Assets', 'AutoVrmInput');
  const editorPath = path.join(unityProjectPath, 'Assets', 'Editor');
  const conversionPath = path.join(workspacePath, 'Conversion');
  const outputPath = path.join(workspacePath, 'Output');

  await fsp.mkdir(assetsInputPath, { recursive: true });
  await fsp.mkdir(editorPath, { recursive: true });
  await fsp.mkdir(conversionPath, { recursive: true });
  await fsp.mkdir(outputPath, { recursive: true });
  await copyTree(session.root, assetsInputPath);
  await fsp.copyFile(bundledUnityWorkerPath(), path.join(editorPath, 'AutoVrmBatchRunner.cs'));

  const job = {
    version: 1,
    packageName: path.parse(session.result.sourceName).name,
    author: options.author || 'Auto VRM Converter',
    modelPath: modelCandidate,
    animationPaths: selectedAnimations,
    outputDirectory: outputPath,
    reportPath: path.join(conversionPath, 'unity-result.json'),
    sourceAssetRoot: 'Assets/AutoVrmInput',
  };

  const jobPath = path.join(conversionPath, 'job.json');
  const logPath = path.join(conversionPath, 'unity.log');
  await fsp.writeFile(jobPath, JSON.stringify(job, null, 2), 'utf8');
  await fsp.writeFile(path.join(conversionPath, 'analysis.json'), JSON.stringify(publicReport(session), null, 2), 'utf8');

  await fsp.mkdir(path.join(unityProjectPath, 'Packages'), { recursive: true });
  await fsp.mkdir(path.join(unityProjectPath, 'ProjectSettings'), { recursive: true });
  await fsp.writeFile(path.join(unityProjectPath, 'Packages', 'manifest.json'), JSON.stringify({
    dependencies: {
      'com.vrmc.gltf': 'https://github.com/vrm-c/UniVRM.git?path=/Packages/UniGLTF#v0.131.0',
      'com.vrmc.vrm': 'https://github.com/vrm-c/UniVRM.git?path=/Packages/VRM10#v0.131.0',
      'com.unity.modules.animation': '1.0.0',
      'com.unity.modules.assetbundle': '1.0.0',
      'com.unity.modules.audio': '1.0.0',
      'com.unity.modules.imageconversion': '1.0.0',
      'com.unity.modules.jsonserialize': '1.0.0',
      'com.unity.modules.physics': '1.0.0',
      'com.unity.modules.ui': '1.0.0'
    }
  }, null, 2), 'utf8');
  await fsp.writeFile(path.join(unityProjectPath, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.62f1\nm_EditorVersionWithRevision: 2022.3.62f1 (000000000000)\n', 'utf8');
  await fsp.writeFile(path.join(workspacePath, 'README.txt'), [
    'Auto VRM Converter workspace',
    '',
    '1. O aplicativo gerou este projeto Unity temporário.',
    '2. O projeto instala UniVRM 0.131.0 por UPM na primeira execução.',
    '3. Output/ recebe o .vrm e os .vrma que forem exportados com sucesso.',
    '4. Conversion/unity.log e Conversion/unity-result.json registram falhas reais.',
    '',
    'Não apague a pasta até revisar os arquivos de saída.',
  ].join('\r\n'), 'utf8');

  return { workspacePath, unityProjectPath, jobPath, logPath, outputPath, modelCandidate, animationCount: selectedAnimations.length };
}

async function findUnityInstallations() {
  const candidates = [];
  if (process.platform === 'win32') {
    const roots = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      'C:\\Program Files',
      'C:\\Program Files (x86)',
    ].filter(Boolean);

    for (const root of [...new Set(roots)]) {
      const editorRoot = path.join(root, 'Unity', 'Hub', 'Editor');
      if (!(await pathExists(editorRoot))) continue;
      let versions = [];
      try { versions = await fsp.readdir(editorRoot); } catch { continue; }
      for (const version of versions) {
        const executable = path.join(editorRoot, version, 'Editor', 'Unity.exe');
        if (await pathExists(executable)) candidates.push({ version, path: executable });
      }
    }
  } else if (process.platform === 'darwin') {
    const hubRoot = '/Applications/Unity/Hub/Editor';
    if (await pathExists(hubRoot)) {
      for (const version of await fsp.readdir(hubRoot)) {
        const executable = path.join(hubRoot, version, 'Unity.app', 'Contents', 'MacOS', 'Unity');
        if (await pathExists(executable)) candidates.push({ version, path: executable });
      }
    }
  } else {
    for (const executable of ['/opt/unity/Editor/Unity', '/usr/bin/unity-editor', '/usr/local/bin/unity-editor']) {
      if (await pathExists(executable)) candidates.push({ version: 'unknown', path: executable });
    }
  }

  return candidates.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
}

function sendWorkerLog(message) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('autovrm:worker-log', message);
}

async function runUnity(payload) {
  const { unityPath, unityProjectPath, jobPath, logPath } = payload || {};
  if (!unityPath || !unityProjectPath || !jobPath || !logPath) throw new Error('Configuração do Unity incompleta.');
  if (!(await pathExists(unityPath))) throw new Error('Unity.exe não foi encontrado no caminho selecionado.');
  if (!(await pathExists(unityProjectPath))) throw new Error('O projeto Unity temporário não existe.');

  const args = [
    '-batchmode',
    '-quit',
    '-accept-apiupdate',
    '-projectPath', unityProjectPath,
    '-executeMethod', 'AutoVrmConverter.BatchRunner.Run',
    '-autovrmJob', jobPath,
    '-logFile', logPath,
  ];

  sendWorkerLog(`Iniciando Unity: ${unityPath}`);
  sendWorkerLog('A primeira execução pode baixar e compilar o UniVRM.');

  return new Promise((resolve, reject) => {
    const child = spawn(unityPath, args, {
      cwd: path.dirname(unityPath),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => sendWorkerLog(chunk.toString().trim()));
    child.stderr.on('data', (chunk) => sendWorkerLog(chunk.toString().trim()));
    child.on('error', reject);
    child.on('close', async (code) => {
      let result = null;
      try {
        const job = JSON.parse(await fsp.readFile(jobPath, 'utf8'));
        if (await pathExists(job.reportPath)) result = JSON.parse(await fsp.readFile(job.reportPath, 'utf8'));
      } catch {
        result = null;
      }
      sendWorkerLog(`Unity finalizou com código ${code}.`);
      resolve({ code, result, logPath });
    });
  });
}

ipcMain.handle('autovrm:pick-archive', async () => {
  const picked = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecione o pacote do personagem',
    properties: ['openFile'],
    filters: [
      { name: 'Pacotes e modelos', extensions: ['zip', 'fbx', 'glb', 'gltf', 'vrm', 'bvh'] },
      { name: 'Todos os arquivos', extensions: ['*'] },
    ],
  });
  return picked.canceled ? null : picked.filePaths[0];
});

ipcMain.handle('autovrm:pick-folder', async () => {
  const picked = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecione a pasta do pacote',
    properties: ['openDirectory'],
  });
  return picked.canceled ? null : picked.filePaths[0];
});

ipcMain.handle('autovrm:analyze-path', async (_event, inputPath) => analyzeInput(inputPath));

ipcMain.handle('autovrm:export-report', async (_event, analysisId) => {
  const session = sessions.get(analysisId);
  if (!session) throw new Error('A análise expirou.');
  const picked = await dialog.showSaveDialog(mainWindow, {
    title: 'Salvar relatório da análise',
    defaultPath: `${path.parse(session.result.sourceName).name}-conversion-report.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (picked.canceled || !picked.filePath) return null;
  await fsp.writeFile(picked.filePath, JSON.stringify(publicReport(session), null, 2), 'utf8');
  return picked.filePath;
});

ipcMain.handle('autovrm:prepare-workspace', async (_event, analysisId, options) => prepareWorkspace(analysisId, options));
ipcMain.handle('autovrm:detect-unity', async () => findUnityInstallations());
ipcMain.handle('autovrm:pick-unity', async () => {
  const picked = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecione o executável do Unity Editor',
    properties: ['openFile'],
    filters: process.platform === 'win32' ? [{ name: 'Unity Editor', extensions: ['exe'] }] : [{ name: 'Executável', extensions: ['*'] }],
  });
  return picked.canceled ? null : picked.filePaths[0];
});
ipcMain.handle('autovrm:run-unity', async (_event, payload) => runUnity(payload));
ipcMain.handle('autovrm:open-path', async (_event, targetPath) => shell.openPath(targetPath));

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  for (const root of temporaryRoots) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
