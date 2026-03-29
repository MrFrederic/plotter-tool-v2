import { create } from 'zustand';
import {
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type NodeChange,
} from '@xyflow/react';
import type { NodeStatus, PluginSchema, UploadedFile } from '../types';
import { fetchPlugins } from '../api/rest';
import { computeGraphExecutionState } from '../utils/flowRules';

export interface SerializedNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    label: string;
    pluginName: string;
    category: string;
    params: Record<string, unknown>;
    nodeKind?: 'start' | 'end' | 'process';
  };
}

export interface SerializedEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
}

export interface FlowNodeData extends Record<string, unknown> {
  label: string;
  pluginName: string;
  category: string;
  params: Record<string, unknown>;
  inputs: PluginSchema['inputs'];
  outputs: PluginSchema['outputs'];
  parameters: PluginSchema['parameters'];
  status: NodeStatus;
  schema: PluginSchema;
  nodeKind?: 'start' | 'end' | 'process';
  blocked?: boolean;
}

export interface OutputPreviewSelection {
  nodeId: string;
  outputHandle: string | null;
}

export interface ConnectionDragState {
  nodeId: string;
  handleId: string | null;
  handleType: 'source' | 'target';
}

export const START_NODE_ID = '__start__';
export const END_NODE_ID = '__end__';

const START_SCHEMA: PluginSchema = {
  name: 'Pipeline Input',
  category: 'Flow',
  description: [
    '# Pipeline Input',
    '',
    'Upload a source file and the pipeline will normalize it into the internal data formats used by downstream modules.',
    '',
    '## Notes',
    '',
    '- Populates `file_path` and `file_category` automatically.',
    '- Exposes normalized `image`, `vector`, `gcode`, `path`, `text`, and `other` outputs.',
    '- Access is restricted to uploaded files stored in the cache area.',
  ].join('\n'),
  inputs: [],
  outputs: [
    { name: 'image', type: 'image' },
    { name: 'vector', type: 'vector' },
    { name: 'gcode', type: 'gcode' },
    { name: 'path', type: 'path' },
    { name: 'text', type: 'text' },
    { name: 'other', type: 'other' },
  ],
  parameters: [],
};

const END_SCHEMA: PluginSchema = {
  name: 'Pipeline Output',
  category: 'Flow',
  description: [
    '# Pipeline Output',
    '',
    'Connect any final node output here to expose a downloadable artifact in the settings panel.',
    '',
    '## Notes',
    '',
    '- Accepts any supported pipeline data type.',
    '- Waits for the upstream node to reach `DONE` or `CACHED` status.',
    '- Downloads are generated from the cached node result.',
  ].join('\n'),
  inputs: [
    { name: 'image', type: 'image' },
    { name: 'vector', type: 'vector' },
    { name: 'gcode', type: 'gcode' },
    { name: 'path', type: 'path' },
    { name: 'text', type: 'text' },
    { name: 'other', type: 'other' },
  ],
  outputs: [],
  parameters: [],
};

function makeStartNode(): Node<FlowNodeData> {
  return {
    id: START_NODE_ID,
    type: 'start',
    position: { x: 80, y: 200 },
    data: {
      label: 'PIPELINE INPUT',
      pluginName: 'Pipeline Input',
      category: 'Flow',
      params: {},
      inputs: START_SCHEMA.inputs,
      outputs: START_SCHEMA.outputs,
      parameters: START_SCHEMA.parameters,
      status: 'IDLE',
      schema: START_SCHEMA,
      nodeKind: 'start',
    },
  };
}

function makeEndNode(): Node<FlowNodeData> {
  return {
    id: END_NODE_ID,
    type: 'end',
    position: { x: 800, y: 200 },
    data: {
      label: 'PIPELINE OUTPUT',
      pluginName: 'Pipeline Output',
      category: 'Flow',
      params: {},
      inputs: END_SCHEMA.inputs,
      outputs: END_SCHEMA.outputs,
      parameters: END_SCHEMA.parameters,
      status: 'IDLE',
      schema: END_SCHEMA,
      nodeKind: 'end',
    },
  };
}

