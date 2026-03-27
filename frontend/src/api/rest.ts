import type { PluginSchema } from '../types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function requestBlob(path: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${res.statusText}`);
  }
  return res.blob();
}

export function fetchPlugins(): Promise<PluginSchema[]> {
  return request<PluginSchema[]>('/plugins/');
}

export function fetchPlugin(name: string): Promise<PluginSchema> {
  return request<PluginSchema>(`/plugins/${encodeURIComponent(name)}`);
}

export interface ExecutePipelinePayload {
  session_id: string;
  nodes: {
    id: string;
    plugin_name: string;
    pos_x: number;
    pos_y: number;
    params: Record<string, unknown>;
  }[];
  edges: {
    source_node_id: string;
    source_output: string;
    target_node_id: string;
    target_input: string;
  }[];
}

export function executePipeline(
  payload: ExecutePipelinePayload,
): Promise<{ run_id: string; status: string }> {
  return request<{ run_id: string; status: string }>('/execute', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchExecutionStatus(runId: string): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(`/execute/${encodeURIComponent(runId)}/status`);
}

export function fetchNodeResult(
  sessionId: string,
  nodeId: string,
  signal?: AbortSignal,
): Promise<{ node_id: string; hash: string; data: Record<string, unknown> }> {
  return request<{ node_id: string; hash: string; data: Record<string, unknown> }>(
    `/preview/${encodeURIComponent(sessionId)}/${encodeURIComponent(nodeId)}`,
    signal ? { signal } : undefined,
  );
}

export function fetchCachedFile(hash: string, extension?: string): Promise<Blob> {
  const ext = extension ? `?ext=${encodeURIComponent(extension)}` : '';
  return requestBlob(`/preview/cache/${encodeURIComponent(hash)}${ext}`);
}

export async function uploadFile(
  file: File,
  sessionId: string,
): Promise<{ filename: string; path: string; size: number }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('session_id', sessionId);
  const resp = await fetch(`${API_BASE}/upload/`, {
    method: 'POST',
    body: formData,
  });
  if (!resp.ok) {
    throw new Error(`Upload failed: ${resp.statusText}`);
  }
  return resp.json();
}

export function clearSessionUploadCache(
  sessionId: string,
): Promise<{
  session_id: string;
  removed_runs: number;
  removed_result_files: number;
  removed_upload_files: number;
  removed_db_rows: number;
}> {
  return request(`/upload/session/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
}
