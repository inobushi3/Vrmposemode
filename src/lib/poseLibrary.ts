import type { PoseSnapshot } from '../types';

export interface StoredPose {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  pose: PoseSnapshot;
}

export interface PoseFile {
  app: 'VRM Pose Mode';
  type: 'pose';
  version: 1;
  name: string;
  pose: PoseSnapshot;
}

const DB_NAME = 'vrm-pose-mode-pose-library';
const STORE_NAME = 'poses';
const DB_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir a biblioteca de poses.'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha na biblioteca de poses.'));
  });
}

function validatePoseSnapshot(value: unknown): value is PoseSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return true;
  return entries.every(([, raw]) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const transform = raw as { rotation?: unknown; position?: unknown };
    const rotation = transform.rotation;
    const position = transform.position;
    return Array.isArray(rotation)
      && rotation.length === 4
      && rotation.every((item) => Number.isFinite(Number(item)))
      && (position === undefined || (
        Array.isArray(position)
        && position.length === 3
        && position.every((item) => Number.isFinite(Number(item)))
      ));
  });
}

export async function listStoredPoses(): Promise<StoredPose[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const records = await requestResult(transaction.objectStore(STORE_NAME).getAll()) as StoredPose[];
    return records.sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    database.close();
  }
}

export async function saveStoredPose(name: string, pose: PoseSnapshot): Promise<StoredPose> {
  if (!validatePoseSnapshot(pose)) throw new Error('A pose capturada é inválida.');
  const now = Date.now();
  const record: StoredPose = {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 100) || 'Minha pose',
    createdAt: now,
    updatedAt: now,
    pose: structuredClone(pose),
  };
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    await requestResult(transaction.objectStore(STORE_NAME).put(record));
    return record;
  } finally {
    database.close();
  }
}

export async function importPoseFile(file: File): Promise<StoredPose> {
  let parsed: PoseFile;
  try {
    parsed = JSON.parse(await file.text()) as PoseFile;
  } catch {
    throw new Error('O arquivo não contém JSON válido.');
  }
  if (parsed.app !== 'VRM Pose Mode' || parsed.type !== 'pose' || parsed.version !== 1 || !validatePoseSnapshot(parsed.pose)) {
    throw new Error('Esse arquivo não é uma pose válida do VRM Pose Mode.');
  }
  return saveStoredPose(parsed.name || file.name.replace(/\.json$/i, ''), parsed.pose);
}

export async function deleteStoredPose(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    await requestResult(transaction.objectStore(STORE_NAME).delete(id));
  } finally {
    database.close();
  }
}

export function poseToFile(record: StoredPose): PoseFile {
  return {
    app: 'VRM Pose Mode',
    type: 'pose',
    version: 1,
    name: record.name,
    pose: structuredClone(record.pose),
  };
}
