import { useCallback } from 'react';
import './Toolbar.css';
import useFlowStore, { START_NODE_ID, END_NODE_ID } from '../../store/useFlowStore';
import usePipelineStore from '../../store/usePipelineStore';
import { executePipeline } from '../../api/rest';
import type { ExecutePipelinePayload } from '../../api/rest';
import GlitchText from '../common/GlitchText';

const EXCLUDED_IDS = new Set([END_NODE_ID]);

export default function Toolbar() {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const isExecuting = usePipelineStore((s) => s.isExecuting);
  const setExecuting = usePipelineStore((s) => s.setExecuting);
  const clearTelemetry = usePipelineStore((s) => s.clearTelemetry);
  const addTelemetryMessage = usePipelineStore((s) => s.addTelemetryMessage);
  const sessionId = usePipelineStore((s) => s.sessionId);
  const pipelineName = usePipelineStore((s) => s.pipelineName);

  // Count only processing nodes (not start/end) for display
  const processNodeCount = nodes.filter(
    (n) => n.id !== START_NODE_ID && n.id !== END_NODE_ID,
  ).length;

  const handleExecute = useCallback(async () => {
    if (isExecuting || processNodeCount === 0) return;

    try {
      setExecuting(true);
      clearTelemetry();

      const syncNodes = nodes.filter((n) => !EXCLUDED_IDS.has(n.id));
      const syncEdges = edges.filter((e) => !EXCLUDED_IDS.has(e.target));

      const payload: ExecutePipelinePayload = {
        session_id: sessionId,
        nodes: syncNodes.map((n) => ({
          id: n.id,
          plugin_name: n.data.pluginName,
          pos_x: n.position.x,
          pos_y: n.position.y,
          params: n.data.params as Record<string, unknown>,
        })),
        edges: syncEdges.map((e) => ({
          source_node_id: e.source,
          source_output: e.sourceHandle || 'output',
          target_node_id: e.target,
          target_input: e.targetHandle || 'input',
        })),
      };

      await executePipeline(payload);
    } catch (err) {
      setExecuting(false);
      const errorMsg = err instanceof Error ? err.message : 'Pipeline execution failed';
      addTelemetryMessage({
        node_id: 'SYSTEM',
        status: 'ERROR',
        message: errorMsg,
        timestamp: new Date().toISOString(),
      });
    }
  }, [isExecuting, processNodeCount, nodes, edges, sessionId, setExecuting, clearTelemetry, addTelemetryMessage]);

  return (
    <div className="toolbar">
      <div className="toolbar__group">
        <GlitchText text={pipelineName} className="toolbar__label" />
        <span className="toolbar__separator">│</span>
        <span className="toolbar__node-count">
          {processNodeCount} module{processNodeCount !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="toolbar__group">
        <button
          className={`toolbar__btn toolbar__btn--execute ${isExecuting ? 'toolbar__btn--active' : ''}`}
          onClick={handleExecute}
          disabled={isExecuting || processNodeCount === 0}
        >
          {isExecuting ? '● PROCESSING...' : '▶ EXECUTE'}
        </button>
      </div>
    </div>
  );
}
