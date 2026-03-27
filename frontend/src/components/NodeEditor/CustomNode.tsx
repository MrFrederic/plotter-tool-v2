import { memo, useCallback, useRef } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { FlowNodeData } from '../../store/useFlowStore';
import useFlowStore from '../../store/useFlowStore';
import { isHandleAvailableDuringDrag } from '../../utils/flowRules';
import './CustomNode.css';

const statusColorVars: Record<string, string> = {
  IDLE: 'var(--text-dim)',
  WAITING: 'var(--accent-amber)',
  RUNNING: 'var(--accent-amber)',
  CACHED: 'var(--accent-cyan)',
  DONE: 'var(--success)',
  ERROR: 'var(--danger)',
};

/** Max pointer travel in px to count as a click rather than a drag-start. */
const CLICK_MAX_MOVE = 4;

function CustomNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  const statusColor = statusColorVars[data.status] || statusColorVars.IDLE;
  const paramCount = Object.keys(data.params).length;
  const errorMsg = useFlowStore((s) => s.nodeErrors[id]);
  const connectionDrag = useFlowStore((s) => s.connectionDrag);
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const selectOutputPreview = useFlowStore((s) => s.selectOutputPreview);
  const blocked = useFlowStore((s) => s.blockedNodeIds.has(id));

  const isDragging = !!connectionDrag;

  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  const handleOutputPointerDown = useCallback((e: React.PointerEvent, _outputName: string) => {
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
    <div
      className={[
        'custom-node',
        `custom-node--status-${data.status.toLowerCase()}`,
        selected ? 'custom-node--selected' : '',
        blocked ? 'custom-node--blocked' : '',
        isDragging ? 'custom-node--dragging-connection' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ '--status-color': statusColor } as React.CSSProperties}
      data-status={data.status}
    >
      <div className="custom-node__status-bar" />

      <div className="custom-node__header">
        <span className="custom-node__status-dot" style={{ background: statusColor }} />
        <span className="custom-node__title">{data.label}</span>
        {paramCount > 0 && (
          <span className="custom-node__param-badge">{paramCount}</span>
        )}
        <span className="custom-node__category">{data.category}</span>
      </div>

      <div className="custom-node__body">
        <div className="custom-node__ports custom-node__ports--inputs">
          {data.inputs.map((input) => {
            const available = isHandleAvailableDuringDrag(
              connectionDrag,
              id,
              'target',
              input.name,
              nodes,
              edges,
            );
            return (
              <div key={input.name} className="custom-node__port">
                <Handle
                  type="target"
                  position={Position.Left}
                  id={input.name}
                  className={[
                    'custom-node__handle',
                    'custom-node__handle--input',
                    isDragging && !available ? 'custom-node__handle--unavailable' : '',
                    isDragging && available ? 'custom-node__handle--available' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                />
                <span
                  className={[
                    'custom-node__port-label',
                    isDragging && !available ? 'custom-node__port-label--unavailable' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {input.name}
                </span>
              </div>
            );
          })}
        </div>

        <div className="custom-node__ports custom-node__ports--outputs">
          {data.outputs.map((output) => {
            const available = isHandleAvailableDuringDrag(
              connectionDrag,
              id,
              'source',
              output.name,
              nodes,
              edges,
            );
            return (
              <div key={output.name} className="custom-node__port custom-node__port--right">
                <span
                  className={[
                    'custom-node__port-label',
                    isDragging && !available ? 'custom-node__port-label--unavailable' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {output.name}
                </span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={output.name}
                  className={[
                    'custom-node__handle',
                    'custom-node__handle--output',
                    isDragging && !available ? 'custom-node__handle--unavailable' : '',
                    isDragging && available ? 'custom-node__handle--available' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onPointerDown={(e) => handleOutputPointerDown(e, output.name)}
                  onPointerUp={(e) => handleOutputPointerUp(e, output.name)}
                />
              </div>
            );
          })}
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
