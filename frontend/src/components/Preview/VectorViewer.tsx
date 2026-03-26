import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import './VectorViewer.css';

interface VectorViewerProps {
  data: unknown;
}

interface PathData {
  points: number[][];
  visible: boolean;
}

const PATH_COLORS = [
  '#00f0ff', '#ff00aa', '#ffaa00', '#00ff88',
  '#ff3366', '#66ffcc', '#ff6633', '#33ccff',
  '#cc66ff', '#ffcc33', '#33ff66', '#ff3399',
];

export default function VectorViewer({ data }: VectorViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [paths, setPaths] = useState<PathData[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    if (!Array.isArray(data)) return;
    const parsed: PathData[] = (data as number[][][]).map((pts) => ({
      points: pts,
      visible: true,
    }));
    setPaths(parsed);
  }, [data]);

  const bounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of paths) {
      for (const pt of p.points) {
        if (pt[0] < minX) minX = pt[0];
        if (pt[1] < minY) minY = pt[1];
        if (pt[0] > maxX) maxX = pt[0];
        if (pt[1] > maxY) maxY = pt[1];
      }
    }
    if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const pad = Math.max((maxX - minX), (maxY - minY)) * 0.05;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }, [paths]);

  const viewBox = `${bounds.minX} ${bounds.minY} ${bounds.maxX - bounds.minX} ${bounds.maxY - bounds.minY}`;

  const togglePath = useCallback((idx: number) => {
    setPaths((prev) => prev.map((p, i) =>
      i === idx ? { ...p, visible: !p.visible } : p
    ));
  }, []);

  const toggleAll = useCallback(() => {
    const allVisible = paths.every((p) => p.visible);
    setPaths((prev) => prev.map((p) => ({ ...p, visible: !allVisible })));
  }, [paths]);

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

  const totalPoints = paths.reduce((s, p) => s + p.points.length, 0);

  return (
    <div className="vector-viewer">
      <div className="vector-viewer__toolbar">
        <button className="vector-viewer__btn" onClick={() => setZoom((z) => Math.min(z * 1.25, 20))}>+</button>
        <button className="vector-viewer__btn" onClick={() => setZoom((z) => Math.max(z * 0.8, 0.1))}>−</button>
        <button className="vector-viewer__btn" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}>⊡</button>
        <span className="vector-viewer__zoom">{(zoom * 100).toFixed(0)}%</span>
        <span className="vector-viewer__stats">
          {paths.length} paths · {totalPoints} pts
        </span>
      </div>

      <div
        className="vector-viewer__viewport"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
      >
        <svg
          ref={svgRef}
          className="vector-viewer__svg"
          viewBox={viewBox}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          }}
        >
          {paths.map((path, idx) =>
            path.visible && path.points.length > 1 ? (
              <polyline
                key={idx}
                points={path.points.map((p) => `${p[0]},${p[1]}`).join(' ')}
                fill="none"
                stroke={PATH_COLORS[idx % PATH_COLORS.length]}
                strokeWidth={Math.max(0.5 / zoom, 0.2)}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null
          )}
        </svg>
      </div>

      {paths.length > 0 && paths.length <= 50 && (
        <div className="vector-viewer__legend">
          <button className="vector-viewer__legend-toggle" onClick={toggleAll}>
            {paths.every((p) => p.visible) ? '☑' : '☐'} ALL
          </button>
          {paths.map((path, idx) => (
            <button
              key={idx}
              className={`vector-viewer__legend-item ${path.visible ? '' : 'vector-viewer__legend-item--hidden'}`}
              onClick={() => togglePath(idx)}
              style={{ borderLeftColor: PATH_COLORS[idx % PATH_COLORS.length] }}
            >
              <span
                className="vector-viewer__legend-swatch"
                style={{ background: PATH_COLORS[idx % PATH_COLORS.length] }}
              />
              Path {idx + 1} ({path.points.length})
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
