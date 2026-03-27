import './Toolbar.css';
import useFlowStore, { START_NODE_ID, END_NODE_ID } from '../../store/useFlowStore';
import usePipelineStore from '../../store/usePipelineStore';
import GlitchText from '../common/GlitchText';

export default function Toolbar() {
  const nodes = useFlowStore((s) => s.nodes);
  const isExecuting = usePipelineStore((s) => s.isExecuting);
  const pipelineName = usePipelineStore((s) => s.pipelineName);

  const processNodeCount = nodes.filter(
    (n) => n.id !== START_NODE_ID && n.id !== END_NODE_ID,
  ).length;

  return (
    <div className="toolbar">
      <div className="toolbar__group">
        <GlitchText text={pipelineName} className="toolbar__label" />
        <span className="toolbar__separator">│</span>
        <span className="toolbar__node-count">
          {processNodeCount} module{processNodeCount !== 1 ? 's' : ''}
        </span>
      </div>

      {isExecuting && (
        <div className="toolbar__group">
          <span className="toolbar__executing">● PROCESSING...</span>
        </div>
      )}
    </div>
  );
}
