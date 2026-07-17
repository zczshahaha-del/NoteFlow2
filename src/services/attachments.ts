import { apiFetch, readApiError, readApiJson } from "./api";

export interface AttachmentRecord {
  id: string;
  noteId: string | null;
  fileName: string;
  contentType: string;
  size: number;
  sha256: string;
  downloadUrl: string;
  createdAt: string | null;
}

export async function uploadAttachment(file: File, noteId: string): Promise<AttachmentRecord> {
  const response = await apiFetch("/api/attachments", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
      "X-Note-Id": noteId,
      "X-Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ attachment: AttachmentRecord }>(response);
  return data.attachment;
}

export async function listNoteAttachments(noteId: string): Promise<AttachmentRecord[]> {
  const response = await apiFetch(`/api/notes/${encodeURIComponent(noteId)}/attachments`);
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ attachments: AttachmentRecord[] }>(response);
  return data.attachments;
}

export async function deleteAttachment(attachmentId: string): Promise<void> {
  const response = await apiFetch(`/api/attachments/${encodeURIComponent(attachmentId)}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await readApiError(response));
}

export function attachmentMarkdown(item: AttachmentRecord): string {
  const source = item.downloadUrl;
  const safeName = item.fileName.replace(/[\[\]]/g, "");
  return item.contentType.startsWith("image/")
    ? `![${safeName}](${source} "${safeName}")`
    : `[${safeName}](${source})`;
}
