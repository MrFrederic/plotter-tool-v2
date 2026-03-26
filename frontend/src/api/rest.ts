const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

import type { PluginSchema } from '../types';

export function fetchPlugins(): Promise<PluginSchema[]> {
  return request<PluginSchema[]>('/plugins/');
}

export function fetchPlugin(name: string): Promise<PluginSchema> {
  return request<PluginSchema>(`/plugins/${encodeURIComponent(name)}`);
}

export function createProject(data: { name: string; user_id?: string }): Promise<{ id: string }> {
  return request<{ id: string }>('/projects/', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function fetchProjects(userId?: string): Promise<{ id: string; name: string }[]> {
  const query = userId ? `?user_id=${encodeURIComponent(userId)}` : '';
  return request<{ id: string; name: string }[]>(`/projects/${query}`);
}

export function fetchPipeline(id: string): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(`/pipelines/${encodeURIComponent(id)}`);
}

export function savePipeline(data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const method = data.id ? 'PUT' : 'POST';
  const path = data.id ? `/pipelines/${data.id}` : '/pipelines/';
  return request<Record<string, unknown>>(path, {
    method,
    body: JSON.stringify(data),
  });
}

export function executePipeline(id: string): Promise<{ execution_id: string }> {
  return request<{ execution_id: string }>(`/execute/${encodeURIComponent(id)}`, {
    method: 'POST',
  });
}

export function fetchExecutionStatus(id: string): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(`/execute/${encodeURIComponent(id)}/status`);
}
