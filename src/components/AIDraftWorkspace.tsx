import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BookOpenCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  ListTree,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCcw,
  Save,
  Sparkles,
  Square,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { useDraftSlice, useWorkspaceSlice } from "../store/selectors";
import AIWritingStatus from "./AIWritingStatus";
import { draftWritingStage, draftWritingLabels } from "../utils/aiWritingFlow";
import type { FileNode } from "../types";
import { generateNoteStream } from "../services/aiStream";
import {
  assembleNoteDraft,
  cancelNoteDraft,
  confirmDraftSection,
  createDraftSection,
  createNoteDraft,
  deleteDraftSection,
  generateAllDraftSections,
  generateDraftSection,
  getNoteDraft,
  restoreDraftSection,
  saveDraftToNotes,
  stopAllDraftSections,
  updateNoteDraft,
  updateDraftSection,
  type DraftSectionPayload,
  type NoteDraftRecord,
  type NoteDraftSectionRecord,
  type NoteDraftSectionStatus,
} from "../services/drafts";
import { bindAgentCheckpoint, resolveAgentCheckpoint } from "../services/agent";
import { isMemoryEnabled } from "../services/memories";
import { handleRenderedCodeBlockAction, renderChatMarkdown } from "../utils/chatMarkdown";
import { useConfirmDialog } from "./ConfirmDialog";
import "./draft-workspace.css";
import "./document-prose.css";
import { buildBodySupplement, buildDraftGenerationRequest, type DraftBrief } from "../utils/draftBrief";
import { headingNumberPrefixLength } from "../utils/headingNumbering";

const AUTO_NOTE_TYPE = "智能笔记";
const AUTO_WRITING_TONE = "根据用户需求自动匹配";
const AUTO_NOTE_FORMAT = "AI 自动组织结构";
const AUTO_HEADING_LEVEL = "AI 自动层级";

type BusyMode = "idle" | "outline" | "section" | "assemble" | "save" | "revise" | "cancel";
interface FolderOption {
  id: string | null;
  path: string;
}

interface OutlineSection {
  title: string;
  level: number;
  outlineText: string;
  sortOrder: number;
}

const HEADING_RE = /^(#{1,4})\s+(.+?)\s*#*\s*$/;
const ORDERED_LIST_RE = /^\d+[.)]\s+(.+?)\s*$/;

const sectionStatusMeta: Record<string, { label: string; className: string }> = {
  outline_only: {
    label: "未生成",
    className: "border-jelly-border bg-white text-jelly-text-muted",
  },
  generating: {
    label: "生成中",
    className: "border-jelly-blue/35 bg-jelly-blue-pale text-jelly-blue-deep",
  },
  generated: {
    label: "已生成",
    className: "border-jelly-green/35 bg-jelly-green-bg text-jelly-green",
  },
  needs_revision: {
    label: "需要修改",
    className: "border-jelly-amber/35 bg-jelly-amber-bg text-jelly-amber",
  },
  confirmed: {
    label: "已确认",
    className: "border-jelly-green/40 bg-jelly-green-bg text-jelly-green",
  },
  deleted: {
    label: "已删除",
    className: "border-jelly-red/30 bg-jelly-red-bg text-jelly-red",
  },
  failed: {
    label: "失败",
    className: "border-jelly-red/30 bg-jelly-red-bg text-jelly-red",
  },
};

function flattenFolders(nodes: FileNode[], prefix = ""): FolderOption[] {
  return nodes.flatMap((node) => {
    if (node.type !== "folder") return [];
    const path = prefix ? `${prefix} / ${node.name}` : node.name;
    return [
      { id: node.id, path },
      ...flattenFolders(node.children ?? [], path),
    ];
  });
}

function cleanDraftTopic(seed: string): string {
  return seed.trim() || "未命名笔记";
}

function cleanTitle(value: string): string {
  return value.trim().replace(/\.md$/i, "").trim() || "未命名笔记";
}

