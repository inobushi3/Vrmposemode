import * as THREE from 'three';
import { MMDLoader, type MmdVpd } from 'three-mmd-runtime/examples/jsm/loaders/MMDLoader.js';
import { unzipSync } from 'fflate';

export interface LoadedMmdModel {
  mesh: THREE.SkinnedMesh;
  modelFileName: string;
  modelFormat: 'PMX' | 'PMD';
  sourceFileCount: number;
  warnings: string[];
  release: () => void;
}

interface ResourceContext {
  manager: THREE.LoadingManager;
  urlFor: (file: File) => string;
  release: () => void;
}

function normalizePath(value: string): string {
  return decodeURIComponent(value)
    .replace(/[?#].*$/, '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .toLowerCase();
}

function filePath(file: File): string {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return relative?.trim() || file.name;
}

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function mimeFor(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'bmp') return 'image/bmp';
  if (extension === 'tga') return 'image/x-tga';
  if (extension === 'spa' || extension === 'sph') return 'application/octet-stream';
  return 'application/octet-stream';
}

export async function expandMmdSelection(input: File[]): Promise<File[]> {
  const files = [...input];
  const archives = files.filter((file) => file.name.toLowerCase().endsWith('.zip'));
  if (!archives.length) return files;

  const expanded: File[] = files.filter((file) => !file.name.toLowerCase().endsWith('.zip'));
  for (const archive of archives) {
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    } catch {
      throw new Error(`${archive.name} não é um ZIP MMD válido.`);
    }
    for (const [path, bytes] of Object.entries(entries)) {
      if (path.endsWith('/') || !bytes.byteLength) continue;
      const name = path.replace(/\\/g, '/');
      const file = new File([copyBytes(bytes)], name, { type: mimeFor(name) });
      Object.defineProperty(file, 'webkitRelativePath', { value: name, configurable: true });
      expanded.push(file);
    }
  }
  return expanded;
}

function createResourceContext(files: File[]): ResourceContext {
  const manager = new THREE.LoadingManager();
  const urls = new Map<File, string>();
  const exact = new Map<string, string>();
  const basename = new Map<string, string>();

  for (const file of files) {
    const url = URL.createObjectURL(file);
    urls.set(file, url);
    const path = normalizePath(filePath(file));
    exact.set(path, url);
    basename.set(path.split('/').pop() ?? path, url);
  }

  manager.setURLModifier((requested) => {
    if (/^(data:|blob:)/i.test(requested)) return requested;
    const normalized = normalizePath(requested);
    const direct = exact.get(normalized);
    if (direct) return direct;

    for (const [path, url] of exact) {
      if (normalized.endsWith(path) || path.endsWith(normalized)) return url;
    }
    const name = normalized.split('/').pop() ?? normalized;
    return basename.get(name) ?? requested;
  });

  return {
    manager,
    urlFor: (file) => {
      const base = urls.get(file);
      if (!base) throw new Error(`Recurso MMD não registrado: ${file.name}.`);
      return base;
    },
    release: () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
    },
  };
}

function loadMesh(loader: MMDLoader, url: string): Promise<THREE.SkinnedMesh> {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, (error) => {
      reject(error instanceof Error ? error : new Error(String(error || 'Falha ao abrir o modelo MMD.')));
    });
  });
}

export async function loadMmdModel(input: File[]): Promise<LoadedMmdModel> {
  const files = await expandMmdSelection(input);
  const modelFile = files.find((file) => /\.pmx$/i.test(file.name))
    ?? files.find((file) => /\.pmd$/i.test(file.name));
  if (!modelFile) {
    throw new Error('Selecione um modelo .pmx ou .pmd. Para manter texturas, selecione o ZIP completo ou todos os arquivos da pasta.');
  }

  const context = createResourceContext(files);
  const loader = new MMDLoader(context.manager);
  const extension = modelFile.name.toLowerCase().endsWith('.pmx') ? 'pmx' : 'pmd';
  const modelUrl = `${context.urlFor(modelFile)}#source.${extension}`;

  try {
    const mesh = await loadMesh(loader, modelUrl);
    mesh.name = modelFile.name.replace(/\.(pmx|pmd)$/i, '');
    mesh.updateMatrixWorld(true);
    const warnings: string[] = [];
    if (files.length === 1) {
      warnings.push('Somente o arquivo do modelo foi selecionado. Texturas externas podem aparecer ausentes; prefira um ZIP ou selecione a pasta completa.');
    }
    return {
      mesh,
      modelFileName: modelFile.name,
      modelFormat: extension === 'pmx' ? 'PMX' : 'PMD',
      sourceFileCount: files.length,
      warnings,
      release: context.release,
    };
  } catch (error) {
    context.release();
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Não foi possível abrir ${modelFile.name}. ${detail}`);
  }
}

function loadAnimation(loader: MMDLoader, url: string, mesh: THREE.SkinnedMesh): Promise<THREE.AnimationClip> {
  return new Promise((resolve, reject) => {
    loader.loadAnimation(url, mesh, resolve, undefined, (error) => {
      reject(error instanceof Error ? error : new Error(String(error || 'Falha ao abrir o VMD.')));
    });
  });
}

export async function loadVmdOnMmdModel(mesh: THREE.SkinnedMesh, file: File): Promise<THREE.AnimationClip> {
  const url = URL.createObjectURL(file);
  try {
    const loader = new MMDLoader();
    return await loadAnimation(loader, `${url}#motion.vmd`, mesh);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadVpd(loader: MMDLoader, url: string): Promise<MmdVpd> {
  return new Promise((resolve, reject) => {
    loader.loadVPD(url, true, resolve, undefined, (error) => {
      reject(error instanceof Error ? error : new Error(String(error || 'Falha ao abrir o VPD.')));
    });
  });
}

export async function loadVpdFile(file: File): Promise<MmdVpd> {
  const url = URL.createObjectURL(file);
  try {
    return await loadVpd(new MMDLoader(), `${url}#pose.vpd`);
  } finally {
    URL.revokeObjectURL(url);
  }
}
