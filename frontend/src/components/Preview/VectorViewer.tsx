import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import './VectorViewer.css';

interface VectorViewerProps {
  data: unknown;
}

interface SegmentMeta {
  width: number | null;
  speed: number | null;
}

interface LineSegment {
  type: 'line';
  from: [number, number];
  to: [number, number];
  meta: SegmentMeta;
}

interface ArcSegment {
  type: 'arc';
  from: [number, number];
  to: [number, number];
  center: [number, number];
  clockwise: boolean;
  meta: SegmentMeta;
}

type Segment = LineSegment | ArcSegment;

interface NormalizedPath {
  closed: boolean;
  segments: Segment[];
}

const PATH_COLORS = [
  '#00f0ff', '#ff00aa', '#ffaa00', '#00ff88',
  '#ff3366', '#66ffcc', '#ff6633', '#33ccff',
  '#cc66ff', '#ffcc33', '#33ff66', '#ff3399',
];

const DEFAULT_META: SegmentMeta = { width: null, speed: null };

function coerceMeta(raw: unknown): SegmentMeta {
  if (!raw || typeof raw !== 'object') return DEFAULT_META;
  const obj = raw as Record<string, unknown>;
  return {
    width: typeof obj.width === 'number' ? obj.width : null,
    speed: typeof obj.speed === 'number' ? obj.speed : null,
  };
}

function coerceXY(value: unknown): [number, number] {
  if (Array.isArray(value) && value.length >= 2) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    return [Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0];
  }
  return [0, 0];
}

function legacyPointsToPath(points: unknown[]): NormalizedPath {
  const parsedPoints = points.map(coerceXY);
  const segments: LineSegment[] = [];
  for (let index = 0; index < parsedPoints.length - 1; index += 1) {
    segments.push({
      type: 'line',
      from: parsedPoints[index],
      to: parsedPoints[index + 1],
      meta: DEFAULT_META,
    });
  }
  return { closed: false, segments };
}

function parsePath(item: unknown): NormalizedPath {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const obj = item as Record<string, unknown>;
    const closed = obj.closed === true;
    const rawSegments = Array.isArray(obj.segments) ? obj.segments : [];

    const segments: Segment[] = rawSegments.map((raw): Segment => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { type: 'line', from: [0, 0], to: [0, 0], meta: DEFAULT_META };
      }
      const segment = raw as Record<string, unknown>;
      const from = coerceXY(segment.from);
      const to = coerceXY(segment.to);
      const meta = coerceMeta(segment.meta);
      if (segment.type === 'arc') {
        return {
          type: 'arc',
          from,
          to,
          center: coerceXY(segment.center),
          clockwise: segment.clockwise !== false,
          meta,
        };
      }
      return { type: 'line', from, to, meta };
    });

    return { closed, segments };
  }

  if (Array.isArray(item)) {
    return legacyPointsToPath(item as unknown[]);
  }

  return { closed: false, segments: [] };
}

function buildPathD(path: NormalizedPath): string {
  if (path.segments.length === 0) return '';

  const commands: string[] = [];
  let previousTo: [number, number] | null = null;

  for (const segment of path.segments) {
    if (!previousTo || previousTo[0] !== segment.from[0] || previousTo[1] !== segment.from[1]) {
      commands.push(`M ${segment.from[0]} ${segment.from[1]}`);
    }

    if (segment.type === 'line') {
      commands.push(`L ${segment.to[0]} ${segment.to[1]}`);
    } else {
      const dx = segment.from[0] - segment.center[0];
      const dy = segment.from[1] - segment.center[1];
      const radius = Math.sqrt(dx * dx + dy * dy);

      const v1x = segment.from[0] - segment.center[0];
      const v1y = segment.from[1] - segment.center[1];
      const v2x = segment.to[0] - segment.center[0];
      const v2y = segment.to[1] - segment.center[1];
      const cross = v1x * v2y - v1y * v2x;

      const sweepFlag = segment.clockwise ? 1 : 0;
      const largeArcFlag = segment.clockwise ? (cross < 0 ? 1 : 0) : (cross > 0 ? 1 : 0);
      commands.push(`A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${segment.to[0]} ${segment.to[1]}`);
    }

    previousTo = segment.to;
  }

  if (path.closed) {
    commands.push('Z');
  }

  return commands.join(' ');
}

