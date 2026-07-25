import { Fragment, useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  FileText,
  BookOpen,
  MessageCircle,
  Search,
  ChevronsRight,
  ChevronDown,
  Clock3,
  History,
  Loader2,
  Mic,
  MicOff,
  RotateCcw,
  Square,
  XCircle,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
} from "lucide-react";
import {
  useAgentSlice,
  useChatSlice,
  useDraftSlice,
  useEditorSlice,
  useWorkspaceSlice,
} from "../storeSlices";
import { findFileById } from "../workspaceTree";
import { handleRenderedCodeBlockAction, renderChatMarkdown } from "../utils/chatMarkdown";
import { shouldSubmitChatInput } from "../utils/inputComposition";
import type { AgentToolTrace, ChatMessage, ChatSource } from "../types";
import { resolveAgentCheckpoint, type AgentTaskSnapshot } from "../services/agent";
import { getNoteDraft } from "../services/drafts";

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onresult: ((event: {
    resultIndex: number;
    results: {
      length: number;
      [index: number]: {
        isFinal: boolean;
        length: number;
        [index: number]: {
          transcript: string;
          confidence: number;
        };
      };
    };
  }) => void) | null;
}

interface SpeechWindow extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as SpeechWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function appendRecognizedText(base: string, addition: string): string {
  const cleanAddition = addition.replace(/\s+/g, " ").trim();
  if (!cleanAddition) return base;
  const cleanBase = base.trimEnd();
  if (!cleanBase) return cleanAddition;
  const needsSpace = /[A-Za-z0-9]$/u.test(cleanBase) && /^[A-Za-z0-9]/u.test(cleanAddition);
  return `${cleanBase}${needsSpace ? " " : ""}${cleanAddition}`;
}

const citationPattern =
  /(?:【\s*来源\s*(\d+)\s*】|\[\s*来源\s*(\d+)\s*\]|（\s*来源\s*(\d+)\s*）|\(\s*来源\s*(\d+)\s*\)|【\s*(\d+)\s*】|\[\s*(\d+)\s*\])/gu;

function extractCitationIndexes(text: string): Set<number> {
  const indexes = new Set<number>();
  citationPattern.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = citationPattern.exec(text))) {
    const value = match.slice(1).find(Boolean);
    const index = Number(value);
    if (Number.isInteger(index) && index > 0) {
      indexes.add(index);
    }
  }

  return indexes;
}

function referencedSources(
  text: string,
  sources: ChatSource[] | undefined
): Array<{ source: ChatSource; index: number }> {
  if (!sources?.length) return [];
  const citedIndexes = extractCitationIndexes(text);
  if (citedIndexes.size === 0) return [];

  return sources
    .map((source, sourceIndex) => ({ source, index: sourceIndex + 1 }))
    .filter(({ index }) => citedIndexes.has(index));
}

function displayedSources(
  text: string,
  sources: ChatSource[] | undefined
): Array<{ source: ChatSource; index: number }> {
  return referencedSources(text, sources);
}

function groupSourcesByNote(
  refs: Array<{ source: ChatSource; index: number }>
): Array<{ noteId: string; noteTitle: string; refs: Array<{ source: ChatSource; index: number }> }> {
  const groups = new Map<string, {
    noteId: string;
    noteTitle: string;
    refs: Array<{ source: ChatSource; index: number }>;
  }>();
  refs.forEach((ref) => {
    const existing = groups.get(ref.source.noteId);
    if (existing) {
      existing.refs.push(ref);
      return;
    }
    groups.set(ref.source.noteId, {
      noteId: ref.source.noteId,
      noteTitle: ref.source.noteTitle,
      refs: [ref],
    });
  });
  return Array.from(groups.values());
}

function chatSessionGroup(value: string | null): string {
  if (!value) return "更早";
  const date = new Date(value);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const difference = Math.round((today - day) / 86_400_000);
  if (difference <= 0) return "今天";
  if (difference === 1) return "昨天";
  if (difference < 7) return "近 7 天";
  return "更早";
}

function toolTraceName(trace: AgentToolTrace): string {
  if (trace.toolName === "response_mode") return "提问方式";
  if (trace.toolName === "context_planner") return "上下文规划";
  if (trace.toolName === "memory_tool") return "记忆";
  if (trace.toolName === "note_library_tool") {
    if (trace.action === "build_current_note_context") return "当前笔记";
    return "笔记检索";
  }
  if (trace.toolName === "note_draft_tool") return "课程规划";
  if (trace.toolName === "note_edit_tool") return "修改预览";
  if (trace.toolName === "ai_chat") return "回答生成";
  if (trace.toolName === "agent_runtime") return "运行时";
  return trace.toolName;
}

function toolTraceStatus(trace: AgentToolTrace): string {
  if (trace.status === "success") return "完成";
  if (trace.status === "failed") return "失败";
  if (trace.status === "running") return "运行中";
  return trace.status;
}

function visibleToolTraces(traces: AgentToolTrace[] | undefined): AgentToolTrace[] {
  return (traces ?? []).filter((trace) => trace.metadata?.silent !== true);
}

function toolTraceDescription(trace: AgentToolTrace): string {
  const done = trace.status === "success";
  const failed = trace.status === "failed";
  if (trace.toolName === "context_planner") return failed ? "上下文规划失败" : done ? "已确定回答范围" : "正在确定回答范围";
  if (trace.toolName === "memory_tool") return failed ? "个人记忆读取失败" : done ? "已读取个人记忆" : "正在读取个人记忆";
  if (trace.toolName === "note_library_tool") {
    if (trace.action === "build_current_note_context") return failed ? "当前笔记读取失败" : done ? "已读取当前笔记" : "正在读取当前笔记";
    return failed ? "知识库检索失败" : done ? "已检索知识库" : "正在检索知识库";
  }
  if (trace.toolName === "note_draft_tool") return done ? "课程方案已准备" : "正在准备课程方案";
  if (trace.toolName === "note_edit_tool") return done ? "修改预览已准备" : "正在准备修改预览";
  if (trace.toolName === "ai_chat") return failed ? "回答生成失败" : done ? "回答生成完成" : "正在组织回答";
  return `${toolTraceName(trace)} · ${toolTraceStatus(trace)}`;
}

