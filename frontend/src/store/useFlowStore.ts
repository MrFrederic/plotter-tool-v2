import { create } from 'zustand';
import {
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type NodeChange,
} from '@xyflow/react';
import type { NodeStatus, PluginSchema } from '../types';
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
}

interface FlowState {
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  selectedNodeId: string | null;
  nodeStatuses: Record<string, NodeStatus>;
  pluginSchemas: PluginSchema[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  addNode: (pluginName: string, position: { x: number; y: number }) => void;
  updateNodeParams: (nodeId: string, params: Record<string, unknown>) => void;
  setNodeStatus: (nodeId: string, status: NodeStatus) => void;
  selectNode: (nodeId: string | null) => void;
  loadPluginSchemas: () => Promise<void>;
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

const useFlowStore = create<FlowState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  nodeStatuses: {},
  pluginSchemas: [],

  onNodesChange: (changes) => {
    set({
      nodes: applyNodeChanges(
        changes as NodeChange<Node<FlowNodeData>>[],
        get().nodes,
      ),
    });
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  onConnect: (connection) => {
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
      },
    };

    set({
      nodes: [...get().nodes, newNode],
      nodeStatuses: { ...get().nodeStatuses, [id]: 'IDLE' },
    });
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
}));

export default useFlowStore;
