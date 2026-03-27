import { useEffect, useRef } from 'react';
import useFlowStore, { END_NODE_ID, START_NODE_ID } from '../store/useFlowStore';
import type { WebSocketManager } from '../api/websocket';
import { executePipeline } from '../api/rest';
import type { ExecutePipelinePayload } from '../api/rest';
import usePipelineStore from '../store/usePipelineStore';

const EXCLUDED_IDS = new Set([END_NODE_ID]);

/**
 * Debounced (600 ms) sync of the current pipeline state to the backend
 * over WebSocket whenever nodes/edges change (ignoring pure position moves).
 * Also triggers auto-execution whenever a runnable pipeline state changes.
 */
export function usePipelineSync(
  wsRef: { current: WebSocketManager | null },
) {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const runnableNodeIds = useFlowStore((s) => s.runnableNodeIds);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingStateRef = useRef<Record<string, unknown> | null>(null);
  const pendingSignatureRef = useRef<string | null>(null);
  const lastSentSignatureRef = useRef<string | null>(null);
  const sessionId = usePipelineStore((s) => s.sessionId);
  const setExecuting = usePipelineStore((s) => s.setExecuting);
  const clearTelemetry = usePipelineStore((s) => s.clearTelemetry);
  const addTelemetryMessage = usePipelineStore((s) => s.addTelemetryMessage);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Filter based on runnability: only send nodes that can actually execute.
    // End node is always excluded. Start node is kept if it has a file.
    const syncNodes = nodes.filter((n) => !EXCLUDED_IDS.has(n.id) && (n.id === START_NODE_ID || runnableNodeIds.has(n.id)));
    const syncEdges = edges.filter(
      (e) => !EXCLUDED_IDS.has(e.target) && runnableNodeIds.has(e.source) && runnableNodeIds.has(e.target),
    );

    // Always sync structure for WS state persistence
    const allSyncNodes = nodes.filter((n) => !EXCLUDED_IDS.has(n.id));
    const allSyncEdges = edges.filter((e) => !EXCLUDED_IDS.has(e.target));

    if (allSyncNodes.length === 0 && allSyncEdges.length === 0) {
      pendingStateRef.current = null;
      return;
    }

    const pipelineState = {
      type: 'pipeline_sync',
      nodes: allSyncNodes.map((n) => ({
        id: n.id,
        plugin_name: n.data.pluginName,
        pos_x: n.position.x,
        pos_y: n.position.y,
        params: n.data.params,
      })).sort((a, b) => a.id.localeCompare(b.id)),
      edges: allSyncEdges.map((e) => ({
        id: e.id,
        source_node_id: e.source,
        source_output: e.sourceHandle || 'output',
        target_node_id: e.target,
        target_input: e.targetHandle || 'input',
      })).sort((a, b) => a.id.localeCompare(b.id)),
    };

    const signature = JSON.stringify({
      nodes: pipelineState.nodes,
      edges: pipelineState.edges,
    });

    if (
      signature === pendingSignatureRef.current ||
      signature === lastSentSignatureRef.current
    ) {
      return;
    }

    pendingStateRef.current = pipelineState;
    pendingSignatureRef.current = signature;

    debounceRef.current = setTimeout(() => {
      if (wsRef.current) {
        wsRef.current.send(pipelineState);
        lastSentSignatureRef.current = signature;
        pendingStateRef.current = null;
        pendingSignatureRef.current = null;
      }

      // Auto-execute if there are runnable process nodes (not just start/end)
      const runnableProcessNodes = syncNodes.filter(
        (n) => n.id !== START_NODE_ID,
      );
      if (runnableProcessNodes.length === 0) return;

      const startNode = syncNodes.find((n) => n.id === START_NODE_ID);
      if (!startNode || !startNode.data.params?.file_path) return;

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

      setExecuting(true);
      clearTelemetry();

      executePipeline(payload).catch((err) => {
        setExecuting(false);
        const errorMsg = err instanceof Error ? err.message : 'Pipeline execution failed';
        addTelemetryMessage({
          node_id: 'SYSTEM',
          status: 'ERROR',
          message: errorMsg,
          timestamp: new Date().toISOString(),
        });
      });
    }, 600);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [nodes, edges, runnableNodeIds, wsRef, sessionId, setExecuting, clearTelemetry, addTelemetryMessage]);

  // Flush pending WS state on unmount
  useEffect(() => {
    const currentWsRef = wsRef;
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const ws = currentWsRef.current;
      if (
        pendingStateRef.current &&
        pendingSignatureRef.current &&
        pendingSignatureRef.current !== lastSentSignatureRef.current &&
        ws
      ) {
        ws.send(pendingStateRef.current);
        lastSentSignatureRef.current = pendingSignatureRef.current;
      }
    };
  }, [wsRef]);
}
