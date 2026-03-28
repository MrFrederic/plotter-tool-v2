import { useEffect, useRef } from 'react';
import './TelemetryPanel.css';
import usePipelineStore from '../../store/usePipelineStore';

const STATUS_SYMBOLS: Record<string, string> = {
  IDLE:    '○',
  WAITING: '◌',
  RUNNING: '▶',
  DONE:    '■',
  ERROR:   '✕',
  CACHED:  '◈',
};

export default function TelemetryPanel() {
  const telemetryLog = usePipelineStore((s) => s.telemetryLog);
  const isExecuting = usePipelineStore((s) => s.isExecuting);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [telemetryLog]);

  return (
    <div className="telemetry-panel">
      <div className="telemetry-panel__header">
        <span className="telemetry-panel__title">EXECUTION LOG</span>
        {isExecuting && (
          <span className="telemetry-panel__running">● PROCESSING</span>
        )}
        <span
          className="fui-barcode"
          aria-hidden="true"
          style={{ pointerEvents: 'none', marginLeft: 'auto', flexShrink: 0 }}
        />
        <span className="telemetry-panel__count">
          {telemetryLog.length} entries
        </span>
      </div>

      <div className="telemetry-panel__log" ref={scrollRef}>
        {telemetryLog.length === 0 && (
          <div className="telemetry-panel__empty">
            Awaiting execution data...
          </div>
        )}

        {telemetryLog.map((msg, i) => (
          <div
            key={`${msg.timestamp}_${msg.node_id}_${i}`}
            className={`telemetry-panel__entry ${msg.status === 'ERROR' ? 'telemetry-panel__entry--error' : ''}`}
            data-status={msg.status}
          >
            <span className="telemetry-panel__timestamp">
              {msg.timestamp.split('T')[1]?.slice(0, 12) || msg.timestamp}
            </span>
            <span className="telemetry-panel__symbol">
              {STATUS_SYMBOLS[msg.status] || '?'}
            </span>
            <span className="telemetry-panel__node-id">{msg.node_id}</span>
            <span className="telemetry-panel__status">{msg.status}</span>
            {msg.progress !== undefined && (
              <span className="telemetry-panel__progress">
                [{Math.round(msg.progress * 100)}%]
              </span>
            )}
            {msg.message && (
              <span className="telemetry-panel__message">{msg.message}</span>
            )}
          </div>
        ))}

        <span className="telemetry-panel__cursor">█</span>
      </div>
    </div>
  );
}
