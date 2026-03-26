import { useEffect, useRef } from 'react';
import { WebSocketManager } from '../api/websocket';
import useFlowStore from '../store/useFlowStore';
import usePipelineStore from '../store/usePipelineStore';
import type { NodeStatus, TelemetryMessage } from '../types';

/**
 * Connects a WebSocket to the backend and dispatches incoming
 * node_status / execution_complete messages to the Zustand stores.
 */
export function useWebSocketBridge(sessionId: string) {
  const wsRef = useRef<WebSocketManager | null>(null);
  const setNodeStatus = useFlowStore((s) => s.setNodeStatus);
  const addTelemetryMessage = usePipelineStore((s) => s.addTelemetryMessage);
  const setExecuting = usePipelineStore((s) => s.setExecuting);

  useEffect(() => {
    const ws = new WebSocketManager(sessionId);
    wsRef.current = ws;

    const unsubscribe = ws.onMessage((data) => {
      if (data.type === 'node_status') {
        const nodeId = data.node_id as string;
        const status = data.status as NodeStatus;
        setNodeStatus(nodeId, status);

        const telemetryMsg: TelemetryMessage = {
          node_id: nodeId,
          status,
          progress: data.progress as number | undefined,
          message: data.message as string | undefined,
          timestamp: (data.timestamp as string) || new Date().toISOString(),
        };
        addTelemetryMessage(telemetryMsg);
      }

      if (data.type === 'execution_complete') {
        setExecuting(false);
      }
    });

    return () => {
      unsubscribe();
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId, setNodeStatus, addTelemetryMessage, setExecuting]);

  return wsRef;
}
