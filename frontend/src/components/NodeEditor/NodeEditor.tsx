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

interface FlowInstance {
  screenToFlowPosition: (pos: { x: number; y: number }) => { x: number; y: number };
}

const nodeTypes = { custom: CustomNode };
const edgeTypes = { custom: CustomEdge };

export default function NodeEditor() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const reactFlowRef = useRef<FlowInstance | null>(null);
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, addNode, selectNode } =
    useFlowStore();

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

  return (
    <div className="node-editor" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
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
