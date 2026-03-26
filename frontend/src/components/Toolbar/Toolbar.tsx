import { useCallback } from 'react';
import './Toolbar.css';
import useFlowStore from '../../store/useFlowStore';
import usePipelineStore from '../../store/usePipelineStore';
import { executePipeline, savePipeline } from '../../api/rest';

export default function Toolbar() {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const isExecuting = usePipelineStore((s) => s.isExecuting);
  const setExecuting = usePipelineStore((s) => s.setExecuting);
  const clearTelemetry = usePipelineStore((s) => s.clearTelemetry);
  const currentPipelineId = usePipelineStore((s) => s.currentPipelineId);
  const pipelineName = usePipelineStore((s) => s.pipelineName);
  const setCurrentPipeline = usePipelineStore((s) => s.setCurrentPipeline);

  const handleExecute = useCallback(async () => {
    if (isExecuting || nodes.length === 0) return;

    try {
      setExecuting(true);
      clearTelemetry();

      const pipelineData: Record<string, unknown> = {
        id: currentPipelineId,
        name: pipelineName,
        nodes: nodes.map((n) => ({
          id: n.id,
          plugin_name: n.data.pluginName,
          pos_x: n.position.x,
          pos_y: n.position.y,
          params: n.data.params,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source_node_id: e.source,
          source_output: e.sourceHandle || 'output',
          target_node_id: e.target,
          target_input: e.targetHandle || 'input',
        })),
      };

      const saved = await savePipeline(pipelineData);
      const pipelineId = (saved.id as string) || currentPipelineId;

      if (pipelineId) {
        setCurrentPipeline(pipelineId, pipelineName);
        await executePipeline(pipelineId);
      }
    } catch {
      setExecuting(false);
    }
  }, [
    isExecuting,
    nodes,
    edges,
    currentPipelineId,
    pipelineName,
    setExecuting,
    clearTelemetry,
    setCurrentPipeline,
  ]);

  return (
    <div className="toolbar">
      <div className="toolbar__group">
        <span className="toolbar__label">{pipelineName}</span>
        <span className="toolbar__separator">│</span>
        <span className="toolbar__node-count">
          {nodes.length} module{nodes.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="toolbar__group">
        <button
          className={`toolbar__btn toolbar__btn--execute ${isExecuting ? 'toolbar__btn--active' : ''}`}
          onClick={handleExecute}
          disabled={isExecuting || nodes.length === 0}
        >
          {isExecuting ? '● PROCESSING...' : '▶ EXECUTE'}
        </button>
      </div>
    </div>
  );
}