function intentLabel(intent?: string): string {
  if (intent === "note_draft_create") return "课程规划";
  if (intent === "note_edit_create") return "修改预览";
  if (intent === "note_edit_revise") return "调整预览";
  if (intent === "confirm_action") return "确认操作";
  if (intent === "cancel_action") return "取消操作";
  if (intent === "note_search") return "笔记检索";
  if (intent === "note_context_qa") return "当前笔记问答";
  if (intent === "memory_manage") return "长期记忆";
  return "普通对话";
}

function checkpointLabel(type?: string): string {
  if (type === "edit_preview") return "等待确认修改预览";
  if (type === "draft_workspace") return "等待确认课程方案";
  return "等待确认";
}

function runStatusLabel(status?: string): string {
  if (status === "running") return "运行中";
  if (status === "waiting_user_confirm") return "待确认";
  if (status === "failed") return "失败";
  if (status === "cancelled") return "已取消";
  if (status === "completed" || status === "success") return "完成";
  return status || "待处理";
}

function statusClassName(status?: string): string {
  if (status === "failed") return "border-jelly-red/25 bg-jelly-red-bg text-jelly-red";
  if (status === "cancelled") return "border-jelly-border bg-jelly-surface text-jelly-text-muted";
  if (status === "waiting_user_confirm") return "border-jelly-blue/20 bg-jelly-blue-pale text-jelly-blue-deep";
  if (status === "running") return "border-jelly-blue/20 bg-jelly-blue-pale text-jelly-blue-deep";
  return "border-jelly-border bg-jelly-surface text-jelly-text-muted";
}

