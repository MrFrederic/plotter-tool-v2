import { useState, useCallback, useRef, useEffect } from 'react';
import './PreviewWindow.css';

interface PreviewWindowProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  imageUrl?: string;
}

export default function PreviewWindow({
  visible,
  onClose,
  title = 'OUTPUT PREVIEW',
  imageUrl,
}: PreviewWindowProps) {
  const [position, setPosition] = useState({ x: 100, y: 100 });
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
      setPosition({
        x: dragRef.current.origX + dx,
        y: dragRef.current.origY + dy,
      });
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

  return (
    <div
      className="preview-window"
      style={{ left: position.x, top: position.y }}
    >
      <div className="preview-window__titlebar" onMouseDown={onMouseDown}>
        <span className="preview-window__title">{title}</span>
        <button className="preview-window__close" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="preview-window__content">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt="Preview output"
            className="preview-window__image"
          />
        ) : (
          <div className="preview-window__placeholder">
            <div className="preview-window__crosshair" />
            <span>No preview data</span>
            <span className="preview-window__hint">
              Execute pipeline to generate output
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
