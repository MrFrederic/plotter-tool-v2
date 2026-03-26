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
}

export const START_NODE_ID = '__start__';
export const END_NODE_ID = '__end__';

const START_SCHEMA: PluginSchema = {
  name: 'Pipeline Input',
  category: 'Flow',
  description: 'Entry point — upload a file for processing',
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
  description: 'End point — download the final result',
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
  nodeStatuses: Record<string, NodeStatus>;
  nodeErrors: Record<string, string>;
  pluginSchemas: PluginSchema[];
  uploadedFile: UploadedFile | null;

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
  loadPluginSchemas: () => Promise<void>;
  setUploadedFile: (file: UploadedFile | null) => void;
  removeEdge: (edgeId: string) => void;
  removeNode: (nodeId: string) => void;
}

const FALLBACK_PLUGINS: PluginSchema[] = [
  {
    name: 'Image Loader',
    category: 'Input',
    description: 'Load an image file from disk',
    inputs: [],
    outputs: [{ name: 'image', type: 'image' }],
    parameters: [{ name: 'file_path', type: 'string', default: '' }],
  },
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
  nodeStatuses: {},
  nodeErrors: {},
  pluginSchemas: [],
  uploadedFile: null,

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
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  onConnect: (connection) => {
    // Prevent self-connections
    if (connection.source === connection.target) return;

    // Prevent multiple incoming connections to the same input port
    const existingEdge = get().edges.find(
      (e) => e.target === connection.target && e.targetHandle === connection.targetHandle,
    );
    if (existingEdge) return;

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

    set({ edges: addEdge({ ...connection, type: 'custom' }, get().edges) });
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
      set({ nodes: remainingNodes, edges: remainingEdges });
      return;
    }

    // If no nodes selected, try removing selected edges
    const remainingEdges = edges.filter((e) => !e.selected);
    if (remainingEdges.length < edges.length) {
      set({ edges: remainingEdges });
    }
  },

  updateNodeParams: (nodeId, params) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, params: { ...n.data.params, ...params } } }
          : n,
      ),
    });
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

  loadPluginSchemas: async () => {
    try {
      const schemas = await fetchPlugins();
      set({ pluginSchemas: schemas });
    } catch {
      if (get().pluginSchemas.length === 0) {
        set({ pluginSchemas: FALLBACK_PLUGINS });
      }
    }
  },

  setUploadedFile: (file) => {
    set({ uploadedFile: file });
  },

  removeEdge: (edgeId) => {
    set({ edges: get().edges.filter((e) => e.id !== edgeId) });
  },

  removeNode: (nodeId) => {
    if (isSpecialNode(nodeId)) return;
    const edges = get().edges.filter(
      (e) => e.source !== nodeId && e.target !== nodeId,
    );
    set({
      nodes: get().nodes.filter((n) => n.id !== nodeId),
      edges,
    });
  },
}));

export default useFlowStore;
