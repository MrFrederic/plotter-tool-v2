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
  const setNodeError = useFlowStore((s) => s.setNodeError);
  const addTelemetryMessage = usePipelineStore((s) => s.addTelemetryMessage);
  const setExecuting = usePipelineStore((s) => s.setExecuting);

  useEffect(() => {
    const ws = new WebSocketManager(sessionId);
    wsRef.current = ws;

    const unsubscribe = ws.onMessage((data) => {
      if (data.type === 'node_status') {
        const nodeId = data.node_id as string;
        const status = (data.status as string).toUpperCase() as NodeStatus;
        setNodeStatus(nodeId, status);

        // Capture error messages when status is ERROR
        if (status === 'ERROR') {
          const errorMsg =
            (data.error as string) ||
            (data.message as string) ||
            'Unknown error during execution';
          setNodeError(nodeId, errorMsg);
        } else {
          // Clear previous error when node moves to a non-error state
          setNodeError(nodeId, null);
        }

        const telemetryMsg: TelemetryMessage = {
          node_id: nodeId,
          status,
          progress: data.progress as number | undefined,
          message:
            status === 'ERROR'
              ? (data.error as string) || (data.message as string) || 'Execution error'
              : (data.message as string | undefined),
          timestamp: (data.timestamp as string) || new Date().toISOString(),
        };
        addTelemetryMessage(telemetryMsg);
      }

      if (data.type === 'execution_complete') {
        setExecuting(false);

        // If execution completed with errors, add a summary telemetry entry
        if (data.status === 'error' || data.error) {
          const errorMsg =
            (data.error as string) || 'Pipeline execution completed with errors';
          addTelemetryMessage({
            node_id: 'SYSTEM',
            status: 'ERROR',
            message: errorMsg,
            timestamp: new Date().toISOString(),
          });
        }
      }
    });

    return () => {
      unsubscribe();
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId, setNodeStatus, setNodeError, addTelemetryMessage, setExecuting]);

  return wsRef;
}
