import { useMemo, useState, useEffect, useCallback } from 'react';
import './App.css';
import NodeEditor from './components/NodeEditor/NodeEditor';
import NodeInventory from './components/Sidebar/NodeInventory';
import ConfigPanel from './components/Sidebar/ConfigPanel';
import TelemetryPanel from './components/Telemetry/TelemetryPanel';
import PreviewWindow from './components/Preview/PreviewWindow';
import Toolbar from './components/Toolbar/Toolbar';
import ScanlineOverlay from './components/common/ScanlineOverlay';
import DecorativeOverlay from './components/common/DecorativeOverlay';
import useFlowStore from './store/useFlowStore';
import { useWebSocketBridge } from './hooks/useWebSocketBridge';
import { usePipelineSync } from './hooks/usePipelineSync';
import { fetchNodeResult } from './api/rest';

function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function App() {
  const selectedNodeId = useFlowStore((s) => s.selectedNodeId);
  const nodes = useFlowStore((s) => s.nodes);
  const nodeStatuses = useFlowStore((s) => s.nodeStatuses);
  const sessionId = useMemo(generateSessionId, []);
  const wsRef = useWebSocketBridge(sessionId);
  usePipelineSync(wsRef);

  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewData, setPreviewData] = useState<Record<string, unknown> | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const outputType = useMemo(() => {
    if (!selectedNode?.data?.outputs?.length) return undefined;
    return selectedNode.data.outputs[0].type;
  }, [selectedNode]);

  const loadPreview = useCallback(async (pipelineId: string, nodeId: string) => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await fetchNodeResult(pipelineId, nodeId);
      setPreviewData(result.data as Record<string, unknown>);
    } catch {
      setPreviewData(null);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedNodeId) {
      setPreviewVisible(false);
      return;
    }

    const status = nodeStatuses[selectedNodeId];
    if (status === 'DONE' || status === 'CACHED') {
      setPreviewVisible(true);
      loadPreview(sessionId, selectedNodeId);
    }
  }, [selectedNodeId, nodeStatuses, sessionId, loadPreview]);

  return (
    <>
      <div
        className={`app-layout ${selectedNodeId ? '' : 'app-layout--no-config'}`}
      >
        <div className="app-layout__sidebar">
          <NodeInventory />
        </div>

        <div className="app-layout__canvas">
          <Toolbar />
          <NodeEditor />
        </div>

        {selectedNodeId && (
          <div className="app-layout__config">
            <ConfigPanel />
          </div>
        )}

        <div className="app-layout__telemetry">
          <TelemetryPanel />
        </div>
      </div>

      <PreviewWindow
        visible={previewVisible}
        onClose={() => setPreviewVisible(false)}
        title="OUTPUT PREVIEW"
        nodeId={selectedNodeId}
        outputType={outputType}
        resultData={previewData}
        loading={previewLoading}
        error={previewError}
      />

      <ScanlineOverlay />
      <DecorativeOverlay />
    </>
  );
}
