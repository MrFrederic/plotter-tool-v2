import { useCallback, useRef, useState, useEffect, type DragEvent } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  type Edge,
  type Node,
  type OnConnectStart,
  type OnConnectEnd,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './NodeEditor.css';
import CustomNode from './CustomNode';
import StartNode from './StartNode';
import EndNode from './EndNode';
import CustomEdge from './CustomEdge';
import type { PortDefinition } from '../../types';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';
import useFlowStore, { START_NODE_ID, END_NODE_ID } from '../../store/useFlowStore';
import type { FlowNodeData } from '../../store/useFlowStore';

interface FlowInstance {
  screenToFlowPosition: (pos: { x: number; y: number }) => { x: number; y: number };
}

const nodeTypes = { custom: CustomNode, start: StartNode, end: EndNode };
const edgeTypes = { custom: CustomEdge };

interface CtxState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

export default function NodeEditor() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const reactFlowRef = useRef<FlowInstance | null>(null);
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const onNodesChange = useFlowStore((s) => s.onNodesChange);
  const onEdgesChange = useFlowStore((s) => s.onEdgesChange);
  const onConnect = useFlowStore((s) => s.onConnect);
  const addNode = useFlowStore((s) => s.addNode);
  const selectNode = useFlowStore((s) => s.selectNode);
  const selectEdge = useFlowStore((s) => s.selectEdge);
  const duplicateNode = useFlowStore((s) => s.duplicateNode);
  const removeNode = useFlowStore((s) => s.removeNode);
  const removeEdge = useFlowStore((s) => s.removeEdge);
  const deleteSelectedElements = useFlowStore((s) => s.deleteSelectedElements);
  const setConnectionDrag = useFlowStore((s) => s.setConnectionDrag);
  const clearConnectionDrag = useFlowStore((s) => s.clearConnectionDrag);

  const [ctxMenu, setCtxMenu] = useState<CtxState | null>(null);

  const closeCtx = useCallback(() => setCtxMenu(null), []);

  /* ---- keyboard handler (Delete key) ---- */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't intercept when typing in an input
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        deleteSelectedElements();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [deleteSelectedElements]);

  const onInit = useCallback((instance: FlowInstance) => {
    reactFlowRef.current = instance;
  }, []);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const pluginName = event.dataTransfer.getData('application/plotter-plugin');
      if (!pluginName || !reactFlowRef.current) return;

      const position = reactFlowRef.current.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      addNode(pluginName, position);
    },
    [addNode],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      selectNode(node.id);
      selectEdge(null);
    },
    [selectNode, selectEdge],
  );

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      selectEdge(edge.id);
    },
    [selectEdge],
  );

  const selectOutputPreview = useFlowStore((s) => s.selectOutputPreview);

  const onPaneClick = useCallback(() => {
    selectNode(null);
    selectEdge(null);
    selectOutputPreview(null);
    closeCtx();
  }, [selectNode, selectEdge, selectOutputPreview, closeCtx]);

  const onConnectStart: OnConnectStart = useCallback(
    (_event, params) => {
      if (!params.nodeId) return;
      setConnectionDrag({
        nodeId: params.nodeId,
        handleId: params.handleId ?? null,
        handleType: (params.handleType ?? 'source') as 'source' | 'target',
      });
    },
    [setConnectionDrag],
  );

  const onConnectEnd: OnConnectEnd = useCallback(() => {
    clearConnectionDrag();
  }, [clearConnectionDrag]);

  /* ---- right-click on node ---- */
  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node<FlowNodeData>) => {
      event.preventDefault();
      const isSpecial =
        node.id === START_NODE_ID || node.id === END_NODE_ID;

      const items: ContextMenuItem[] = [];
      if (!isSpecial) {
        items.push({
          label: '⧉ Duplicate',
          action: () => duplicateNode(node.id),
        });
        items.push({
          label: '✕ Delete',
          danger: true,
          action: () => removeNode(node.id),
        });
      }

      if (items.length > 0) {
        setCtxMenu({ x: event.clientX, y: event.clientY, items });
      }
    },
    [duplicateNode, removeNode],
  );

  /* ---- right-click on edge ---- */
  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      setCtxMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          {
            label: '✕ Delete connection',
            danger: true,
            action: () => removeEdge(edge.id),
          },
        ],
      });
    },
    [removeEdge],
  );

  const isValidConnection = useCallback(
    (connection: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }) => {
      // Prevent self-connections
      if (connection.source === connection.target) return false;

      // Occupied single inputs are allowed — the store now replaces the old edge on connect
      // Port type compatibility check
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (sourceNode && targetNode) {
        const sourcePort = sourceNode.data.outputs.find(
          (p: PortDefinition) => p.name === connection.sourceHandle,
        );
        const targetPort = targetNode.data.inputs.find(
          (p: PortDefinition) => p.name === connection.targetHandle,
        );
        if (
          sourcePort &&
          targetPort &&
          sourcePort.type !== targetPort.type &&
          sourcePort.type !== 'other' &&
          targetPort.type !== 'other'
        ) {
          return false;
        }
      }

      return true;
    },
    [nodes],
  );

  return (
    <div className="node-editor" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onInit={onInit}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'custom', animated: true, interactionWidth: 24 }}
        connectionRadius={32}
        deleteKeyCode={null}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1a1a2e" />
        <MiniMap
          nodeColor="#1a1a2e"
          maskColor="rgba(10, 10, 15, 0.8)"
          style={{ background: '#0d0d14', border: '1px solid #1a1a2e' }}
        />
        <Controls />
      </ReactFlow>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          onClose={closeCtx}
        />
      )}
    </div>
  );
}
