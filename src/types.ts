export interface FileNode {
  id: string;
  name: string;
  type: "folder" | "file";
  children?: FileNode[];
  content?: string;
  createdAt?: string;
  updatedAt?: string;
  summary?: string;
  tags?: string[];
  pinned?: boolean;
  favorite?: boolean;
  lastOpenedAt?: string;
  indexStatus?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  chatMode?: "chat" | "ask_notes";
  attachedSelection?: {
    text: string;
    noteId: string | null;
    noteTitle: string;
  };
  contextMode?: string;
  sources?: ChatSource[];
  agentSessionId?: string;
  agentRunId?: string;
  toolTraces?: AgentToolTrace[];
}

export interface ChatSource {
  noteId: string;
  noteTitle: string;
  sectionId: string | null;
  sectionTitle: string | null;
  chunkId: string | null;
  sourceType: string;
  snippet: string;
  score: number;
  retrievalChannels?: string[];
  queryIntent?: string | null;
}

export interface AgentToolTrace {
  id?: string;
  runId?: string;
  toolName: string;
  action: string;
  status: "running" | "success" | "failed" | string;
  durationMs?: number;
  inputSummary?: string;
  outputSummary?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentToolAction {
  toolName: string;
  action: string;
  message?: string;
  payload?: Record<string, unknown>;
}