function cleanSectionTitle(value: string): string {
  const title = value.replace(/^(?:#{1,6}\s+|[-*+]\s+)/, "").trim();
  return (
    title.slice(headingNumberPrefixLength(title))
      .replace(/\s+/g, " ")
      .trim() || "未命名小节"
  );
}

function outlineGenerationError(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  const normalized = message.toLocaleLowerCase();
  if (
    normalized.includes("too many") ||
    normalized.includes("rate limit") ||
    normalized.includes("ai_rate_limited") ||
    message.includes("请求较多") ||
    message.includes("请求过于频繁")
  ) {
    return "当前生成请求较多，本次大纲生成已暂停。请稍等十几秒后点击“重新生成大纲”。";
  }
  return message || "大纲生成失败，请稍后重试。";
}

function parseOutlineSections(outline: string): OutlineSection[] {
  const sections: OutlineSection[] = [];
  let mainTitle = "";

  const startSection = (title: string, level: number, line: string) => {
    const normalizedLevel = Math.max(2, Math.min(level, 4));
    const section = {
      title: cleanSectionTitle(title),
      level: normalizedLevel,
      sortOrder: sections.length,
      outlineText: line.trim(),
    };
    sections.push(section);
  };

  outline
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .forEach((line) => {
      if (!line.trim()) return;
      const headingMatch = line.match(HEADING_RE);
      if (headingMatch) {
        const level = headingMatch[1].length;
        if (level === 1) {
          mainTitle = cleanSectionTitle(headingMatch[2]);
          return;
        }
        if (level > 2) {
          const current = sections[sections.length - 1];
          if (current) current.outlineText = `${current.outlineText}\n${line.trim()}`;
          return;
        }
        startSection(headingMatch[2], level, line);
        return;
      }

      const listMatch = line.match(ORDERED_LIST_RE);
      if (listMatch) {
        startSection(listMatch[1], 2, line);
        return;
      }

      const current = sections[sections.length - 1];
      if (current) current.outlineText = `${current.outlineText}\n${line.trim()}`;
    });

  if (!sections.length && outline.trim()) {
    sections.push({
      title: mainTitle || cleanSectionTitle(outline.split("\n")[0]),
      level: 2,
      sortOrder: 0,
      outlineText: outline.trim(),
    });
  }

  return sections;
}

function makeSectionPayloads(outline: string): DraftSectionPayload[] {
  return parseOutlineSections(outline).map((section) => ({
    title: section.title,
    level: section.level,
    sortOrder: section.sortOrder,
    outlineText: section.outlineText,
    status: "outline_only",
  }));
}

function buildSmartRequirement(topicText: string, feedbackText = "", currentOutline = "", rawRequest = ""): string {
  const cleanTopicText = topicText.trim();
  const cleanRawRequest = rawRequest.trim();
  const lines = [
    cleanRawRequest || cleanTopicText
      ? `用户原始需求：${cleanRawRequest || cleanTopicText}`
      : "",
  ];
  if (cleanTopicText && cleanRawRequest && cleanRawRequest !== cleanTopicText) {
    lines.push(`整理后的主题：${cleanTopicText}`);
  }
  if (feedbackText.trim()) {
    if (currentOutline.trim()) {
      lines.push(`当前已有大纲：\n${currentOutline.trim()}`);
    }
    lines.push(
      `用户对当前草稿/大纲的反馈：${feedbackText.trim()}`,
      "请根据用户反馈重新生成大纲。"
    );
  }
  return lines.filter(Boolean).join("\n");
}

function requestWantsCode(value: string): boolean {
  return /代码|源码|code|demo|示例代码|代码示例|写个程序|实现一下|实战/i.test(value);
}

function requestWantsExercises(value: string): boolean {
  return /练习|习题|题目|作业|课后题|测试题/i.test(value);
}

function rawRequestFromDraft(draft: NoteDraftRecord | null, fallback = ""): string {
  const config = draft?.draftConfig ?? {};
  const rawRequest = typeof config.rawRequest === "string" ? config.rawRequest.trim() : "";
  if (rawRequest) return rawRequest;
  const trigger = typeof config.trigger === "string" ? config.trigger.trim() : "";
  if (trigger) return trigger;
  const extraRequest = draft?.extraRequest ?? "";
  const match = extraRequest.match(/^用户原始需求：(.+)$/m);
  return match?.[1]?.trim() || fallback.trim();
}

function getMaxTokens(extraRequest: string): number {
  if (/详细|深入|完整|体系化|全面|教程|长文|系统/.test(extraRequest)) {
    return 9000;
  }
  return 6500;
}

function buildSectionOutline(section: NoteDraftSectionRecord): string {
  const heading = "#".repeat(Math.max(1, Math.min(section.level, 4)));
  const outlineText = section.outlineText.trim();
  if (outlineText.startsWith(`${heading} `)) return outlineText;
  return `${heading} ${section.title}\n${outlineText}`.trim();
}

function stripRepeatedMainTitle(content: string, mainTitle: string): string {
  const title = cleanTitle(mainTitle);
  if (!title) return content.trim();
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return content
    .replace(new RegExp(`^#\\s+${escapedTitle}\\s*\\n+`, "i"), "")
    .replace(new RegExp(`\\n{2,}#\\s+${escapedTitle}\\s*\\n+`, "gi"), "\n\n")
    .trim();
}

function assembleLocalDraft(title: string, sections: NoteDraftSectionRecord[]): string {
  const body = sections
    .filter((section) => section.status !== "deleted")
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((section) => {
      const content = stripRepeatedMainTitle(section.content, title);
      if (content) return content;
      const heading = "#".repeat(Math.max(1, Math.min(section.level, 4)));
      const outlineText = section.outlineText.trim();
      if (/^#{1,4}\s+/u.test(outlineText)) return outlineText;
      return `${heading} ${section.title}\n\n${outlineText}`.trim();
    })
    .filter(Boolean)
    .join("\n\n");
  return body.trim();
}

function statusLabel(status: NoteDraftSectionStatus): string {
  return sectionStatusMeta[status]?.label ?? status;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-[12px] font-medium text-jelly-text-soft">
      {children}
    </span>
  );
}

function SelectField<TValue extends string>({
  value,
  options,
  onChange,
}: {
  value: TValue;
  options: { value: TValue; label: string }[];
  onChange: (value: TValue) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as TValue)}
      className="nf-draft-field h-8 w-full px-2.5"
    >
      {options.map((option) => (
        <option key={option.value || "root"} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export default function AIDraftWorkspace() {
  const {
    centerMode,
    draftSeed,
    draftCommand,
    closeDraft,
    dismissDraftWorkspace,
    consumeDraftCommand,
    setActiveDraftContext,
    pendingCheckpoint,
    draftBriefApprovalRequired,
    editDraftBrief,
  } = useDraftSlice();
  const { treeData, reloadWorkspace } = useWorkspaceSlice();
  const folders = useMemo(() => flattenFolders(treeData), [treeData]);
  const folderOptions = useMemo(
    () => [
      { value: "", label: "知识库根目录" },
      ...folders.map((folder) => ({ value: folder.id ?? "", label: folder.path })),
    ],
    [folders]
  );

  const initialTopic = useMemo(() => cleanDraftTopic(draftSeed), [draftSeed]);
  const checkpointMatchesCurrentSeed = useMemo(() => {
    if (pendingCheckpoint?.checkpointType !== "draft_workspace") return false;
    const checkpointSeed = typeof pendingCheckpoint.payload?.seed === "string"
      ? cleanDraftTopic(pendingCheckpoint.payload.seed)
      : "";
    return !checkpointSeed || !initialTopic || checkpointSeed === initialTopic;
  }, [initialTopic, pendingCheckpoint]);
  const checkpointRawRequest = useMemo(() => {
    const payload = checkpointMatchesCurrentSeed ? pendingCheckpoint?.payload : null;
    return typeof payload?.rawRequest === "string" ? payload.rawRequest.trim() : "";
  }, [checkpointMatchesCurrentSeed, pendingCheckpoint]);
  const [topic, setTopic] = useState(initialTopic);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [draft, setDraft] = useState<NoteDraftRecord | null>(null);
  const [streamingOutline, setStreamingOutline] = useState("");
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [busyMode, setBusyMode] = useState<BusyMode>("idle");
  const [statusText, setStatusText] = useState("");
  const [errorText, setErrorText] = useState("");
  const [outlineInstruction, setOutlineInstruction] = useState("");
  const [sectionInstruction, setSectionInstruction] = useState("");
  const [newSectionTitle, setNewSectionTitle] = useState("");
  const [renamingSectionId, setRenamingSectionId] = useState<string | null>(null);
  const [renamingSectionTitle, setRenamingSectionTitle] = useState("");
  const [bodyInstructionOpen, setBodyInstructionOpen] = useState(false);
  const [bodyInstructionDraft, setBodyInstructionDraft] = useState("");
  const [directoryManagerOpen, setDirectoryManagerOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const activeRequestRef = useRef<AbortController | null>(null);
  const completedNoteRef = useRef<string | null>(null);
  const autoOutlineStartedRef = useRef(false);
  const taskSeedRef = useRef(initialTopic);
  const bodyInstructionRef = useRef<HTMLDivElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const sectionInstructionRef = useRef<HTMLTextAreaElement | null>(null);
  const outlineInstructionRef = useRef<HTMLTextAreaElement | null>(null);
  const supplementInputRef = useRef<HTMLTextAreaElement | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();

  const isBusy = busyMode !== "idle";
  const activeSections = useMemo(
    () =>
      (draft?.sections ?? [])
        .filter((section) => section.status !== "deleted")
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [draft]
  );
  const deletedSections = useMemo(
    () =>
      (draft?.sections ?? [])
        .filter((section) => section.status === "deleted")
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [draft]
  );
  const selectedSection =
    draft?.sections.find((section) => section.id === selectedSectionId && section.status !== "deleted") ??
    activeSections[0] ??
    null;
  const renderedSection = useMemo(
    () => renderChatMarkdown(selectedSection?.content || ""),
    [selectedSection?.content]
  );
  const canGenerateSections = Boolean(draft && activeSections.length > 0);
  const canSave = Boolean(draft?.status === "assembled" && draft.assembledContent.trim());
  const writingStage = draftWritingStage(draft?.status, busyMode, errorText, activeSections.some(section => Boolean(section.content.trim())));
  const writingStatus = draftWritingLabels[writingStage];

  const fitSectionInstruction = useCallback(() => {
    const field = sectionInstructionRef.current;
    if (!field) return;
    const lineHeight = Number.parseFloat(getComputedStyle(field).lineHeight) || 22;
    const maxHeight = lineHeight * 4;
    field.style.height = `${lineHeight}px`;
    field.style.height = `${Math.min(maxHeight, Math.max(lineHeight, field.scrollHeight))}px`;
    field.style.overflowY = field.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);
  useLayoutEffect(fitSectionInstruction, [fitSectionInstruction, sectionInstruction, selectedSection?.id, Boolean(selectedSection?.content), centerMode]);
  useLayoutEffect(() => {
    const field = outlineInstructionRef.current;
    if (!field) return;
    const fit = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(field).lineHeight) || 22;
      field.style.height = `${lineHeight}px`;
      field.style.height = `${Math.min(lineHeight * 4, Math.max(lineHeight, field.scrollHeight))}px`;
      field.style.overflowY = field.scrollHeight > lineHeight * 4 ? "auto" : "hidden";
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width !== field.clientWidth) { width = field.clientWidth; fit(); }
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [outlineInstruction, directoryManagerOpen]);
  useLayoutEffect(() => {
    const field = supplementInputRef.current;
    if (!field) return;
    const fit = () => {
      const style = getComputedStyle(field);
      const lineHeight = Number.parseFloat(style.lineHeight) || 22;
      const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
      const minHeight = lineHeight * 2 + padding, maxHeight = lineHeight * 6 + padding;
      field.style.height = `${minHeight}px`;
      field.style.height = `${Math.min(maxHeight, Math.max(minHeight, field.scrollHeight))}px`;
      field.style.overflowY = field.scrollHeight > maxHeight ? "auto" : "hidden";
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width !== field.clientWidth) { width = field.clientWidth; fit(); }
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [bodyInstructionDraft, bodyInstructionOpen]);
  useEffect(() => {
    const field = sectionInstructionRef.current;
    if (!field || typeof ResizeObserver === "undefined") return;
    let width = field.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const nextWidth = field.getBoundingClientRect().width;
      if (nextWidth !== width) { width = nextWidth; fitSectionInstruction(); }
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [fitSectionInstruction, selectedSection?.id, Boolean(selectedSection?.content), centerMode]);

  useEffect(() => {
    if (!initialTopic || taskSeedRef.current === initialTopic) return;
    taskSeedRef.current = initialTopic;
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    completedNoteRef.current = null;
    autoOutlineStartedRef.current = false;
    setTopic(initialTopic);
    setCategoryId(null);
    setDraft(null);
    setStreamingOutline("");
    setSelectedSectionId(null);
    setBusyMode("idle");
    setStatusText("正在根据你的要求生成大纲…");
    setErrorText("");
  }, [initialTopic]);

  useEffect(() => {
    if (!draft && !isBusy) {
      setTopic(initialTopic);
    }
  }, [draft, initialTopic, isBusy]);

  useEffect(() => {
    setSectionInstruction("");
  }, [selectedSection?.id]);

  useEffect(() => {
    if (!bodyInstructionOpen) {
      setBodyInstructionDraft(draft?.bodyInstruction ?? "");
      return;
    }
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(".nf-draft-confirmation")) return;
      if (!bodyInstructionRef.current?.contains(event.target as Node)) {
        setBodyInstructionOpen(false);
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick, true);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick, true);
  }, [bodyInstructionOpen, draft?.bodyInstruction]);

  useEffect(() => {
    if (!moreMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!moreMenuRef.current?.contains(event.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick, true);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick, true);
  }, [moreMenuOpen]);

  useEffect(() => {
    if (centerMode !== "draft") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
      // The existing confirmation owns Escape; do not dismiss its parent too.
      if (document.querySelector(".nf-draft-confirmation [role='dialog']")) return;
      if (saveDialogOpen) {
        setSaveDialogOpen(false);
        return;
      }
      if (directoryManagerOpen) {
        setDirectoryManagerOpen(false);
        return;
      }
      if (bodyInstructionOpen || moreMenuOpen) {
        setBodyInstructionOpen(false);
        setMoreMenuOpen(false);
        return;
      }
      dismissDraftWorkspace();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [bodyInstructionOpen, centerMode, directoryManagerOpen, dismissDraftWorkspace, moreMenuOpen, saveDialogOpen]);

  useEffect(() => {
    return () => activeRequestRef.current?.abort();
  }, []);

  useEffect(() => {
    const sections = draft?.sections.filter((section) => section.status !== "deleted") ?? [];
    const completedSections = sections.filter((section) =>
      ["generated", "confirmed"].includes(section.status)
    ).length;
    const generationJob = (draft?.draftConfig?.generationJob ?? {}) as Record<string, unknown>;
    const jobError = typeof generationJob.error === "string" ? generationJob.error : "";
    setActiveDraftContext(
      {
        id: draft?.id ?? "",
        title: draft?.title || cleanTitle(topic),
        topic: draft?.topic || topic,
        stage: writingStage,
        busy: isBusy,
        statusText:
          draft?.status === "generating" && typeof generationJob.currentSectionTitle === "string"
            ? `正在后台生成：${generationJob.currentSectionTitle}`
            : statusText,
        errorText: errorText || (draft?.status === "failed" ? jobError : ""),
        completedSections,
        totalSections: sections.length,
        hasBody: sections.some(section => Boolean(section.content.trim())),
      }
    );
  }, [draft, errorText, isBusy, setActiveDraftContext, statusText, topic, writingStage]);

  const patchSection = useCallback((sectionId: string, patch: Partial<NoteDraftSectionRecord>) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            sections: current.sections.map((section) =>
              section.id === sectionId ? { ...section, ...patch } : section
            ),
          }
        : current
    );
  }, []);

  const replaceDraft = useCallback((nextDraft: NoteDraftRecord) => {
    const sorted = [...nextDraft.sections].sort((a, b) => a.sortOrder - b.sortOrder);
    setDraft({ ...nextDraft, sections: sorted });
    const firstActive = sorted.find((section) => section.status !== "deleted");
    setSelectedSectionId((current) =>
      current && sorted.some((section) => section.id === current && section.status !== "deleted") ? current : firstActive?.id ?? null
    );
  }, []);

  useEffect(() => {
    const draftId = checkpointMatchesCurrentSeed && pendingCheckpoint?.checkpointType === "draft_workspace"
      ? pendingCheckpoint.payload?.draftId
      : null;
    if (draft || typeof draftId !== "string" || !draftId) return;
    let alive = true;
    setBusyMode("revise");
    setStatusText("正在恢复上次未完成的草稿…");
    void getNoteDraft(draftId)
      .then((restored) => {
        if (!alive) return;
        replaceDraft(restored);
        setTopic(restored.topic || restored.title);
        setCategoryId(restored.categoryId);
        setStatusText(
          restored.status === "generating"
            ? "后台正在继续生成，刷新或关闭页面不会中断。"
            : "已恢复上次未完成的课程方案。"
        );
      })
      .catch((error) => { if (alive) setErrorText(error instanceof Error ? error.message : "恢复草稿失败"); })
      .finally(() => { if (alive) setBusyMode("idle"); });
    return () => { alive = false; };
  }, [checkpointMatchesCurrentSeed, draft, pendingCheckpoint, replaceDraft]);

  const stopActiveRequest = useCallback(() => {
    const controller = activeRequestRef.current;
    controller?.abort();
    activeRequestRef.current = null;
    setBusyMode("idle");
    if (controller) {
      setStatusText("已停止当前生成。");
      if (!draft) setErrorText("大纲生成已停止，请点击“重新生成大纲”继续。");
    }
  }, [draft]);

  const createOutline = useCallback(async (feedbackText = "", topicOverride = "", submittedBrief?: DraftBrief, messageId?: string) => {
    const isFeedback = Boolean(feedbackText.trim());
    const currentDraftTopic = draft ? (draft.topic || draft.title || topic) : "";
    const cleanTopicValue = cleanTitle(
      submittedBrief?.title || (isFeedback && currentDraftTopic ? currentDraftTopic : topicOverride || topic)
    );
    if (!cleanTopicValue || isBusy || activeRequestRef.current) return;
    // The chat card confirms a new task once. Further structure changes belong
    // to this workspace and never replace its original task with a new topic.
    if (submittedBrief && draft) {
      if (messageId) editDraftBrief?.(messageId, {requestPending:false});
      return;
    }

    const currentOutline = draft?.outline || streamingOutline;
    const controller = new AbortController();
    activeRequestRef.current = controller;
    setTopic(cleanTopicValue);
    setBusyMode("outline");
    setErrorText("");
    setStatusText(feedbackText.trim() ? "正在根据你的反馈调整大纲。" : "正在规划大纲。");
    setStreamingOutline("");

    try {
      let outline = "";
      const persistedRawRequest = rawRequestFromDraft(
        draft,
        checkpointRawRequest || draftSeed || topicOverride || cleanTopicValue
      );
      const rawRequest = submittedBrief?.rawRequest || persistedRawRequest || cleanTopicValue;
      const savedBrief = draft?.draftConfig?.generationBrief as DraftBrief | undefined;
      const generationBrief = submittedBrief || savedBrief;
      const smartRequirement = generationBrief
        ? buildDraftGenerationRequest(generationBrief) + (isFeedback ? `\n\n用户最新反馈：${feedbackText}\n当前大纲：\n${currentOutline}` : "")
        : buildSmartRequirement(cleanTopicValue, feedbackText, currentOutline, rawRequest);
      const effectiveRequirements = generationBrief ? `${generationBrief.title}\n${generationBrief.requirements}` : rawRequest;
      const includeCode = requestWantsCode(effectiveRequirements);
      const includeExercises = requestWantsExercises(effectiveRequirements);
      if (submittedBrief && pendingCheckpoint?.checkpointType === "draft_workspace") {
        await bindAgentCheckpoint(pendingCheckpoint.id, {payload:{draftBrief:submittedBrief,manualOutline:true}});
        if (controller.signal.aborted || activeRequestRef.current !== controller) return;
      }
      await generateNoteStream({
        mode: "outline",
        topic: cleanTopicValue,
        noteType: AUTO_NOTE_TYPE,
        writingTone: AUTO_WRITING_TONE,
        noteFormat: AUTO_NOTE_FORMAT,
        headingLevel: AUTO_HEADING_LEVEL,
        includeCode,
        includeExercises,
        extraRequest: smartRequirement,
        memoryEnabled: isMemoryEnabled(),
        maxTokens: getMaxTokens(effectiveRequirements),
        temperature: 0.35,
        signal: controller.signal,
        onDelta: (delta) => {
          if (controller.signal.aborted || activeRequestRef.current !== controller) return;
          outline += delta;
          setStreamingOutline(outline);
        },
      });

      if (controller.signal.aborted || activeRequestRef.current !== controller) return;
      if (!outline.trim()) {
        throw new Error("大纲为空，请换一个主题或稍后重试。");
      }

      const created = draft
        ? await updateNoteDraft(draft.id, {
            title: cleanTopicValue,
            outline,
            status: "outline_ready",
            assembledContent: "",
            sections: makeSectionPayloads(outline),
            ...(generationBrief ? {generationBrief,includeCode,includeExercises} : {}),
          })
        : await createNoteDraft({
            title: cleanTopicValue,
            topic: cleanTopicValue,
            categoryId,
            noteType: AUTO_NOTE_TYPE,
            writingTone: AUTO_WRITING_TONE,
            noteFormat: AUTO_NOTE_FORMAT,
            headingLevel: AUTO_HEADING_LEVEL,
            includeCode,
            includeExercises,
            extraRequest: smartRequirement,
            draftConfig: {
              source: "note_draft_tool",
              trigger: draftSeed,
              rawRequest,
              ...(generationBrief ? {generationBrief} : {}),
              includeCode,
              includeExercises,
            },
            outline,
            sections: makeSectionPayloads(outline),
          });

      if (controller.signal.aborted || activeRequestRef.current !== controller) return;
      replaceDraft(created);
      if (messageId && submittedBrief) editDraftBrief?.(messageId, {generatedBrief:submittedBrief});
      if (!draft && pendingCheckpoint?.checkpointType === "draft_workspace") {
        await bindAgentCheckpoint(pendingCheckpoint.id, { draftId: created.id, ...(submittedBrief ? {payload:{draftBrief:submittedBrief,generatedBrief:submittedBrief,manualOutline:true}} : {}) });
      } else if (submittedBrief && pendingCheckpoint?.checkpointType === "draft_workspace") {
        await bindAgentCheckpoint(pendingCheckpoint.id, {draftId:created.id,payload:{draftBrief:submittedBrief,generatedBrief:submittedBrief,manualOutline:true}});
      }
      if (controller.signal.aborted || activeRequestRef.current !== controller) return;
      setStreamingOutline("");
      setOutlineInstruction("");
      setStatusText(feedbackText.trim() ? "已根据你的反馈重新生成大纲。确认后可以逐节生成正文。" : "大纲已生成。确认后可以逐节生成正文。");
    } catch (error) {
      if (controller.signal.aborted || activeRequestRef.current !== controller) return;
      setErrorText(outlineGenerationError(error));
      setStatusText("");
    } finally {
      if (messageId) editDraftBrief?.(messageId, {requestPending:false});
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
        setBusyMode("idle");
      }
    }
  }, [
    categoryId,
    checkpointRawRequest,
    draftSeed,
    draft?.title,
    draft?.id,
    draft?.outline,
    draft?.topic,
    isBusy,
    replaceDraft,
    streamingOutline,
    topic,
    pendingCheckpoint,
    editDraftBrief,
  ]);

  useEffect(() => {
    const restoredDraftId = checkpointMatchesCurrentSeed && pendingCheckpoint?.checkpointType === "draft_workspace"
      ? pendingCheckpoint.payload?.draftId
      : null;
    if (
      draft ||
      draftBriefApprovalRequired ||
      draftCommand ||
      isBusy ||
      autoOutlineStartedRef.current ||
      (typeof restoredDraftId === "string" && restoredDraftId) ||
      !draftSeed.trim()
    ) return;
    // StrictMode replays effects before this microtask. Only the surviving
    // setup may launch a request; its cleanup must not poison the start flag.
    let canceled = false;
    queueMicrotask(() => {
      if (canceled || autoOutlineStartedRef.current) return;
      autoOutlineStartedRef.current = true;
      void createOutline("", initialTopic);
    });
    return () => { canceled = true; };
  }, [checkpointMatchesCurrentSeed, createOutline, draft, draftCommand, draftSeed, initialTopic, isBusy, pendingCheckpoint, draftBriefApprovalRequired]);

  useEffect(() => {
    if (
      !draftCommand ||
      !["generate_outline", "regenerate_outline"].includes(draftCommand.action) ||
      isBusy
    ) return;
    let canceled = false;
    queueMicrotask(() => {
      if (canceled) return;
      autoOutlineStartedRef.current = true;
      consumeDraftCommand(draftCommand.id);
      const currentDraftTopic = draft ? draft.topic || draft.title || topic : "";
      void createOutline(
        draftCommand.action === "regenerate_outline" ? draftCommand.feedback : "",
        draftCommand.brief?.title || currentDraftTopic || draftCommand.seed,
        draftCommand.brief,
        draftCommand.messageId,
      );
    });
    return () => { canceled = true; };
  }, [consumeDraftCommand, createOutline, draft, draftCommand, isBusy, topic]);

  const runSectionGeneration = useCallback(
    async (
      baseDraft: NoteDraftRecord,
      section: NoteDraftSectionRecord,
      instruction = ""
    ): Promise<NoteDraftRecord | null> => {
      const controller = activeRequestRef.current;
      if (!controller) return null;
      let generated = "";
      patchSection(section.id, { status: "generating", content: "" });
      setSelectedSectionId(section.id);
      setStatusText(`正在生成：${section.title}`);

      try {
        await updateDraftSection(baseDraft.id, section.id, {
          status: "generating",
          source: "generate_section",
        }).catch(() => {});

        const rawRequest = rawRequestFromDraft(
          baseDraft,
          checkpointRawRequest || draftSeed || baseDraft.topic || baseDraft.title || topic
        );
        const includeCode = baseDraft.includeCode || requestWantsCode(rawRequest);
        const includeExercises = baseDraft.includeExercises || requestWantsExercises(rawRequest);
        const bodyInstruction = (baseDraft.bodyInstruction || "").trim();
        const bodyInstructionContext = buildBodySupplement(bodyInstruction);

        const revisionContext = instruction.trim() && section.content.trim()
          ? `\n\n当前本章正文：\n${section.content.trim()}\n\n用户对本章的修改要求：${instruction.trim()}\n请在保留正确内容的基础上完整重写本章。`
          : instruction.trim()
            ? `\n\n用户对本章的补充要求：${instruction.trim()}`
            : "";
        await generateNoteStream({
          mode: "section",
          topic: cleanTitle(baseDraft.topic || topic),
          noteType: AUTO_NOTE_TYPE,
          writingTone: AUTO_WRITING_TONE,
          noteFormat: AUTO_NOTE_FORMAT,
          headingLevel: AUTO_HEADING_LEVEL,
          includeCode,
          includeExercises,
          extraRequest: `${baseDraft.draftConfig?.generationBrief ? buildDraftGenerationRequest(baseDraft.draftConfig.generationBrief as DraftBrief) : buildSmartRequirement(baseDraft.topic || topic, "", "", rawRequest)}${bodyInstructionContext}${revisionContext}`,
          memoryEnabled: isMemoryEnabled(),
          outlinePlan: `${buildSectionOutline(section)}${revisionContext}`,
          maxTokens: getMaxTokens(rawRequest || baseDraft.topic || topic),
          temperature: 0.52,
          signal: controller.signal,
          onDelta: (delta) => {
            generated += delta;
            patchSection(section.id, { content: generated });
          },
        });

        const nextDraft = await generateDraftSection(baseDraft.id, section.id, {
          content: generated.trim(),
          status: "generated",
          source: "generate_section",
        });
        replaceDraft(nextDraft);
        return nextDraft;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          const partialContent = generated.trim();
          const stoppedStatus = partialContent ? "needs_revision" : "outline_only";
          const stoppedDraft = await updateDraftSection(baseDraft.id, section.id, {
            content: partialContent,
            status: stoppedStatus,
            source: "generation_stopped",
          }).catch(() => null);
          if (stoppedDraft) {
            replaceDraft(stoppedDraft);
          } else {
            patchSection(section.id, {
              content: partialContent,
              status: stoppedStatus,
            });
          }
          setStatusText(
            partialContent
              ? `${section.title} 已停止生成，已保留当前内容。`
              : `${section.title} 已停止生成。`
          );
        } else {
          patchSection(section.id, { status: "failed" });
          await updateDraftSection(baseDraft.id, section.id, {
            status: "failed",
            source: "generate_section",
          }).catch(() => {});
          setErrorText(
            error instanceof Error ? `${section.title} 生成失败：${error.message}` : "小节生成失败"
          );
        }
        return null;
      }
    },
    [
      checkpointRawRequest,
      draftSeed,
      patchSection,
      replaceDraft,
      topic,
    ]
  );

  const generateOneSection = useCallback(
    async (section: NoteDraftSectionRecord, instruction = "") => {
      if (!draft || isBusy) return;
      activeRequestRef.current?.abort();
      const controller = new AbortController();
      activeRequestRef.current = controller;
      setBusyMode("section");
      setErrorText("");

      try {
        const nextDraft = await runSectionGeneration(draft, section, instruction);
        if (nextDraft) {
          setSectionInstruction("");
          setStatusText(instruction.trim() ? `${section.title} 已按要求重新润色。` : `${section.title} 已生成，可以确认或继续修改。`);
        }
      } finally {
        if (activeRequestRef.current === controller) {
          activeRequestRef.current = null;
        }
        setBusyMode("idle");
      }
    },
    [draft, isBusy, runSectionGeneration]
  );

  const generateAllSections = useCallback(async () => {
    if (!draft || isBusy || activeSections.length === 0 || draft.status === "generating") return;
    setBusyMode("revise");
    setErrorText("");

    try {
      const queued = await generateAllDraftSections(draft.id, draft.status === "failed");
      replaceDraft(queued);
      setStatusText("已交给后台生成。你可以继续阅读、关闭页面，稍后回来查看进度。");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "完整课程生成失败");
      setStatusText("生成任务未能启动，可在右侧继续重试。");
    } finally {
      setBusyMode("idle");
    }
  }, [
    activeSections,
    draft,
    isBusy,
    replaceDraft,
  ]);

  const stopBackgroundGeneration = useCallback(async () => {
    if (!draft || draft.status !== "generating") return;
    setBusyMode("revise");
    try {
      const stopped = await stopAllDraftSections(draft.id);
      replaceDraft(stopped);
      setStatusText("");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "停止生成失败");
    } finally {
      setBusyMode("idle");
    }
  }, [draft, replaceDraft]);

  useEffect(() => {
    if (!draft || draft.status !== "generating") return;
    let alive = true;
    const sync = async () => {
      try {
        const latest = await getNoteDraft(draft.id);
        if (!alive) return;
        replaceDraft(latest);
        if (latest.status === "saved" && latest.savedNoteId && completedNoteRef.current !== latest.savedNoteId) {
          completedNoteRef.current = latest.savedNoteId;
          reloadWorkspace(latest.savedNoteId, `“${latest.title}”已生成完成并保存。`);
          if (pendingCheckpoint?.checkpointType === "draft_workspace") {
            await resolveAgentCheckpoint(pendingCheckpoint.id, "resolved", {
              draftId: latest.id,
              noteId: latest.savedNoteId,
            }).catch(() => null);
          }
          closeDraft({ status: "resolved", draftId: latest.id });
        }
      } catch (error) {
        if (alive) setErrorText(error instanceof Error ? error.message : "读取生成进度失败");
      }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 2500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [closeDraft, draft?.id, draft?.status, pendingCheckpoint, reloadWorkspace, replaceDraft]);

  const assembleCurrentDraft = useCallback(async () => {
    if (!draft || isBusy) return;
    setBusyMode("assemble");
    setErrorText("");
    try {
      const content = assembleLocalDraft(cleanTitle(topic), draft.sections);
      const assembled = await assembleNoteDraft(draft.id, content);
      replaceDraft(assembled);
      setStatusText("草稿已重新组装。");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "组装草稿失败");
    } finally {
      setBusyMode("idle");
    }
  }, [draft, isBusy, replaceDraft, topic]);

  const confirmSection = useCallback(async () => {
    if (!draft || !selectedSection || isBusy) return;
    setBusyMode("revise");
    setErrorText("");
    try {
      const nextDraft = await confirmDraftSection(draft.id, selectedSection.id);
      replaceDraft(nextDraft);
      setStatusText(`${selectedSection.title} 已确认。`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "确认小节失败");
    } finally {
      setBusyMode("idle");
    }
  }, [draft, isBusy, replaceDraft, selectedSection]);

  const deleteSection = useCallback(async (section = selectedSection) => {
    if (!draft || !section || isBusy) return;
    setBusyMode("revise");
    setErrorText("");
    try {
      const nextDraft = await deleteDraftSection(draft.id, section.id);
      replaceDraft(nextDraft);
      setStatusText(`${section.title} 已从草稿中删除，可在下方恢复。`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "删除小节失败");
    } finally {
      setBusyMode("idle");
    }
  }, [draft, isBusy, replaceDraft, selectedSection]);

  const restoreSection = useCallback(
    async (section: NoteDraftSectionRecord) => {
      if (!draft || isBusy) return;
      setBusyMode("revise");
      setErrorText("");
      try {
        const nextDraft = await restoreDraftSection(draft.id, section.id);
        replaceDraft(nextDraft);
        setSelectedSectionId(section.id);
        setStatusText(`${section.title} 已恢复。`);
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : "恢复小节失败");
      } finally {
        setBusyMode("idle");
      }
    },
    [draft, isBusy, replaceDraft]
  );

  const addOutlineSection = useCallback(async () => {
    const title = cleanSectionTitle(newSectionTitle);
    if (!draft || !newSectionTitle.trim() || isBusy) return;
    setBusyMode("revise");
    setErrorText("");
    try {
      const nextDraft = await createDraftSection(draft.id, {
        title,
        level: 2,
        sortOrder: activeSections.length,
        outlineText: `## ${title}`,
        status: "outline_only",
      });
      replaceDraft(nextDraft);
      const added = [...nextDraft.sections]
        .filter((section) => section.status !== "deleted")
        .sort((a, b) => b.sortOrder - a.sortOrder)[0];
      setSelectedSectionId(added?.id ?? null);
      setNewSectionTitle("");
      setStatusText(`已添加章节：${title}`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "添加章节失败");
    } finally {
      setBusyMode("idle");
    }
  }, [activeSections.length, draft, isBusy, newSectionTitle, replaceDraft]);

  const saveSectionTitle = useCallback(async (section: NoteDraftSectionRecord) => {
    const title = cleanSectionTitle(renamingSectionTitle);
    if (!draft || !renamingSectionTitle.trim() || isBusy) return;
    setBusyMode("revise");
    setErrorText("");
    try {
      const nextDraft = await updateDraftSection(draft.id, section.id, {
        title,
        outlineText: [`## ${title}`, ...section.outlineText.split("\n").slice(1)].filter(Boolean).join("\n"),
        source: "rename_section",
      });
      replaceDraft(nextDraft);
      setRenamingSectionId(null);
      setRenamingSectionTitle("");
      setStatusText(`章节已改名为：${title}`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "修改章节名称失败");
    } finally {
      setBusyMode("idle");
    }
  }, [draft, isBusy, renamingSectionTitle, replaceDraft]);

  const moveSection = useCallback(async (sectionId: string, direction: -1 | 1) => {
    if (!draft || isBusy) return;
    const currentIndex = activeSections.findIndex((section) => section.id === sectionId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= activeSections.length) return;
    const reordered = [...activeSections];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    setBusyMode("revise");
    setErrorText("");
    try {
      const nextDraft = await updateNoteDraft(draft.id, {
        sectionOrder: reordered.map((section) => section.id),
      });
      replaceDraft(nextDraft);
      setStatusText(`已调整章节顺序：${moved.title}`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "调整章节顺序失败");
    } finally {
      setBusyMode("idle");
    }
  }, [activeSections, draft, isBusy, replaceDraft]);

  const reviseOutlineWithInstruction = useCallback(async () => {
    const instruction = outlineInstruction.trim();
    if (!draft || !instruction || isBusy) return;
    const hasGeneratedContent = activeSections.some((section) => section.content.trim());
    if (hasGeneratedContent) {
      const approved = await confirm({
        title: "按新要求重做大纲？",
        description: "重做大纲会清空当前已经生成的章节正文，并按新结构重新开始。",
        confirmText: "重做大纲",
        cancelText: "保留正文",
        tone: "danger",
      });
      if (!approved) return;
    }
    autoOutlineStartedRef.current = true;
    await createOutline(instruction, topic);
  }, [activeSections, confirm, createOutline, draft, isBusy, outlineInstruction, topic]);

  const saveBodyInstruction = useCallback(async (regenerateGenerated = false) => {
    if (!draft || isBusy) return;
    const instruction = bodyInstructionDraft.trim();
    const generatedCount = activeSections.filter((section) => section.content.trim()).length;
    if (regenerateGenerated) {
      if (!instruction || generatedCount === 0 || draft.status === "generating") return;
      const approved = await confirm({
        title: `按正文补充要求重写 ${generatedCount} 个章节？`,
        description: "已生成章节会重新进入生成队列，现有正文会保留到新正文生成完成。这个操作会产生新的模型调用。",
        confirmText: "开始重写",
        cancelText: "暂不重写",
        tone: "primary",
      });
      if (!approved) {
        requestAnimationFrame(() => supplementInputRef.current?.focus({ preventScroll: true }));
        return;
      }
    }

    setBusyMode("revise");
    setErrorText("");
    try {
      let nextDraft = await updateNoteDraft(draft.id, {
        bodyInstruction: instruction,
        regenerateGenerated,
      });
      if (regenerateGenerated && generatedCount > 0) {
        nextDraft = await generateAllDraftSections(nextDraft.id, true);
      }
      replaceDraft(nextDraft);
      setBodyInstructionOpen(false);
      setStatusText(
        regenerateGenerated
          ? "已应用正文补充要求，正在逐章重写，完成后替换对应正文。"
          : instruction
            ? "正文补充要求已保存，将与最初要求一起用于后续章节。"
            : "正文补充要求已清空，后续章节仍遵循最初要求。"
      );
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存正文补充要求失败");
    } finally {
      setBusyMode("idle");
    }
  }, [activeSections, bodyInstructionDraft, confirm, draft, isBusy, replaceDraft]);

  const openSaveDialog = useCallback(() => {
    if (!draft || !canSave || isBusy) return;
    setSaveTitle(cleanTitle(topic));
    setSaveDialogOpen(true);
    setMoreMenuOpen(false);
  }, [canSave, draft, isBusy, topic]);

  const saveDraft = useCallback(async () => {
    if (!draft || !canSave || isBusy) return;
    setBusyMode("save");
    setErrorText("");
    try {
      const result = await saveDraftToNotes(draft.id, {
        categoryId,
        title: cleanTitle(saveTitle || topic),
        confirm: true,
      });
      setSaveDialogOpen(false);
      replaceDraft(result.draft);
      reloadWorkspace(result.note.id, `“${result.note.title}”已保存，并已定位到新笔记。`);
      if (pendingCheckpoint?.checkpointType === "draft_workspace") {
        await resolveAgentCheckpoint(pendingCheckpoint.id, "resolved", {
          draftId: draft.id,
          noteId: result.note.id,
        }).catch(() => null);
      }
      closeDraft({ status: "resolved", draftId: draft.id });
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存正式笔记失败");
    } finally {
      setBusyMode("idle");
    }
  }, [canSave, categoryId, closeDraft, draft, isBusy, pendingCheckpoint, reloadWorkspace, replaceDraft, saveTitle, topic]);

  const cancelDraft = useCallback(async () => {
    if (isBusy) {
      // Only streaming work is abortable. Do not unlock an in-flight save,
      // assembly or cancellation while its server request is still running.
      if (activeRequestRef.current) stopActiveRequest();
      return;
    }
    const confirmed =
      !draft ||
      (await confirm({
        title: "退出当前 AI 草稿？",
        description: "未保存为正式笔记的内容不会进入笔记库。你可以稍后重新生成，但当前草稿工作区会关闭。",
        confirmText: "退出",
        cancelText: "留下",
        tone: "danger",
      }));
    if (!confirmed) return;
    setBusyMode("cancel");
    setErrorText("");
    try {
      if (draft && draft.status !== "saved") {
        await cancelNoteDraft(draft.id);
      }
      if (pendingCheckpoint?.checkpointType === "draft_workspace") {
        await resolveAgentCheckpoint(pendingCheckpoint.id, "cancelled", {
          draftId: draft?.id,
        }).catch(() => null);
      }
      closeDraft({ status: "cancelled", draftId: draft?.id });
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "放弃草稿失败，请重试；草稿已保留。");
    } finally {
      setBusyMode("idle");
    }
  }, [closeDraft, confirm, draft, isBusy, pendingCheckpoint, stopActiveRequest]);

  useEffect(() => {
    if (!draftCommand) return;
    if (!["generate_all", "stop", "cancel"].includes(draftCommand.action)) return;
    consumeDraftCommand(draftCommand.id);
    if (draftCommand.action === "generate_all") {
      if (!isBusy) void generateAllSections();
      return;
    }
    if (draftCommand.action === "stop") {
      if (draft?.status === "generating") void stopBackgroundGeneration();
      else if (activeRequestRef.current) stopActiveRequest();
      return;
    }
    void cancelDraft();
  }, [cancelDraft, consumeDraftCommand, draft?.status, draftCommand, generateAllSections, isBusy, stopActiveRequest, stopBackgroundGeneration]);

  if (centerMode !== "draft") return null;

  const completedSections = activeSections.filter((section) =>
    ["generated", "confirmed"].includes(section.status)
  ).length;
  const progress = activeSections.length
    ? Math.round((completedSections / activeSections.length) * 100)
    : 0;
  const generatedSectionCount = activeSections.filter((section) => section.content.trim()).length;
  const bodyInstructionChanged = bodyInstructionDraft.trim() !== (draft?.bodyInstruction ?? "").trim();
  const confirmedBrief = draft?.draftConfig?.generationBrief as DraftBrief | undefined;
  const initialRequirements = confirmedBrief
    ? String(confirmedBrief.requirements || "").trim()
    : String(draft?.draftConfig?.rawRequest || "").trim();
  return (
    <>
      <div className="nf-draft-workspace fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="AI 笔记草稿工作台">
        <button
          type="button"
          className="nf-draft-backdrop absolute inset-0"
          onClick={dismissDraftWorkspace}
          aria-label="关闭草稿工作台"
        />

        <main className="draft-modal-shell nf-draft-shell relative flex h-[min(880px,calc(100vh-32px))] w-[min(1240px,calc(100vw-32px))] min-h-0 flex-col overflow-hidden sm:h-[min(880px,calc(100vh-48px))] sm:w-[min(1240px,calc(100vw-48px))]">
          <header className="nf-draft-header flex min-h-[64px] shrink-0 items-center gap-4 px-5 sm:px-7">
            <div className="nf-draft-heading min-w-0 flex-1">
              <h1 className="nf-draft-title truncate">
                {cleanTitle(topic)}
              </h1>
              <div className="nf-draft-stage">
                <AIWritingStatus compact label={busyMode === "cancel" ? "正在放弃草稿" : writingStatus.label}
                  step={writingStatus.step} />
                {activeSections.length > 0 && <span className="nf-draft-progress" role="progressbar"
                  aria-label="草稿正文生成进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}
                  aria-valuetext={`已生成 ${completedSections} / ${activeSections.length} 章`}>
                  {completedSections} / {activeSections.length} 章
                </span>}
              </div>
            </div>

            <div className="nf-draft-toolbar flex items-center gap-2">
              <div ref={bodyInstructionRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setBodyInstructionDraft(draft?.bodyInstruction ?? "");
                    setBodyInstructionOpen((open) => !open);
                  }}
                  disabled={!draft || isBusy}
                  className="nf-draft-action inline-flex h-9 items-center gap-1.5 px-3 disabled:opacity-45"
                  aria-expanded={bodyInstructionOpen}
                  aria-haspopup="dialog"
                  aria-label="正文补充要求"
                >
                  <FileText size={14} />
                  <span className="hidden sm:inline">正文补充</span>
                  {draft?.bodyInstruction?.trim() && (
                    <span className="h-1.5 w-1.5 rounded-full bg-jelly-blue" aria-label="已设置" />
                  )}
                </button>

                {bodyInstructionOpen && draft && (
                  <div
                    className="nf-draft-panel nf-draft-requirements absolute right-0 top-11 z-40 text-left"
                    role="dialog"
                    aria-label="补充写作要求"
                  >
                    <div className="nf-draft-supplement-header">
                      <h2>补充写作要求</h2>
                      <button type="button" className="nf-draft-close" aria-label="关闭正文补充要求"
                        onClick={() => {setBodyInstructionOpen(false);bodyInstructionRef.current?.querySelector("button")?.focus();}}>
                        <X size={16} />
                      </button>
                    </div>
                    <div className="nf-draft-initial-requirements">
                      <span>创建时的要求</span>
                      <p>{initialRequirements || "未设置"}</p>
                    </div>
                    <label htmlFor="draft-body-supplement" className="sr-only">还希望怎么写</label>
                    <textarea
                      id="draft-body-supplement"
                      ref={supplementInputRef}
                      value={bodyInstructionDraft}
                      onChange={(event) => setBodyInstructionDraft(event.target.value)}
                      placeholder="还希望怎么写？例如：多举例、少用术语"
                      className="nf-draft-field nf-draft-supplement-field"
                      rows={2}
                      maxLength={4000}
                      aria-label="还希望怎么写"
                      aria-description="选填。在创建时要求的基础上补充正文写法；同一条件以本次补充为准，单章要求优先。仅用于后续生成不改大纲与已有正文；重写已有正文需再次确认。"
                    />
                    <p className="nf-draft-supplement-hint">
                      {draft.status === "generating" ? "原要求继续保留，补充从下一章起生效。" : "原要求继续保留，已有正文不会自动改写。"}
                    </p>
                    <div className="nf-draft-supplement-actions">
                      {generatedSectionCount > 0 && (
                        <button
                          type="button"
                          onClick={() => void saveBodyInstruction(true)}
                          disabled={!bodyInstructionDraft.trim() || isBusy || draft.status === "generating"}
                          className="nf-draft-action inline-flex items-center px-2.5 disabled:opacity-40"
                        >
                          重写已有正文
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void saveBodyInstruction(false)}
                        disabled={!bodyInstructionChanged || isBusy}
                        className="nf-draft-action nf-draft-primary inline-flex items-center px-3 disabled:opacity-40"
                      >
                        仅用于后续生成
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {draft?.status === "generating" ? (
                <button
                  type="button"
                  onClick={() => void stopBackgroundGeneration()}
                  disabled={isBusy}
                  className="nf-draft-action nf-draft-desktop-action nf-draft-danger inline-flex h-9 items-center gap-1.5 px-3 disabled:opacity-50"
                >
                  <Square size={12} fill="currentColor" />
                  停止生成
                </button>
              ) : draft && draft.status !== "assembled" ? (
                <button
                  type="button"
                  onClick={() => void generateAllSections()}
                  disabled={!canGenerateSections || isBusy}
                  className="nf-draft-action nf-draft-desktop-action inline-flex h-9 items-center gap-1.5 px-3 disabled:opacity-50"
                >
                  <Wand2 size={14} />
                  全部生成
                </button>
              ) : null}
              <button
                type="button"
                onClick={openSaveDialog}
                disabled={!canSave || isBusy}
                className="nf-draft-action nf-draft-desktop-action nf-draft-primary inline-flex h-9 items-center gap-1.5 px-3.5 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Save size={14} />
                保存为笔记
              </button>
              <div ref={moreMenuRef} className="nf-draft-desktop-action relative">
                <button
                  type="button"
                  onClick={() => setMoreMenuOpen((open) => !open)}
                  className="nf-draft-action nf-draft-icon grid h-9 w-9 place-items-center"
                  aria-label="更多草稿操作"
                  aria-expanded={moreMenuOpen}
                >
                  <MoreHorizontal size={17} />
                </button>
                {moreMenuOpen && (
                  <div className="nf-draft-panel absolute right-0 top-11 z-40 w-[156px] p-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        void cancelDraft();
                      }}
                      disabled={isBusy}
                      className="nf-draft-action nf-draft-danger flex h-9 w-full items-center gap-2 px-2.5 disabled:opacity-40"
                    >
                      <Trash2 size={14} />
                      放弃草稿
                    </button>
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={dismissDraftWorkspace}
              className="nf-draft-close"
              aria-label="关闭草稿工作台"
            >
              <X size={18} strokeWidth={1.8} />
            </button>
          </header>

          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <aside className="nf-draft-outline flex h-[168px] shrink-0 flex-col md:h-auto md:w-[282px]">
              <div className="flex shrink-0 items-center justify-between px-5 pb-3 pt-5">
                <p className="nf-draft-section-title">大纲目录</p>
                <button type="button" className="nf-draft-action nf-draft-icon grid place-items-center"
                  aria-label="目录管理" title="目录管理" disabled={!draft || isBusy || draft.status === "generating"}
                  onClick={() => { setDirectoryManagerOpen(true); setMoreMenuOpen(false); }}>
                  <ListTree size={16} />
                </button>
              </div>

              <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4" aria-label="草稿章节目录">
                {activeSections.length ? (
                  <div className="space-y-1">
                    {activeSections.map((section, index) => {
                      const selected = section.id === selectedSection?.id;
                      const completed = ["generated", "confirmed"].includes(section.status);
                      return (
                        <button
                          type="button"
                          key={section.id}
                          onClick={() => setSelectedSectionId(section.id)}
                          className="nf-draft-chapter flex h-11 w-full items-center gap-2.5 px-3 text-left"
                          aria-current={selected ? "page" : undefined}
                          aria-label={`${index + 1}. ${section.title}，${statusLabel(section.status)}`}
                          title={`${section.title} · ${statusLabel(section.status)}`}
                        >
                          <span className="nf-draft-marker" data-state={section.status}>
                            {completed ? "✓" : section.status === "generating" ? <Loader2 size={10} className="animate-spin" /> : index + 1}
                          </span>
                          <span className="nf-draft-chapter-title min-w-0 flex-1 truncate">
                            {section.title}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex h-full min-h-[90px] items-center justify-center px-4 text-center text-[12px] leading-relaxed text-jelly-text-muted">
                    {busyMode === "outline" ? "AI 正在组织章节结构…" : "大纲准备后会显示在这里"}
                  </div>
                )}
              </nav>
            </aside>

            <section className="nf-draft-main flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="nf-draft-section-bar shrink-0">
                <div className="nf-draft-reading flex min-h-[58px] items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="nf-draft-section-title truncate">
                      {selectedSection?.title || (busyMode === "outline" ? "正在准备章节" : "选择一个章节")}
                    </h2>
                  </div>
                  {selectedSection?.status === "generating" && (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-jelly-blue-pale px-2.5 py-1 text-[11px] text-jelly-blue-deep">
                        <Loader2 size={12} className="animate-spin" />
                        生成中
                      </span>
                      {busyMode === "section" && (
                        <button
                          type="button"
                          onClick={stopActiveRequest}
                          className="nf-draft-action nf-draft-danger inline-flex h-8 items-center gap-1.5 px-2.5"
                          aria-label={`停止生成 ${selectedSection.title}`}
                        >
                          <Square size={11} fill="currentColor" />
                          停止生成
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="nf-draft-reading py-7 sm:py-10">
                  {errorText && (
                    <div role="alert" className="mb-5 rounded-lg border border-jelly-red/25 bg-jelly-red-bg px-3 py-2 text-[12px] leading-relaxed text-jelly-red">
                      {errorText}
                    </div>
                  )}

                  {!draft ? (
                    <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
                      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-jelly-blue-pale text-jelly-blue-deep">
                        <Sparkles size={22} />
                      </span>
                      <h3 className="mt-4 text-[16px] font-semibold text-jelly-text">正在生成大纲</h3>
                      <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-jelly-text-muted">
                        AI 正在规划一级章节。准备完成后，点击左侧章节即可生成和查看正文。
                      </p>
                    </div>
                  ) : selectedSection?.content ? (
                    <div
                      className="note-content nf-reading-prose draft-note-content"
                      onClick={(event) => void handleRenderedCodeBlockAction(event.target, event.currentTarget)}
                      dangerouslySetInnerHTML={{ __html: renderedSection }}
                    />
                  ) : selectedSection ? (
                    <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
                      <BookOpenCheck size={30} className="text-jelly-blue" strokeWidth={1.5} />
                      <h3 className="mt-4 text-[16px] font-semibold text-jelly-text">正文尚未生成</h3>
                      <p className="mt-2 max-w-md text-[13px] leading-relaxed text-jelly-text-muted">
                        {selectedSection.outlineText.replace(/^#{1,4}\s*/u, "") || "点击下方按钮，让 AI 生成正文。"}
                      </p>
                      <button
                        type="button"
                        onClick={() => void generateOneSection(selectedSection)}
                        disabled={isBusy || draft.status === "generating"}
                        className="nf-draft-action nf-draft-primary mt-5 inline-flex h-10 items-center gap-2 px-5 disabled:opacity-45"
                      >
                        <Wand2 size={15} />
                        生成正文
                      </button>
                    </div>
                  ) : (
                    <div className="flex min-h-[360px] items-center justify-center text-[13px] text-jelly-text-muted">
                      请从左侧选择一个章节
                    </div>
                  )}
                </div>
              </div>

              <footer className="nf-draft-footer shrink-0">
                <div className="nf-draft-reading nf-draft-footer-inner">
                  {selectedSection?.content.trim() && (
                    <div className="nf-draft-revision">
                      <textarea
                        id="draft-section-instruction"
                        ref={sectionInstructionRef}
                        value={sectionInstruction}
                        onChange={(event) => setSectionInstruction(event.target.value)}
                        placeholder="告诉 AI 如何修改…"
                        aria-label="告诉 AI 如何修改"
                        rows={1}
                        className="nf-draft-field"
                      />
                      <button
                        type="button"
                        onClick={() => void generateOneSection(selectedSection, sectionInstruction)}
                        disabled={!sectionInstruction.trim() || isBusy || draft?.status === "generating"}
                        aria-label="按要求修改"
                        className="nf-draft-action nf-draft-revision-submit disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        修改
                      </button>
                    </div>
                  )}
                  <div className="nf-draft-footer-actions">
                    {selectedSection?.content.trim() ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void generateOneSection(selectedSection)}
                          disabled={isBusy || draft?.status === "generating"}
                          className="nf-draft-action inline-flex h-9 items-center gap-1.5 px-3 disabled:opacity-45"
                        >
                          <RefreshCcw size={13} />
                          重新生成
                        </button>
                        {selectedSection.status !== "confirmed" && selectedSection.content.trim() && (
                          <button
                            type="button"
                            onClick={() => void confirmSection()}
                            disabled={isBusy}
                            className="nf-draft-action nf-draft-confirm inline-flex h-9 items-center gap-1.5 px-3 disabled:opacity-45"
                          >
                            <CheckCircle2 size={13} />
                            确认
                          </button>
                        )}
                      </>
                    ) : null}
                    {draft?.status === "generating" ? (
                      <button
                        type="button"
                        onClick={() => void stopBackgroundGeneration()}
                        disabled={isBusy}
                        className="nf-draft-action nf-draft-danger inline-flex h-9 items-center gap-1.5 px-3 disabled:opacity-45"
                      >
                        <Square size={12} fill="currentColor" />
                        停止
                      </button>
                    ) : draft?.status === "assembled" ? (
                      <button
                        type="button"
                        onClick={openSaveDialog}
                        disabled={!canSave || isBusy}
                        className="nf-draft-action nf-draft-primary inline-flex h-9 items-center gap-1.5 px-4 disabled:opacity-45"
                      >
                        <Save size={14} />
                        保存为笔记
                      </button>
                    ) : completedSections === activeSections.length && activeSections.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => void assembleCurrentDraft()}
                        disabled={isBusy}
                        className="nf-draft-action nf-draft-primary inline-flex h-9 items-center gap-1.5 px-4 disabled:opacity-45"
                      >
                        <FileText size={14} />
                        完成草稿
                      </button>
                    ) : null}
                  </div>
                </div>
              </footer>
            </section>
          </div>
        </main>

        {directoryManagerOpen && draft && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="目录管理">
            <button
              type="button"
              className="nf-draft-backdrop absolute inset-0"
              onClick={() => setDirectoryManagerOpen(false)}
              aria-label="关闭目录管理"
            />
            <section className="nf-draft-panel relative flex max-h-[min(720px,calc(100vh-40px))] w-[min(680px,calc(100vw-32px))] flex-col overflow-hidden">
              <header className="nf-draft-header flex h-[66px] shrink-0 items-center justify-between px-5">
                <div>
                  <h2 className="text-[16px] font-semibold text-jelly-text">目录管理</h2>
                  <p className="mt-0.5 text-[11px] text-jelly-text-muted">添加、改名、排序或重新规划一级章节</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDirectoryManagerOpen(false)}
                  className="nf-draft-close"
                  aria-label="关闭目录管理"
                >
                  <X size={18} strokeWidth={1.8} />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <div className="space-y-2">
                  {activeSections.map((section, index) => (
                    <div key={section.id} className="nf-draft-directory-row flex min-h-[48px] items-center gap-2 px-3 py-2">
                      <span className="nf-draft-directory-index">
                        {index + 1}
                      </span>
                      {renamingSectionId === section.id ? (
                        <input
                          value={renamingSectionTitle}
                          onChange={(event) => setRenamingSectionTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void saveSectionTitle(section);
                            if (event.key === "Escape") setRenamingSectionId(null);
                          }}
                          className="nf-draft-field h-8 min-w-0 flex-1 px-2.5"
                          aria-label="修改章节名称"
                          autoFocus
                        />
                      ) : (
                        <span className="nf-draft-directory-name min-w-0 flex-1 truncate text-[13px] font-medium text-jelly-text" title={section.title}>{section.title}</span>
                      )}
                      <div className="nf-draft-directory-actions flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => void moveSection(section.id, -1)}
                          disabled={index === 0 || isBusy}
                          className="nf-draft-action nf-draft-icon grid h-8 w-8 place-items-center disabled:opacity-25"
                          aria-label={`上移章节 ${section.title}`}
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void moveSection(section.id, 1)}
                          disabled={index === activeSections.length - 1 || isBusy}
                          className="nf-draft-action nf-draft-icon grid h-8 w-8 place-items-center disabled:opacity-25"
                          aria-label={`下移章节 ${section.title}`}
                        >
                          <ChevronDown size={14} />
                        </button>
                        {renamingSectionId === section.id ? (
                          <button
                            type="button"
                            onClick={() => void saveSectionTitle(section)}
                            className="nf-draft-action nf-draft-icon grid h-8 w-8 place-items-center"
                            aria-label="保存章节名称"
                          >
                            <Check size={14} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingSectionId(section.id);
                              setRenamingSectionTitle(section.title);
                            }}
                            className="nf-draft-action nf-draft-icon grid h-8 w-8 place-items-center"
                            aria-label={`修改章节 ${section.title}`}
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void deleteSection(section)}
                          disabled={activeSections.length <= 1 || isBusy}
                          className="nf-draft-action nf-draft-icon grid h-8 w-8 place-items-center disabled:opacity-25"
                          aria-label={`删除章节 ${section.title}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="nf-draft-inline-entry nf-draft-add-entry">
                  <input
                    value={newSectionTitle}
                    onChange={(event) => setNewSectionTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) void addOutlineSection();
                    }}
                    placeholder="添加一级章节"
                    aria-label="添加一级章节"
                    className="nf-draft-field nf-draft-inline-field"
                  />
                  <button
                    type="button"
                    onClick={() => void addOutlineSection()}
                    disabled={!newSectionTitle.trim() || isBusy}
                    className="nf-draft-action nf-draft-revision-submit inline-flex gap-1 disabled:opacity-40"
                  >
                    <Plus size={14} />
                    添加
                  </button>
                </div>

                {deletedSections.length > 0 && (
                  <div className="mt-5 border-t border-[#e7ebef] pt-4">
                    <p className="text-[11px] font-semibold text-jelly-text-muted">已删除章节</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {deletedSections.map((section) => (
                        <button
                          type="button"
                          key={section.id}
                          onClick={() => void restoreSection(section)}
                          className="nf-draft-action inline-flex h-8 items-center gap-1.5 px-2.5"
                        >
                          {section.title}
                          <span className="text-jelly-blue-deep">恢复</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <section className="nf-draft-outline-adjust" aria-label="按新要求调整大纲">
                  <label htmlFor="draft-outline-instruction">AI 调整大纲</label>
                  <div className="nf-draft-inline-entry">
                    <textarea
                      id="draft-outline-instruction"
                      ref={outlineInstructionRef}
                      value={outlineInstruction}
                      onChange={(event) => setOutlineInstruction(event.target.value)}
                      placeholder="如何调整大纲…"
                      aria-label="大纲调整要求"
                      aria-description="将重新规划全部章节；已有正文需要确认后才会替换。"
                      rows={1}
                      className="nf-draft-field nf-draft-inline-field"
                    />
                    <button
                      type="button"
                      onClick={() => void reviseOutlineWithInstruction()}
                      disabled={!outlineInstruction.trim() || isBusy}
                      aria-label="按要求重新规划"
                      className="nf-draft-action nf-draft-primary nf-draft-revision-submit disabled:opacity-40"
                    >
                      重新规划
                    </button>
                  </div>
                </section>
              </div>
            </section>
          </div>
        )}

        {saveDialogOpen && draft && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="保存为笔记">
            <button
              type="button"
              className="nf-draft-backdrop absolute inset-0"
              onClick={() => setSaveDialogOpen(false)}
              aria-label="关闭保存弹窗"
            />
            <section className="nf-draft-panel relative w-[min(460px,calc(100vw-32px))] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-[16px] font-semibold text-jelly-text">保存为笔记</h2>
                  <p className="mt-1 text-[11px] text-jelly-text-muted">确认标题和保存位置后，草稿会进入正式笔记库。</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSaveDialogOpen(false)}
                  className="nf-draft-close"
                  aria-label="关闭保存弹窗"
                >
                  <X size={18} strokeWidth={1.8} />
                </button>
              </div>
              {errorText && <p role="alert" className="mt-3 text-[12px] text-jelly-red">{errorText}</p>}
              <div className="mt-5 space-y-4">
                <label className="block">
                  <FieldLabel>笔记标题</FieldLabel>
                  <input
                    value={saveTitle}
                    onChange={(event) => setSaveTitle(event.target.value)}
                    className="nf-draft-field h-10 w-full px-3"
                    maxLength={120}
                  />
                </label>
                <label className="block">
                  <FieldLabel>保存位置</FieldLabel>
                  <SelectField
                    value={categoryId ?? ""}
                    options={folderOptions}
                    onChange={(value) => setCategoryId(value || null)}
                  />
                </label>
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSaveDialogOpen(false)}
                  className="nf-draft-action inline-flex h-9 items-center px-3.5"
                >
                  继续编辑
                </button>
                <button
                  type="button"
                  onClick={() => void saveDraft()}
                  disabled={!saveTitle.trim() || isBusy}
                  className="nf-draft-action nf-draft-primary inline-flex h-9 items-center gap-1.5 px-4 disabled:opacity-40"
                >
                  <Save size={14} />
                  {busyMode === "save" ? "正在保存…" : "确认保存"}
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
      <div className="nf-draft-workspace nf-draft-confirmation">{confirmDialog}</div>
    </>
  );
}
