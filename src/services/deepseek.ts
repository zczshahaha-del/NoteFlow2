import type { AgentToolAction, AgentToolTrace, ChatMessage, ChatSource } from "../types";
import { apiFetch, readApiError } from "./api";

interface StreamPayload {
  type?: string;
  sessionId?: string;
  runId?: string;
  intent?: string;
  contextMode?: string;
  sources?: ChatSource[];
  id?: string;
  toolName?: string;
  action?: string;
  status?: string;
  code?: string;
  message?: string;
  content?: string;
  payload?: Record<string, unknown>;
  durationMs?: number;
  inputSummary?: string;
  outputSummary?: string;
  metadata?: Record<string, unknown>;
  choices?: Array<{
    delta?: {
      content?: string;
    };
    finish_reason?: string | null;
  }>;
}

interface AskDeepSeekParams {
  sessionId?: string | null;
  question: string;
  mode?: "chat" | "ask_notes";
  documentTitle?: string;
  documentContent?: string;
  pageState?: ChatPageState;
  history: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  memoryEnabled?: boolean;
  signal?: AbortSignal;
}

export interface ChatPageState {
  currentNoteId?: string | null;
  selectedText?: string;
  currentSectionId?: string | null;
  dirty?: boolean;
  unsavedContent?: string;
  centerMode?: string;
  activeEditPreviewId?: string | null;
  draftSeed?: string;
  activeDraftId?: string | null;
  activeDraftTitle?: string;
  activeDraftTopic?: string;
  contextScope?: "auto" | "current_note" | "knowledge_base" | "selection";
}

interface StreamRequest {
  path: string;
  body: unknown;
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
  onFinishReason?: (reason: string) => void;
  onContext?: (context: { contextMode: string; sources: ChatSource[] }) => void;
  onAnswerReplace?: (content: string) => void;
  onAgentSession?: (session: { sessionId: string; runId: string; intent: string }) => void;
  onAgentDone?: (result: { sessionId: string; runId: string; status: string }) => void;
  onAgentError?: (error: { sessionId?: string; runId?: string; status: string; code?: string; message: string }) => void;
  onStreamError?: (error: { status: string; code?: string; message: string }) => void;
  onToolTrace?: (trace: AgentToolTrace) => void;
  onToolAction?: (action: AgentToolAction) => void;
}

export interface GenerateNoteStreamParams {
  mode?: "generate" | "outline" | "fromOutline" | "section" | "continue" | "expand" | "revise";
  topic: string;
  noteType: string;
  writingTone: string;
  noteFormat: string;
  headingLevel: string;
  includeCode: boolean;
  includeExercises: boolean;
  extraRequest: string;
  markdown?: string;
  outlinePlan?: string;
  maxTokens?: number;
  temperature?: number;
  memoryEnabled?: boolean;
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
  onFinishReason?: (reason: string) => void;
}

export async function askDeepSeek(params: AskDeepSeekParams): Promise<string> {
  let answer = "";
  await askDeepSeekStream({
    ...params,
    onDelta: (delta) => {
      answer += delta;
    },
  });
  return answer.trim();
}

export async function askDeepSeekStream({
  sessionId,
  question,
  mode,
  documentTitle,
  documentContent,
  pageState,
  history,
  maxTokens,
  temperature,
  memoryEnabled,
  onDelta,
  onFinishReason,
  onContext,
  onAnswerReplace,
  onAgentSession,
  onAgentDone,
  onAgentError,
  onToolTrace,
  onToolAction,
  signal,
}: AskDeepSeekParams & {
  onDelta: (delta: string) => void;
  onFinishReason?: (reason: string) => void;
  onContext?: (context: { contextMode: string; sources: ChatSource[] }) => void;
  onAnswerReplace?: (content: string) => void;
  onAgentSession?: (session: { sessionId: string; runId: string; intent: string }) => void;
  onAgentDone?: (result: { sessionId: string; runId: string; status: string }) => void;
  onAgentError?: (error: { sessionId?: string; runId?: string; status: string; code?: string; message: string }) => void;
  onToolTrace?: (trace: AgentToolTrace) => void;
  onToolAction?: (action: AgentToolAction) => void;
}): Promise<void> {
  return streamAIResponse({
    path: "/api/agent/chat",
    signal,
    onDelta,
    onFinishReason,
    onContext,
    onAnswerReplace,
    onAgentSession,
    onAgentDone,
    onAgentError,
    onToolTrace,
    onToolAction,
    body: {
      sessionId,
      question,
      mode,
      documentTitle,
      documentContent,
      pageState,
      history,
      maxTokens,
      temperature,
      memoryEnabled,
    },
  });
}

export async function generateNoteStream({
  signal,
  onDelta,
  onFinishReason,
  ...payload
}: GenerateNoteStreamParams): Promise<void> {
  return streamAIResponse({
    path: "/api/ai/notes/generate",
    signal,
    onDelta,
    onFinishReason,
    body: payload,
  });
}

async function streamAIResponse({
  path,
  body,
  signal,
  onDelta,
  onFinishReason,
  onContext,
  onAnswerReplace,
  onAgentSession,
  onAgentDone,
  onAgentError,
  onStreamError,
  onToolTrace,
  onToolAction,
}: StreamRequest): Promise<void> {
  const response = await apiFetch(path, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  if (!response.body) {
    throw new Error("当前浏览器不支持流式读取响应。");
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    throw new Error("AI 接口返回了前端 HTML 页面，说明线上 /api 没有正确转发到后端。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      const data = JSON.parse(payload) as StreamPayload;
      if (data.type === "agent_session") {
        if (data.sessionId && data.runId) {
          onAgentSession?.({
            sessionId: data.sessionId,
            runId: data.runId,
            intent: data.intent ?? "general_chat",
          });
        }
        continue;
      }
      if (data.type === "tool_trace") {
        if (data.toolName && data.action && data.status) {
          onToolTrace?.({
            id: data.id,
            runId: data.runId,
            toolName: data.toolName,
            action: data.action,
            status: data.status,
            durationMs: data.durationMs,
            inputSummary: data.inputSummary,
            outputSummary: data.outputSummary,
            metadata: data.metadata,
          });
        }
        continue;
      }
      if (data.type === "tool_action") {
        if (data.toolName && data.action) {
          onToolAction?.({
            toolName: data.toolName,
            action: data.action,
            message: data.message,
            payload: data.payload,
          });
        }
        continue;
      }
      if (data.type === "agent_done") {
        if (data.sessionId && data.runId) {
          onAgentDone?.({
            sessionId: data.sessionId,
            runId: data.runId,
            status: data.status ?? "completed",
          });
        }
        continue;
      }
      if (data.type === "agent_error") {
        onAgentError?.({
          sessionId: data.sessionId,
          runId: data.runId,
          status: data.status ?? "failed",
          code: data.code,
          message: data.message ?? "Agent 执行失败，请稍后重试。",
        });
        continue;
      }
      if (data.type === "stream_error") {
        const message = data.message ?? "AI 生成失败，请稍后重试。";
        onStreamError?.({
          status: data.status ?? "failed",
          code: data.code,
          message,
        });
        throw new Error(message);
      }
      if (data.type === "context") {
        onContext?.({
          contextMode: data.contextMode ?? "retrieval",
          sources: data.sources ?? [],
        });
        continue;
      }
      if (data.type === "answer_replace") {
        onAnswerReplace?.(data.content ?? "");
        continue;
      }
      const choice = data.choices?.[0];
      const delta = choice?.delta?.content;
      if (delta) onDelta(delta);
      if (choice?.finish_reason) onFinishReason?.(choice.finish_reason);
    }
  }
}
