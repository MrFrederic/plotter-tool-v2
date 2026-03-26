import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { FlowNodeData } from '../../store/useFlowStore';
import './EndNode.css';

function EndNode({ selected }: NodeProps<Node<FlowNodeData>>) {
  return (
    <div className={`end-node ${selected ? 'end-node--selected' : ''}`}>
      <div className="end-node__accent" />
      <div className="end-node__header">
        <span className="end-node__title">PIPELINE OUTPUT</span>
        <span className="end-node__icon">■</span>
      </div>
      <div className="end-node__body">
        <div className="end-node__inputs">
          {['image', 'vector', 'gcode', 'path', 'text', 'other'].map((name) => (
            <div key={name} className="end-node__port">
              <Handle
                type="target"
                position={Position.Left}
                id={name}
                className="end-node__handle"
              />
              <span className="end-node__port-label">{name}</span>
            </div>
          ))}
        </div>
        <span className="end-node__hint">Select node to download result</span>
      </div>
    </div>
  );
}

export default memo(EndNode);
