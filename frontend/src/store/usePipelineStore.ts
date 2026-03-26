import { create } from 'zustand';
import type { TelemetryMessage } from '../types';

interface PipelineState {
  currentPipelineId: string | null;
  projectId: string | null;
  pipelineName: string;
  isExecuting: boolean;
  telemetryLog: TelemetryMessage[];
  setCurrentPipeline: (id: string | null, name?: string) => void;
  setProjectId: (id: string) => void;
  addTelemetryMessage: (msg: TelemetryMessage) => void;
  setExecuting: (executing: boolean) => void;
  clearTelemetry: () => void;
}

const usePipelineStore = create<PipelineState>((set, get) => ({
  currentPipelineId: null,
  projectId: null,
  pipelineName: 'Untitled Pipeline',
  isExecuting: false,
  telemetryLog: [],

  setCurrentPipeline: (id, name) => {
    set({
      currentPipelineId: id,
      pipelineName: name ?? get().pipelineName,
    });
  },

  setProjectId: (id) => {
    set({ projectId: id });
  },

  addTelemetryMessage: (msg) => {
    const log = [...get().telemetryLog, msg];
    set({ telemetryLog: log.length > 500 ? log.slice(-500) : log });
  },

  setExecuting: (executing) => {
    set({ isExecuting: executing });
  },

  clearTelemetry: () => {
    set({ telemetryLog: [] });
  },
}));

export default usePipelineStore;
