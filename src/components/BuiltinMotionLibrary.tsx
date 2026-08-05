import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Repeat2, Sparkles } from 'lucide-react';
import { BUILTIN_MOTIONS, createBuiltinMotion } from '../lib/builtinMotions';
import { useEditorStore } from '../store';

function usePoseLibraryHost(): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let disposed = false;
    let observer: MutationObserver | null = null;

    const attach = (): boolean => {
      const container = document.querySelector<HTMLElement>('.pose-library');
      if (!container) return false;
      let node = container.querySelector<HTMLElement>('.builtin-motion-library-host');
      if (!node) {
        node = document.createElement('div');
        node.className = 'builtin-motion-library-host';
        container.appendChild(node);
      }
      if (!disposed) setHost(node);
      return true;
    };

    if (!attach()) {
      observer = new MutationObserver(() => {
        if (attach()) observer?.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      disposed = true;
      observer?.disconnect();
      setHost(null);
    };
  }, []);

  return host;
}

export default function BuiltinMotionLibrary(): JSX.Element | null {
  const host = usePoseLibraryHost();
  const modelInfo = useEditorStore((state) => state.modelInfo);
  const availableBones = useEditorStore((state) => state.availableBones);
  const currentTime = useEditorStore((state) => state.currentTime);
  const importKeyframes = useEditorStore((state) => state.importKeyframes);
  const setLoop = useEditorStore((state) => state.setLoop);
  const setProjectName = useEditorStore((state) => state.setProjectName);
  const setStatus = useEditorStore((state) => state.setStatus);

  const apply = (id: string, mode: 'replace' | 'append'): void => {
    if (!modelInfo || modelInfo.format !== 'VRM') {
      setStatus('Abra um modelo VRM antes de aplicar uma movimentação pronta.');
      return;
    }

    const definition = BUILTIN_MOTIONS.find((motion) => motion.id === id);
    if (!definition) return;
    const startTime = mode === 'append' ? currentTime : 0;
    const keyframes = createBuiltinMotion(id, {
      startTime,
      availableBones,
      targetMetaVersion: modelInfo.metaVersion === '0' ? '0' : '1',
    });
    importKeyframes(keyframes, mode);
    setLoop(definition.loop);
    if (mode === 'replace') setProjectName(definition.name);
    setStatus(
      `“${definition.name}” aplicada com ${keyframes.length} keyframes. Reproduza, ajuste os ossos necessários e exporte como VRMA.`,
    );
  };

  if (!host) return null;

  return createPortal(
    <section className="builtin-motion-library">
      <div className="builtin-motion-divider"><span>Movimentações prontas</span></div>
      {BUILTIN_MOTIONS.map((motion) => (
        <article key={motion.id} className="builtin-motion-card">
          <span className="builtin-motion-icon"><Sparkles size={17} /></span>
          <div className="builtin-motion-copy">
            <strong>{motion.name}</strong>
            <small>{motion.description}</small>
            <em><Repeat2 size={11} /> {motion.duration.toFixed(2)}s · loop</em>
          </div>
          <div className="builtin-motion-actions">
            <button disabled={!modelInfo} onClick={() => apply(motion.id, 'replace')}>Aplicar</button>
            <button disabled={!modelInfo} title="Inserir no ponto atual da timeline" onClick={() => apply(motion.id, 'append')}><Plus size={13} /></button>
          </div>
        </article>
      ))}
      <p>A animação foi construída manualmente a partir da referência enviada e entra como keyframes normais, não como captura automática.</p>
    </section>,
    host,
  );
}
