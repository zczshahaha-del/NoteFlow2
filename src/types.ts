export interface FileNode {
  id: string;
  name: string;
  type: "folder" | "file";
  children?: FileNode[];
  content?: string;
  contentHash?: string;
  createdAt?: string;
  updatedAt?: string;
  summary?: string;
  tags?: string[];
  pinned?: boolean;
  favorite?: boolean;
  lastOpenedAt?: string;
  indexStatus?: string;
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

export interface ChatReplyRequest {
  question: string;
  mode: "chat" | "ask_notes";
  documentTitle: string;
  documentContent: string;
  pageState: ChatPageState;
  history: { role: "user" | "assistant"; text: string }[];
  memoryEnabled: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Streaming is client-only; history may restore terminal failure/stop states. */
  streamState?: "streaming" | "completed" | "stopped" | "failed";
  /** Client-only recovery data; never serialized as chat history. */
  replyRequest?: ChatReplyRequest;
  retryBlocked?: boolean;
  retrying?: boolean;
  errorText?: string;
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
  draftCard?: {
    seed: string;
    checkpointId?: string | null;
    draftId?: string | null;
    status?: string | null;
  };
  createdAt?: string | null;
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  status: string;
  currentNoteId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastMessageAt: string | null;
}

export interface ChatSource {
  citationId?: string;
  noteId: string;
  noteTitle: string;
  sectionId: string | null;
  sectionTitle: string | null;
  sectionPath?: string[];
  chunkId: string | null;
  sourceType: string;
  snippet: string;
  score: number;
  sourceVersion?: string;
  startLine?: number | null;
  endLine?: number | null;
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
