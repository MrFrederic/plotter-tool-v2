import { useState, useEffect, useCallback, useMemo } from 'react';
import './App.css';
import NodeEditor from './components/NodeEditor/NodeEditor';
import NodeInventory from './components/Sidebar/NodeInventory';
import ConfigPanel from './components/Sidebar/ConfigPanel';
import TelemetryPanel from './components/Telemetry/TelemetryPanel';
import PreviewWindow from './components/Preview/PreviewWindow';
import Toolbar from './components/Toolbar/Toolbar';
import ScanlineOverlay from './components/common/ScanlineOverlay';
import DecorativeOverlay from './components/common/DecorativeOverlay';
import ErrorBoundary from './components/common/ErrorBoundary';
import useFlowStore from './store/useFlowStore';
import usePipelineStore from './store/usePipelineStore';
import { useWebSocketBridge } from './hooks/useWebSocketBridge';
import { usePipelineSync } from './hooks/usePipelineSync';
import { fetchNodeResult } from './api/rest';

export default function App() {
  const selectedNodeId = useFlowStore((s) => s.selectedNodeId);
  const nodes = useFlowStore((s) => s.nodes);
  const selectedStatus = useFlowStore((s) =>
    s.selectedNodeId ? s.nodeStatuses[s.selectedNodeId] : undefined,
  );
  const sessionId = usePipelineStore((s) => s.sessionId);
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

  const loadPreview = useCallback(async (pipelineId: string, nodeId: string, signal?: AbortSignal) => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await fetchNodeResult(pipelineId, nodeId, signal);
      if (signal?.aborted) return;
      setPreviewData(result.data as Record<string, unknown>);
    } catch (err) {
      if (signal?.aborted) return;
      setPreviewData(null);
      setPreviewError(err instanceof Error ? err.message : 'Failed to load preview');
    } finally {
      if (!signal?.aborted) {
        setPreviewLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!selectedNodeId) {
      setPreviewVisible(false);
      return;
    }

    let abortController: AbortController | undefined;
    if (selectedStatus === 'DONE' || selectedStatus === 'CACHED') {
      setPreviewVisible(true);
      abortController = new AbortController();
      loadPreview(sessionId, selectedNodeId, abortController.signal);
    }

    return () => { abortController?.abort(); };
  }, [selectedNodeId, selectedStatus, sessionId, loadPreview]);

  return (
    <>
      <div
        className={`app-layout ${selectedNodeId ? '' : 'app-layout--no-config'}`}
      >
        <div className="app-layout__sidebar">
          <ErrorBoundary name="NodeInventory">
            <NodeInventory />
          </ErrorBoundary>
        </div>

        <div className="app-layout__canvas">
          <Toolbar />
          <ErrorBoundary name="NodeEditor">
            <NodeEditor />
          </ErrorBoundary>
        </div>

        {selectedNodeId && (
          <div className="app-layout__config">
            <ErrorBoundary name="ConfigPanel">
              <ConfigPanel />
            </ErrorBoundary>
          </div>
        )}

        <div className="app-layout__telemetry">
          <ErrorBoundary name="TelemetryPanel">
            <TelemetryPanel />
          </ErrorBoundary>
        </div>
      </div>

      <ErrorBoundary name="PreviewWindow">
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
      </ErrorBoundary>

      <ScanlineOverlay />
      <DecorativeOverlay />
    </>
  );
}
