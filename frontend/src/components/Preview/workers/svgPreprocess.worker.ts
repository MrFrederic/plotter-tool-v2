interface ParsedSvg {
  error: string | null;
  content: string;
  width: number;
  height: number;
  elementCount: number;
  geometryCount: number;
  useCanvasMode: boolean;
}

interface WorkerRequest {
  requestId: number;
  data: unknown;
  canvasGeometryThreshold: number;
}

interface WorkerResponse {
  requestId: number;
  payload: ParsedSvg;
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

    return {
      error: null,
      content: sanitized,
      width,
      height,
      elementCount: svgElement.getElementsByTagName('*').length,
      geometryCount,
      useCanvasMode: geometryCount >= canvasGeometryThreshold,
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
    };
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const payload = parseSvgData(event.data.data, event.data.canvasGeometryThreshold);
  const response: WorkerResponse = {
    requestId: event.data.requestId,
    payload,
  };
  self.postMessage(response);
};
