import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { FlowNodeData } from '../../store/useFlowStore';
import useFlowStore from '../../store/useFlowStore';
import './CustomNode.css';

const statusColorVars: Record<string, string> = {
  IDLE: 'var(--text-dim)',
  WAITING: 'var(--accent-amber)',
  RUNNING: 'var(--accent-amber)',
  CACHED: 'var(--accent-cyan)',
  DONE: 'var(--success)',
  ERROR: 'var(--danger)',
};

function CustomNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  const statusColor = statusColorVars[data.status] || statusColorVars.IDLE;
  const paramCount = Object.keys(data.params).length;
  const errorMsg = useFlowStore((s) => s.nodeErrors[id]);

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

      {data.status === 'ERROR' && errorMsg && (
        <div className="custom-node__error-bar">
          <span className="custom-node__error-icon">⚠</span>
          <span className="custom-node__error-text">{errorMsg}</span>
        </div>
      )}
    </div>
  );
}

export default memo(CustomNode);
