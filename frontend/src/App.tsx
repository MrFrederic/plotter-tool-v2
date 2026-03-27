import { useState, useEffect, useCallback, useMemo } from 'react';
import './App.css';
import NodeEditor from './components/NodeEditor/NodeEditor';
import NodeInventory from './components/Sidebar/NodeInventory';
import ConfigPanel from './components/Sidebar/ConfigPanel';
import TelemetryPanel from './components/Telemetry/TelemetryPanel';
import PreviewWindow from './components/Preview/PreviewWindow';
import Toolbar from './components/Toolbar/Toolbar';
import DecorativeOverlay from './components/common/DecorativeOverlay';
import ErrorBoundary from './components/common/ErrorBoundary';
import useFlowStore from './store/useFlowStore';
import usePipelineStore from './store/usePipelineStore';
import { useWebSocketBridge } from './hooks/useWebSocketBridge';
import { usePipelineSync } from './hooks/usePipelineSync';
import { fetchNodeResult } from './api/rest';

export default function App() {
  const selectedNodeId = useFlowStore((s) => s.selectedNodeId);
  const selectedEdgeId = useFlowStore((s) => s.selectedEdgeId);
  const selectEdge = useFlowStore((s) => s.selectEdge);
  const selectedOutputPreview = useFlowStore((s) => s.selectedOutputPreview);
  const selectOutputPreview = useFlowStore((s) => s.selectOutputPreview);
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const nodeStatuses = useFlowStore((s) => s.nodeStatuses);
  const sessionId = usePipelineStore((s) => s.sessionId);
  const wsRef = useWebSocketBridge(sessionId);
  usePipelineSync(wsRef);

  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewData, setPreviewData] = useState<Record<string, unknown> | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId],
  );

  const previewNodeId = selectedEdge?.source ?? null;
  const outputPreviewNodeId = selectedOutputPreview?.nodeId ?? null;
  const outputPreviewHandle = selectedOutputPreview?.outputHandle ?? null;

  // Output-port click takes priority over edge click for preview
  const activePreviewNodeId = outputPreviewNodeId ?? previewNodeId;
  const activePreviewHandle = outputPreviewNodeId ? outputPreviewHandle : (selectedEdge?.sourceHandle ?? null);

  const activePreviewNode = useMemo(
    () => (activePreviewNodeId ? nodes.find((n) => n.id === activePreviewNodeId) ?? null : null),
    [nodes, activePreviewNodeId],
  );

  const outputType = useMemo(() => {
    if (!activePreviewNode?.data?.outputs?.length) return undefined;

    if (activePreviewHandle) {
      const matchingOutput = activePreviewNode.data.outputs.find(
        (output) => output.name === activePreviewHandle,
      );
      if (matchingOutput) return matchingOutput.type;
    }

    return activePreviewNode.data.outputs[0].type;
  }, [activePreviewNode, activePreviewHandle]);

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

  const activePreviewNodeStatus = activePreviewNodeId ? nodeStatuses[activePreviewNodeId] : undefined;

  useEffect(() => {
    if (!activePreviewNodeId) {
      setPreviewVisible(false);
      setPreviewData(null);
      setPreviewError(null);
      return;
    }

    setPreviewVisible(true);

    if (activePreviewNodeStatus !== 'DONE' && activePreviewNodeStatus !== 'CACHED') {
      setPreviewLoading(false);
      setPreviewData(null);
      setPreviewError(null);
      return;
    }

    const abortController = new AbortController();
    loadPreview(sessionId, activePreviewNodeId, abortController.signal);

    return () => { abortController?.abort(); };
  }, [activePreviewNodeId, activePreviewNodeStatus, sessionId, loadPreview]);

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
          onClose={() => {
            setPreviewVisible(false);
            selectEdge(null);
            selectOutputPreview(null);
          }}
          title="CONNECTION PREVIEW"
          nodeId={activePreviewNodeId}
          outputType={outputType}
          resultData={previewData}
          loading={previewLoading}
          error={previewError}
        />
      </ErrorBoundary>

      <DecorativeOverlay />
    </>
  );
}
