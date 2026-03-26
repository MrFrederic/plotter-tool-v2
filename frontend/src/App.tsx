import { useState } from 'react';
import './App.css';
import NodeEditor from './components/NodeEditor/NodeEditor';
import NodeInventory from './components/Sidebar/NodeInventory';
import ConfigPanel from './components/Sidebar/ConfigPanel';
import TelemetryPanel from './components/Telemetry/TelemetryPanel';
import PreviewWindow from './components/Preview/PreviewWindow';
import ScanlineOverlay from './components/common/ScanlineOverlay';
import DecorativeOverlay from './components/common/DecorativeOverlay';
import useFlowStore from './store/useFlowStore';

export default function App() {
  const selectedNodeId = useFlowStore((s) => s.selectedNodeId);
  const [previewVisible, setPreviewVisible] = useState(false);

  return (
    <>
      <div
        className={`app-layout ${selectedNodeId ? '' : 'app-layout--no-config'}`}
      >
        <div className="app-layout__sidebar">
          <NodeInventory />
        </div>

        <div className="app-layout__canvas">
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
      />

      <ScanlineOverlay />
      <DecorativeOverlay />
    </>
  );
}
