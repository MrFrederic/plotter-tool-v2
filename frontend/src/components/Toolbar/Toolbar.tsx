import { useCallback } from 'react';
import './Toolbar.css';
import useFlowStore, { START_NODE_ID, END_NODE_ID } from '../../store/useFlowStore';
import usePipelineStore from '../../store/usePipelineStore';
import { executePipeline, savePipeline } from '../../api/rest';
import GlitchText from '../common/GlitchText';

const SPECIAL_IDS = new Set([START_NODE_ID, END_NODE_ID]);

export default function Toolbar() {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const isExecuting = usePipelineStore((s) => s.isExecuting);
  const setExecuting = usePipelineStore((s) => s.setExecuting);
  const clearTelemetry = usePipelineStore((s) => s.clearTelemetry);
  const addTelemetryMessage = usePipelineStore((s) => s.addTelemetryMessage);
  const currentPipelineId = usePipelineStore((s) => s.currentPipelineId);
  const pipelineName = usePipelineStore((s) => s.pipelineName);
  const projectId = usePipelineStore((s) => s.projectId);
  const setCurrentPipeline = usePipelineStore((s) => s.setCurrentPipeline);

  // Count only processing nodes (not start/end)
  const processNodeCount = nodes.filter((n) => !SPECIAL_IDS.has(n.id)).length;

  const handleExecute = useCallback(async () => {
    if (isExecuting || processNodeCount === 0) return;

    try {
      setExecuting(true);
      clearTelemetry();

      // Filter out start/end nodes — they are frontend-only
      const syncNodes = nodes.filter((n) => !SPECIAL_IDS.has(n.id));
      const syncEdges = edges.filter(
        (e) => !SPECIAL_IDS.has(e.source) && !SPECIAL_IDS.has(e.target),
      );

      const pipelineData: Record<string, unknown> = {
        id: currentPipelineId,
        project_id: projectId,
        name: pipelineName,
        nodes: syncNodes.map((n) => ({
          id: n.id,
          plugin_name: n.data.pluginName,
          pos_x: n.position.x,
          pos_y: n.position.y,
          params: n.data.params,
        })),
        edges: syncEdges.map((e) => ({
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
  }, [
    isExecuting,
    processNodeCount,
    nodes,
    edges,
    currentPipelineId,
    projectId,
    pipelineName,
    setExecuting,
    clearTelemetry,
    setCurrentPipeline,
    addTelemetryMessage,
  ]);

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
