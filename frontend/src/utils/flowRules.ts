import type { Edge, Node } from '@xyflow/react';
import { END_NODE_ID, START_NODE_ID, type FlowNodeData } from '../store/useFlowStore';

export interface ConnectionCandidate {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface ConnectionDragState {
  nodeId: string;
  handleId: string | null;
  handleType: 'source' | 'target';
}

export interface GraphExecutionState {
  runnableNodeIds: Set<string>;
  blockedNodeIds: Set<string>;
  noDataEdgeIds: Set<string>;
}

function isSpecialNode(nodeId: string): boolean {
  return nodeId === START_NODE_ID || nodeId === END_NODE_ID;
}

export function arePortsCompatible(
  nodes: Node<FlowNodeData>[],
  connection: ConnectionCandidate,
): boolean {
  const sourceNode = nodes.find((node) => node.id === connection.source);
  const targetNode = nodes.find((node) => node.id === connection.target);

  if (!sourceNode || !targetNode) return false;

  const sourcePort = sourceNode.data.outputs.find((port) => port.name === connection.sourceHandle);
  const targetPort = targetNode.data.inputs.find((port) => port.name === connection.targetHandle);

  if (!sourcePort || !targetPort) return true;

  return (
    sourcePort.type === targetPort.type ||
    sourcePort.type === 'other' ||
    targetPort.type === 'other'
  );
}

export function isConnectionAllowed(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  connection: ConnectionCandidate,
  options?: { allowTargetReplacement?: boolean },
): boolean {
  if (!connection.source || !connection.target) return false;
  if (connection.source === connection.target) return false;

  const targetOccupied = edges.some(
    (edge) => edge.target === connection.target && edge.targetHandle === connection.targetHandle,
  );

  if (targetOccupied && !options?.allowTargetReplacement) {
    return false;
  }

  return arePortsCompatible(nodes, connection);
}

function canOutputCarryData(
  nodeId: string,
  outputHandle: string | null | undefined,
  uploadedCategory?: string | null,
): boolean {
  if (nodeId !== START_NODE_ID) return true;
  if (!uploadedCategory) return false;
  return outputHandle === uploadedCategory;
}

export function computeGraphExecutionState(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  uploadedCategory?: string | null,
): GraphExecutionState {
  const incomingByNode = new Map<string, Edge[]>();

  for (const edge of edges) {
    const list = incomingByNode.get(edge.target) ?? [];
    list.push(edge);
    incomingByNode.set(edge.target, list);
  }

  const runnableNodeIds = new Set<string>();

  if (uploadedCategory) {
    runnableNodeIds.add(START_NODE_ID);
  }

  let changed = true;
  while (changed) {
    changed = false;

    for (const node of nodes) {
      if (runnableNodeIds.has(node.id)) continue;
      if (node.id === START_NODE_ID || node.id === END_NODE_ID) continue;

      const requiredInputs = node.data.inputs.map((input) => input.name);
      if (requiredInputs.length === 0) {
        runnableNodeIds.add(node.id);
        changed = true;
        continue;
      }

      const incoming = incomingByNode.get(node.id) ?? [];
      const everyInputReady = requiredInputs.every((inputName) => {
        const edge = incoming.find((candidate) => candidate.targetHandle === inputName);
        if (!edge) return false;
        if (!runnableNodeIds.has(edge.source)) return false;
        return canOutputCarryData(edge.source, edge.sourceHandle, uploadedCategory);
      });

      if (everyInputReady) {
        runnableNodeIds.add(node.id);
        changed = true;
      }
    }
  }

  const blockedNodeIds = new Set<string>();
  for (const node of nodes) {
    if (isSpecialNode(node.id)) continue;
    if (!runnableNodeIds.has(node.id)) {
      blockedNodeIds.add(node.id);
    }
  }

  const noDataEdgeIds = new Set<string>();
  for (const edge of edges) {
    if (edge.target === END_NODE_ID) continue;

    const sourceRunnable = runnableNodeIds.has(edge.source);
    const targetRunnable = runnableNodeIds.has(edge.target);
    const sourceHasData = canOutputCarryData(edge.source, edge.sourceHandle, uploadedCategory);

    if (!sourceRunnable || !targetRunnable || !sourceHasData) {
      noDataEdgeIds.add(edge.id);
    }
  }

  return { runnableNodeIds, blockedNodeIds, noDataEdgeIds };
}

export function isHandleAvailableDuringDrag(
  drag: ConnectionDragState | null,
  nodeId: string,
  handleType: 'source' | 'target',
  handleId: string,
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
): boolean {
  if (!drag) return true;

  if (drag.handleType === 'source') {
    if (handleType === 'source') {
      return drag.nodeId === nodeId && drag.handleId === handleId;
    }

    return isConnectionAllowed(
      nodes,
      edges,
      {
        source: drag.nodeId,
        sourceHandle: drag.handleId,
        target: nodeId,
        targetHandle: handleId,
      },
      { allowTargetReplacement: true },
    );
  }

  if (handleType === 'target') {
    return drag.nodeId === nodeId && drag.handleId === handleId;
  }

  return isConnectionAllowed(
    nodes,
    edges,
    {
      source: nodeId,
      sourceHandle: handleId,
      target: drag.nodeId,
      targetHandle: drag.handleId,
    },
    { allowTargetReplacement: true },
  );
}
