import { apiFetch, readApiError, readApiJson } from './api';

export interface MemoryConsoleOverview {
  engine: string;
  capabilities: { rules: boolean; graph: boolean; sources: boolean; importLegacy: boolean };
  mission: string;
  ruleVersion: number;
  history: { version: number; mission: string }[];
  reviewNewFacts: boolean;
  jobs: { id: string; sourceId: string; status: string; attempts: number; sourceStatus: string | null; error: string | null }[];
}

export interface MemoryGraphNode { id: string; content: string; sourceRef: string }
export interface MemoryGraph {
  nodes: MemoryGraphNode[];
  edges: { source: string; target: string; relation: string }[];
}

export interface MemorySourceRecord {
  id: string;
  status: string;
  ruleVersion: number;
  createdAt: string;
  document: { id: string; content: string } | null;
}

export async function memoryConsole<T = any>(path = '', method = 'GET', body?: unknown): Promise<T> {
  const response = await apiFetch('/api/memory-console' + path, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return readApiJson<T>(response);
}