interface FlowState {
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  nodeStatuses: Record<string, NodeStatus>;
  nodeErrors: Record<string, string>;
  pluginSchemas: PluginSchema[];
  uploadedFile: UploadedFile | null;
  selectedOutputPreview: OutputPreviewSelection | null;
  connectionDrag: ConnectionDragState | null;
  blockedNodeIds: Set<string>;
  noDataEdgeIds: Set<string>;
  runnableNodeIds: Set<string>;

  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  addNode: (pluginName: string, position: { x: number; y: number }) => void;
  duplicateNode: (nodeId: string) => void;
  deleteSelectedElements: () => void;
  updateNodeParams: (nodeId: string, params: Record<string, unknown>) => void;
  setNodeStatus: (nodeId: string, status: NodeStatus) => void;
  setNodeError: (nodeId: string, error: string | null) => void;
  selectNode: (nodeId: string | null) => void;
  selectEdge: (edgeId: string | null) => void;
  loadPluginSchemas: () => Promise<void>;
  setUploadedFile: (file: UploadedFile | null) => void;
  selectOutputPreview: (selection: OutputPreviewSelection | null) => void;
  setConnectionDrag: (drag: ConnectionDragState) => void;
  clearConnectionDrag: () => void;
  resetExecutionState: () => void;
  removeEdge: (edgeId: string) => void;
  removeNode: (nodeId: string) => void;
  getSnapshot: () => { nodes: SerializedNode[]; edges: SerializedEdge[] };
  loadSnapshot: (snapshot: { nodes: SerializedNode[]; edges: SerializedEdge[] }) => void;
}

const FALLBACK_PLUGINS: PluginSchema[] = [
  {
    name: 'SVG Trace',
    category: 'Processing',
    description: 'Convert raster image to vector paths',
    inputs: [{ name: 'image', type: 'image' }],
    outputs: [{ name: 'paths', type: 'path' }],
    parameters: [
      { name: 'threshold', type: 'number', default: 128, min: 0, max: 255, step: 1 },
      { name: 'smoothing', type: 'number', default: 1.0, min: 0, max: 5, step: 0.1 },
    ],
  },
  {
    name: 'G-code Generator',
    category: 'Output',
    description: 'Generate G-code from vector paths',
    inputs: [{ name: 'paths', type: 'path' }],
    outputs: [{ name: 'gcode', type: 'gcode' }],
    parameters: [
      { name: 'feed_rate', type: 'number', default: 1000, min: 100, max: 5000, step: 50 },
      { name: 'pen_up_height', type: 'number', default: 5, min: 1, max: 20, step: 0.5 },
    ],
  },
  {
    name: 'Threshold Filter',
    category: 'Processing',
    description: 'Apply binary threshold to image',
    inputs: [{ name: 'image', type: 'image' }],
    outputs: [{ name: 'image', type: 'image' }],
    parameters: [
      { name: 'value', type: 'number', default: 128, min: 0, max: 255, step: 1 },
      { name: 'invert', type: 'boolean', default: false },
    ],
  },
  {
    name: 'Path Optimizer',
    category: 'Processing',
    description: 'Optimize path ordering for plotting',
    inputs: [{ name: 'paths', type: 'path' }],
    outputs: [{ name: 'paths', type: 'path' }],
    parameters: [
      { name: 'method', type: 'select', default: 'greedy', options: ['greedy', 'two-opt', 'nearest'] },
    ],
  },
  {
    name: 'Preview Render',
    category: 'Output',
    description: 'Render paths to preview image',
    inputs: [{ name: 'paths', type: 'path' }],
    outputs: [{ name: 'image', type: 'image' }],
    parameters: [
      { name: 'width', type: 'number', default: 800, min: 100, max: 4096, step: 1 },
      { name: 'height', type: 'number', default: 600, min: 100, max: 4096, step: 1 },
      { name: 'line_color', type: 'color', default: '#00f0ff' },
    ],
  },
];

let nodeCounter = 0;

const isSpecialNode = (id: string) => id === START_NODE_ID || id === END_NODE_ID;

