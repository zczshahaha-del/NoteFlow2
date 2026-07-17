import { apiFetch, readApiError, readApiJson } from "./api";

export type MemoryType =
  | "episode"
  | "identity"
  | "personal_info"
  | "interest"
  | "preference"
  | "goal"
  | "writing_style"
  | "project"
  | "skill"
  | "constraint"
  | "workflow"
  | string;

export type MemoryStatus = "active" | "pending" | "archived" | "deleted" | string;

export interface UserMemoryRecord {
  id: string;
  memoryType: MemoryType;
  content: string;
  canonicalKey: string;
  value: string;
  layer: string;
  importance: number;
  confidence: number | null;
  source: string;
  scope: string;
  tags: string[];
  status: MemoryStatus;
  lastUsedAt: string | null;
  accessCount: number;
  createdAt: string | null;
  updatedAt: string | null;
  deletedAt: string | null;
}

export interface MemoryCandidate {
  memoryType: MemoryType;
  content: string;
  canonicalKey: string;
  value: string;
  layer: string;
  importance: number;
  confidence: number;
  shouldSave: boolean;
  source: string;
  scope: string;
  tags: string[];
  stability?: string;
  subject?: string;
  temporalScope?: string;
  operation?: string;
  reason?: string;
}

export interface MemoryPayload {
  memoryType: MemoryType;
  content: string;
  importance?: number;
  confidence?: number | null;
  source?: string;
  scope?: string;
  tags?: string[];
}

export interface MemoryUpdatePayload {
  memoryType?: MemoryType;
  content?: string;
  importance?: number;
  confidence?: number | null;
  source?: string;
  scope?: string;
  tags?: string[];
  status?: MemoryStatus;
  reason?: string;
}

const MEMORY_ENABLED_STORAGE_KEY = "noteflow-memory-enabled";

export interface UserSettingsRecord {
  memoryEnabled: boolean;
  preferences: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
}

let memoryEnabledCache = readLocalMemoryEnabled();

function readLocalMemoryEnabled(): boolean {
  try {
    return localStorage.getItem(MEMORY_ENABLED_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeLocalMemoryEnabled(enabled: boolean) {
  try {
    localStorage.setItem(MEMORY_ENABLED_STORAGE_KEY, enabled ? "true" : "false");
  } catch {}
}

export function isMemoryEnabled(): boolean {
  return memoryEnabledCache;
}

export function setMemoryEnabledLocal(enabled: boolean) {
  memoryEnabledCache = enabled;
  writeLocalMemoryEnabled(enabled);
}

export async function loadMemorySettings(): Promise<UserSettingsRecord> {
  const response = await apiFetch("/api/settings");
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ settings: UserSettingsRecord }>(response);
  setMemoryEnabledLocal(data.settings.memoryEnabled);
  return data.settings;
}

export async function setMemoryEnabled(enabled: boolean): Promise<UserSettingsRecord> {
  setMemoryEnabledLocal(enabled);
  const response = await apiFetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memoryEnabled: enabled }),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ settings: UserSettingsRecord }>(response);
  setMemoryEnabledLocal(data.settings.memoryEnabled);
  return data.settings;
}

export async function listMemories(includeDeleted = false): Promise<UserMemoryRecord[]> {
  const response = await apiFetch(`/api/memories${includeDeleted ? "?includeDeleted=true" : ""}`);
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ memories: UserMemoryRecord[] }>(response);
  return data.memories;
}

export async function searchMemories(payload: {
  query?: string;
  memoryTypes?: MemoryType[];
  scopes?: string[];
  limit?: number;
}): Promise<UserMemoryRecord[]> {
  const response = await apiFetch("/api/memories/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ memories: UserMemoryRecord[] }>(response);
  return data.memories;
}

export async function extractMemory(text: string, context = "global"): Promise<{
  candidates: MemoryCandidate[];
  reason: string;
}> {
  const response = await apiFetch("/api/memories/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, context }),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return readApiJson<{ candidates: MemoryCandidate[]; reason: string }>(response);
}

export async function createMemory(payload: MemoryPayload): Promise<UserMemoryRecord> {
  const response = await apiFetch("/api/memories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ memory: UserMemoryRecord }>(response);
  return data.memory;
}

export async function updateMemory(
  memoryId: string,
  payload: MemoryUpdatePayload
): Promise<UserMemoryRecord> {
  const response = await apiFetch(`/api/memories/${encodeURIComponent(memoryId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ memory: UserMemoryRecord }>(response);
  return data.memory;
}

export async function deleteMemory(memoryId: string): Promise<UserMemoryRecord> {
  const response = await apiFetch(`/api/memories/${encodeURIComponent(memoryId)}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ memory: UserMemoryRecord }>(response);
  return data.memory;
}
