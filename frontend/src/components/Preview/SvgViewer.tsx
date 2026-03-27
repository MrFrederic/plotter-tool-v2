import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import './SvgViewer.css';

interface SvgViewerProps {
  data: unknown;
}

interface ParsedSvg {
  error: string | null;
  content: string;
  width: number;
  height: number;
  elementCount: number;
}

function parseSvgData(data: unknown): ParsedSvg {
  if (!data || typeof data !== 'string') {
    return {
      error: 'Invalid input: expected SVG string',
      content: '',
      width: 100,
      height: 100,
      elementCount: 0,
    };
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(data, 'image/svg+xml');

    if (doc.getElementsByTagName('parsererror').length > 0) {
      return {
        error: 'Invalid SVG: malformed XML',
        content: '',
        width: 100,
        height: 100,
        elementCount: 0,
      };
    }

    const svgElement = doc.documentElement;
    if (svgElement.tagName.toLowerCase() !== 'svg') {
      return {
        error: 'Invalid: root element must be <svg>',
        content: '',
        width: 100,
        height: 100,
        elementCount: 0,
      };
    }

    let width = 100;
    let height = 100;
    const viewBox = svgElement.getAttribute('viewBox');

    if (viewBox) {
      const parts = viewBox.split(/\s+/).map((part) => Number(part));
      if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3])) {
        width = parts[2];
        height = parts[3];
      }
    } else {
      const rawWidth = svgElement.getAttribute('width');
      const rawHeight = svgElement.getAttribute('height');
      if (rawWidth && rawHeight) {
        const parsedWidth = Number.parseFloat(rawWidth);
        const parsedHeight = Number.parseFloat(rawHeight);
        if (Number.isFinite(parsedWidth) && Number.isFinite(parsedHeight)) {
          width = parsedWidth;
          height = parsedHeight;
        }
      }
    }

    return {
      error: null,
      content: data,
      width,
      height,
      elementCount: svgElement.childElementCount,
    };
  } catch (err) {
    return {
      error: `Parse error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      content: '',
      width: 100,
      height: 100,
      elementCount: 0,
    };
  }
}

export default function SvgViewer({ data }: SvgViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('svgViewerTheme') as 'dark' | 'light') || 'dark';
  });

  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    localStorage.setItem('svgViewerTheme', theme);
  }, [theme]);

  const parsed = useMemo(() => parseSvgData(data), [data]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((currentZoom) => Math.min(Math.max(currentZoom * delta, 0.1), 20));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: offset.x, origY: offset.y };
  }, [offset]);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragRef.current) return;
      setOffset({
        x: dragRef.current.origX + (e.clientX - dragRef.current.startX),
        y: dragRef.current.origY + (e.clientY - dragRef.current.startY),
      });
    };

    const up = () => {
      dragRef.current = null;
    };

    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);

    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  if (parsed.error) {
    return (
      <div className="svg-viewer">
        <div className="svg-viewer__error">
          <div className="svg-viewer__error-icon">⚠</div>
          <div className="svg-viewer__error-message">{parsed.error}</div>
        </div>
      </div>
    );
  }

  if (!parsed.content) {
    return (
      <div className="svg-viewer">
        <div className="svg-viewer__empty">
          <div className="svg-viewer__empty-icon">◯</div>
          <div className="svg-viewer__empty-text">No SVG data</div>
        </div>
      </div>
    );
  }

  return (
    <div className="svg-viewer">
      <div className="svg-viewer__toolbar">
        <button className="svg-viewer__btn" onClick={() => setZoom((currentZoom) => Math.min(currentZoom * 1.25, 20))} title="Zoom in">+</button>
        <button className="svg-viewer__btn" onClick={() => setZoom((currentZoom) => Math.max(currentZoom * 0.8, 0.1))} title="Zoom out">−</button>
        <button className="svg-viewer__btn" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title="Toggle theme">◐</button>
        <button className="svg-viewer__btn" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }} title="Reset">⊡</button>
        <span className="svg-viewer__zoom">{(zoom * 100).toFixed(0)}%</span>
        <span className="svg-viewer__stats">{parsed.elementCount} elements</span>
      </div>

      <div className={`svg-viewer__viewport svg-viewer__viewport--${theme}`} onWheel={handleWheel} onMouseDown={handleMouseDown}>
        <div
          className="svg-viewer__canvas"
          style={{
            width: parsed.width,
            height: parsed.height,
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          }}
          dangerouslySetInnerHTML={{ __html: parsed.content }}
        />
      </div>
    </div>
  );
}
