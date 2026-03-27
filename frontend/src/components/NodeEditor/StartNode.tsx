import { memo, useCallback, useRef } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { FlowNodeData } from '../../store/useFlowStore';
import useFlowStore from '../../store/useFlowStore';
import { isHandleAvailableDuringDrag } from '../../utils/flowRules';
import './StartNode.css';

const CLICK_MAX_MOVE = 4;

function StartNode({ id, selected }: NodeProps<Node<FlowNodeData>>) {
  const uploadedFile = useFlowStore((s) => s.uploadedFile);
  const connectionDrag = useFlowStore((s) => s.connectionDrag);
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const selectOutputPreview = useFlowStore((s) => s.selectOutputPreview);
  const isDragging = !!connectionDrag;

  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  const handleOutputPointerDown = useCallback((e: React.PointerEvent) => {
    pointerRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleOutputPointerUp = useCallback(
    (e: React.PointerEvent, outputName: string) => {
      if (!pointerRef.current) return;
      const dx = e.clientX - pointerRef.current.x;
      const dy = e.clientY - pointerRef.current.y;
      const moved = Math.sqrt(dx * dx + dy * dy);
      pointerRef.current = null;
      if (moved > CLICK_MAX_MOVE) return;
      e.stopPropagation();
      selectOutputPreview({ nodeId: id, outputHandle: outputName });
    },
    [id, selectOutputPreview],
  );

  return (
    <div className={`start-node ${selected ? 'start-node--selected' : ''}`}>
      <div className="start-node__accent" />
      <div className="start-node__header">
        <span className="start-node__icon">▶</span>
        <span className="start-node__title">PIPELINE INPUT</span>
      </div>
      <div className="start-node__body">
        {uploadedFile ? (
          <div className="start-node__file-info">
            <span className="start-node__file-name">{uploadedFile.name}</span>
            <span className="start-node__file-cat">{uploadedFile.category}</span>
          </div>
        ) : (
          <span className="start-node__hint">Select node to upload file</span>
        )}
        <div className="start-node__outputs">
          {['image', 'vector', 'gcode', 'path', 'text', 'other'].map((name) => {
            const available = isHandleAvailableDuringDrag(
              connectionDrag, id, 'source', name, nodes, edges,
            );
            return (
              <div key={name} className="start-node__port">
                <span
                  className={[
                    'start-node__port-label',
                    isDragging && !available ? 'start-node__port-label--unavailable' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {name}
                </span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={name}
                  className={[
                    'start-node__handle',
                    isDragging && !available ? 'start-node__handle--unavailable' : '',
                    isDragging && available ? 'start-node__handle--available' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onPointerDown={handleOutputPointerDown}
                  onPointerUp={(e) => handleOutputPointerUp(e, name)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default memo(StartNode);