const useFlowStore = create<FlowState>((set, get) => ({
  nodes: [makeStartNode(), makeEndNode()],
  edges: [],
  selectedNodeId: null,
  selectedEdgeId: null,
  nodeStatuses: {},
  nodeErrors: {},
  pluginSchemas: [],
  uploadedFile: null,
  selectedOutputPreview: null,
  connectionDrag: null,
  blockedNodeIds: new Set<string>(),
  noDataEdgeIds: new Set<string>(),
  runnableNodeIds: new Set<string>(),

  onNodesChange: (changes) => {
    // Protect start/end nodes from deletion
    const safeChanges = (changes as NodeChange<Node<FlowNodeData>>[]).filter(
      (c) => !(c.type === 'remove' && isSpecialNode(c.id)),
    );
    set({
      nodes: applyNodeChanges(safeChanges, get().nodes),
    });
  },

  onEdgesChange: (changes) => {
    const nextEdges = applyEdgeChanges(changes, get().edges);
    const selectedEdgeId = get().selectedEdgeId;
    const { blockedNodeIds, noDataEdgeIds, runnableNodeIds } = computeGraphExecutionState(
      get().nodes,
      nextEdges,
      (get().nodes.find((n) => n.id === START_NODE_ID)?.data?.params?.file_category as string | undefined) || null,
    );
    set({
      edges: nextEdges,
      selectedEdgeId:
        selectedEdgeId && !nextEdges.some((e) => e.id === selectedEdgeId)
          ? null
          : selectedEdgeId,
      blockedNodeIds,
      noDataEdgeIds,
      runnableNodeIds,
    });
  },

  onConnect: (connection) => {
    if (!connection.source || !connection.target) return;

    // Prevent self-connections
    if (connection.source === connection.target) return;

    // Port type compatibility check
    const sourceNode = get().nodes.find((n) => n.id === connection.source);
    const targetNode = get().nodes.find((n) => n.id === connection.target);
    if (sourceNode && targetNode) {
      const sourcePort = sourceNode.data.outputs.find(
        (p) => p.name === connection.sourceHandle,
      );
      const targetPort = targetNode.data.inputs.find(
        (p) => p.name === connection.targetHandle,
      );
      if (
        sourcePort &&
        targetPort &&
        sourcePort.type !== targetPort.type &&
        sourcePort.type !== 'other' &&
        targetPort.type !== 'other'
      ) {
        return;
      }
    }

    const sameTarget = get().edges.filter(
      (edge) => edge.target === connection.target && edge.targetHandle === connection.targetHandle,
    );

    const duplicate = sameTarget.some(
      (edge) => edge.source === connection.source && edge.sourceHandle === connection.sourceHandle,
    );
    if (duplicate) return;

    const remainingEdges = get().edges.filter(
      (edge) => !(edge.target === connection.target && edge.targetHandle === connection.targetHandle),
    );

    const nextEdges = addEdge({ ...connection, type: 'custom' }, remainingEdges);
    const { blockedNodeIds, noDataEdgeIds, runnableNodeIds } = computeGraphExecutionState(
      get().nodes,
      nextEdges,
      (get().nodes.find((n) => n.id === START_NODE_ID)?.data?.params?.file_category as string | undefined) || null,
    );
    set({ edges: nextEdges, blockedNodeIds, noDataEdgeIds, runnableNodeIds });
  },

  addNode: (pluginName, position) => {
    const plugin = get().pluginSchemas.find((s) => s.name === pluginName);
    if (!plugin) return;

    const id = `node_${++nodeCounter}_${Date.now()}`;
    const defaultParams: Record<string, unknown> = {};
    plugin.parameters.forEach((p) => {
      defaultParams[p.name] = p.default;
    });

    const newNode: Node<FlowNodeData> = {
      id,
      type: 'custom',
      position,
      data: {
        label: plugin.name,
        pluginName: plugin.name,
        category: plugin.category,
        params: defaultParams,
        inputs: plugin.inputs,
        outputs: plugin.outputs,
        parameters: plugin.parameters,
        status: 'IDLE',
        schema: plugin,
        nodeKind: 'process',
      },
    };

    set({
      nodes: [...get().nodes, newNode],
      nodeStatuses: { ...get().nodeStatuses, [id]: 'IDLE' },
    });
  },

  duplicateNode: (nodeId) => {
    const original = get().nodes.find((n) => n.id === nodeId);
    if (!original || isSpecialNode(nodeId)) return;

    const id = `node_${++nodeCounter}_${Date.now()}`;
    const newNode: Node<FlowNodeData> = {
      ...original,
      id,
      position: {
        x: original.position.x + 40,
        y: original.position.y + 40,
      },
      selected: false,
      data: {
        ...original.data,
        status: 'IDLE',
        params: { ...original.data.params },
      },
    };

    set({
      nodes: [...get().nodes, newNode],
      nodeStatuses: { ...get().nodeStatuses, [id]: 'IDLE' },
    });
  },

  deleteSelectedElements: () => {
    const { nodes, edges } = get();
    const selectedNodeIds = new Set(
      nodes
        .filter((n) => n.selected && !isSpecialNode(n.id))
        .map((n) => n.id),
    );

    if (selectedNodeIds.size > 0) {
      const remainingNodes = nodes.filter(
        (n) => !selectedNodeIds.has(n.id),
      );
      // Also remove edges connected to deleted nodes
      const remainingEdges = edges.filter(
        (e) =>
          !selectedNodeIds.has(e.source) && !selectedNodeIds.has(e.target),
      );
      const selectedEdgeId = get().selectedEdgeId;
      const selectedOutputPreview = get().selectedOutputPreview;
      set({
        nodes: remainingNodes,
        edges: remainingEdges,
        selectedEdgeId:
          selectedEdgeId && !remainingEdges.some((e) => e.id === selectedEdgeId)
            ? null
            : selectedEdgeId,
        selectedOutputPreview:
          selectedOutputPreview && selectedNodeIds.has(selectedOutputPreview.nodeId)
            ? null
            : selectedOutputPreview,
      });
      return;
    }

    // If no nodes selected, try removing selected edges
    const remainingEdges = edges.filter((e) => !e.selected);
    if (remainingEdges.length < edges.length) {
      const selectedEdgeId = get().selectedEdgeId;
      set({
        edges: remainingEdges,
        selectedEdgeId:
          selectedEdgeId && !remainingEdges.some((e) => e.id === selectedEdgeId)
            ? null
            : selectedEdgeId,
      });
    }
  },

  updateNodeParams: (nodeId, params) => {
    const nextNodes = get().nodes.map((n) =>
      n.id === nodeId
        ? { ...n, data: { ...n.data, params: { ...n.data.params, ...params } } }
        : n,
    );
    const { blockedNodeIds, noDataEdgeIds, runnableNodeIds } = computeGraphExecutionState(
      nextNodes,
      get().edges,
      (nextNodes.find((n) => n.id === START_NODE_ID)?.data?.params?.file_category as string | undefined) || null,
    );
    set({ nodes: nextNodes, blockedNodeIds, noDataEdgeIds, runnableNodeIds });
  },

  setNodeStatus: (nodeId, status) => {
    set({
      nodeStatuses: { ...get().nodeStatuses, [nodeId]: status },
      nodes: get().nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, status } } : n,
      ),
    });
  },

  setNodeError: (nodeId, error) => {
    const errors = { ...get().nodeErrors };
    if (error) {
      errors[nodeId] = error;
    } else {
      delete errors[nodeId];
    }
    set({ nodeErrors: errors });
  },

  selectNode: (nodeId) => {
    set({ selectedNodeId: nodeId });
  },

  selectEdge: (edgeId) => {
    set({ selectedEdgeId: edgeId });
  },

  loadPluginSchemas: async () => {
    try {
      const schemas = await fetchPlugins();
      // Filter out Flow category plugins (Pipeline Input is handled by Start node)
      set({ pluginSchemas: schemas.filter((s) => s.category !== 'Flow') });
    } catch {
      if (get().pluginSchemas.length === 0) {
        set({ pluginSchemas: FALLBACK_PLUGINS });
      }
    }
  },

  setUploadedFile: (file) => {
    set({ uploadedFile: file });
  },

  selectOutputPreview: (selection) => {
    set({ selectedOutputPreview: selection });
  },

  setConnectionDrag: (drag) => {
    set({ connectionDrag: drag });
  },

  clearConnectionDrag: () => {
    set({ connectionDrag: null });
  },

  resetExecutionState: () => {
    set({
      nodeStatuses: {},
      nodeErrors: {},
      nodes: get().nodes.map((n) => ({
        ...n,
        data: { ...n.data, status: 'IDLE' },
      })),
    });
  },

  removeEdge: (edgeId) => {
    const remainingEdges = get().edges.filter((e) => e.id !== edgeId);
    set({
      edges: remainingEdges,
      selectedEdgeId: get().selectedEdgeId === edgeId ? null : get().selectedEdgeId,
    });
  },

  removeNode: (nodeId) => {
    if (isSpecialNode(nodeId)) return;
    const edges = get().edges.filter(
      (e) => e.source !== nodeId && e.target !== nodeId,
    );
    const selectedEdgeId = get().selectedEdgeId;
    const selectedOutputPreview = get().selectedOutputPreview;
    set({
      nodes: get().nodes.filter((n) => n.id !== nodeId),
      edges,
      selectedEdgeId:
        selectedEdgeId && !edges.some((e) => e.id === selectedEdgeId)
          ? null
          : selectedEdgeId,
      selectedOutputPreview:
        selectedOutputPreview?.nodeId === nodeId ? null : selectedOutputPreview,
    });
  },
  getSnapshot: () => {
    const { nodes, edges } = get();
    const serializedNodes: SerializedNode[] = nodes.map((n) => ({
      id: n.id,
      type: n.type ?? 'custom',
      position: { x: n.position.x, y: n.position.y },
      data: {
        label: n.data.label,
        pluginName: n.data.pluginName,
        category: n.data.category,
        params: { ...n.data.params },
        ...(n.data.nodeKind ? { nodeKind: n.data.nodeKind } : {}),
      },
    }));
    const serializedEdges: SerializedEdge[] = edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
      type: e.type,
    }));
    return { nodes: serializedNodes, edges: serializedEdges };
  },

  loadSnapshot: (snapshot) => {
    const pluginSchemas = get().pluginSchemas;
    const restoredNodes: Node<FlowNodeData>[] = [];
    let maxCounter = 0;

    for (const sn of snapshot.nodes) {
      const match = sn.id.match(/^node_(\d+)_/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxCounter) maxCounter = num;
      }

      if (sn.id === START_NODE_ID) {
        restoredNodes.push({
          id: START_NODE_ID,
          type: 'start',
          position: { ...sn.position },
          data: {
            label: sn.data.label,
            pluginName: 'Pipeline Input',
            category: 'Flow',
            params: { ...sn.data.params },
            inputs: START_SCHEMA.inputs,
            outputs: START_SCHEMA.outputs,
            parameters: START_SCHEMA.parameters,
            status: 'IDLE',
            schema: START_SCHEMA,
            nodeKind: 'start',
          },
        });
      } else if (sn.id === END_NODE_ID) {
        restoredNodes.push({
          id: END_NODE_ID,
          type: 'end',
          position: { ...sn.position },
          data: {
            label: sn.data.label,
            pluginName: 'Pipeline Output',
            category: 'Flow',
            params: { ...sn.data.params },
            inputs: END_SCHEMA.inputs,
            outputs: END_SCHEMA.outputs,
            parameters: END_SCHEMA.parameters,
            status: 'IDLE',
            schema: END_SCHEMA,
            nodeKind: 'end',
          },
        });
      } else {
        const plugin = pluginSchemas.find((s) => s.name === sn.data.pluginName);
        if (!plugin) continue;
        restoredNodes.push({
          id: sn.id,
          type: sn.type,
          position: { ...sn.position },
          data: {
            label: sn.data.label,
            pluginName: sn.data.pluginName,
            category: sn.data.category,
            params: { ...sn.data.params },
            inputs: plugin.inputs,
            outputs: plugin.outputs,
            parameters: plugin.parameters,
            status: 'IDLE',
            schema: plugin,
            nodeKind: sn.data.nodeKind ?? 'process',
          },
        });
      }
    }

    nodeCounter = maxCounter;

    const restoredEdges: Edge[] = snapshot.edges.map((se) => ({
      id: se.id,
      source: se.source,
      target: se.target,
      sourceHandle: se.sourceHandle ?? undefined,
      targetHandle: se.targetHandle ?? undefined,
      type: se.type ?? 'custom',
    }));

    const fileCategory =
      (restoredNodes.find((n) => n.id === START_NODE_ID)?.data?.params?.file_category as string | undefined) || null;
    const { blockedNodeIds, noDataEdgeIds, runnableNodeIds } = computeGraphExecutionState(
      restoredNodes,
      restoredEdges,
      fileCategory,
    );

    set({
      nodes: restoredNodes,
      edges: restoredEdges,
      selectedNodeId: null,
      selectedEdgeId: null,
      nodeStatuses: {},
      nodeErrors: {},
      selectedOutputPreview: null,
      connectionDrag: null,
      blockedNodeIds,
      noDataEdgeIds,
      runnableNodeIds,
    });
  },
}));

export default useFlowStore;
