export type NodeStatus = 'IDLE' | 'WAITING' | 'RUNNING' | 'CACHED' | 'DONE' | 'ERROR';

export interface PluginSchema {
  name: string;
  category: string;
  description: string;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  parameters: ParameterDefinition[];
}

export interface PortDefinition {
  name: string;
  type: 'image' | 'vector' | 'gcode' | 'path' | 'text' | 'other';
  description?: string;
}

export interface ParameterDefinition {
  name: string;
  type: 'number' | 'string' | 'boolean' | 'select' | 'color';
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  description?: string;
}

export interface TelemetryMessage {
  node_id: string;
  status: NodeStatus;
  progress?: number;
  message?: string;
  timestamp: string;
}

export interface PipelineNode {
  id: string;
  plugin_name: string;
  pos_x: number;
  pos_y: number;
  params: Record<string, unknown>;
}

export interface PipelineEdge {
  id: string;
  source_node_id: string;
  source_output: string;
  target_node_id: string;
  target_input: string;
}
