import { useEffect, useRef } from 'react';
import useFlowStore, { END_NODE_ID } from '../store/useFlowStore';
import type { WebSocketManager } from '../api/websocket';

/**
 * Debounced (500 ms) sync of the current pipeline state to the backend
 * over WebSocket whenever nodes or edges change.
 * Filters out start/end special nodes (frontend-only).
 */
export function usePipelineSync(
  wsRef: { current: WebSocketManager | null },
) {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingStateRef = useRef<Record<string, unknown> | null>(null);
  const pendingSignatureRef = useRef<string | null>(null);
  const lastSentSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Filter out the End node — it's frontend-only. Start node is now synced to backend.
    const syncNodes = nodes.filter((n) => n.id !== END_NODE_ID);
    const syncEdges = edges.filter((e) => e.target !== END_NODE_ID);

    if (syncNodes.length === 0 && syncEdges.length === 0) {
      pendingStateRef.current = null;
      return;
    }

    const pipelineState = {
      type: 'pipeline_sync',
      nodes: syncNodes.map((n) => ({
        id: n.id,
        plugin_name: n.data.pluginName,
        pos_x: n.position.x,
        pos_y: n.position.y,
        params: n.data.params,
      })).sort((a, b) => a.id.localeCompare(b.id)),
      edges: syncEdges.map((e) => ({
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
      if (!wsRef.current) return;
      wsRef.current.send(pipelineState);
      lastSentSignatureRef.current = signature;
      pendingStateRef.current = null;
      pendingSignatureRef.current = null;
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [nodes, edges, wsRef]);

  // Flush pending state on unmount
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
