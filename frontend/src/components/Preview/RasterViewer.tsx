import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import './RasterViewer.css';

interface RasterViewerProps {
  data: unknown;
}

export default function RasterViewer({ data }: RasterViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Synchronously parse array data — no setState needed
  const arrayInfo = useMemo(() => {
    if (!Array.isArray(data) || data.length === 0) return null;
    const rows = data as number[][][] | number[][];
    const height = rows.length;
    const firstRow = rows[0];
    if (!Array.isArray(firstRow)) return null;
    const isGrayscale = typeof firstRow[0] === 'number';
    const width = isGrayscale ? firstRow.length : (firstRow as number[][]).length;
    return { width, height, isGrayscale };
  }, [data]);

  // Load base64 image asynchronously — setState only fires inside img.onload, never synchronously
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (typeof data !== 'string') return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => { if (!cancelled) setLoadedImage(img); };
    img.src = data.startsWith('data:') ? data : `data:image/png;base64,${data}`;
    return () => { cancelled = true; };
  }, [data]);

  // Derived dimensions — no setState
  const dimensions = useMemo(() => {
    if (arrayInfo) return { w: arrayInfo.width, h: arrayInfo.height };
    if (typeof data === 'string' && loadedImage) return { w: loadedImage.width, h: loadedImage.height };
    return { w: 0, h: 0 };
  }, [arrayInfo, loadedImage, data]);

  // Derived format — no setState
  const format = useMemo(() => {
    if (arrayInfo) return arrayInfo.isGrayscale ? 'grayscale' : 'RGB';
    if (typeof data === 'string' && loadedImage) return 'encoded';
    return '';
  }, [arrayInfo, loadedImage, data]);

  // Draw to canvas — pure DOM mutation, no setState
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (typeof data === 'string' && loadedImage) {
      canvas.width = loadedImage.width;
      canvas.height = loadedImage.height;
      ctx.drawImage(loadedImage, 0, 0);
      return;
    }

    if (arrayInfo) {
      const { width, height, isGrayscale } = arrayInfo;
      const rows = data as number[][][] | number[][];
      canvas.width = width;
      canvas.height = height;
      const imageData = ctx.createImageData(width, height);
      for (let y = 0; y < height; y++) {
        const row = rows[y];
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          if (isGrayscale) {
            const v = (row as number[])[x] ?? 0;
            imageData.data[idx] = v;
            imageData.data[idx + 1] = v;
            imageData.data[idx + 2] = v;
          } else {
            const pixel = (row as number[][])[x];
            // OpenCV BGR → RGB
            imageData.data[idx] = pixel[2] ?? 0;
            imageData.data[idx + 1] = pixel[1] ?? 0;
            imageData.data[idx + 2] = pixel[0] ?? 0;
          }
          imageData.data[idx + 3] = 255;
        }
      }
      ctx.putImageData(imageData, 0, 0);
    }
  }, [arrayInfo, loadedImage, data]);

  const fitToViewport = useCallback(() => {
    const container = containerRef.current;
    if (!container || dimensions.w <= 0 || dimensions.h <= 0) return;

    const fitX = (container.clientWidth - 24) / dimensions.w;
    const fitY = (container.clientHeight - 24) / dimensions.h;
    const fitZoom = Math.min(fitX, fitY, 1);

    setZoom(Number.isFinite(fitZoom) && fitZoom > 0 ? fitZoom : 1);
    setOffset({ x: 0, y: 0 });
  }, [dimensions]);

  useEffect(() => {
    if (dimensions.w <= 0 || dimensions.h <= 0) return;
    const raf = window.requestAnimationFrame(() => fitToViewport());
    return () => window.cancelAnimationFrame(raf);
  }, [dimensions, fitToViewport]);

  useEffect(() => {
    const onResize = () => fitToViewport();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fitToViewport]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.min(Math.max(z * delta, 0.1), 10));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: offset.x, origY: offset.y };
  }, [offset]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      setOffset({
        x: dragRef.current.origX + (e.clientX - dragRef.current.startX),
        y: dragRef.current.origY + (e.clientY - dragRef.current.startY),
      });
    };
    const handleMouseUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const resetView = useCallback(() => {
    fitToViewport();
  }, [fitToViewport]);

  return (
    <div className="raster-viewer">
      <div className="raster-viewer__toolbar">
        <button className="raster-viewer__btn" onClick={() => setZoom((z) => Math.min(z * 1.25, 10))}>+</button>
        <button className="raster-viewer__btn" onClick={() => setZoom((z) => Math.max(z * 0.8, 0.1))}>−</button>
        <button className="raster-viewer__btn" onClick={resetView}>⊡</button>
        <span className="raster-viewer__zoom">{(zoom * 100).toFixed(0)}%</span>
      </div>
      <div
        ref={containerRef}
        className="raster-viewer__viewport"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
      >
        <canvas
          ref={canvasRef}
          className="raster-viewer__canvas"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          }}
        />
      </div>
      <div className="raster-viewer__info">
        <span>{dimensions.w}×{dimensions.h}</span>
        {format && <span className="raster-viewer__format">{format}</span>}
      </div>
    </div>
  );
}
