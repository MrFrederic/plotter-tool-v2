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

export interface FlowNodeData extends Record<string, unknown> {
  label: string;
  pluginName: string;
  category: string;
  params: Record<string, unknown>;
  inputs: PluginSchema['inputs'];
  outputs: PluginSchema['outputs'];
  parameters: PluginSchema['parameters'];
  status: NodeStatus;
}

interface FlowState {
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  selectedNodeId: string | null;
  nodeStatuses: Record<string, NodeStatus>;
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  addNode: (plugin: PluginSchema, position: { x: number; y: number }) => void;
  updateNodeParams: (nodeId: string, params: Record<string, unknown>) => void;
  setNodeStatus: (nodeId: string, status: NodeStatus) => void;
  selectNode: (nodeId: string | null) => void;
}

let nodeCounter = 0;

const useFlowStore = create<FlowState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  nodeStatuses: {},

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

  addNode: (plugin, position) => {
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
}));

export default useFlowStore;
