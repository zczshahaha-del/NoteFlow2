import { apiFetch, readApiError, readApiJson } from "./api";
import type { NoteIndexJobRecord, NoteRecord } from "./notes";

export type EditPreviewStatus = "preview" | "applied" | "cancelled" | "expired" | string;
export type EditTargetType = "selection" | "section" | "note" | "insert" | "delete" | string;

export interface NoteEditPreviewRecord {
  id: string;
  noteId: string;
  targetType: EditTargetType;
  sectionId: string | null;
  oldContent: string;
  newContent: string;
  instruction: string;
  changeSummary: string[];
  status: EditPreviewStatus;
  createdAt: string | null;
  updatedAt: string | null;
  appliedAt: string | null;
  cancelledAt: string | null;
}

export interface NoteEditPreviewRevisionRecord {
  id: string;
  editId: string;
  newContent: string;
  instruction: string;
  changeSummary: string[];
  source: string;
  createdAt: string | null;
}

export interface EditPreviewPayload {
  noteId: string;
  targetType?: EditTargetType | null;
  sectionId?: string | null;
  selectedText?: string;
  instruction: string;
  keepStyle?: boolean;
  memoryEnabled?: boolean;
}

export async function createEditPreview(
  payload: EditPreviewPayload
): Promise<NoteEditPreviewRecord> {
  const response = await apiFetch("/api/note-edit-previews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ preview: NoteEditPreviewRecord }>(response);
  return data.preview;
}

export async function getEditPreview(editId: string): Promise<NoteEditPreviewRecord> {
  const response = await apiFetch(`/api/note-edit-previews/${encodeURIComponent(editId)}`);
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ preview: NoteEditPreviewRecord }>(response);
  return data.preview;
}

export async function listEditPreviewRevisions(
  editId: string
): Promise<NoteEditPreviewRevisionRecord[]> {
  const response = await apiFetch(
    `/api/note-edit-previews/${encodeURIComponent(editId)}/revisions`
  );
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ revisions: NoteEditPreviewRevisionRecord[] }>(response);
  return data.revisions;
}

export async function restoreEditPreviewRevision(
  editId: string,
  revisionId: string
): Promise<NoteEditPreviewRecord> {
  const response = await apiFetch(
    `/api/note-edit-previews/${encodeURIComponent(editId)}/restore-revision`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revisionId }),
    }
  );
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ preview: NoteEditPreviewRecord }>(response);
  return data.preview;
}

export async function reviseEditPreview(
  editId: string,
  instruction: string,
  memoryEnabled = true
): Promise<NoteEditPreviewRecord> {
  const response = await apiFetch(`/api/note-edit-previews/${encodeURIComponent(editId)}/revise`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instruction, memoryEnabled }),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ preview: NoteEditPreviewRecord }>(response);
  return data.preview;
}

export async function applyEditPreview(editId: string): Promise<{
  preview: NoteEditPreviewRecord;
  note: NoteRecord;
  job: NoteIndexJobRecord;
}> {
  const response = await apiFetch(`/api/note-edit-previews/${encodeURIComponent(editId)}/apply`, {
    method: "POST",
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return readApiJson<{
    preview: NoteEditPreviewRecord;
    note: NoteRecord;
    job: NoteIndexJobRecord;
  }>(response);
}

export async function cancelEditPreview(editId: string): Promise<NoteEditPreviewRecord> {
  const response = await apiFetch(`/api/note-edit-previews/${encodeURIComponent(editId)}/cancel`, {
    method: "POST",
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ preview: NoteEditPreviewRecord }>(response);
  return data.preview;
}
