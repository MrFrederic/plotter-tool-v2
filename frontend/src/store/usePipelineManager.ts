import { create } from 'zustand';
import useFlowStore, {
  type SerializedNode,
  type SerializedEdge,
  START_NODE_ID,
  END_NODE_ID,
} from './useFlowStore';
import usePipelineStore from './usePipelineStore';

const STORAGE_KEY = 'plotter-pipelines';

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `p_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function defaultSnapshot(): { nodes: SerializedNode[]; edges: SerializedEdge[] } {
  return {
    nodes: [
      {
        id: START_NODE_ID,
        type: 'start',
        position: { x: 80, y: 200 },
        data: {
          label: 'PIPELINE INPUT',
          pluginName: 'Pipeline Input',
          category: 'Flow',
          params: {},
          nodeKind: 'start',
        },
      },
      {
        id: END_NODE_ID,
        type: 'end',
        position: { x: 800, y: 200 },
        data: {
          label: 'PIPELINE OUTPUT',
          pluginName: 'Pipeline Output',
          category: 'Flow',
          params: {},
          nodeKind: 'end',
        },
      },
    ],
    edges: [],
  };
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface SavedPipeline {
  id: string;
  name: string;
  nodes: SerializedNode[];
  edges: SerializedEdge[];
  createdAt: string;
  updatedAt: string;
}

interface PipelineManagerState {
  pipelines: SavedPipeline[];
  activePipelineId: string;
  init: () => void;
  saveCurrentPipeline: () => void;
  createPipeline: (name?: string) => string;
  switchPipeline: (id: string) => void;
  deletePipeline: (id: string) => void;
  renamePipeline: (id: string, name: string) => void;
  exportPipeline: (id: string) => void;
  exportAllPipelines: () => void;
  importPipelines: (data: unknown) => void;
  _persist: () => void;
}

function isValidPipeline(obj: unknown): obj is { nodes: unknown[]; edges: unknown[]; name?: string } {
  if (typeof obj !== 'object' || obj === null) return false;
  const record = obj as Record<string, unknown>;
  if (!Array.isArray(record.nodes) || !Array.isArray(record.edges)) return false;
  if (record.name !== undefined && typeof record.name !== 'string') return false;
  const nodesValid = record.nodes.every(
    (n: unknown) =>
      typeof n === 'object' &&
      n !== null &&
      typeof (n as Record<string, unknown>).id === 'string' &&
      typeof (n as Record<string, unknown>).type === 'string' &&
      typeof (n as Record<string, unknown>).position === 'object' &&
      typeof (n as Record<string, unknown>).data === 'object',
  );
  const edgesValid = record.edges.every(
    (e: unknown) =>
      typeof e === 'object' &&
      e !== null &&
      typeof (e as Record<string, unknown>).id === 'string' &&
      typeof (e as Record<string, unknown>).source === 'string' &&
      typeof (e as Record<string, unknown>).target === 'string',
  );
  return nodesValid && edgesValid;
}

const usePipelineManager = create<PipelineManagerState>((set, get) => ({
  pipelines: [],
  activePipelineId: '',

  init: () => {
    let pipelines: SavedPipeline[] = [];
    let activePipelineId = '';

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.pipelines) && parsed.pipelines.length > 0) {
          pipelines = parsed.pipelines;
          activePipelineId = parsed.activePipelineId || pipelines[0].id;
        }
      }
    } catch {
      // corrupted storage, start fresh
    }

    if (pipelines.length === 0) {
      const snapshot = useFlowStore.getState().getSnapshot();
      const id = generateId();
      const now = new Date().toISOString();
      const name = usePipelineStore.getState().pipelineName || 'Untitled Pipeline';
      pipelines = [
        {
          id,
          name,
          nodes: snapshot.nodes,
          edges: snapshot.edges,
          createdAt: now,
          updatedAt: now,
        },
      ];
      activePipelineId = id;
    }

    const active = pipelines.find((p) => p.id === activePipelineId) || pipelines[0];
    activePipelineId = active.id;

    set({ pipelines, activePipelineId });
    usePipelineStore.getState().setPipelineName(active.name);
    useFlowStore.getState().loadSnapshot({ nodes: active.nodes, edges: active.edges });
    get()._persist();
  },

  saveCurrentPipeline: () => {
    const { pipelines, activePipelineId } = get();
    const snapshot = useFlowStore.getState().getSnapshot();
    const name = usePipelineStore.getState().pipelineName;
    const now = new Date().toISOString();

    const updated = pipelines.map((p) =>
      p.id === activePipelineId
        ? { ...p, name, nodes: snapshot.nodes, edges: snapshot.edges, updatedAt: now }
        : p,
    );

    set({ pipelines: updated });
    get()._persist();
  },

  createPipeline: (name) => {
    get().saveCurrentPipeline();

    const id = generateId();
    const now = new Date().toISOString();
    const pipelineName = name || 'Untitled Pipeline';
    const snap = defaultSnapshot();

    const newPipeline: SavedPipeline = {
      id,
      name: pipelineName,
      nodes: snap.nodes,
      edges: snap.edges,
      createdAt: now,
      updatedAt: now,
    };

    set({
      pipelines: [...get().pipelines, newPipeline],
      activePipelineId: id,
    });

    useFlowStore.getState().loadSnapshot(snap);
    usePipelineStore.getState().setPipelineName(pipelineName);
    usePipelineStore.getState().newSession();
    get()._persist();

    return id;
  },

  switchPipeline: (id) => {
    const { activePipelineId } = get();
    if (id === activePipelineId) return;

    get().saveCurrentPipeline();

    const target = get().pipelines.find((p) => p.id === id);
    if (!target) return;

    set({ activePipelineId: id });
    useFlowStore.getState().loadSnapshot({ nodes: target.nodes, edges: target.edges });
    usePipelineStore.getState().setPipelineName(target.name);
    usePipelineStore.getState().newSession();
    usePipelineStore.getState().clearTelemetry();
    get()._persist();
  },

  deletePipeline: (id) => {
    const { pipelines, activePipelineId } = get();
    if (pipelines.length <= 1) return;

    if (id === activePipelineId) {
      const idx = pipelines.findIndex((p) => p.id === id);
      const nextIdx = idx > 0 ? idx - 1 : 1;
      const next = pipelines[nextIdx];
      set({
        pipelines: pipelines.filter((p) => p.id !== id),
        activePipelineId: next.id,
      });
      useFlowStore.getState().loadSnapshot({ nodes: next.nodes, edges: next.edges });
      usePipelineStore.getState().setPipelineName(next.name);
      usePipelineStore.getState().newSession();
      usePipelineStore.getState().clearTelemetry();
    } else {
      set({ pipelines: pipelines.filter((p) => p.id !== id) });
    }

    get()._persist();
  },

  renamePipeline: (id, name) => {
    const { pipelines, activePipelineId } = get();
    const now = new Date().toISOString();
    set({
      pipelines: pipelines.map((p) => (p.id === id ? { ...p, name, updatedAt: now } : p)),
    });
    if (id === activePipelineId) {
      usePipelineStore.getState().setPipelineName(name);
    }
    get()._persist();
  },

  exportPipeline: (id) => {
    get().saveCurrentPipeline();
    const pipeline = get().pipelines.find((p) => p.id === id);
    if (!pipeline) return;

    const blob = new Blob([JSON.stringify(pipeline, null, 2)], { type: 'application/json' });
    triggerDownload(blob, `${pipeline.name}.json`);
  },

  exportAllPipelines: () => {
    get().saveCurrentPipeline();
    const { pipelines } = get();
    const blob = new Blob([JSON.stringify(pipelines, null, 2)], { type: 'application/json' });
    triggerDownload(blob, 'pipelines-export.json');
  },

  importPipelines: (data) => {
    const items: unknown[] = Array.isArray(data) ? data : [data];
    const now = new Date().toISOString();
    const imported: SavedPipeline[] = [];

    for (const item of items) {
      if (!isValidPipeline(item)) continue;
      imported.push({
        id: generateId(),
        name: item.name || 'Imported Pipeline',
        nodes: item.nodes as SerializedNode[],
        edges: item.edges as SerializedEdge[],
        createdAt: now,
        updatedAt: now,
      });
    }

    if (imported.length === 0) return;

    set({
      pipelines: [...get().pipelines, ...imported],
    });
    get()._persist();
    get().switchPipeline(imported[0].id);
  },

  _persist: () => {
    const { pipelines, activePipelineId } = get();
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ pipelines, activePipelineId }),
      );
    } catch {
      // storage full or unavailable
    }
  },
}));

export default usePipelineManager;
