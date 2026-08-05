import { unzipSync } from 'fflate';

export interface PapAnimationRecord {
  index: number;
  name: string;
  havokIndex: number;
}

export interface ParsedPap {
  version: number;
  skeletonId: number;
  animations: PapAnimationRecord[];
}

export interface PmpPapEntry extends PapAnimationRecord {
  path: string;
  fileName: string;
  skeletonCode: string | null;
}

function readAscii(bytes: Uint8Array, start: number, length: number): string {
  return new TextDecoder('ascii')
    .decode(bytes.subarray(start, start + length))
    .replace(/\0.*$/s, '')
    .trim();
}

function ensureRange(bytes: Uint8Array, offset: number, length: number, label: string): void {
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw new Error(`${label} está fora dos limites do arquivo.`);
  }
}

export function parsePapBytes(input: ArrayBuffer | Uint8Array): ParsedPap {
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

  const animations: PapAnimationRecord[] = [];
  for (let index = 0; index < animationCount; index += 1) {
    const offset = infoOffset + index * 40;
    animations.push({
      index,
      name: readAscii(bytes, offset, 32) || `Animação ${index + 1}`,
      havokIndex: view.getInt16(offset + 34, true),
    });
  }
  return { version, skeletonId, animations };
}

export function skeletonCodeFromPath(value: string): string | null {
  const normalized = value.replace(/\\/g, '/').toLowerCase();
  const match = normalized.match(/(?:^|\/)(c\d{4})(?:\/|_)/);
  return match?.[1] ?? null;
}

export function listPmpPapEntries(data: ArrayBuffer): PmpPapEntry[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(data));
  } catch {
    throw new Error('O arquivo PMP não é um pacote ZIP válido do Penumbra.');
  }
  const entries: PmpPapEntry[] = [];
  for (const [archivePath, bytes] of Object.entries(files)) {
    if (!archivePath.toLowerCase().endsWith('.pap') || !bytes.byteLength) continue;
    const parsed = parsePapBytes(bytes);
    const fileName = archivePath.replace(/\\/g, '/').split('/').pop() ?? archivePath;
    const skeletonCode = skeletonCodeFromPath(archivePath);
    for (const animation of parsed.animations) {
      entries.push({
        ...animation,
        path: archivePath,
        fileName,
        skeletonCode,
      });
    }
  }
  return entries;
}

export function extractPmpPap(data: ArrayBuffer, archivePath: string): Uint8Array {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(data));
  } catch {
    throw new Error('O arquivo PMP não é um pacote ZIP válido do Penumbra.');
  }
  const exact = files[archivePath];
  if (exact) return exact.slice();
  const normalized = archivePath.replace(/\\/g, '/').toLowerCase();
  const match = Object.entries(files).find(([entry]) => entry.replace(/\\/g, '/').toLowerCase() === normalized);
  if (!match) throw new Error('O PAP escolhido não foi encontrado dentro do PMP.');
  return match[1].slice();
}
