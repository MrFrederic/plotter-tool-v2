import { useState, useCallback, useRef, useEffect } from 'react';
import './PreviewWindow.css';
import RasterViewer from './RasterViewer';
import VectorViewer from './VectorViewer';
import GCodeViewer from './GCodeViewer';
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
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

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
      const newX = Math.max(0, Math.min(window.innerWidth - 200, dragRef.current.origX + dx));
      const newY = Math.max(0, Math.min(window.innerHeight - 50, dragRef.current.origY + dy));
      setPosition({ x: newX, y: newY });
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
  }, []);

  if (!visible) return null;

  const resolvedType = outputType || detectOutputType(resultData);

  return (
    <div
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
                <VectorViewer data={resultData.paths ?? resultData} />
              )}
              {resolvedType === 'gcode' && (
                <GCodeViewer data={String(resultData.gcode ?? '')} />
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
  if ('paths' in data) return 'path';
  if ('gcode' in data) return 'gcode';
  return 'unknown';
}
