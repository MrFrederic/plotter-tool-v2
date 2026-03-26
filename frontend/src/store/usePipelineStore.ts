import { create } from 'zustand';
import type { TelemetryMessage } from '../types';

interface PipelineState {
  currentPipelineId: string | null;
  pipelineName: string;
  isExecuting: boolean;
  telemetryLog: TelemetryMessage[];
  setCurrentPipeline: (id: string | null, name?: string) => void;
  addTelemetryMessage: (msg: TelemetryMessage) => void;
  setExecuting: (executing: boolean) => void;
  clearTelemetry: () => void;
}

const usePipelineStore = create<PipelineState>((set, get) => ({
  currentPipelineId: null,
  pipelineName: 'Untitled Pipeline',
  isExecuting: false,
  telemetryLog: [],

  setCurrentPipeline: (id, name) => {
    set({
      currentPipelineId: id,
      pipelineName: name ?? get().pipelineName,
    });
  },

  addTelemetryMessage: (msg) => {
    set({ telemetryLog: [...get().telemetryLog, msg] });
  },

  setExecuting: (executing) => {
    set({ isExecuting: executing });
  },

  clearTelemetry: () => {
    set({ telemetryLog: [] });
  },
}));

export default usePipelineStore;