function collectPathPoints(path: NormalizedPath): [number, number][] {
  const points: [number, number][] = [];
  for (const segment of path.segments) {
    points.push(segment.from, segment.to);
    if (segment.type === 'arc') {
      points.push(segment.center);
    }
  }
  return points;
}

export default function VectorViewer({ data }: VectorViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [hiddenPathIndexes, setHiddenPathIndexes] = useState<Set<number>>(new Set());
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const parsedPaths = useMemo(
    () => (Array.isArray(data) ? (data as unknown[]).map(parsePath) : []),
    [data],
  );

  const visiblePaths = useMemo(
    () => parsedPaths.map((path, index) => ({ path, visible: !hiddenPathIndexes.has(index) })),
    [parsedPaths, hiddenPathIndexes],
  );

  const bounds = useMemo(() => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const item of visiblePaths) {
      for (const [x, y] of collectPathPoints(item.path)) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    }

    const pad = Math.max(maxX - minX, maxY - minY) * 0.05;
    return {
      minX: minX - pad,
      minY: minY - pad,
      maxX: maxX + pad,
      maxY: maxY + pad,
    };
  }, [visiblePaths]);

  const togglePath = useCallback((index: number) => {
    setHiddenPathIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    const allVisible = visiblePaths.every((item) => item.visible);
    setHiddenPathIndexes(allVisible ? new Set(parsedPaths.map((_, index) => index)) : new Set());
  }, [parsedPaths, visiblePaths]);

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

  const totalSegments = parsedPaths.reduce((sum, path) => sum + path.segments.length, 0);
  const viewBox = `${bounds.minX} ${bounds.minY} ${bounds.maxX - bounds.minX} ${bounds.maxY - bounds.minY}`;

  return (
    <div className="vector-viewer">
      <div className="vector-viewer__toolbar">
        <button className="vector-viewer__btn" onClick={() => setZoom((currentZoom) => Math.min(currentZoom * 1.25, 20))}>+</button>
        <button className="vector-viewer__btn" onClick={() => setZoom((currentZoom) => Math.max(currentZoom * 0.8, 0.1))}>−</button>
        <button className="vector-viewer__btn" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}>⊡</button>
        <span className="vector-viewer__zoom">{(zoom * 100).toFixed(0)}%</span>
        <span className="vector-viewer__stats">{parsedPaths.length} paths · {totalSegments} segs</span>
      </div>

      <div className="vector-viewer__viewport" onWheel={handleWheel} onMouseDown={handleMouseDown}>
        <svg
          ref={svgRef}
          className="vector-viewer__svg"
          viewBox={viewBox}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          }}
        >
          {visiblePaths.map((item, index) => {
            if (!item.visible || item.path.segments.length === 0) return null;
            const d = buildPathD(item.path);
            if (!d) return null;
            return (
              <path
                key={index}
                d={d}
                fill="none"
                stroke={PATH_COLORS[index % PATH_COLORS.length]}
                strokeWidth={Math.max(0.5 / zoom, 0.2)}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            );
          })}
        </svg>
      </div>

      {parsedPaths.length > 0 && parsedPaths.length <= 50 && (
        <div className="vector-viewer__legend">
          <button className="vector-viewer__legend-toggle" onClick={toggleAll}>
            {visiblePaths.every((item) => item.visible) ? '☑' : '☐'} ALL
          </button>
          {visiblePaths.map((item, index) => (
            <button
              key={index}
              className={`vector-viewer__legend-item ${item.visible ? '' : 'vector-viewer__legend-item--hidden'}`}
              onClick={() => togglePath(index)}
              style={{ borderLeftColor: PATH_COLORS[index % PATH_COLORS.length] }}
            >
              <span className="vector-viewer__legend-swatch" style={{ background: PATH_COLORS[index % PATH_COLORS.length] }} />
              Path {index + 1} ({item.path.segments.length} segs{item.path.closed ? ', closed' : ''})
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

