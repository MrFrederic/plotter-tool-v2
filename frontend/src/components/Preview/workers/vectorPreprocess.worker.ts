interface SegmentMeta {
  width: number | null;
  speed: number | null;
}

interface PathBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
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

interface WorkerRequest {
  requestId: number;
  data: unknown;
}

interface WorkerResponse {
  requestId: number;
  payload: PreprocessResult;
}

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

function emptyBounds(): PathBounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
}

function mergeBounds(into: PathBounds, from: PathBounds): void {
  if (from.minX < into.minX) into.minX = from.minX;
  if (from.minY < into.minY) into.minY = from.minY;
  if (from.maxX > into.maxX) into.maxX = from.maxX;
  if (from.maxY > into.maxY) into.maxY = from.maxY;
}

function finalizeBounds(bounds: PathBounds): PathBounds {
  if (
    Number.isFinite(bounds.minX)
    && Number.isFinite(bounds.minY)
    && Number.isFinite(bounds.maxX)
    && Number.isFinite(bounds.maxY)
  ) {
    const pad = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.03;
    return {
      minX: bounds.minX - pad,
      minY: bounds.minY - pad,
      maxX: bounds.maxX + pad,
      maxY: bounds.maxY + pad,
    };
  }

  return {
    minX: 0,
    minY: 0,
    maxX: 100,
    maxY: 100,
  };
}

function legacyPointsToPath(points: unknown[]): NormalizedPath {
  const parsedPoints = points.map(coerceXY);
  const segments: LineSegment[] = [];
  const pathBounds = emptyBounds();

  for (let index = 0; index < parsedPoints.length - 1; index += 1) {
    const from = parsedPoints[index];
    const to = parsedPoints[index + 1];
    const minX = Math.min(from[0], to[0]);
    const minY = Math.min(from[1], to[1]);
    const maxX = Math.max(from[0], to[0]);
    const maxY = Math.max(from[1], to[1]);

    const dx = to[0] - from[0];
    const dy = to[1] - from[1];

    segments.push({
      type: 'line',
      from,
      to,
      meta: DEFAULT_META,
      minX,
      minY,
      maxX,
      maxY,
      length: Math.sqrt(dx * dx + dy * dy),
    });

    mergeBounds(pathBounds, { minX, minY, maxX, maxY });
  }

  return {
    closed: false,
    segments,
    bounds: finalizeBounds(pathBounds),
  };
}

function parsePath(item: unknown): NormalizedPath {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const obj = item as Record<string, unknown>;
    const closed = obj.closed === true;
    const rawSegments = Array.isArray(obj.segments) ? obj.segments : [];

    const pathBounds = emptyBounds();

    const segments: Segment[] = rawSegments.map((raw): Segment => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return {
          type: 'line',
          from: [0, 0],
          to: [0, 0],
          meta: DEFAULT_META,
          minX: 0,
          minY: 0,
          maxX: 0,
          maxY: 0,
          length: 0,
        };
      }

      const segment = raw as Record<string, unknown>;
      const from = coerceXY(segment.from);
      const to = coerceXY(segment.to);
      const meta = coerceMeta(segment.meta);

      if (segment.type === 'arc') {
        const center = coerceXY(segment.center);
        const dx = from[0] - center[0];
        const dy = from[1] - center[1];
        const radius = Math.sqrt(dx * dx + dy * dy);

        const arcBounds: PathBounds = {
          minX: center[0] - radius,
          minY: center[1] - radius,
          maxX: center[0] + radius,
          maxY: center[1] + radius,
        };

        mergeBounds(pathBounds, arcBounds);

        return {
          type: 'arc',
          from,
          to,
          center,
          clockwise: segment.clockwise !== false,
          meta,
          minX: arcBounds.minX,
          minY: arcBounds.minY,
          maxX: arcBounds.maxX,
          maxY: arcBounds.maxY,
          radius,
        };
      }

      const minX = Math.min(from[0], to[0]);
      const minY = Math.min(from[1], to[1]);
      const maxX = Math.max(from[0], to[0]);
      const maxY = Math.max(from[1], to[1]);
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];

      mergeBounds(pathBounds, { minX, minY, maxX, maxY });

      return {
        type: 'line',
        from,
        to,
        meta,
        minX,
        minY,
        maxX,
        maxY,
        length: Math.sqrt(dx * dx + dy * dy),
      };
    });

    return {
      closed,
      segments,
      bounds: finalizeBounds(pathBounds),
    };
  }

  if (Array.isArray(item)) {
    return legacyPointsToPath(item as unknown[]);
  }

  return {
    closed: false,
    segments: [],
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  };
}

function getPathPayload(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;

  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.paths)) return obj.paths;
    if (Array.isArray(obj.path)) return obj.path;
    if (obj.path != null) return [obj.path];
    if (Array.isArray(obj.PATH)) return obj.PATH;
    if (obj.PATH != null) return [obj.PATH];

    if ('segments' in obj || 'closed' in obj) {
      return [obj];
    }

    return [obj];
  }

  return [];
}

function preprocess(data: unknown): PreprocessResult {
  const rawPaths = getPathPayload(data);
  const paths = rawPaths.map(parsePath);

  let totalSegments = 0;
  const bounds = emptyBounds();

  for (const path of paths) {
    totalSegments += path.segments.length;
    mergeBounds(bounds, path.bounds);
  }

  return {
    paths,
    totalSegments,
    bounds: finalizeBounds(bounds),
  };
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const payload = preprocess(event.data.data);
  const response: WorkerResponse = {
    requestId: event.data.requestId,
    payload,
  };
  self.postMessage(response);
};
