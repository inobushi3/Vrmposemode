import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Keyframe } from '../types';
import { useEditorStore } from '../store';

interface DragSession {
  id: string;
  pointerId: number;
  before: Keyframe[];
  originClientX: number;
  startTime: number;
  moved: boolean;
}

function cloneKeyframes(keyframes: Keyframe[]): Keyframe[] {
  return structuredClone(keyframes);
}

function formatTime(time: number, fps: number): string {
  const frame = Math.round(time * fps);
  return `${time.toFixed(2)}s · F ${frame}`;
}

function findAvailableTime(
  rawTime: number,
  session: DragSession,
  fps: number,
  duration: number,
): number {
  const safeFps = Math.max(1, fps);
  const maxFrame = Math.max(0, Math.round(duration * safeFps));
  const targetFrame = Math.max(0, Math.min(maxFrame, Math.round(rawTime * safeFps)));
  const occupiedFrames = new Set(
    session.before
      .filter((keyframe) => keyframe.id !== session.id)
      .map((keyframe) => Math.round(keyframe.time * safeFps)),
  );

  if (!occupiedFrames.has(targetFrame)) return Math.min(duration, targetFrame / safeFps);

  const preferredDirection = rawTime >= session.startTime ? 1 : -1;
  for (let distance = 1; distance <= maxFrame; distance += 1) {
    const preferred = targetFrame + distance * preferredDirection;
    if (preferred >= 0 && preferred <= maxFrame && !occupiedFrames.has(preferred)) {
      return Math.min(duration, preferred / safeFps);
    }

    const opposite = targetFrame - distance * preferredDirection;
    if (opposite >= 0 && opposite <= maxFrame && !occupiedFrames.has(opposite)) {
      return Math.min(duration, opposite / safeFps);
    }
  }

  return Math.min(duration, targetFrame / safeFps);
}

export default function TimelineKeyframeDragLayer(): JSX.Element | null {
  const keyframes = useEditorStore((state) => state.keyframes);
  const duration = useEditorStore((state) => state.duration);
  const fps = useEditorStore((state) => state.fps);
  const setCurrentTime = useEditorStore((state) => state.setCurrentTime);
  const setPlaying = useEditorStore((state) => state.setPlaying);
  const previewKeyframeTime = useEditorStore((state) => state.previewKeyframeTime);
  const commitKeyframeTime = useEditorStore((state) => state.commitKeyframeTime);

  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragTime, setDragTime] = useState(0);
  const dragRef = useRef<DragSession | null>(null);

  useEffect(() => {
    let disposed = false;
    let frame = 0;
    let portalHost: HTMLDivElement | null = null;

    const attach = (): void => {
      if (disposed) return;
      const track = document.querySelector<HTMLElement>('.timeline-track');
      if (!track) {
        frame = window.requestAnimationFrame(attach);
        return;
      }

      portalHost = document.createElement('div');
      portalHost.className = 'timeline-keyframe-drag-layer';
      track.appendChild(portalHost);
      setHost(portalHost);
    };

    frame = window.requestAnimationFrame(attach);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      portalHost?.remove();
      document.body.classList.remove('is-dragging-keyframe');
    };
  }, []);

  const timeFromPointer = (clientX: number, session: DragSession): number | null => {
    const track = host?.parentElement;
    if (!track || duration <= 0) return null;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return findAvailableTime(ratio * duration, session, fps, duration);
  };

  const finishDrag = (pointerId: number): void => {
    const session = dragRef.current;
    if (!session || session.pointerId !== pointerId) return;
    commitKeyframeTime(session.before);
    dragRef.current = null;
    setDraggingId(null);
    document.body.classList.remove('is-dragging-keyframe');
  };

  if (!host) return null;

  return createPortal(
    <>
      {keyframes.map((keyframe) => {
        const isDragging = draggingId === keyframe.id;
        return (
          <button
            key={keyframe.id}
            className={`keyframe-drag-hitbox${isDragging ? ' dragging' : ''}`}
            style={{ left: `${(keyframe.time / Math.max(duration, 0.1)) * 100}%` }}
            type="button"
            aria-label={`Mover keyframe em ${formatTime(keyframe.time, fps)}`}
            title={`${formatTime(keyframe.time, fps)} — arraste para mover`}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              const session: DragSession = {
                id: keyframe.id,
                pointerId: event.pointerId,
                before: cloneKeyframes(keyframes),
                originClientX: event.clientX,
                startTime: keyframe.time,
                moved: false,
              };
              dragRef.current = session;
              setDraggingId(keyframe.id);
              setDragTime(keyframe.time);
              setPlaying(false);
              setCurrentTime(keyframe.time);
              document.body.classList.add('is-dragging-keyframe');
            }}
            onPointerMove={(event) => {
              const session = dragRef.current;
              if (!session || session.pointerId !== event.pointerId || session.id !== keyframe.id) return;
              event.preventDefault();
              event.stopPropagation();
              if (Math.abs(event.clientX - session.originClientX) >= 3) session.moved = true;
              const nextTime = timeFromPointer(event.clientX, session);
              if (nextTime === null) return;
              setDragTime(nextTime);
              previewKeyframeTime(session.id, nextTime);
            }}
            onPointerUp={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              finishDrag(event.pointerId);
            }}
            onPointerCancel={(event) => finishDrag(event.pointerId)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              event.stopPropagation();
              const before = cloneKeyframes(keyframes);
              const direction = event.key === 'ArrowRight' ? 1 : -1;
              const frameStep = event.shiftKey ? 10 : 1;
              const session: DragSession = {
                id: keyframe.id,
                pointerId: -1,
                before,
                originClientX: 0,
                startTime: keyframe.time,
                moved: true,
              };
              const nextTime = findAvailableTime(
                keyframe.time + (direction * frameStep) / Math.max(1, fps),
                session,
                fps,
                duration,
              );
              previewKeyframeTime(keyframe.id, nextTime);
              commitKeyframeTime(before);
            }}
          >
            <span className="keyframe-drag-time" aria-hidden="true">
              {formatTime(isDragging ? dragTime : keyframe.time, fps)}
            </span>
          </button>
        );
      })}
    </>,
    host,
  );
}
