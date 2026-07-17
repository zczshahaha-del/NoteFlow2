import { apiFetch, readApiError, readApiJson } from "./api";
import type { AgentToolTrace } from "../types";

export interface AgentCheckpointRecord {
  id: string;
  runId: string;
  sessionId: string;
  intent: string;
  status: string;
  checkpointType: string;
  payload: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
  resolvedAt: string | null;
}

export interface AgentRunRecord {
  id: string;
  sessionId: string;
  intent: string;
  status: string;
  rawStatus: string;
  inputText: string;
  outputText: string;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  toolTraces: AgentToolTrace[];
}

export interface AgentTaskSnapshot {
  run: AgentRunRecord;
  checkpoint: AgentCheckpointRecord | null;
}

export async function getLatestAgentTask(
  sessionId?: string | null
): Promise<AgentTaskSnapshot | null> {
  const suffix = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  const response = await apiFetch(`/api/agent/runs/latest${suffix}`);
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ task: AgentTaskSnapshot | null }>(response);
  return data.task;
}

export async function listAgentRuns(
  sessionId?: string | null,
  limit = 8
): Promise<AgentTaskSnapshot[]> {
  const params = new URLSearchParams();
  if (sessionId) params.set("sessionId", sessionId);
  params.set("limit", String(limit));
  const response = await apiFetch(`/api/agent/runs?${params.toString()}`);
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ tasks: AgentTaskSnapshot[] }>(response);
  return data.tasks;
}

export async function cancelAgentRun(
  runId: string,
  reason = "user_cancelled"
): Promise<AgentTaskSnapshot | null> {
  const response = await apiFetch(`/api/agent/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ task: AgentTaskSnapshot | null }>(response);
  return data.task;
}

export async function getLatestAgentCheckpoint(
  sessionId?: string | null
): Promise<AgentCheckpointRecord | null> {
  const suffix = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  const response = await apiFetch(`/api/agent/checkpoints/latest${suffix}`);
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ checkpoint: AgentCheckpointRecord | null }>(response);
  return data.checkpoint;
}

export async function bindAgentCheckpoint(
  checkpointId: string,
  payload: {
    editPreviewId?: string | null;
    draftId?: string | null;
    payload?: Record<string, unknown>;
  }
): Promise<AgentCheckpointRecord | null> {
  const response = await apiFetch(`/api/agent/checkpoints/${encodeURIComponent(checkpointId)}/bind`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ checkpoint: AgentCheckpointRecord | null }>(response);
  return data.checkpoint;
}

export async function resolveAgentCheckpoint(
  checkpointId: string,
  status: "resolved" | "cancelled" | "failed" = "resolved",
  payload: Record<string, unknown> = {}
): Promise<AgentCheckpointRecord | null> {
  const response = await apiFetch(`/api/agent/checkpoints/${encodeURIComponent(checkpointId)}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, payload }),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ checkpoint: AgentCheckpointRecord | null }>(response);
  return data.checkpoint;
}
