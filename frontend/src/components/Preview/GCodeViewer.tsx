import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import './GCodeViewer.css';

interface GCodeViewerProps {
  data: string;
}

type ViewMode = 'text' | 'toolpath';

interface ParsedLine {
  raw: string;
  lineNum: number;
}

interface ToolpathSegment {
  x1: number; y1: number;
  x2: number; y2: number;
  rapid: boolean;
  index: number;
}

export default function GCodeViewer({ data }: GCodeViewerProps) {
  const [mode, setMode] = useState<ViewMode>('text');
  const [searchQuery, setSearchQuery] = useState('');
  const [step, setStep] = useState(-1); // -1 = show all

  const lines = useMemo<ParsedLine[]>(() => {
    if (!data) return [];
    return data.split('\n').map((raw, i) => ({ raw, lineNum: i + 1 }));
  }, [data]);

  const filteredLines = useMemo(() => {
    if (!searchQuery) return lines;
    const q = searchQuery.toLowerCase();
    return lines.filter((l) => l.raw.toLowerCase().includes(q));
  }, [lines, searchQuery]);

  const segments = useMemo<ToolpathSegment[]>(() => {
    const segs: ToolpathSegment[] = [];
    let cx = 0, cy = 0;
    let idx = 0;
    for (const line of lines) {
      const s = line.raw.trim();
      if (!s.startsWith('G0') && !s.startsWith('G1')) continue;
      const rapid = s.startsWith('G0');
      const xMatch = s.match(/X([-\d.]+)/);
      const yMatch = s.match(/Y([-\d.]+)/);
      const nx = xMatch ? parseFloat(xMatch[1]) : cx;
      const ny = yMatch ? parseFloat(yMatch[1]) : cy;
      if (nx !== cx || ny !== cy) {
        segs.push({ x1: cx, y1: cy, x2: nx, y2: ny, rapid, index: idx++ });
      }
      cx = nx;
      cy = ny;
    }
    return segs;
  }, [lines]);

  return (
    <div className="gcode-viewer">
      <div className="gcode-viewer__tabs">
        <button
          className={`gcode-viewer__tab ${mode === 'text' ? 'gcode-viewer__tab--active' : ''}`}
          onClick={() => setMode('text')}
        >
          TEXT
        </button>
        <button
          className={`gcode-viewer__tab ${mode === 'toolpath' ? 'gcode-viewer__tab--active' : ''}`}
          onClick={() => setMode('toolpath')}
        >
          TOOLPATH
        </button>
        <span className="gcode-viewer__line-count">{lines.length} lines</span>
      </div>

      {mode === 'text' ? (
        <TextViewer
          lines={filteredLines}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
      ) : (
        <ToolpathViewer
          segments={segments}
          step={step}
          onStepChange={setStep}
        />
      )}
    </div>
  );
}

/* ── Text View ─────────────────────────────────────────────────────── */

