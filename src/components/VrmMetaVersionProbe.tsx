import { useEffect, useRef } from 'react';
import { editorEvent } from '../lib/events';
import { useEditorStore } from '../store';

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;

interface GltfDocument {
  extensions?: Record<string, unknown>;
  extensionsUsed?: string[];
}

function versionFromDocument(document: GltfDocument): '0' | '1' | null {
  const extensions = document.extensions ?? {};
  const used = new Set(document.extensionsUsed ?? []);
  if ('VRMC_vrm' in extensions || used.has('VRMC_vrm')) return '1';
  if ('VRM' in extensions || used.has('VRM')) return '0';
  return null;
}

function parseJsonBytes(bytes: Uint8Array): GltfDocument | null {
  try {
    const text = new TextDecoder().decode(bytes).replace(/\u0000+$/g, '').trim();
    return JSON.parse(text) as GltfDocument;
  } catch {
    return null;
  }
}

async function detectVrmMetaVersion(file: File): Promise<'0' | '1' | null> {
  const data = await file.arrayBuffer();
  const bytes = new Uint8Array(data);
  const view = new DataView(data);

  if (bytes.length >= 20 && view.getUint32(0, true) === GLB_MAGIC) {
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const length = view.getUint32(offset, true);
      const type = view.getUint32(offset + 4, true);
      const start = offset + 8;
      const end = start + length;
      if (end > bytes.length) break;
      if (type === JSON_CHUNK) {
        const document = parseJsonBytes(bytes.subarray(start, end));
        return document ? versionFromDocument(document) : null;
      }
      offset = end;
    }
    return null;
  }

  const document = parseJsonBytes(bytes);
  return document ? versionFromDocument(document) : null;
}

export default function VrmMetaVersionProbe(): null {
  const requestRef = useRef(0);

  useEffect(() => {
    const processFile = (file: File): void => {
      const extension = file.name.split('.').pop()?.toLowerCase();
      if (!extension || !['vrm', 'glb', 'gltf'].includes(extension)) return;
      const request = ++requestRef.current;

      void detectVrmMetaVersion(file).then((metaVersion) => {
        if (!metaVersion || request !== requestRef.current) return;

        const applyWhenLoaded = (): boolean => {
          const state = useEditorStore.getState();
          if (!state.modelInfo || state.modelFileName !== file.name) return false;
          state.setModelMetaVersion(metaVersion);
          return true;
        };

        if (applyWhenLoaded()) return;
        const unsubscribe = useEditorStore.subscribe(() => {
          if (request !== requestRef.current) {
            unsubscribe();
            return;
          }
          const state = useEditorStore.getState();
          if (!state.modelInfo || state.modelFileName !== file.name) return;
          unsubscribe();
          state.setModelMetaVersion(metaVersion);
        });
        window.setTimeout(unsubscribe, 15000);
      }).catch((error) => {
        console.warn('Could not detect the VRM meta version.', error);
      });
    };

    const onLoad = (event: Event): void => {
      const file = (event as CustomEvent<File>).detail;
      if (file) processFile(file);
    };
    const onDrop = (event: DragEvent): void => {
      const file = event.dataTransfer?.files?.[0];
      if (file) processFile(file);
    };

    window.addEventListener(editorEvent.loadModel, onLoad);
    document.addEventListener('drop', onDrop, true);
    return () => {
      window.removeEventListener(editorEvent.loadModel, onLoad);
      document.removeEventListener('drop', onDrop, true);
    };
  }, []);

  return null;
}
