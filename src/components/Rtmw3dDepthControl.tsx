import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, RotateCcw } from 'lucide-react';
import {
  getRtmw3dDepthStrength,
  resetRtmw3dDepthStrength,
  setRtmw3dDepthStrength,
} from '../lib/rtmw3dDepth';

export default function Rtmw3dDepthControl(): JSX.Element | null {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [strength, setStrength] = useState(getRtmw3dDepthStrength());

  useEffect(() => {
    let mountedHost: HTMLElement | null = null;
    const attach = (): void => {
      const settings = document.querySelector<HTMLElement>('.rtmw3d-settings');
      if (!settings || settings.querySelector('.rtmw3d-depth-control-host')) return;
      const nextHost = document.createElement('div');
      nextHost.className = 'rtmw3d-depth-control-host';
      const firstField = settings.querySelector('.rtmw3d-field');
      settings.insertBefore(nextHost, firstField);
      mountedHost = nextHost;
      setHost(nextHost);
    };

    attach();
    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mountedHost?.remove();
      setHost(null);
    };
  }, []);

  if (!host) return null;

  const percentage = Math.round(strength * 100);
  return createPortal(
    <div className="rtmw3d-depth-control">
      <div className="rtmw3d-depth-heading">
        <span><Box size={14} /> Profundidade 3D</span>
        <button
          type="button"
          title="Restaurar profundidade recomendada"
          onClick={() => setStrength(resetRtmw3dDepthStrength())}
        >
          <RotateCcw size={12} />
        </button>
      </div>
      <div className="rtmw3d-depth-row">
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.05}
          value={strength}
          onChange={(event) => setStrength(setRtmw3dDepthStrength(Number(event.target.value)))}
        />
        <strong>{percentage}%</strong>
      </div>
      <div className="rtmw3d-depth-presets">
        <button type="button" className={strength === 0 ? 'active' : ''} onClick={() => setStrength(setRtmw3dDepthStrength(0))}>2D fiel</button>
        <button type="button" className={Math.abs(strength - 0.65) < 0.001 ? 'active' : ''} onClick={() => setStrength(setRtmw3dDepthStrength(0.65))}>Equilibrado</button>
        <button type="button" className={Math.abs(strength - 1) < 0.001 ? 'active' : ''} onClick={() => setStrength(setRtmw3dDepthStrength(1))}>3D forte</button>
      </div>
      <small>O valor é aplicado na próxima análise. Use “2D fiel” quando a silhueta estiver certa, mas braços ou pernas dobrarem para a câmera.</small>
    </div>,
    host,
  );
}
