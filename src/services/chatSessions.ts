import { apiFetch, readApiError, readApiJson } from "./api";
import type { ChatMessage, ChatSessionSummary } from "../types";

export async function listChatSessions(limit = 60): Promise<ChatSessionSummary[]> {
  const response = await apiFetch(`/api/chat-sessions?limit=${limit}`);
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ sessions: ChatSessionSummary[] }>(response);
  return data.sessions;
}

export async function createChatSession(
  currentNoteId?: string | null
): Promise<ChatSessionSummary> {
  const response = await apiFetch("/api/chat-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentNoteId: currentNoteId ?? null }),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ session: ChatSessionSummary }>(response);
  return data.session;
}

export async function listChatMessages(sessionId: string): Promise<ChatMessage[]> {
  const response = await apiFetch(
    `/api/chat-sessions/${encodeURIComponent(sessionId)}/messages?limit=300`
  );
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ messages: ChatMessage[] }>(response);
  return data.messages;
}

export async function renameChatSession(
  sessionId: string,
  title: string
): Promise<ChatSessionSummary> {
  const response = await apiFetch(`/api/chat-sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ session: ChatSessionSummary }>(response);
  return data.session;
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const response = await apiFetch(`/api/chat-sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await readApiError(response));
}
