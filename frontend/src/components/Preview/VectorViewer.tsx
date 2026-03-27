import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  length: number;
}

interface ArcSegment {
  type: 'arc';
  from: [number, number];
  to: [number, number];
  center: [number, number];
  clockwise: boolean;
  meta: SegmentMeta;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  radius: number;
}

type Segment = LineSegment | ArcSegment;

interface PathBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface NormalizedPath {
  closed: boolean;
  segments: Segment[];
  bounds: PathBounds;
}

interface PreprocessResult {
  paths: NormalizedPath[];
  totalSegments: number;
  bounds: PathBounds;
}

interface CameraState {
  zoom: number;
  panX: number;
  panY: number;
}

interface ViewportSize {
  width: number;
  height: number;
}

const PATH_COLORS = [
  '#00f0ff', '#ff00aa', '#ffaa00', '#00ff88',
  '#ff3366', '#66ffcc', '#ff6633', '#33ccff',
  '#cc66ff', '#ffcc33', '#33ff66', '#ff3399',
];

const EMPTY_BOUNDS: PathBounds = {
  minX: 0,
  minY: 0,
  maxX: 100,
  maxY: 100,
};

const INTERACTION_IDLE_MS = 140;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isBoundsVisible(
  bounds: PathBounds,
  camera: CameraState,
  sceneCenterX: number,
  sceneCenterY: number,
  scale: number,
  viewport: ViewportSize,
): boolean {
  const minScreenX = (bounds.minX - sceneCenterX) * scale + viewport.width / 2 + camera.panX;
  const maxScreenX = (bounds.maxX - sceneCenterX) * scale + viewport.width / 2 + camera.panX;
  const minScreenY = (bounds.minY - sceneCenterY) * scale + viewport.height / 2 + camera.panY;
  const maxScreenY = (bounds.maxY - sceneCenterY) * scale + viewport.height / 2 + camera.panY;

  return !(maxScreenX < 0 || minScreenX > viewport.width || maxScreenY < 0 || minScreenY > viewport.height);
}

function arcAngles(segment: ArcSegment): { start: number; end: number; anticlockwise: boolean } {
  const start = Math.atan2(segment.from[1] - segment.center[1], segment.from[0] - segment.center[0]);
  const end = Math.atan2(segment.to[1] - segment.center[1], segment.to[0] - segment.center[0]);
  return {
    start,
    end,
    anticlockwise: !segment.clockwise,
  };
}