function formatRunTime(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function taskStatus(task: AgentTaskSnapshot): string {
  return task.checkpoint?.status === "waiting_user_confirm" ? "waiting_user_confirm" : task.run.status;
}

function AgentTaskDetailPanel({
  currentTask,
  history,
}: {
  currentTask: AgentTaskSnapshot | null;
  history: AgentTaskSnapshot[];
}) {
  const recent = history.slice(0, 6);

  return (
    <div className="shrink-0 border-b border-jelly-border bg-jelly-surface px-4 py-2.5">
      <div className="space-y-2">
        <section className="rounded-md border border-jelly-border bg-white px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold text-jelly-text">当前任务</span>
            {currentTask ? (
              <span className={`rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${statusClassName(taskStatus(currentTask))}`}>
                {runStatusLabel(taskStatus(currentTask))}
              </span>
            ) : null}
          </div>
          {currentTask ? (
            <>
              <div className="flex items-center gap-1.5 text-[12px] text-jelly-text-muted">
                <span>{intentLabel(currentTask.run.intent)}</span>
                {currentTask.run.startedAt ? <span>{formatRunTime(currentTask.run.startedAt)}</span> : null}
              </div>
              <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-jelly-text-soft">
                {currentTask.run.errorMessage || currentTask.run.inputText || "暂无输入"}
              </p>
              {visibleToolTraces(currentTask.run.toolTraces).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {visibleToolTraces(currentTask.run.toolTraces).slice(-4).map((trace, index) => (
                    <span
                      key={`${trace.id ?? trace.toolName}-${index}-detail`}
                      className="rounded-md border border-jelly-border bg-jelly-surface px-1.5 py-0.5 text-[11px] text-jelly-text-muted"
                      title={trace.outputSummary ?? trace.action}
                    >
                      {toolTraceDescription(trace)}
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-[12px] text-jelly-text-muted">暂无正在跟踪的任务</p>
          )}
        </section>

        <section className="rounded-md border border-jelly-border bg-white px-3 py-2">
          <div className="mb-1.5 text-[12px] font-semibold text-jelly-text">近期任务</div>
          {recent.length === 0 ? (
            <p className="text-[12px] text-jelly-text-muted">暂无任务记录</p>
          ) : (
            <div className="space-y-1.5">
              {recent.map((task) => {
                const status = taskStatus(task);
                return (
                  <div
                    key={task.run.id}
                    className="rounded-md border border-jelly-border bg-jelly-surface px-2 py-1.5"
                    title={task.run.inputText}
                  >
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[12px] font-medium text-jelly-text">
                        {intentLabel(task.run.intent)}
                      </span>
                      <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${statusClassName(status)}`}>
                        {runStatusLabel(status)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-jelly-text-muted">
                      <span className="shrink-0">{formatRunTime(task.run.startedAt)}</span>
                      <span className="min-w-0 truncate">{task.run.errorMessage || task.run.inputText || "暂无输入"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default function AIPanel({ onCollapse }: { onCollapse?: () => void }) {
  const {
    chatMessages,
    chatLoading,
    chatSessions,
    chatSessionsLoading,
    newChatSession,
    switchChatSession,
    renameChatSession,
    deleteChatSession,
    sendMessage,
    stopGeneration,
    chatSelection,
    clearChatSelection,
  } = useChatSlice();
  const {
    activeEditPreview,
    createEditPreviewRequest,
    applyEditPreviewRequest,
    cancelEditPreviewRequest,
    focusChatSource,
  } = useEditorSlice();
  const {
    centerMode,
    activeDraftContext,
    setActiveDraftContext,
    pendingCheckpoint,
    closeDraft,
    openPendingEditPreview,
    openPendingDraft,
    requestDraftCommand,
  } = useDraftSlice();
  const { agentSessionId, agentTask, agentRunHistory, agentTaskDetailOpen } = useAgentSlice();
  const { selectedFileId, treeData, reloadWorkspace } = useWorkspaceSlice();
  const [input, setInput] = useState("");
  const [composerMode, setComposerMode] = useState<"chat" | "ask_notes">("chat");
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [currentNoteReferenced, setCurrentNoteReferenced] = useState(true);
  const [inputComposing, setInputComposing] = useState(false);
  const [expandedSelectionMessageIds, setExpandedSelectionMessageIds] = useState<Set<string>>(
    () => new Set()
  );
  const [chatPinnedToBottom, setChatPinnedToBottom] = useState(true);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingSessionTitle, setEditingSessionTitle] = useState("");
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [sessionActionBusy, setSessionActionBusy] = useState(false);
  const [sessionActionError, setSessionActionError] = useState("");
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollChatRef = useRef(true);
  const previousMessageCountRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const historyMenuRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceBaseInputRef = useRef("");
  const voiceFinalTextRef = useRef("");
  const voiceSessionIdRef = useRef(0);
  const voiceRestartTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const selectedFile = selectedFileId
    ? findFileById(treeData, selectedFileId)
    : undefined;
  const activeCheckpoint = pendingCheckpoint ?? agentTask?.checkpoint ?? null;
  const currentSession = chatSessions.find((session) => session.id === agentSessionId) ?? null;
  const filteredChatSessions = chatSessions.filter((session) =>
    session.title.toLocaleLowerCase().includes(historyQuery.trim().toLocaleLowerCase())
  );
  const currentNoteTitle = selectedFile?.name.replace(/\.md$/i, "") ?? "";
  const draftCardVisible = activeCheckpoint?.checkpointType === "draft_workspace" || Boolean(activeDraftContext);
  const outlineGenerating = !activeDraftContext || activeDraftContext.stage === "configuring";
  const outlineFailed = activeDraftContext?.stage === "failed";
  const outlineCanOpen = Boolean(
    activeDraftContext && ["outline_ready", "generating", "assembled"].includes(activeDraftContext.stage)
  );
  const renderDraftConversationCard = (
    card: NonNullable<ChatMessage["draftCard"]>,
    className = "mt-3 w-[92%]"
  ) => {
    const isCurrent = Boolean(
      draftCardVisible &&
      ((card.checkpointId && activeCheckpoint?.id === card.checkpointId) ||
        (!card.checkpointId && activeDraftContext?.topic === card.seed))
    );
    const context = isCurrent ? activeDraftContext : null;
    const historicalText = card.status === "resolved"
      ? "该大纲已完成并保存。"
      : card.status === "cancelled"
        ? "该大纲任务已取消。"
        : "这是当时生成的大纲记录。";
    const historicalAction = card.status === "resolved"
      ? "已完成"
      : card.status === "cancelled"
        ? "已取消"
        : "历史大纲";

    return (
    <section className={`${className} overflow-hidden rounded-2xl border border-[#dfe7ec] bg-[#fbfcfd] shadow-[0_8px_24px_rgba(45,65,80,0.06)]`} aria-label="AI 笔记大纲">
      <div className="px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wide text-[#748694]">AI 笔记大纲</p>
            <h3 className="mt-1 truncate text-[14px] font-semibold text-jelly-text">
              {context?.title || card.seed}
            </h3>
          </div>
          {context?.totalSections ? (
            <span className="shrink-0 rounded-full bg-[#eef7fb] px-2 py-1 text-[10px] font-semibold text-jelly-blue-deep">
              {context.stage === "generating" || context.stage === "assembled"
                ? `${context.completedSections}/${context.totalSections}`
                : `${context.totalSections} 章`}
            </span>
          ) : null}
        </div>
        <p className={`mt-2 text-[12px] leading-relaxed ${context?.errorText ? "text-jelly-red" : "text-jelly-text-muted"}`}>
          {!isCurrent ? historicalText : context?.errorText ||
            (context?.stage === "outline_ready"
              ? "大纲已经准备好，请打开完整查看后再确认生成。"
              : context?.stage === "generating"
                ? context.statusText || "正在按章节生成正文。"
                : context?.stage === "assembled"
                  ? "所有章节已生成，可以打开检查并保存为正式笔记。"
                  : "正在根据你的要求生成大纲…")}
        </p>
        {context?.totalSections ? (
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-[#e7eef2]">
            <div
              className="h-full rounded-full bg-jelly-blue transition-[width] duration-300"
              style={{ width: `${Math.round((context.completedSections / context.totalSections) * 100)}%` }}
            />
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => {
          if (!isCurrent) return;
          if (outlineFailed) {
            requestDraftCommand("generate_outline");
            return;
          }
          openPendingDraft();
        }}
        disabled={!isCurrent || centerMode === "draft" || outlineGenerating || (!outlineFailed && !outlineCanOpen)}
        className="flex h-10 w-full items-center justify-center border-t border-[#e8edf0] bg-white text-[12px] font-semibold text-jelly-blue-deep transition-colors hover:bg-[#f2f8fb] disabled:cursor-not-allowed disabled:text-jelly-text-muted"
      >
        {!isCurrent
          ? historicalAction
          : outlineFailed
          ? "重新生成大纲"
          : outlineGenerating
            ? "大纲生成中…"
            : activeDraftContext?.stage === "generating" || activeDraftContext?.stage === "assembled"
              ? "查看草稿"
              : "查看大纲"}
      </button>
    </section>
    );
  };

  useEffect(() => {
    setCurrentNoteReferenced(Boolean(selectedFileId));
  }, [selectedFileId]);

  useEffect(() => {
    if (!modeMenuOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!modeMenuRef.current?.contains(event.target as Node)) {
        setModeMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModeMenuOpen(false);
    };

    document.addEventListener("mousedown", closeOnOutsideClick, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [modeMenuOpen]);

  useEffect(() => {
    if (!historyOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!historyMenuRef.current?.contains(event.target as Node)) {
        setHistoryOpen(false);
        setEditingSessionId(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHistoryOpen(false);
        setEditingSessionId(null);
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [historyOpen]);

  const handleNewChat = async () => {
    if (sessionActionBusy) return;
    setSessionActionBusy(true);
    setSessionActionError("");
    try {
      await newChatSession();
      setHistoryOpen(false);
      setHistoryQuery("");
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (error) {
      setSessionActionError(error instanceof Error ? error.message : "新建对话失败");
    } finally {
      setSessionActionBusy(false);
    }
  };

  const handleSwitchChat = async (sessionId: string) => {
    if (sessionActionBusy || sessionId === agentSessionId) {
      setHistoryOpen(false);
      return;
    }
    setSessionActionBusy(true);
    setSessionActionError("");
    try {
      await switchChatSession(sessionId);
      setHistoryOpen(false);
      setHistoryQuery("");
    } catch (error) {
      setSessionActionError(error instanceof Error ? error.message : "读取对话失败");
    } finally {
      setSessionActionBusy(false);
    }
  };

  const handleRenameChat = async (sessionId: string) => {
    const title = editingSessionTitle.trim();
    if (!title || sessionActionBusy) return;
    setSessionActionBusy(true);
    setSessionActionError("");
    try {
      await renameChatSession(sessionId, title);
      setEditingSessionId(null);
    } catch (error) {
      setSessionActionError(error instanceof Error ? error.message : "重命名失败");
    } finally {
      setSessionActionBusy(false);
    }
  };

  const handleDeleteChat = async () => {
    if (!deletingSessionId || sessionActionBusy) return;
    setSessionActionBusy(true);
    setSessionActionError("");
    try {
      await deleteChatSession(deletingSessionId);
      setDeletingSessionId(null);
      setHistoryOpen(false);
    } catch (error) {
      setSessionActionError(error instanceof Error ? error.message : "删除对话失败");
    } finally {
      setSessionActionBusy(false);
    }
  };

  const setChatAutoScroll = useCallback((enabled: boolean) => {
    shouldAutoScrollChatRef.current = enabled;
    setChatPinnedToBottom((current) => (current === enabled ? current : enabled));
  }, []);

  const scrollChatToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const element = chatScrollRef.current;
      if (!element) return;
      setChatAutoScroll(true);
      element.scrollTo({ top: element.scrollHeight, behavior });
    },
    [setChatAutoScroll]
  );

  const handleChatScroll = useCallback(() => {
    const element = chatScrollRef.current;
    if (!element) return;
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    setChatAutoScroll(distanceToBottom <= 96);
  }, [setChatAutoScroll]);

  useEffect(() => {
    const element = chatScrollRef.current;
    if (!element) return;

    const messageCountIncreased = chatMessages.length > previousMessageCountRef.current;
    previousMessageCountRef.current = chatMessages.length;

    if (messageCountIncreased) {
      scrollChatToBottom("smooth");
      return;
    }

    if (!shouldAutoScrollChatRef.current) return;
    element.scrollTo({ top: element.scrollHeight, behavior: "auto" });
  }, [chatMessages, scrollChatToBottom]);

  useEffect(() => {
    if (
      centerMode === "draft" ||
      activeDraftContext?.stage !== "generating" ||
      !activeDraftContext.id
    ) return;
    let alive = true;
    const refresh = async () => {
      try {
        const latest = await getNoteDraft(activeDraftContext.id);
        if (!alive) return;
        const sections = latest.sections.filter((section) => section.status !== "deleted");
        const completedSections = sections.filter((section) =>
          ["generated", "confirmed"].includes(section.status)
        ).length;
        const generationJob = (latest.draftConfig?.generationJob ?? {}) as Record<string, unknown>;
        if (latest.status === "saved" && latest.savedNoteId) {
          reloadWorkspace(latest.savedNoteId, `“${latest.title}”已生成完成并保存。`);
          if (pendingCheckpoint?.checkpointType === "draft_workspace") {
            await resolveAgentCheckpoint(pendingCheckpoint.id, "resolved", {
              draftId: latest.id,
              noteId: latest.savedNoteId,
            }).catch(() => null);
          }
          closeDraft();
          return;
        }
        setActiveDraftContext({
          id: latest.id,
          title: latest.title,
          topic: latest.topic,
          stage:
            latest.status === "failed"
              ? "failed"
              : latest.status === "assembled"
                ? "assembled"
                : "generating",
          busy: false,
          statusText:
            latest.status === "assembled"
              ? "所有章节已生成，等待检查并保存为正式笔记。"
              : typeof generationJob.currentSectionTitle === "string"
              ? `正在后台生成：${generationJob.currentSectionTitle}`
              : "后台正在继续生成，刷新或关闭页面不会中断。",
          errorText:
            latest.status === "failed" && typeof generationJob.error === "string"
              ? generationJob.error
              : "",
          completedSections,
          totalSections: sections.length,
        });
      } catch {
        // The next poll will retry; transient network errors should not disturb reading.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [activeDraftContext?.id, activeDraftContext?.stage, centerMode, closeDraft, pendingCheckpoint, reloadWorkspace, setActiveDraftContext]);

  useEffect(() => {
    setVoiceSupported(Boolean(getSpeechRecognitionConstructor()));
    return () => {
      voiceSessionIdRef.current += 1;
      if (voiceRestartTimerRef.current !== null) {
        window.clearTimeout(voiceRestartTimerRef.current);
        voiceRestartTimerRef.current = null;
      }
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  const clearVoiceRestartTimer = useCallback(() => {
    if (voiceRestartTimerRef.current !== null) {
      window.clearTimeout(voiceRestartTimerRef.current);
      voiceRestartTimerRef.current = null;
    }
  }, []);

  const stopVoiceRecognition = useCallback(() => {
    clearVoiceRestartTimer();
    voiceSessionIdRef.current += 1;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setVoiceListening(false);
  }, [clearVoiceRestartTimer]);

  const startVoiceRecognition = useCallback((baseInput: string) => {
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setVoiceError("当前浏览器不支持语音输入。");
      return;
    }

    clearVoiceRestartTimer();
    recognitionRef.current?.abort();
    const recognition = new Recognition();
    recognition.lang = "zh-CN";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    voiceBaseInputRef.current = baseInput;
    voiceFinalTextRef.current = "";
    const sessionId = voiceSessionIdRef.current + 1;
    voiceSessionIdRef.current = sessionId;
    setVoiceError("");

    recognition.onstart = () => {
      if (voiceSessionIdRef.current !== sessionId) return;
      setVoiceListening(true);
      inputRef.current?.focus();
    };

    recognition.onresult = (event) => {
      if (voiceSessionIdRef.current !== sessionId) return;
      let finalChunk = "";
      let interimChunk = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? "";
        if (!transcript) continue;
        if (result.isFinal) finalChunk = appendRecognizedText(finalChunk, transcript);
        else interimChunk = appendRecognizedText(interimChunk, transcript);
      }

      if (finalChunk) {
        voiceFinalTextRef.current = appendRecognizedText(voiceFinalTextRef.current, finalChunk);
      }

      const finalText = voiceFinalTextRef.current;
      const nextWithoutInterim = appendRecognizedText(voiceBaseInputRef.current, finalText);
      setInput(appendRecognizedText(nextWithoutInterim, interimChunk));
    };

    recognition.onerror = (event) => {
      if (voiceSessionIdRef.current !== sessionId) return;
      if (event.error === "no-speech") {
        setVoiceError("没有听到声音，可以再试一次。");
      } else if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setVoiceError("麦克风权限被拒绝，请允许浏览器使用麦克风。");
      } else if (event.error !== "aborted") {
        setVoiceError(event.message || "语音识别失败，请重试。");
      }
      setVoiceListening(false);
    };

    recognition.onend = () => {
      if (voiceSessionIdRef.current !== sessionId) return;
      recognitionRef.current = null;
      setVoiceListening(false);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setVoiceError("语音识别启动失败，请稍后重试。");
      recognitionRef.current = null;
      setVoiceListening(false);
    }
  }, [clearVoiceRestartTimer]);

  const handleInputChange = useCallback(
    (value: string) => {
      setInput(value);

      if (!voiceListening) return;

      clearVoiceRestartTimer();
      voiceSessionIdRef.current += 1;
      voiceBaseInputRef.current = value;
      voiceFinalTextRef.current = "";
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      setVoiceError("");
      voiceRestartTimerRef.current = window.setTimeout(() => {
        voiceRestartTimerRef.current = null;
        startVoiceRecognition(value);
      }, 180);
    },
    [clearVoiceRestartTimer, startVoiceRecognition, voiceListening]
  );

  const toggleVoiceRecognition = useCallback(() => {
    if (voiceListening) {
      stopVoiceRecognition();
      return;
    }

    startVoiceRecognition(input);
  }, [input, startVoiceRecognition, stopVoiceRecognition, voiceListening]);

  const handleSend = useCallback(
    (text?: string) => {
      const msg = (text ?? input).trim();
      if (!msg || chatLoading) return;
      if (voiceListening) stopVoiceRecognition();
      const selectedText = chatSelection?.text.trim() || "";
      const contextScope =
        composerMode === "ask_notes"
          ? "knowledge_base"
          : selectedText
            ? "selection"
            : currentNoteReferenced && selectedFile
              ? "current_note"
              : "auto";
      sendMessage(
        msg,
        {
          selectedText,
          contextScope,
        },
        { mode: composerMode }
      );
      if (chatSelection) clearChatSelection();
      setInput("");
    },
    [
      input,
      chatLoading,
      sendMessage,
      composerMode,
      chatSelection,
      clearChatSelection,
      currentNoteReferenced,
      selectedFile,
      voiceListening,
      stopVoiceRecognition,
    ]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const nativeEvent = e.nativeEvent as KeyboardEvent & { keyCode?: number };
      if (!shouldSubmitChatInput({
        key: e.key,
        shiftKey: e.shiftKey,
        isComposing: nativeEvent.isComposing,
        keyCode: nativeEvent.keyCode,
      }, inputComposing)) return;
      e.preventDefault();
      handleSend();
    },
    [handleSend, inputComposing]
  );

  const handleChatContentClick = useCallback(async (
    e: React.MouseEvent<HTMLDivElement>,
    sources: ChatSource[] | undefined
  ) => {
    const target = e.target;
    if (!(target instanceof Element)) return;

    const citationButton = target.closest("[data-chat-citation]");
    if (citationButton instanceof HTMLElement) {
      const sourceIndex = Number(citationButton.dataset.chatCitation ?? "0") - 1;
      const source = sources?.[sourceIndex];
      if (source) {
        focusChatSource(source);
      }
      return;
    }

    await handleRenderedCodeBlockAction(target, e.currentTarget);
  }, [focusChatSource]);

  const toggleSelectionAttachment = useCallback((messageId: string) => {
    setExpandedSelectionMessageIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }, []);

  return (
    <aside className="ai-side-panel relative flex h-full flex-col border-l border-[#e9edf1] bg-white/80 px-5 pb-5 pt-3">
      <div className="relative z-40 flex h-10 shrink-0 items-center justify-between gap-2" ref={historyMenuRef}>
        <button
          type="button"
          onClick={() => setHistoryOpen((open) => !open)}
          className="flex min-w-0 max-w-[calc(100%-80px)] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-[14px] font-semibold text-jelly-text transition-colors hover:bg-[#f2f6f8]"
          aria-expanded={historyOpen}
          aria-haspopup="menu"
          title={currentSession?.title ?? "新对话"}
        >
          <span className="truncate">{currentSession?.title ?? "新对话"}</span>
          <ChevronDown size={14} className={`shrink-0 transition-transform ${historyOpen ? "rotate-180" : ""}`} />
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <div className="group/new-chat relative">
            <button
              type="button"
              onClick={() => void handleNewChat()}
              disabled={sessionActionBusy}
              className="grid h-8 w-8 place-items-center rounded-lg text-jelly-text-muted transition-colors hover:bg-[#eef5f8] hover:text-jelly-blue-deep disabled:opacity-50"
              aria-label="新建对话"
              aria-describedby="new-chat-tooltip"
            >
              <Plus size={18} strokeWidth={1.9} />
            </button>
            <span
              id="new-chat-tooltip"
              role="tooltip"
              className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 -translate-y-1 whitespace-nowrap rounded-md border border-jelly-border bg-white px-2.5 py-1 text-[12px] font-medium text-jelly-text-soft opacity-0 shadow-[0_6px_18px_rgba(30,44,56,0.08)] transition-all duration-150 group-hover/new-chat:translate-y-0 group-hover/new-chat:opacity-100 group-focus-within/new-chat:translate-y-0 group-focus-within/new-chat:opacity-100"
            >
              新建对话
            </span>
          </div>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              className="grid h-8 w-8 place-items-center rounded-lg text-jelly-text-muted transition-colors hover:bg-[#eef5f8] hover:text-jelly-blue-deep"
              aria-label="收起 AI 助手"
              title="收起 AI 助手"
            >
              <ChevronsRight size={17} strokeWidth={1.9} />
            </button>
          )}
        </div>

        {historyOpen && (
          <div className="absolute left-0 top-11 w-[min(340px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-[#dfe7ec] bg-white p-2 shadow-[0_18px_50px_rgba(35,52,65,0.16)]" role="menu">
            <div className="flex items-center gap-2 rounded-xl bg-[#f6f8fa] px-3">
              <Search size={15} className="shrink-0 text-jelly-text-muted" />
              <input
                value={historyQuery}
                onChange={(event) => setHistoryQuery(event.target.value)}
                placeholder="搜索历史对话"
                className="h-9 min-w-0 flex-1 border-0 bg-transparent text-[13px] text-jelly-text outline-none placeholder:text-[#9aa5ad]"
                autoFocus
              />
            </div>
            <button
              type="button"
              onClick={() => void handleNewChat()}
              className="mt-1.5 flex h-9 w-full items-center gap-2 rounded-xl px-3 text-[13px] font-medium text-jelly-blue-deep transition-colors hover:bg-[#eef6fa]"
            >
              <Plus size={15} />
              新建对话
            </button>
            <div className="mt-1 max-h-[360px] overflow-y-auto overscroll-contain pr-0.5">
              {chatSessionsLoading && filteredChatSessions.length === 0 ? (
                <div className="flex h-20 items-center justify-center text-[12px] text-jelly-text-muted">
                  <Loader2 size={15} className="mr-2 animate-spin" />读取中
                </div>
              ) : filteredChatSessions.length === 0 ? (
                <p className="px-3 py-8 text-center text-[12px] text-jelly-text-muted">没有找到对话</p>
              ) : filteredChatSessions.map((session, index) => {
                const group = chatSessionGroup(session.lastMessageAt ?? session.updatedAt);
                const previous = index > 0
                  ? chatSessionGroup(filteredChatSessions[index - 1].lastMessageAt ?? filteredChatSessions[index - 1].updatedAt)
                  : null;
                const editing = editingSessionId === session.id;
                return (
                  <Fragment key={session.id}>
                    {group !== previous && (
                      <p className="px-3 pb-1 pt-3 text-[10px] font-semibold tracking-wide text-[#94a0a9]">{group}</p>
                    )}
                    <div className={`group flex min-h-10 items-center rounded-xl px-2 transition-colors ${session.id === agentSessionId ? "bg-[#edf6fa]" : "hover:bg-[#f6f8fa]"}`}>
                      {editing ? (
                        <>
                          <input
                            value={editingSessionTitle}
                            onChange={(event) => setEditingSessionTitle(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") void handleRenameChat(session.id);
                              if (event.key === "Escape") setEditingSessionId(null);
                            }}
                            className="h-8 min-w-0 flex-1 rounded-lg border border-[#ccdbe4] bg-white px-2 text-[13px] outline-none"
                            autoFocus
                          />
                          <button type="button" onClick={() => void handleRenameChat(session.id)} className="grid h-7 w-7 place-items-center text-jelly-blue-deep" aria-label="保存名称"><Check size={14} /></button>
                          <button type="button" onClick={() => setEditingSessionId(null)} className="grid h-7 w-7 place-items-center text-jelly-text-muted" aria-label="取消重命名"><X size={14} /></button>
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={() => void handleSwitchChat(session.id)} className="min-w-0 flex-1 truncate px-1 py-2 text-left text-[13px] text-jelly-text" title={session.title}>
                            {session.title}
                          </button>
                          {session.id === agentSessionId && <Check size={13} className="mr-1 shrink-0 text-jelly-blue-deep" />}
                          <button
                            type="button"
                            onClick={() => { setEditingSessionId(session.id); setEditingSessionTitle(session.title); }}
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-jelly-text-muted opacity-0 transition-opacity hover:bg-white hover:text-jelly-blue-deep group-hover:opacity-100"
                            aria-label={`重命名${session.title}`}
                          ><Pencil size={13} /></button>
                          <button
                            type="button"
                            onClick={() => setDeletingSessionId(session.id)}
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-jelly-text-muted opacity-0 transition-opacity hover:bg-[#fff2f0] hover:text-jelly-red group-hover:opacity-100"
                            aria-label={`删除${session.title}`}
                          ><Trash2 size={13} /></button>
                        </>
                      )}
                    </div>
                  </Fragment>
                );
              })}
            </div>
            {sessionActionError && <p className="px-3 pb-1 pt-2 text-[11px] text-jelly-red">{sessionActionError}</p>}
          </div>
        )}
      </div>

      {false && agentTaskDetailOpen && (
        <AgentTaskDetailPanel currentTask={agentTask} history={agentRunHistory} />
      )}

      {/* Chat messages */}
      <div
        ref={chatScrollRef}
        onScroll={handleChatScroll}
        className="ai-message-list flex-1 space-y-[26px] overflow-y-auto px-0 py-[34px]"
      >
        {chatMessages.map((msg, index) => {
          const isStreaming =
            chatLoading &&
            msg.role === "assistant" &&
            index === chatMessages.length - 1;
          const selectionExpanded = expandedSelectionMessageIds.has(msg.id);
          const attachedSelectionText = msg.attachedSelection?.text ?? "";
          const canExpandSelection =
            attachedSelectionText.length > 80 || attachedSelectionText.includes("\n");
          const sourceRefs =
            msg.role === "assistant" ? displayedSources(msg.text, msg.sources) : [];
          const sourceGroups = groupSourcesByNote(sourceRefs);
          const precedingSelection = (() => {
            if (msg.role !== "assistant") return null;
            for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
              const candidate = chatMessages[cursor];
              if (candidate.role === "user") return candidate.attachedSelection ?? null;
            }
            return null;
          })();
          return (
          <Fragment key={msg.id}>
          <div className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
            <div
              className={`
                rounded-xl border px-4 py-3 text-[14px] leading-relaxed
                ${msg.role === "user"
                  ? "max-w-[92%] border-[#dcebf4] bg-[#f1f8fd] text-jelly-text shadow-none"
                  : "max-w-[92%] border-[#e9edf1] bg-white text-jelly-text shadow-none"
                }
              `}
            >
              {msg.role === "assistant" && msg.text ? (
                <div
                  className="chat-markdown"
                  onClick={(event) => handleChatContentClick(event, msg.sources)}
                  dangerouslySetInnerHTML={{
                    __html: renderChatMarkdown(msg.text, msg.sources?.length ?? 0),
                  }}
                />
              ) : (
                <div className="space-y-2">
                  <span className="whitespace-pre-wrap">
                    {msg.text || (isStreaming ? "正在生成" : "")}
                  </span>
                  {msg.role === "user" && msg.attachedSelection && (
                    <div className="border-l-2 border-jelly-blue/25 pl-2.5 text-left">
                      <div className="mb-1 min-w-0 truncate text-[12px] font-medium text-jelly-blue-deep">
                        已引用 · {msg.attachedSelection.noteTitle}
                      </div>
                      <p
                        className={
                          selectionExpanded
                            ? "max-h-44 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-jelly-text-soft"
                            : "line-clamp-2 text-[12px] leading-relaxed text-jelly-text-soft"
                        }
                      >
                        {attachedSelectionText}
                      </p>
                      {canExpandSelection && (
                        <button
                          type="button"
                          onClick={() => toggleSelectionAttachment(msg.id)}
                          className="mt-1.5 inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[12px] font-medium text-jelly-blue-deep transition-colors hover:bg-jelly-blue-pale"
                        >
                          {selectionExpanded ? "收起" : "展开"}
                          <ChevronDown
                            size={12}
                            strokeWidth={1.8}
                            className={`transition-transform ${selectionExpanded ? "rotate-180" : ""}`}
                          />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {isStreaming && <span className="typing-caret" />}
              {msg.role === "assistant" && msg.text && precedingSelection && !isStreaming && (
                <button
                  type="button"
                  className="mt-3 inline-flex h-7 items-center rounded-full border border-[#d9e8f1] bg-[#f7fbfd] px-3 text-[11px] font-medium text-[#47708a] transition-colors hover:bg-[#edf6fa]"
                  onClick={() =>
                    createEditPreviewRequest(
                      `保留选中的原文，在它后面补充一段简洁、自然的“补充理解”提示块。可参考下面这段解释，但请重新组织成适合直接放进技术学习笔记的内容：\n\n${msg.text}`,
                      precedingSelection.text,
                      "insert",
                      null
                    )
                  }
                >
                  补充理解
                </button>
              )}
              {sourceRefs.length > 0 && (
                <div className="mt-2 border-t border-jelly-border pt-2">
                  <div className="mb-1 text-[11px] text-jelly-text-muted">
                    参考 · {sourceGroups.length} 篇笔记 · {sourceRefs.length} 处原文
                  </div>
                  <div className="space-y-1.5">
                    {sourceGroups.map((group) => (
                      <div key={group.noteId} className="min-w-0">
                        <div className="truncate text-[12px] font-medium text-jelly-text-soft">
                          {group.noteTitle}
                        </div>
                        <div className="space-y-0.5">
                          {group.refs.map(({ source, index: sourceIndex }) => (
                            <button
                              key={`${source.noteId}-${source.sectionId ?? "note"}-${source.chunkId ?? sourceIndex}`}
                              type="button"
                              className="group flex max-w-full items-center gap-1.5 py-0.5 text-left text-[12px] text-jelly-text-muted transition-colors hover:text-jelly-blue-deep"
                              onClick={() => focusChatSource(source)}
                              title={`打开原文：${source.noteTitle}${source.sectionTitle ? ` / ${source.sectionTitle}` : ""}`}
                            >
                              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-jelly-blue-pale px-1 text-[10px] font-semibold text-jelly-blue-deep">
                                {sourceIndex}
                              </span>
                              <span className="min-w-0 truncate border-b border-transparent group-hover:border-jelly-blue/30">
                                {source.sectionPath?.[source.sectionPath.length - 1] ||
                                  source.sectionTitle ||
                                  "正文"}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {msg.role === "assistant" && msg.draftCard &&
              renderDraftConversationCard(msg.draftCard)}
          </div>
          </Fragment>
          );
        })}
        {chatLoading && chatMessages[chatMessages.length - 1]?.role !== "assistant" && (
          <div className="flex">
            <div className="rounded-2xl border border-jelly-border bg-white px-3.5 py-2.5">
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-jelly-blue animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-jelly-blue animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-jelly-blue animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
        {!chatPinnedToBottom && chatMessages.length > 0 && (
          <div className="sticky bottom-2 z-20 flex justify-center">
            <button
              type="button"
              onClick={() => scrollChatToBottom("smooth")}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-jelly-blue/20 bg-white/95 px-2.5 text-[12px] font-medium text-jelly-blue-deep shadow-[0_8px_24px_rgba(22,34,45,0.12)] backdrop-blur transition-colors hover:bg-jelly-blue-pale"
            >
              <ChevronDown size={13} strokeWidth={1.9} />
              回到底部
            </button>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0">
        <div className="ai-chat-composer ai-large-composer flex min-h-[158px] flex-col rounded-2xl border border-[#dfe6ec] bg-white px-3.5 py-3 shadow-[0_2px_8px_rgba(36,51,67,0.025)]">
          <div className="mb-2 flex max-w-full flex-wrap gap-1.5">
            {selectedFile && currentNoteReferenced && (
              <span className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#e5e9ed] bg-[#fafbfc] py-1.5 pl-2.5 pr-1.5 text-[12px] text-[#687584]">
                <FileText size={13} strokeWidth={1.8} />
                <span className="min-w-0 truncate">{currentNoteTitle}</span>
                <button
                  type="button"
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#edf0f2] text-[#67717c] opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => setCurrentNoteReferenced(false)}
                  aria-label="移除当前笔记引用"
                >
                  <X size={12} strokeWidth={2} />
                </button>
              </span>
            )}
            {chatSelection && (
              <span className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#d8e8f2] bg-[#f3f9fc] py-1.5 pl-2.5 pr-1.5 text-[12px] text-[#47708a]">
                <span className="min-w-0 truncate">引用：{chatSelection.text}</span>
                <button
                  type="button"
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#e5eef4] text-[#607483] opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={clearChatSelection}
                  aria-label="移除选中文字引用"
                >
                  <X size={12} strokeWidth={2} />
                </button>
              </span>
            )}
          </div>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onCompositionStart={() => setInputComposing(true)}
            onCompositionEnd={() => setInputComposing(false)}
            onKeyDown={handleKeyDown}
            placeholder={
              activeEditPreview
                ? "继续调整，或输入“应用吧 / 取消”..."
                : composerMode === "ask_notes"
                  ? "在全部笔记中提问..."
                  : "使用 AI 处理各种任务..."
            }
            className="ai-chat-input min-h-[82px] flex-1 resize-none border-0 bg-transparent text-[15px] leading-7 text-jelly-text outline-none placeholder:text-[#a4aab2]"
          />
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-[#f0f2f4] pt-2.5">
            <div className="relative" ref={modeMenuRef}>
              <button
                type="button"
                className={`inline-flex min-w-[104px] items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-semibold transition-colors ${
                  composerMode === "ask_notes"
                    ? "bg-[#f1f7fb] text-[#28749c]"
                    : "bg-transparent text-[#637383] hover:bg-[#f1f7fb] hover:text-[#28749c]"
                }`}
                onClick={() => setModeMenuOpen((value) => !value)}
                aria-haspopup="listbox"
                aria-expanded={modeMenuOpen}
              >
                <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-[#e8f4fa] text-[#2c7da5]">
                  {composerMode === "ask_notes" ? <Search size={12} strokeWidth={2} /> : <MessageCircle size={12} strokeWidth={2} />}
                </span>
                <span>{composerMode === "ask_notes" ? "全库搜索" : "对话"}</span>
                <ChevronDown size={14} strokeWidth={2} />
              </button>
              {modeMenuOpen && (
                <div className="absolute bottom-11 left-0 z-30 w-44 rounded-xl border border-[#e2e8ed] bg-white p-1.5 shadow-[0_14px_30px_rgba(36,57,74,0.14)]" role="listbox">
                  <button
                    type="button"
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
                      composerMode === "chat" ? "bg-[#f0f7fb] text-[#28749c]" : "text-[#4f5360] hover:bg-[#f0f7fb] hover:text-[#28749c]"
                    }`}
                    onClick={() => {
                      setComposerMode("chat");
                      setModeMenuOpen(false);
                    }}
                    role="option"
                    aria-selected={composerMode === "chat"}
                  >
                    <MessageCircle size={15} strokeWidth={1.9} />
                    对话
                  </button>
                  <button
                    type="button"
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
                      composerMode === "ask_notes" ? "bg-[#f0f7fb] text-[#28749c]" : "text-[#4f5360] hover:bg-[#f0f7fb] hover:text-[#28749c]"
                    }`}
                    onClick={() => {
                      setComposerMode("ask_notes");
                      setModeMenuOpen(false);
                    }}
                    role="option"
                    aria-selected={composerMode === "ask_notes"}
                  >
                    <Search size={15} strokeWidth={1.9} />
                    全库搜索
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={() => {
                if (chatLoading) {
                  stopGeneration();
                } else {
                  handleSend();
                }
              }}
              disabled={!chatLoading && !input.trim()}
              aria-label={chatLoading ? "停止生成" : "发送"}
              title={chatLoading ? "停止生成" : "发送"}
              className={`
                grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors duration-150
                ${chatLoading
                  ? "bg-jelly-red text-white hover:brightness-90"
                  : input.trim()
                    ? "bg-jelly-blue text-white shadow-[0_4px_10px_rgba(45,122,164,0.18)] hover:brightness-95"
                    : "cursor-not-allowed bg-[#f3f4f5] text-[#c4c9cf]"
                }
              `}
            >
              {chatLoading ? (
                <Square size={13} fill="currentColor" strokeWidth={2.4} />
              ) : (
                <Send size={16} strokeWidth={2.2} />
              )}
            </button>
          </div>
        </div>
        {(voiceListening || voiceError) && (
          <div
            className={`mt-1.5 text-[12px] ${
              voiceError ? "text-jelly-red" : "text-jelly-text-muted"
            }`}
          >
            {voiceError || "正在听写..."}
          </div>
        )}
      </div>

      {deletingSessionId && (
        <div className="fixed inset-0 z-[120] grid place-items-center bg-[#26343d]/20 p-5 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="删除对话">
          <div className="w-full max-w-sm rounded-2xl border border-[#dfe5e9] bg-white p-5 shadow-[0_24px_70px_rgba(25,39,50,0.22)]">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#fff1ef] text-jelly-red"><Trash2 size={19} /></span>
              <div className="min-w-0">
                <h3 className="text-[16px] font-semibold text-jelly-text">删除这段对话？</h3>
                <p className="mt-1 line-clamp-2 text-[13px] leading-6 text-jelly-text-muted">
                  {chatSessions.find((session) => session.id === deletingSessionId)?.title ?? "这段对话"}将从历史记录中移除，已经保存的笔记不会受到影响。
                </p>
              </div>
            </div>
            {sessionActionError && <p className="mt-3 text-[12px] text-jelly-red">{sessionActionError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setDeletingSessionId(null)} disabled={sessionActionBusy} className="h-9 rounded-xl border border-[#dfe5e9] px-4 text-[13px] font-medium text-jelly-text-soft hover:bg-[#f6f8fa] disabled:opacity-50">取消</button>
              <button type="button" onClick={() => void handleDeleteChat()} disabled={sessionActionBusy} className="inline-flex h-9 items-center rounded-xl bg-jelly-red px-4 text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-50">
                {sessionActionBusy && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                删除
              </button>
            </div>
          </div>
        </div>
      )}

    </aside>
  );
}
