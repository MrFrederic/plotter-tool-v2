import { useMemo } from 'react';
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

function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function App() {
  const selectedNodeId = useFlowStore((s) => s.selectedNodeId);
  const sessionId = useMemo(generateSessionId, []);
  const wsRef = useWebSocketBridge(sessionId);
  usePipelineSync(wsRef);

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
        visible={false}
        onClose={() => {/* managed externally */}}
      />

      <ScanlineOverlay />
      <DecorativeOverlay />
    </>
  );
}
