import type { FileNode } from "../types";
import { apiFetch, readApiError, readApiJson } from "./api";

export interface KnowledgeBaseSnapshot {
  treeData: FileNode[];
  fileContents: Record<string, string>;
  selectedFileId: string | null;
}

interface KnowledgeBaseRow {
  treeData: unknown;
  fileContents: unknown;
  selectedFileId: string | null;
}

function isFileContents(value: unknown): value is Record<string, string> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function loadKnowledgeBase(
  _userId: string
): Promise<KnowledgeBaseSnapshot | null> {
  const response = await apiFetch("/api/knowledge-base");
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  const data = await readApiJson<{ snapshot: KnowledgeBaseRow | null }>(response);
  if (!data.snapshot) return null;

  const snapshot = data.snapshot;
  return {
    treeData: Array.isArray(snapshot.treeData) ? (snapshot.treeData as FileNode[]) : [],
    fileContents: isFileContents(snapshot.fileContents)
      ? (snapshot.fileContents as Record<string, string>)
      : {},
    selectedFileId: snapshot.selectedFileId ?? null,
  };
}

export interface KnowledgeBaseMigrationResult {
  ok: boolean;
  migrated: boolean;
  reason?: string;
  categoriesCreated: number;
  notesCreated: number;
}

export async function migrateKnowledgeBase(): Promise<KnowledgeBaseMigrationResult> {
  const response = await apiFetch("/api/knowledge-base/migrate", {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  return readApiJson<KnowledgeBaseMigrationResult>(response);
}

export async function clearKnowledgeBase(): Promise<void> {
  const response = await apiFetch("/api/knowledge-base", {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
}
