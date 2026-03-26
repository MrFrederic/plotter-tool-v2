import { useEffect, useRef } from 'react';
import useFlowStore from '../store/useFlowStore';
import type { WebSocketManager } from '../api/websocket';

/**
 * Debounced (500 ms) sync of the current pipeline state to the backend
 * over WebSocket whenever nodes or edges change.
 */
export function usePipelineSync(
  wsRef: { current: WebSocketManager | null },
) {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingStateRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (nodes.length === 0 && edges.length === 0) {
      pendingStateRef.current = null;
      return;
    }

    const pipelineState = {
      type: 'pipeline_sync',
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

    pendingStateRef.current = pipelineState;

    debounceRef.current = setTimeout(() => {
      if (!wsRef.current) return;
      wsRef.current.send(pipelineState);
      pendingStateRef.current = null;
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [nodes, edges, wsRef]);

  // Flush pending state on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const ws = wsRef.current;
      if (pendingStateRef.current && ws) {
        ws.send(pendingStateRef.current);
      }
    };
  }, [wsRef]);
}
