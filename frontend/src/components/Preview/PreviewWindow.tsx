import { useState, useCallback, useRef, useEffect } from 'react';
import './PreviewWindow.css';
import RasterViewer from './RasterViewer';
import VectorViewer from './VectorViewer';
import GCodeViewer from './GCodeViewer';
import TextViewer from './TextViewer';
import SvgViewer from './SvgViewer';
import OtherViewer from './OtherViewer';
import GlitchText from '../common/GlitchText';

interface PreviewWindowProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  nodeId?: string | null;
  outputType?: string;
  resultData?: Record<string, unknown> | null;
  loading?: boolean;
  error?: string | null;
}

function getPathPayload(data: Record<string, unknown>): unknown {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return [value];
    return value;
  };

  const keys = ['paths', 'path', 'PATH'] as const;
  for (const key of keys) {
    if (key in data && data[key] != null) {
      return normalize(data[key]);
    }
  }

  return normalize(data);
}

export default function PreviewWindow({
  visible,
  onClose,
  title = 'OUTPUT PREVIEW',
  nodeId,
  outputType,
  resultData,
  loading = false,
  error = null,
}: PreviewWindowProps) {
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [minimized, setMinimized] = useState(false);
  const windowRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const clampPosition = useCallback((x: number, y: number) => {
    const el = windowRef.current;
    const panelWidth = el?.offsetWidth ?? 640;
    const panelHeight = el?.offsetHeight ?? 420;
    const maxX = Math.max(8, window.innerWidth - panelWidth - 8);
    const maxY = Math.max(8, window.innerHeight - panelHeight - 8);

    return {
      x: Math.min(Math.max(8, x), maxX),
      y: Math.min(Math.max(8, y), maxY),
    };
  }, []);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: position.x,
        origY: position.y,
      };
    },
    [position],
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const next = clampPosition(dragRef.current.origX + dx, dragRef.current.origY + dy);
      setPosition(next);
    };

    const onMouseUp = () => {
      dragRef.current = null;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [clampPosition]);

  useEffect(() => {
    if (!visible) return;

    const raf = window.requestAnimationFrame(() => {
      const el = windowRef.current;
      const panelWidth = el?.offsetWidth ?? 640;
      const panelHeight = el?.offsetHeight ?? 420;
      const centered = clampPosition(
        Math.max(8, (window.innerWidth - panelWidth) / 2),
        Math.max(8, (window.innerHeight - panelHeight) / 2),
      );
      setPosition(centered);
    });

    return () => window.cancelAnimationFrame(raf);
  }, [visible, clampPosition]);

  useEffect(() => {
    if (!visible) return;

    const onResize = () => {
      setPosition((prev) => clampPosition(prev.x, prev.y));
    };

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [visible, clampPosition]);

  if (!visible) return null;

  const resolvedType = outputType || detectOutputType(resultData);

  return (
    <div
      ref={windowRef}
      className={`preview-window ${minimized ? 'preview-window--minimized' : ''}`}
      style={{ left: position.x, top: position.y }}
    >
      <div className="preview-window__titlebar" onMouseDown={onMouseDown}>
        <span className="preview-window__title">
          <span className="preview-window__title-prefix">▸ </span>
          {title}
          {nodeId && <span className="preview-window__node-id"> [{nodeId.slice(0, 12)}]</span>}
        </span>
        <div className="preview-window__controls">
          <button
            className="preview-window__btn preview-window__minimize"
            onClick={() => setMinimized(!minimized)}
            title={minimized ? 'Expand' : 'Collapse'}
          >
            {minimized ? '▢' : '▬'}
          </button>
          <button className="preview-window__btn preview-window__close" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      {!minimized && (
        <div className="preview-window__content">
          {loading && (
            <div className="preview-window__loading">
              <div className="preview-window__spinner" />
              <GlitchText text="LOADING DATA..." duration={800} />
            </div>
          )}

          {error && !loading && (
            <div className="preview-window__error">
              <span className="preview-window__error-icon">⚠</span>
              <span className="preview-window__error-text">{error}</span>
            </div>
          )}

          {!loading && !error && resultData && (
            <div className="preview-window__viewer">
              {resolvedType === 'image' && (
                <RasterViewer data={resultData.image ?? resultData} />
              )}
              {resolvedType === 'path' && (
                <VectorViewer data={getPathPayload(resultData)} />
              )}
              {resolvedType === 'gcode' && (
                <GCodeViewer data={String(resultData.gcode ?? '')} />
              )}
              {resolvedType === 'text' && (
                <TextViewer data={resultData.text ?? resultData} />
              )}
              {resolvedType === 'vector' && (
                <SvgViewer data={resultData.vector ?? resultData} />
              )}
              {resolvedType === 'other' && (
                <OtherViewer data={resultData.data ?? resultData} />
              )}
              {resolvedType === 'unknown' && (
                <div className="preview-window__raw">
                  <pre>{JSON.stringify(resultData, null, 2)}</pre>
                </div>
              )}
            </div>
          )}

          {!loading && !error && !resultData && (
            <div className="preview-window__placeholder">
              <div className="preview-window__crosshair" />
              <span>No preview data</span>
              <span className="preview-window__hint">
                Execute pipeline to generate output
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function detectOutputType(data: Record<string, unknown> | null | undefined): string {
  if (!data) return 'unknown';
  if ('image' in data) return 'image';
  if ('paths' in data || 'path' in data || 'PATH' in data) return 'path';
  if ('gcode' in data) return 'gcode';
  if ('text' in data) return 'text';
  if ('vector' in data) return 'vector';
  if ('data' in data) return 'other';
  return 'unknown';
}