export default function VectorViewer({ data }: VectorViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const rafRef = useRef<number | null>(null);
  const interactionTimeoutRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const isInteractingRef = useRef(false);

  const [preprocessed, setPreprocessed] = useState<PreprocessResult>({
    paths: [],
    totalSegments: 0,
    bounds: EMPTY_BOUNDS,
  });
  const [hiddenPathIndexes, setHiddenPathIndexes] = useState<Set<number>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [drawStats, setDrawStats] = useState({ visiblePaths: 0, drawnSegments: 0 });

  const cameraRef = useRef<CameraState>({ zoom: 1, panX: 0, panY: 0 });

  const visiblePaths = useMemo(
    () => preprocessed.paths.map((path, index) => ({ path, visible: !hiddenPathIndexes.has(index), index })),
    [preprocessed.paths, hiddenPathIndexes],
  );

  const sceneMetrics = useMemo(() => {
    const sceneWidth = Math.max(1, preprocessed.bounds.maxX - preprocessed.bounds.minX);
    const sceneHeight = Math.max(1, preprocessed.bounds.maxY - preprocessed.bounds.minY);
    return {
      centerX: (preprocessed.bounds.minX + preprocessed.bounds.maxX) / 2,
      centerY: (preprocessed.bounds.minY + preprocessed.bounds.maxY) / 2,
      sceneWidth,
      sceneHeight,
    };
  }, [preprocessed.bounds]);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;

      const canvas = canvasRef.current;
      const viewport = viewportRef.current;
      if (!canvas || !viewport) return;

      const rect = viewport.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      const dpr = window.devicePixelRatio || 1;

      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const viewportSize: ViewportSize = { width, height };
      const fitScale = Math.min(
        (width * 0.9) / sceneMetrics.sceneWidth,
        (height * 0.9) / sceneMetrics.sceneHeight,
      );
      const effectiveScale = Math.max(0.00001, fitScale * cameraRef.current.zoom);
      const lodThreshold = isInteractingRef.current
        ? Math.max(1, 1.35 / effectiveScale)
        : Math.max(0.3, 0.5 / effectiveScale);

      let visibleCount = 0;
      let drawnSegments = 0;

      for (const { path, visible, index } of visiblePaths) {
        if (!visible || path.segments.length === 0) continue;
        if (!isBoundsVisible(path.bounds, cameraRef.current, sceneMetrics.centerX, sceneMetrics.centerY, effectiveScale, viewportSize)) {
          continue;
        }

        visibleCount += 1;
        ctx.beginPath();

        for (const segment of path.segments) {
          if (!isBoundsVisible(segment, cameraRef.current, sceneMetrics.centerX, sceneMetrics.centerY, effectiveScale, viewportSize)) {
            continue;
          }

          if (segment.type === 'line' && segment.length < lodThreshold) {
            continue;
          }
          if (segment.type === 'arc' && segment.radius * 2 < lodThreshold) {
            continue;
          }

          const fromX = (segment.from[0] - sceneMetrics.centerX) * effectiveScale + width / 2 + cameraRef.current.panX;
          const fromY = (segment.from[1] - sceneMetrics.centerY) * effectiveScale + height / 2 + cameraRef.current.panY;

          if (segment.type === 'line') {
            const toX = (segment.to[0] - sceneMetrics.centerX) * effectiveScale + width / 2 + cameraRef.current.panX;
            const toY = (segment.to[1] - sceneMetrics.centerY) * effectiveScale + height / 2 + cameraRef.current.panY;
            ctx.moveTo(fromX, fromY);
            ctx.lineTo(toX, toY);
            drawnSegments += 1;
            continue;
          }

          const centerX = (segment.center[0] - sceneMetrics.centerX) * effectiveScale + width / 2 + cameraRef.current.panX;
          const centerY = (segment.center[1] - sceneMetrics.centerY) * effectiveScale + height / 2 + cameraRef.current.panY;
          const radius = segment.radius * effectiveScale;
          const angles = arcAngles(segment);
          const start = Math.atan2(fromY - centerY, fromX - centerX);
          const toX = (segment.to[0] - sceneMetrics.centerX) * effectiveScale + width / 2 + cameraRef.current.panX;
          const toY = (segment.to[1] - sceneMetrics.centerY) * effectiveScale + height / 2 + cameraRef.current.panY;
          const end = Math.atan2(toY - centerY, toX - centerX);

          ctx.moveTo(fromX, fromY);
          ctx.arc(centerX, centerY, radius, start, end, angles.anticlockwise);
          drawnSegments += 1;
        }

        if (path.closed && path.segments.length > 1) {
          const first = path.segments[0].from;
          const closeX = (first[0] - sceneMetrics.centerX) * effectiveScale + width / 2 + cameraRef.current.panX;
          const closeY = (first[1] - sceneMetrics.centerY) * effectiveScale + height / 2 + cameraRef.current.panY;
          ctx.lineTo(closeX, closeY);
        }

        ctx.strokeStyle = PATH_COLORS[index % PATH_COLORS.length];
        ctx.lineWidth = isInteractingRef.current ? 1 : 1.2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      setDrawStats((prev) => {
        if (prev.visiblePaths === visibleCount && prev.drawnSegments === drawnSegments) {
          return prev;
        }
        return { visiblePaths: visibleCount, drawnSegments };
      });
    });
  }, [sceneMetrics.centerX, sceneMetrics.centerY, sceneMetrics.sceneHeight, sceneMetrics.sceneWidth, visiblePaths]);

  useEffect(() => {
    const worker = new Worker(new URL('./workers/vectorPreprocess.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<{ requestId: number; payload: PreprocessResult }>) => {
      if (event.data.requestId !== requestIdRef.current) return;
      setPreprocessed(event.data.payload);
      setHiddenPathIndexes(new Set());
      cameraRef.current = { zoom: 1, panX: 0, panY: 0 };
      setZoom(1);
      scheduleDraw();
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [scheduleDraw]);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;

    requestIdRef.current += 1;
    worker.postMessage({ requestId: requestIdRef.current, data });
  }, [data]);

  useEffect(() => {
    scheduleDraw();
  }, [scheduleDraw, hiddenPathIndexes]);

  useEffect(() => {
    const onResize = () => scheduleDraw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [scheduleDraw]);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
      }
      if (interactionTimeoutRef.current != null) {
        window.clearTimeout(interactionTimeoutRef.current);
      }
    };
  }, []);

  const endInteraction = useCallback(() => {
    dragRef.current = null;
    if (!isInteractingRef.current) return;

    if (interactionTimeoutRef.current != null) {
      window.clearTimeout(interactionTimeoutRef.current);
    }

    interactionTimeoutRef.current = window.setTimeout(() => {
      isInteractingRef.current = false;
      scheduleDraw();
    }, INTERACTION_IDLE_MS);
  }, [scheduleDraw]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    if (interactionTimeoutRef.current != null) {
      window.clearTimeout(interactionTimeoutRef.current);
      interactionTimeoutRef.current = null;
    }

    isInteractingRef.current = true;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      panX: cameraRef.current.panX,
      panY: cameraRef.current.panY,
    };
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    cameraRef.current.panX = dragRef.current.panX + (e.clientX - dragRef.current.startX);
    cameraRef.current.panY = dragRef.current.panY + (e.clientY - dragRef.current.startY);
    scheduleDraw();
  }, [scheduleDraw]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    endInteraction();
  }, [endInteraction]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();

    const viewport = viewportRef.current;
    if (!viewport) return;

    if (interactionTimeoutRef.current != null) {
      window.clearTimeout(interactionTimeoutRef.current);
      interactionTimeoutRef.current = null;
    }

    isInteractingRef.current = true;

    const rect = viewport.getBoundingClientRect();
    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;

    const prevZoom = cameraRef.current.zoom;
    const nextZoom = clamp(prevZoom * (e.deltaY > 0 ? 0.9 : 1.1), 0.05, 40);
    if (Math.abs(nextZoom - prevZoom) < 0.000001) return;

    const factor = nextZoom / prevZoom;
    cameraRef.current.panX = pointerX - (pointerX - cameraRef.current.panX) * factor;
    cameraRef.current.panY = pointerY - (pointerY - cameraRef.current.panY) * factor;
    cameraRef.current.zoom = nextZoom;
    setZoom(nextZoom);

    scheduleDraw();
    endInteraction();
  }, [endInteraction, scheduleDraw]);

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
    setHiddenPathIndexes(allVisible ? new Set(preprocessed.paths.map((_, index) => index)) : new Set());
  }, [preprocessed.paths, visiblePaths]);

  const resetView = useCallback(() => {
    cameraRef.current = { zoom: 1, panX: 0, panY: 0 };
    setZoom(1);
    scheduleDraw();
  }, [scheduleDraw]);

  return (
    <div className="vector-viewer">
      <div className="vector-viewer__toolbar">
        <button
          className="vector-viewer__btn"
          onClick={() => {
            cameraRef.current.zoom = clamp(cameraRef.current.zoom * 1.25, 0.05, 40);
            setZoom(cameraRef.current.zoom);
            scheduleDraw();
          }}
        >
          +
        </button>
        <button
          className="vector-viewer__btn"
          onClick={() => {
            cameraRef.current.zoom = clamp(cameraRef.current.zoom * 0.8, 0.05, 40);
            setZoom(cameraRef.current.zoom);
            scheduleDraw();
          }}
        >
          −
        </button>
        <button className="vector-viewer__btn" onClick={resetView}>⊡</button>
        <span className="vector-viewer__zoom">{(zoom * 100).toFixed(0)}%</span>
        <span className="vector-viewer__stats">
          {visiblePaths.length} paths · {preprocessed.totalSegments} segs · {drawStats.drawnSegments} drawn
        </span>
      </div>

      <div
        ref={viewportRef}
        className="vector-viewer__viewport"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <canvas ref={canvasRef} className="vector-viewer__canvas" />
      </div>

      {preprocessed.paths.length > 0 && preprocessed.paths.length <= 50 && (
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

      {preprocessed.totalSegments > 150000 && (
        <div className="vector-viewer__hint">INTERACTIVE LOD ACTIVE · FULL DETAIL RESTORES AFTER INPUT IDLE</div>
      )}
    </div>
  );
}
