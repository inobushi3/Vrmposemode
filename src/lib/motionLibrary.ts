import { detectMotionFormat, motionName, type MotionFormat } from './motionFormats';

export interface StoredMotion {
  id: string;
  name: string;
  fileName: string;
  format: MotionFormat;
  size: number;
  importedAt: number;
  data: ArrayBuffer;
}

interface LegacyStoredMotion extends Omit<StoredMotion, 'format'> {
  format?: MotionFormat;
}

const DB_NAME = 'vrm-pose-mode-motion-library';
const STORE_NAME = 'motions';
const DB_VERSION = 2;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('importedAt', 'importedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the local motion library.'));
  });
}

function transactionResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The motion library operation failed.'));
  });
}

function normalizeRecord(record: LegacyStoredMotion): StoredMotion | null {
  const format = record.format ?? detectMotionFormat(record.fileName);
  if (!format) return null;
  return {
    ...record,
    format,
    name: record.name || motionName(record.fileName),
  };
}

export async function listStoredMotions(): Promise<StoredMotion[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const records = await transactionResult(store.getAll()) as LegacyStoredMotion[];
    return records
      .map(normalizeRecord)
      .filter((record): record is StoredMotion => Boolean(record))
      .sort((a, b) => b.importedAt - a.importedAt);
  } finally {
    database.close();
  }
}

export async function saveMotionFile(file: File, validatedData?: ArrayBuffer): Promise<StoredMotion> {
  const format = detectMotionFormat(file.name);
  if (!format) throw new Error('Unsupported motion format.');
  const data = validatedData ?? await file.arrayBuffer();
  const record: StoredMotion = {
    id: crypto.randomUUID(),
    name: motionName(file.name),
    fileName: file.name,
    format,
    size: file.size,
    importedAt: Date.now(),
    data,
  };
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    await transactionResult(transaction.objectStore(STORE_NAME).put(record));
    return record;
  } finally {
    database.close();
  }
}

export async function renameStoredMotion(id: string, name: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const record = await transactionResult(store.get(id)) as LegacyStoredMotion | undefined;
    if (!record) throw new Error('The motion was not found in the local library.');
    record.name = name.trim().slice(0, 100) || record.name;
    await transactionResult(store.put(record));
  } finally {
    database.close();
  }
}

export async function deleteStoredMotion(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    await transactionResult(transaction.objectStore(STORE_NAME).delete(id));
  } finally {
    database.close();
  }
}
