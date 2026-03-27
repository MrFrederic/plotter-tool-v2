import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './SvgViewer.css';
import MmRuler from './MmRuler';

const UNIT_TO_MM: Record<string, number> = {
  mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6,
};

function parsePhysicalValue(attr: string | null): { value: number; unit: string } | null {
  if (!attr) return null;
  const m = attr.match(/^([\d.]+)\s*(mm|cm|in|pt|pc)$/i);
  if (!m) return null;
  return { value: parseFloat(m[1]), unit: m[2].toLowerCase() };
}

function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\s(href|xlink:href)\s*=\s*(['"])https?:\/\/.*?\2/gi, '');
}

function parseSvgData(data: unknown, canvasGeometryThreshold: number): ParsedSvg {
  if (!data || typeof data !== 'string') {
    return {
      error: 'Invalid input: expected SVG string',
      content: '',
      width: 100,
      height: 100,
      elementCount: 0,
      geometryCount: 0,
      useCanvasMode: false,
      mmPerUnit: null,
    };
  }

  try {
    const parser = new DOMParser();
    const sanitized = sanitizeSvg(data);
    const doc = parser.parseFromString(sanitized, 'image/svg+xml');

    if (doc.getElementsByTagName('parsererror').length > 0) {
      return {
        error: 'Invalid SVG: malformed XML',
        content: '',
        width: 100,
        height: 100,
        elementCount: 0,
        geometryCount: 0,
        useCanvasMode: false,
        mmPerUnit: null,
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
        geometryCount: 0,
        useCanvasMode: false,
        mmPerUnit: null,
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

    const geometryCount = [
      'path',
      'line',
      'polyline',
      'polygon',
      'circle',
      'ellipse',
      'rect',
      'use',
    ].reduce((count, tag) => count + svgElement.getElementsByTagName(tag).length, 0);

    let mmPerUnit: number | null = null;
    const rawWidthAttr = svgElement.getAttribute('width');
    const rawHeightAttr = svgElement.getAttribute('height');
    const physW = parsePhysicalValue(rawWidthAttr);
    const physH = parsePhysicalValue(rawHeightAttr);
    if (physW && physH) {
      const physWmm = physW.value * UNIT_TO_MM[physW.unit];
      if (width > 0) {
        mmPerUnit = physWmm / width;
      }
    }

    return {
      error: null,
      content: sanitized,
      width,
      height,
      elementCount: svgElement.getElementsByTagName('*').length,
      geometryCount,
      useCanvasMode: geometryCount >= canvasGeometryThreshold,
      mmPerUnit,
    };
  } catch (err) {
    return {
      error: `Parse error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      content: '',
      width: 100,
      height: 100,
      elementCount: 0,
      geometryCount: 0,
      useCanvasMode: false,
      mmPerUnit: null,
    };
  }
}

interface SvgViewerProps {
  data: unknown;
}

interface ParsedSvg {
  error: string | null;
  content: string;
  width: number;
  height: number;
  elementCount: number;
  geometryCount: number;
  useCanvasMode: boolean;
  mmPerUnit: number | null;
}

interface CameraState {
  zoom: number;
  panX: number;
  panY: number;
}

const SVG_CANVAS_GEOMETRY_THRESHOLD = 8000;
const INTERACTION_IDLE_MS = 140;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export default function SvgViewer({ data }: SvgViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const idleTimeoutRef = useRef<number | null>(null);
  const isInteractingRef = useRef(false);

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('svgViewerTheme') as 'dark' | 'light') || 'dark';
  });
  const [zoom, setZoom] = useState(1);
  const [domOffset, setDomOffset] = useState({ x: 0, y: 0 });
  const [panState, setPanState] = useState({ x: 0, y: 0 });
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });
  const [bitmapError, setBitmapError] = useState<string | null>(null);
  const [bitmapReady, setBitmapReady] = useState(false);

  const cameraRef = useRef<CameraState>({ zoom: 1, panX: 0, panY: 0 });
  const bitmapRef = useRef<ImageBitmap | null>(null);

  const parsed = useMemo(() => parseSvgData(data, SVG_CANVAS_GEOMETRY_THRESHOLD), [data]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setViewportSize({ w: Math.round(width), h: Math.round(height) });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    localStorage.setItem('svgViewerTheme', theme);
  }, [theme]);

  const scheduleCanvasDraw = useCallback(() => {
    if (rafRef.current != null) return;

    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;

      if (!bitmapRef.current) return;

      const viewport = viewportRef.current;
      const canvas = canvasRef.current;
      if (!viewport || !canvas) return;

      const rect = viewport.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      const dpr = window.devicePixelRatio || 1;

      const targetWidth = Math.floor(width * dpr);
      const targetHeight = Math.floor(height * dpr);
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const fitScale = Math.min((width * 0.9) / parsed.width, (height * 0.9) / parsed.height);
      const scale = fitScale * cameraRef.current.zoom;
      const drawWidth = parsed.width * scale;
      const drawHeight = parsed.height * scale;
      const drawX = width / 2 - drawWidth / 2 + cameraRef.current.panX;
      const drawY = height / 2 - drawHeight / 2 + cameraRef.current.panY;

      if (theme === 'light') {
        ctx.fillStyle = '#d4d9de';
        ctx.fillRect(0, 0, width, height);
      }

      ctx.drawImage(bitmapRef.current, drawX, drawY, drawWidth, drawHeight);
    });
  }, [parsed.height, parsed.width, theme]);

  useEffect(() => {
    cameraRef.current = { zoom: 1, panX: 0, panY: 0 };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setZoom(1);
    setDomOffset({ x: 0, y: 0 });
    setBitmapError(null);
  }, [data]);

  useEffect(() => {
    let cancelled = false;

    const buildBitmap = async () => {
      if (!parsed.useCanvasMode || !parsed.content || parsed.error) {
        if (bitmapRef.current) {
          bitmapRef.current.close();
          bitmapRef.current = null;
        }
        setBitmapError(null);
        setBitmapReady(false);
        return;
      }

      try {
        const blob = new Blob([parsed.content], { type: 'image/svg+xml;charset=utf-8' });
        const bitmap = await Promise.race([
          createImageBitmap(blob),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Bitmap creation timeout')), 5000),
          ),
        ]);
        if (cancelled) {
          bitmap.close();
          return;
        }

        if (bitmapRef.current) bitmapRef.current.close();
        bitmapRef.current = bitmap;
        setBitmapError(null);
        setBitmapReady(true);
        scheduleCanvasDraw();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.warn(`SVG bitmap creation failed: ${msg}. Falling back to DOM rendering.`);
        setBitmapError(msg);
        setBitmapReady(false);
        if (bitmapRef.current) {
          bitmapRef.current.close();
          bitmapRef.current = null;
        }
      }
    };

    buildBitmap();

    return () => {
      cancelled = true;
    };
  }, [parsed.content, parsed.error, parsed.useCanvasMode, scheduleCanvasDraw]);

  useEffect(() => {
    if (!parsed.useCanvasMode) return;
    scheduleCanvasDraw();
  }, [parsed.useCanvasMode, theme, scheduleCanvasDraw, zoom]);

  useEffect(() => {
    if (!parsed.useCanvasMode) return;
    const onResize = () => scheduleCanvasDraw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [parsed.useCanvasMode, scheduleCanvasDraw]);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
      if (idleTimeoutRef.current != null) window.clearTimeout(idleTimeoutRef.current);
      if (bitmapRef.current) {
        bitmapRef.current.close();
        bitmapRef.current = null;
      }
    };
  }, []);

  const endInteraction = useCallback(() => {
    dragRef.current = null;
    if (!isInteractingRef.current) return;

    if (idleTimeoutRef.current != null) {
      window.clearTimeout(idleTimeoutRef.current);
    }

    idleTimeoutRef.current = window.setTimeout(() => {
      isInteractingRef.current = false;
      scheduleCanvasDraw();
    }, INTERACTION_IDLE_MS);
  }, [scheduleCanvasDraw]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    if (idleTimeoutRef.current != null) {
      window.clearTimeout(idleTimeoutRef.current);
      idleTimeoutRef.current = null;
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
    if (!bitmapRef.current) {
      setDomOffset({ x: cameraRef.current.panX, y: cameraRef.current.panY });
    }
    setPanState({ x: cameraRef.current.panX, y: cameraRef.current.panY });
    scheduleCanvasDraw();
  }, [scheduleCanvasDraw]);

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

    const rect = viewport.getBoundingClientRect();
    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;

    const prevZoom = cameraRef.current.zoom;
    const nextZoom = clamp(prevZoom * (e.deltaY > 0 ? 0.9 : 1.1), 0.05, 40);
    if (Math.abs(nextZoom - prevZoom) < 0.000001) return;

    if (idleTimeoutRef.current != null) {
      window.clearTimeout(idleTimeoutRef.current);
      idleTimeoutRef.current = null;
    }

    isInteractingRef.current = true;

    const factor = nextZoom / prevZoom;
    cameraRef.current.panX = pointerX - (pointerX - cameraRef.current.panX) * factor;
    cameraRef.current.panY = pointerY - (pointerY - cameraRef.current.panY) * factor;
    cameraRef.current.zoom = nextZoom;
    setZoom(nextZoom);
    if (!bitmapRef.current) {
      setDomOffset({ x: cameraRef.current.panX, y: cameraRef.current.panY });
    }
    setPanState({ x: cameraRef.current.panX, y: cameraRef.current.panY });

    scheduleCanvasDraw();
    endInteraction();
  }, [endInteraction, scheduleCanvasDraw]);

  const resetView = useCallback(() => {
    cameraRef.current = { zoom: 1, panX: 0, panY: 0 };
    setZoom(1);
    setDomOffset({ x: 0, y: 0 });
    setPanState({ x: 0, y: 0 });
    scheduleCanvasDraw();
  }, [scheduleCanvasDraw]);

  const domTransform = useMemo(
    () => `translate(${domOffset.x}px, ${domOffset.y}px) scale(${zoom})`,
    [domOffset.x, domOffset.y, zoom],
  );

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
        <button className="svg-viewer__btn" onClick={() => {
          cameraRef.current.zoom = clamp(cameraRef.current.zoom * 1.25, 0.05, 40);
          setZoom(cameraRef.current.zoom);
          scheduleCanvasDraw();
        }} title="Zoom in">+</button>
        <button className="svg-viewer__btn" onClick={() => {
          cameraRef.current.zoom = clamp(cameraRef.current.zoom * 0.8, 0.05, 40);
          setZoom(cameraRef.current.zoom);
          scheduleCanvasDraw();
        }} title="Zoom out">−</button>
        <button className="svg-viewer__btn" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} title="Toggle theme">◐</button>
        <button className="svg-viewer__btn" onClick={resetView} title="Reset">⊡</button>
        <span className="svg-viewer__zoom">{(zoom * 100).toFixed(0)}%</span>
        <span className="svg-viewer__stats">{parsed.geometryCount} geom · {parsed.elementCount} elems</span>
      </div>

      <div
        ref={viewportRef}
        className={`svg-viewer__viewport svg-viewer__viewport--${theme}`}
        style={{ position: 'relative' }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {parsed.useCanvasMode && bitmapReady && !bitmapError ? (
          <canvas ref={canvasRef} className="svg-viewer__canvas-bitmap" />
        ) : (
          <div
            className="svg-viewer__canvas"
            style={{
              width: parsed.width,
              height: parsed.height,
              transform: domTransform,
            }}
            dangerouslySetInnerHTML={{ __html: parsed.content }}
          />
        )}
        {parsed.mmPerUnit != null && viewportSize.w > 0 && (() => {
          const fitScale = Math.min(
            (viewportSize.w * 0.9) / parsed.width,
            (viewportSize.h * 0.9) / parsed.height,
          );
          return (
            <MmRuler
              containerWidth={viewportSize.w}
              containerHeight={viewportSize.h}
              mmPerPx={parsed.mmPerUnit / fitScale}
              offsetX={panState.x}
              offsetY={panState.y}
              zoom={zoom}
            />
          );
        })()}
      </div>

      {parsed.useCanvasMode && bitmapReady && !bitmapError && (
        <div className="svg-viewer__hint">HIGH-SCALE MODE ACTIVE · CANVAS RASTER PREVIEW</div>
      )}
    </div>
  );
}
