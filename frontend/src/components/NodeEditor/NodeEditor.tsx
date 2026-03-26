import { useCallback, useRef, type DragEvent } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './NodeEditor.css';
import CustomNode from './CustomNode';
import CustomEdge from './CustomEdge';
import useFlowStore from '../../store/useFlowStore';
import type { PortDefinition } from '../../types';

interface FlowInstance {
  screenToFlowPosition: (pos: { x: number; y: number }) => { x: number; y: number };
}

const nodeTypes = { custom: CustomNode };
const edgeTypes = { custom: CustomEdge };

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
    },
    [selectNode],
  );

  const onPaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  const isValidConnection = useCallback(
    (connection: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }) => {
      // Prevent self-connections
      if (connection.source === connection.target) return false;

      // Prevent multiple incoming connections to the same input port
      const existingEdge = edges.find(
        (e) => e.target === connection.target && e.targetHandle === connection.targetHandle,
      );
      if (existingEdge) return false;

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
    [nodes, edges],
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
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'custom', animated: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1a1a2e" />
        <MiniMap
          nodeColor="#1a1a2e"
          maskColor="rgba(10, 10, 15, 0.8)"
          style={{ background: '#0d0d14', border: '1px solid #1a1a2e' }}
        />
        <Controls />
      </ReactFlow>
    </div>
  );
}
