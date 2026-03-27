import { create } from 'zustand';
import type { TelemetryMessage } from '../types';

function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

interface PipelineState {
  sessionId: string;
  pipelineName: string;
  isExecuting: boolean;
  telemetryLog: TelemetryMessage[];
  setExecuting: (executing: boolean) => void;
  addTelemetryMessage: (msg: TelemetryMessage) => void;
  clearTelemetry: () => void;
}

const usePipelineStore = create<PipelineState>((set, get) => ({
  sessionId: generateSessionId(),
  pipelineName: 'Untitled Pipeline',
  isExecuting: false,
  telemetryLog: [],

  setExecuting: (executing) => {
    set({ isExecuting: executing });
  },

  addTelemetryMessage: (msg) => {
    const log = [...get().telemetryLog, msg];
    set({ telemetryLog: log.length > 500 ? log.slice(-500) : log });
  },

  clearTelemetry: () => {
    set({ telemetryLog: [] });
  },
}));

export default usePipelineStore;
