import { apiFetch, readApiError, readApiJson } from "./api";
import type { ChatSource } from "../types";

export interface NoteRecord {
  id: string;
  title: string;
  categoryId: string | null;
  summary: string | null;
  tags: string[];
  content: string;
  isPinned: boolean;
  isFavorite: boolean;
  indexStatus: string;
  createdAt: string | null;
  updatedAt: string | null;
  deletedAt: string | null;
}

export interface NoteVersionRecord {
  id: string;
  noteId: string;
  title: string;
  content: string;
  changeSummary: string | null;
  source: string;
  createdAt: string | null;
}

export interface NoteSectionRecord {
  id: string;
  noteId: string;
  parentId: string | null;
  title: string;
  level: number;
  sortOrder: number;
  content: string;
  tokenCount: number;
  createdAt: string | null;
}

export interface NoteIndexJobRecord {
  id: string;
  noteId: string;
  status: "pending" | "running" | "success" | "failed" | string;
  errorMessage: string | null;
  stats?: Record<string, unknown>;
  retryCount?: number;
  maxRetries?: number;
  nextAttemptAt?: string | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface NoteSearchQueryPlan {
  originalQuery: string;
  searchQuery: string;
  intent: string;
  scopeHint: string;
  terms: string[];
  rewrittenQueries: string[];
}

export interface NoteSearchResponse {
  query: NoteSearchQueryPlan;
  results: ChatSource[];
}

export interface NotePayload {
  id?: string;
  title: string;
  categoryId?: string | null;
  summary?: string | null;
  tags?: string[];
  content?: string;
  isPinned?: boolean;
  isFavorite?: boolean;
}

export interface NoteUpdatePayload {
  title?: string;
  categoryId?: string | null;
  summary?: string | null;
  tags?: string[];
  content?: string;
  isPinned?: boolean;
  isFavorite?: boolean;
  indexStatus?: string;
  source?: "manual_edit" | "auto_save" | "restore";
  changeSummary?: string | null;
  expectedUpdatedAt?: string | null;
}

export async function listNotes(includeDeleted = false): Promise<NoteRecord[]> {
  const response = await apiFetch(`/api/notes${includeDeleted ? "?includeDeleted=true" : ""}`);
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ notes: NoteRecord[] }>(response);
  return data.notes;
}

export async function searchNotes(
  query: string,
  options: { noteId?: string | null; limit?: number; signal?: AbortSignal } = {}
): Promise<NoteSearchResponse> {
  const response = await apiFetch("/api/notes/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      noteId: options.noteId ?? null,
      limit: options.limit ?? 12,
    }),
    signal: options.signal,
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return readApiJson<NoteSearchResponse>(response);
}

export async function getNote(noteId: string): Promise<NoteRecord> {
  const response = await apiFetch(`/api/notes/${encodeURIComponent(noteId)}`);
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ note: NoteRecord }>(response);
  return data.note;
}

export async function createNote(payload: NotePayload): Promise<NoteRecord> {
  const response = await apiFetch("/api/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ note: NoteRecord }>(response);
  return data.note;
}

export async function updateNote(
  noteId: string,
  payload: NoteUpdatePayload
): Promise<NoteRecord> {
  const response = await apiFetch(`/api/notes/${encodeURIComponent(noteId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ note: NoteRecord }>(response);
  return data.note;
}

export async function deleteNote(noteId: string) {
  const response = await apiFetch(`/api/notes/${encodeURIComponent(noteId)}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await readApiError(response));
}

export async function restoreNote(noteId: string): Promise<NoteRecord> {
  const response = await apiFetch(`/api/notes/${encodeURIComponent(noteId)}/restore`, {
    method: "POST",
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ note: NoteRecord }>(response);
  return data.note;
}

export async function listNoteVersions(noteId: string): Promise<NoteVersionRecord[]> {
  const response = await apiFetch(`/api/notes/${encodeURIComponent(noteId)}/versions`);
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ versions: NoteVersionRecord[] }>(response);
  return data.versions;
}

export async function restoreNoteVersion(
  noteId: string,
  versionId: string
): Promise<NoteRecord> {
  const response = await apiFetch(
    `/api/notes/${encodeURIComponent(noteId)}/versions/${encodeURIComponent(versionId)}/restore`,
    { method: "POST" }
  );
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ note: NoteRecord }>(response);
  return data.note;
}

export async function getNoteOutline(noteId: string): Promise<{
  noteId: string;
  indexStatus: string;
  sections: NoteSectionRecord[];
}> {
  const response = await apiFetch(`/api/notes/${encodeURIComponent(noteId)}/outline`);
  if (!response.ok) throw new Error(await readApiError(response));
  return readApiJson<{
    noteId: string;
    indexStatus: string;
    sections: NoteSectionRecord[];
  }>(response);
}

export async function reindexNote(noteId: string): Promise<{
  note: NoteRecord;
  job: NoteIndexJobRecord;
}> {
  const response = await apiFetch(`/api/notes/${encodeURIComponent(noteId)}/reindex`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "manual" }),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return readApiJson<{ note: NoteRecord; job: NoteIndexJobRecord }>(response);
}

export async function listIndexJobs(noteId?: string): Promise<NoteIndexJobRecord[]> {
  const query = noteId ? `?noteId=${encodeURIComponent(noteId)}` : "";
  const response = await apiFetch(`/api/index-jobs${query}`);
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ jobs: NoteIndexJobRecord[] }>(response);
  return data.jobs;
}

export async function getRelatedNotes(noteId: string): Promise<ChatSource[]> {
  const response = await apiFetch(`/api/notes/${encodeURIComponent(noteId)}/related`);
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ related: ChatSource[] }>(response);
  return data.related;
}
