import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minus, Plus, ZoomIn, ZoomOut } from 'lucide-react';
import { useEditorStore } from '../store';

const MIN_DURATION = 0.1;
const MAX_DURATION = 3600;
const MIN_ZOOM = 8;
const MAX_ZOOM = 240;
const DEFAULT_ZOOM = 72;

function durationText(value: number): string {
  return Number(value.toFixed(2)).toString();
}

export default function TimelineDurationControls(): JSX.Element | null {
  const duration = useEditorStore((state) => state.duration);
  const currentTime = useEditorStore((state) => state.currentTime);
  const playing = useEditorStore((state) => state.playing);
  const setDuration = useEditorStore((state) => state.setDuration);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState(() => durationText(duration));
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);

  useEffect(() => {
    const controls = document.querySelector<HTMLElement>('.timeline-controls');
    if (!controls) return;

    const portalHost = document.createElement('div');
    portalHost.className = 'timeline-duration-host';
    const spacer = controls.querySelector('.timeline-spacer');
    controls.insertBefore(portalHost, spacer);
    setHost(portalHost);

    return () => portalHost.remove();
  }, []);

  useEffect(() => {
    setDraft(durationText(duration));
  }, [duration]);

  useEffect(() => {
    const wrap = document.querySelector<HTMLElement>('.timeline-track-wrap');
    if (!wrap) return;

    const pixelWidth = Math.max(640, Math.round(duration * zoom));
    wrap.style.setProperty('--timeline-pixel-width', `${pixelWidth}px`);
    wrap.style.setProperty('--timeline-second-width', `${zoom}px`);
  }, [duration, zoom]);

  useEffect(() => {
    if (!playing || duration <= 0) return;
    const wrap = document.querySelector<HTMLElement>('.timeline-track-wrap');
    const track = document.querySelector<HTMLElement>('.timeline-track');
    if (!wrap || !track) return;

    const playheadX = track.offsetLeft + (currentTime / duration) * track.clientWidth;
    const safeLeft = wrap.scrollLeft + 60;
    const safeRight = wrap.scrollLeft + wrap.clientWidth - 80;
    if (playheadX < safeLeft || playheadX > safeRight) {
      wrap.scrollTo({
        left: Math.max(0, playheadX - wrap.clientWidth * 0.28),
        behavior: 'smooth',
      });
    }
  }, [currentTime, duration, playing, zoom]);

  const commitDuration = (): void => {
    const parsed = Number(draft.replace(',', '.'));
    if (!Number.isFinite(parsed)) {
      setDraft(durationText(duration));
      return;
    }
    setDuration(Math.max(MIN_DURATION, Math.min(MAX_DURATION, parsed)));
  };

  const changeDuration = (amount: number): void => {
    setDuration(Math.max(MIN_DURATION, Math.min(MAX_DURATION, duration + amount)));
  };

  const fitTimeline = (): void => {
    const wrap = document.querySelector<HTMLElement>('.timeline-track-wrap');
    if (!wrap || duration <= 0) return;
    const availableWidth = Math.max(320, wrap.clientWidth - 40);
    setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, availableWidth / duration)));
    wrap.scrollTo({ left: 0, behavior: 'smooth' });
  };

  if (!host) return null;

  return createPortal(
    <div className="timeline-duration-controls" aria-label="Configuração da timeline">
      <span className="timeline-duration-label">Duração</span>
      <button title="Diminuir 1 segundo" onClick={() => changeDuration(-1)}><Minus size={13} /></button>
      <label className="timeline-duration-input">
        <input
          aria-label="Duração da animação em segundos"
          type="number"
          min={MIN_DURATION}
          max={MAX_DURATION}
          step={0.1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDuration}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setDraft(durationText(duration));
              event.currentTarget.blur();
            }
          }}
        />
        <span>s</span>
      </label>
      <button title="Aumentar 1 segundo" onClick={() => changeDuration(1)}><Plus size={13} /></button>
      <select
        aria-label="Durações rápidas"
        value=""
        onChange={(event) => {
          if (event.target.value) setDuration(Number(event.target.value));
        }}
      >
        <option value="">Tempo rápido</option>
        <option value="3">3 segundos</option>
        <option value="5">5 segundos</option>
        <option value="10">10 segundos</option>
        <option value="30">30 segundos</option>
        <option value="60">1 minuto</option>
        <option value="120">2 minutos</option>
        <option value="300">5 minutos</option>
      </select>
      <span className="timeline-control-divider" />
      <button title="Diminuir zoom da timeline" onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value - 12))}><ZoomOut size={14} /></button>
      <span className="timeline-zoom-value">{Math.round(zoom)} px/s</span>
      <button title="Aumentar zoom da timeline" onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value + 12))}><ZoomIn size={14} /></button>
      <button title="Ajustar toda a duração à janela" onClick={fitTimeline}><Maximize2 size={13} /></button>
    </div>,
    host,
  );
}
