import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { FlowNodeData } from '../../store/useFlowStore';
import useFlowStore from '../../store/useFlowStore';
import './StartNode.css';

function StartNode({ selected }: NodeProps<Node<FlowNodeData>>) {
  const uploadedFile = useFlowStore((s) => s.uploadedFile);

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
          {['image', 'vector', 'gcode', 'path', 'text', 'other'].map((name) => (
            <div key={name} className="start-node__port">
              <span className="start-node__port-label">{name}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={name}
                className="start-node__handle"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default memo(StartNode);
