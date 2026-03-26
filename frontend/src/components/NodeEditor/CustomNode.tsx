import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { FlowNodeData } from '../../store/useFlowStore';
import './CustomNode.css';

const statusColors: Record<string, string> = {
  IDLE: '#4a4a5a',
  WAITING: '#ffaa00',
  RUNNING: '#ffaa00',
  CACHED: '#00f0ff',
  DONE: '#00ff88',
  ERROR: '#ff3366',
};

function CustomNode({ data, selected }: NodeProps<Node<FlowNodeData>>) {
  const statusColor = statusColors[data.status] || statusColors.IDLE;
  const paramCount = Object.keys(data.params).length;

  return (
    <div
      className={`custom-node custom-node--status-${data.status.toLowerCase()} ${selected ? 'custom-node--selected' : ''}`}
      style={{ '--status-color': statusColor } as React.CSSProperties}
      data-status={data.status}
    >
      <div className="custom-node__status-bar" />

      <div className="custom-node__header">
        <span
          className="custom-node__status-dot"
          style={{ background: statusColor }}
        />
        <span className="custom-node__title">{data.label}</span>
        {paramCount > 0 && (
          <span className="custom-node__param-badge">{paramCount}</span>
        )}
        <span className="custom-node__category">{data.category}</span>
      </div>

      <div className="custom-node__body">
        <div className="custom-node__ports custom-node__ports--inputs">
          {data.inputs.map((input) => (
            <div key={input.name} className="custom-node__port">
              <Handle
                type="target"
                position={Position.Left}
                id={input.name}
                className="custom-node__handle custom-node__handle--input"
              />
              <span className="custom-node__port-label">{input.name}</span>
            </div>
          ))}
        </div>

        <div className="custom-node__ports custom-node__ports--outputs">
          {data.outputs.map((output) => (
            <div key={output.name} className="custom-node__port custom-node__port--right">
              <span className="custom-node__port-label">{output.name}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={output.name}
                className="custom-node__handle custom-node__handle--output"
              />
            </div>
          ))}
        </div>
      </div>

      {data.status === 'RUNNING' && (
        <div className="custom-node__progress-bar">
          <div className="custom-node__progress-fill" />
        </div>
      )}
    </div>
  );
}

export default memo(CustomNode);