function TextViewer({
  lines,
  searchQuery,
  onSearchChange,
}: {
  lines: ParsedLine[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
}) {
  return (
    <div className="gcode-text">
      <div className="gcode-text__search">
        <input
          type="text"
          className="gcode-text__search-input"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {searchQuery && (
          <span className="gcode-text__search-count">{lines.length} matches</span>
        )}
      </div>
      <div className="gcode-text__list">
        <Virtuoso
          totalCount={lines.length}
          itemContent={(index) => {
            const line = lines[index];
            return (
              <div className="gcode-text__line">
                <span className="gcode-text__line-num">{line.lineNum}</span>
                <span className="gcode-text__line-content">
                  {highlightGCode(line.raw)}
                </span>
              </div>
            );
          }}
          style={{ height: '350px' }}
        />
      </div>
    </div>
  );
}

function highlightGCode(raw: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let rest = raw;
  let key = 0;

  // Comment
  const commentIdx = rest.indexOf(';');
  let comment = '';
  if (commentIdx >= 0) {
    comment = rest.slice(commentIdx);
    rest = rest.slice(0, commentIdx);
  }

  // Tokenize remaining
  const tokens = rest.split(/(\b(?:G|M)\d+\b|[XYZIJFSE][-\d.]+)/g);
  for (const token of tokens) {
    if (/^[GM]\d+$/.test(token)) {
      parts.push(<span key={key++} className="gcode-hl-cmd">{token}</span>);
    } else if (/^[XYZIJF][-\d.]+$/.test(token)) {
      parts.push(<span key={key++} className="gcode-hl-coord">{token}</span>);
    } else if (/^[SE][-\d.]+$/.test(token)) {
      parts.push(<span key={key++} className="gcode-hl-coord">{token}</span>);
    } else if (token) {
      parts.push(<span key={key++}>{token}</span>);
    }
  }

  if (comment) {
    parts.push(<span key={key++} className="gcode-hl-comment">{comment}</span>);
  }

  return <>{parts}</>;
}

/* ── Toolpath View ─────────────────────────────────────────────────── */

function ToolpathViewer({
  segments,
  step,
  onStepChange,
}: {
  segments: ToolpathSegment[];
  step: number;
  onStepChange: (s: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const bounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of segments) {
      minX = Math.min(minX, s.x1, s.x2);
      minY = Math.min(minY, s.y1, s.y2);
      maxX = Math.max(maxX, s.x1, s.x2);
      maxY = Math.max(maxY, s.y1, s.y2);
    }
    if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 100, maxY: 100, w: 100, h: 100 };
    const pad = Math.max(maxX - minX, maxY - minY) * 0.05 || 5;
    return {
      minX: minX - pad, minY: minY - pad,
      maxX: maxX + pad, maxY: maxY + pad,
      w: maxX - minX + pad * 2, h: maxY - minY + pad * 2,
    };
  }, [segments]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const displayW = canvas.clientWidth;
    const displayH = canvas.clientHeight;
    canvas.width = displayW * dpr;
    canvas.height = displayH * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, displayW, displayH);

    const scaleX = (displayW / bounds.w) * zoom;
    const scaleY = (displayH / bounds.h) * zoom;
    const scale = Math.min(scaleX, scaleY);

    ctx.save();
    ctx.translate(offset.x + displayW / 2, offset.y + displayH / 2);
    ctx.scale(scale, scale);
    ctx.translate(-(bounds.minX + bounds.w / 2), -(bounds.minY + bounds.h / 2));

    const maxIdx = step < 0 ? segments.length : step;
    for (let i = 0; i < maxIdx && i < segments.length; i++) {
      const s = segments[i];
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.strokeStyle = s.rapid ? '#ff3366' : '#00f0ff';
      ctx.lineWidth = (s.rapid ? 0.3 : 0.6) / scale;
      ctx.stroke();
    }

    ctx.restore();
  }, [segments, bounds, zoom, offset, step]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.min(Math.max(z * delta, 0.1), 20));
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
    const up = () => { dragRef.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  return (
    <div className="gcode-toolpath">
      <div className="gcode-toolpath__controls">
        <button className="gcode-toolpath__btn" onClick={() => setZoom((z) => Math.min(z * 1.25, 20))}>+</button>
        <button className="gcode-toolpath__btn" onClick={() => setZoom((z) => Math.max(z * 0.8, 0.1))}>−</button>
        <button className="gcode-toolpath__btn" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}>⊡</button>
        <span className="gcode-toolpath__info">{segments.length} moves</span>
      </div>
      <div
        className="gcode-toolpath__canvas-wrap"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
      >
        <canvas ref={canvasRef} className="gcode-toolpath__canvas" />
      </div>
      <div className="gcode-toolpath__scrubber">
        <label className="gcode-toolpath__scrubber-label">
          STEP
          <input
            type="range"
            className="gcode-toolpath__slider"
            min={-1}
            max={segments.length}
            value={step}
            onChange={(e) => onStepChange(parseInt(e.target.value, 10))}
          />
          <span className="gcode-toolpath__step-val">
            {step < 0 ? 'ALL' : `${step}/${segments.length}`}
          </span>
        </label>
      </div>
      <div className="gcode-toolpath__legend">
        <span className="gcode-toolpath__legend-rapid">■ Rapid (G0)</span>
        <span className="gcode-toolpath__legend-feed">■ Feed (G1)</span>
      </div>
    </div>
  );
}
