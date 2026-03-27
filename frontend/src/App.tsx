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
  const selectedEdgeId = useFlowStore((s) => s.selectedEdgeId);
  const selectEdge = useFlowStore((s) => s.selectEdge);
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

  const previewNode = useMemo(
    () => (selectedEdge ? nodes.find((n) => n.id === selectedEdge.source) ?? null : null),
    [nodes, selectedEdge],
  );

  const previewNodeId = selectedEdge?.source ?? null;
  const previewNodeStatus = previewNodeId ? nodeStatuses[previewNodeId] : undefined;

  const outputType = useMemo(() => {
    if (!previewNode?.data?.outputs?.length) return undefined;

    if (selectedEdge?.sourceHandle) {
      const matchingOutput = previewNode.data.outputs.find(
        (output) => output.name === selectedEdge.sourceHandle,
      );
      if (matchingOutput) return matchingOutput.type;
    }

    return previewNode.data.outputs[0].type;
  }, [previewNode, selectedEdge]);

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
    if (!selectedEdge || !previewNodeId) {
      setPreviewVisible(false);
      setPreviewData(null);
      setPreviewError(null);
      return;
    }

    setPreviewVisible(true);

    if (previewNodeStatus !== 'DONE' && previewNodeStatus !== 'CACHED') {
      setPreviewLoading(false);
      setPreviewData(null);
      setPreviewError(null);
      return;
    }

    const abortController = new AbortController();
    loadPreview(sessionId, previewNodeId, abortController.signal);

    return () => { abortController?.abort(); };
  }, [selectedEdge, previewNodeId, previewNodeStatus, sessionId, loadPreview]);

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
          }}
          title="CONNECTION PREVIEW"
          nodeId={previewNodeId}
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
