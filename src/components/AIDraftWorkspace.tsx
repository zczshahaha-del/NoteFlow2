import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useDraftSlice, useWorkspaceSlice } from "../storeSlices";
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

const AUTO_NOTE_TYPE = "智能笔记";
const AUTO_WRITING_TONE = "根据用户需求自动匹配";
const AUTO_NOTE_FORMAT = "AI 自动组织结构";
const AUTO_HEADING_LEVEL = "AI 自动层级";

type BusyMode = "idle" | "outline" | "section" | "assemble" | "save" | "revise";
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
  const source = seed.trim();
  const quotedTitle = source.match(/《\s*([^》]{2,80})\s*》/u)?.[1]?.trim();
  if (quotedTitle) return quotedTitle;

  const requestTitle = source.match(
    /(?:生成|创建|新建|写|整理)(?:一篇|一个|一份|份)?(?:关于)?\s*([^，。！？,.!?]{2,80}?(?:学习笔记|面试笔记|复习笔记|项目笔记|笔记|教程))/u
  )?.[1]?.trim();
  if (requestTitle) return requestTitle;

  const firstClause = source
    .replace(/^(?:帮我|请|麻烦|给我|我想要|我想|我要|需要你)?\s*/u, "")
    .replace(/^(?:生成|创建|新建|写一篇|写一个|写一份|写份|整理一篇|整理一个)\s*/u, "")
    .split(/[，。！？,.!?]/u)[0]
    .replace(/^关于\s*/u, "")
    .trim();
  return firstClause || source || "未命名学习笔记";
}

function cleanTitle(value: string): string {
  return value.trim().replace(/\.md$/i, "").trim() || "未命名笔记";
}

function cleanSectionTitle(value: string): string {
  return (
    value
      .replace(/^[#\s*\-+0-9.、)）]+/g, "")
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
      className="draft-control-no-focus-ring h-8 w-full rounded-md border border-jelly-border bg-white px-2.5 text-[12px] text-jelly-text outline-none"
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
  const [sectionEditContent, setSectionEditContent] = useState("");
  const [busyMode, setBusyMode] = useState<BusyMode>("idle");
  const [statusText, setStatusText] = useState("");
  const [errorText, setErrorText] = useState("");
  const [sectionEditing, setSectionEditing] = useState(false);
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
    setSectionEditContent("");
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
    setSectionEditContent(selectedSection?.content ?? "");
    setSectionEditing(false);
    setSectionInstruction("");
  }, [selectedSection?.id]);

  useEffect(() => {
    if (!bodyInstructionOpen) {
      setBodyInstructionDraft(draft?.bodyInstruction ?? "");
      return;
    }
    const closeOnOutsideClick = (event: MouseEvent) => {
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
      if (event.key !== "Escape") return;
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
    const stage = errorText || draft?.status === "failed"
      ? "failed"
      : draft?.status === "generating" || busyMode === "section" || busyMode === "assemble" || busyMode === "save"
        ? "generating"
        : draft?.status === "assembled"
          ? "assembled"
          : draft
            ? "outline_ready"
            : "configuring";
    setActiveDraftContext(
      {
        id: draft?.id ?? "",
        title: draft?.title || cleanTitle(topic),
        topic: draft?.topic || topic,
        stage,
        busy: isBusy,
        statusText:
          draft?.status === "generating" && typeof generationJob.currentSectionTitle === "string"
            ? `正在后台生成：${generationJob.currentSectionTitle}`
            : statusText,
        errorText: errorText || (draft?.status === "failed" ? jobError : ""),
        completedSections,
        totalSections: sections.length,
      }
    );
  }, [busyMode, draft, errorText, isBusy, setActiveDraftContext, statusText, topic]);

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
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    setBusyMode("idle");
  }, []);

  const createOutline = useCallback(async (feedbackText = "", topicOverride = "") => {
    const isFeedback = Boolean(feedbackText.trim());
    const currentDraftTopic = draft ? (draft.topic || draft.title || topic) : "";
    const cleanTopicValue = cleanTitle(
      isFeedback && currentDraftTopic ? currentDraftTopic : topicOverride || topic
    );
    if (!cleanTopicValue || isBusy) return;

    activeRequestRef.current?.abort();
    const currentOutline = draft?.outline || streamingOutline;
    const controller = new AbortController();
    activeRequestRef.current = controller;
    setTopic(cleanTopicValue);
    setBusyMode("outline");
    setErrorText("");
    setStatusText(feedbackText.trim() ? "正在根据你的反馈重写学习笔记大纲。" : "正在生成学习笔记大纲。");
    setStreamingOutline("");

    try {
      let outline = "";
      const currentInputRequest = topic.trim();
      const persistedRawRequest = rawRequestFromDraft(
        draft,
        checkpointRawRequest || draftSeed || topicOverride || cleanTopicValue
      );
      const rawRequest = isFeedback
        ? persistedRawRequest || currentInputRequest || cleanTopicValue
        : currentInputRequest || persistedRawRequest || cleanTopicValue;
      const smartRequirement = buildSmartRequirement(cleanTopicValue, feedbackText, currentOutline, rawRequest);
      const includeCode = requestWantsCode(rawRequest);
      const includeExercises = requestWantsExercises(rawRequest);
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
        maxTokens: getMaxTokens(rawRequest),
        temperature: 0.35,
        signal: controller.signal,
        onDelta: (delta) => {
          outline += delta;
          setStreamingOutline(outline);
        },
      });

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
              includeCode,
              includeExercises,
            },
            outline,
            sections: makeSectionPayloads(outline),
          });

      replaceDraft(created);
      if (!draft && pendingCheckpoint?.checkpointType === "draft_workspace") {
        await bindAgentCheckpoint(pendingCheckpoint.id, { draftId: created.id }).catch(() => null);
      }
      setStreamingOutline("");
      setOutlineInstruction("");
      setStatusText(feedbackText.trim() ? "已根据你的反馈重新生成大纲。确认后可以逐节生成正文。" : "大纲已生成。确认后可以逐节生成正文。");
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        setErrorText(outlineGenerationError(error));
        setStatusText("");
      }
    } finally {
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
      }
      setBusyMode("idle");
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
  ]);

  useEffect(() => {
    const restoredDraftId = checkpointMatchesCurrentSeed && pendingCheckpoint?.checkpointType === "draft_workspace"
      ? pendingCheckpoint.payload?.draftId
      : null;
    if (
      draft ||
      isBusy ||
      autoOutlineStartedRef.current ||
      (typeof restoredDraftId === "string" && restoredDraftId) ||
      !draftSeed.trim()
    ) return;
    autoOutlineStartedRef.current = true;
    void createOutline("", initialTopic);
  }, [checkpointMatchesCurrentSeed, createOutline, draft, draftSeed, initialTopic, isBusy, pendingCheckpoint]);

  useEffect(() => {
    if (
      !draftCommand ||
      !["generate_outline", "regenerate_outline"].includes(draftCommand.action) ||
      isBusy
    ) return;
    consumeDraftCommand(draftCommand.id);
    const currentDraftTopic = draft ? draft.topic || draft.title || topic : "";
    void createOutline(
      draftCommand.action === "regenerate_outline" ? draftCommand.feedback : "",
      currentDraftTopic || draftCommand.seed
    );
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
        const bodyInstructionContext = bodyInstruction
          ? `\n\n全文写作要求（适用于每一个章节）：\n${bodyInstruction}\n如果与本章单独要求冲突，以本章要求为准。`
          : "";

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
          extraRequest: `${buildSmartRequirement(baseDraft.topic || topic, "", "", rawRequest)}${bodyInstructionContext}${revisionContext}`,
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
        if (!(error instanceof Error && error.name === "AbortError")) {
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
          closeDraft();
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

  const saveSectionEdit = useCallback(async () => {
    if (!draft || !selectedSection || isBusy) return;
    setBusyMode("revise");
    setErrorText("");
    try {
      const nextDraft = await updateDraftSection(draft.id, selectedSection.id, {
        content: sectionEditContent,
        status: "needs_revision",
        source: "revise_section",
      });
      replaceDraft(nextDraft);
      setStatusText(`${selectedSection.title} 已保存为待确认修改。`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存小节修改失败");
    } finally {
      setBusyMode("idle");
    }
  }, [draft, isBusy, replaceDraft, sectionEditContent, selectedSection]);

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
        title: `按全文要求重写 ${generatedCount} 个已生成章节？`,
        description: "已生成章节会重新进入生成队列，现有正文会保留到新正文生成完成。这个操作会产生新的模型调用。",
        confirmText: "开始重写",
        cancelText: "暂不重写",
        tone: "primary",
      });
      if (!approved) return;
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
          ? "已应用新的全文要求，正在后台逐章重写。旧正文会在对应章节生成完成后替换。"
          : instruction
            ? "全文要求已保存，将应用于后续章节。"
            : "全文要求已清空。"
      );
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存全文要求失败");
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
      closeDraft();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存正式笔记失败");
    } finally {
      setBusyMode("idle");
    }
  }, [canSave, categoryId, closeDraft, draft, isBusy, pendingCheckpoint, reloadWorkspace, replaceDraft, saveTitle, topic]);

  const cancelDraft = useCallback(async () => {
    if (isBusy) {
      stopActiveRequest();
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
    try {
      if (draft && draft.status !== "saved") {
        await cancelNoteDraft(draft.id).catch(() => {});
      }
      if (pendingCheckpoint?.checkpointType === "draft_workspace") {
        await resolveAgentCheckpoint(pendingCheckpoint.id, "cancelled", {
          draftId: draft?.id,
        }).catch(() => null);
      }
    } finally {
      closeDraft();
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
      else stopActiveRequest();
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
  return (
    <>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="AI 笔记草稿工作台">
        <button
          type="button"
          className="absolute inset-0 bg-[#17202a]/30 backdrop-blur-[2px]"
          onClick={dismissDraftWorkspace}
          aria-label="关闭草稿工作台"
        />

        <main className="draft-modal-shell relative flex h-[min(880px,calc(100vh-32px))] w-[min(1240px,calc(100vw-32px))] min-h-0 flex-col overflow-hidden rounded-[22px] border border-white/80 bg-[#fbfcfd] shadow-[0_30px_90px_rgba(28,43,56,0.24)] sm:h-[min(880px,calc(100vh-48px))] sm:w-[min(1240px,calc(100vw-48px))]">
          <header className="flex min-h-[64px] shrink-0 items-center gap-4 border-b border-[#e7ebef] bg-white/95 px-5 sm:px-7">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[18px] font-semibold text-jelly-text sm:text-[20px]">
                {cleanTitle(topic)}
              </h1>
            </div>

            <div className="hidden items-center gap-2 md:flex">
              <button
                type="button"
                onClick={() => {
                  setDirectoryManagerOpen(true);
                  setMoreMenuOpen(false);
                }}
                disabled={!draft || isBusy || draft.status === "generating"}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#d9e5ec] bg-white px-3 text-[12px] font-semibold text-jelly-text-soft hover:border-jelly-blue/30 hover:bg-jelly-blue-pale disabled:opacity-45"
              >
                <ListTree size={14} />
                目录管理
              </button>
              <div ref={bodyInstructionRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setBodyInstructionDraft(draft?.bodyInstruction ?? "");
                    setBodyInstructionOpen((open) => !open);
                  }}
                  disabled={!draft || isBusy}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#d9e5ec] bg-white px-3 text-[12px] font-semibold text-jelly-text-soft hover:border-jelly-blue/30 hover:bg-jelly-blue-pale disabled:opacity-45"
                  aria-expanded={bodyInstructionOpen}
                  aria-haspopup="dialog"
                >
                  <FileText size={14} />
                  全文要求
                  {draft?.bodyInstruction?.trim() && (
                    <span className="h-1.5 w-1.5 rounded-full bg-jelly-blue" aria-label="已设置" />
                  )}
                </button>

                {bodyInstructionOpen && draft && (
                  <div
                    className="absolute right-0 top-11 z-40 w-[360px] rounded-2xl border border-[#dfe5e9] bg-white p-4 text-left shadow-[0_18px_50px_rgba(31,48,61,0.18)]"
                    role="dialog"
                    aria-label="全文写作要求"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[13px] font-semibold text-jelly-text">全文写作要求</p>
                        <p className="mt-1 text-[11px] leading-relaxed text-jelly-text-muted">
                          统一控制所有章节的语气、深度、篇幅和示例风格。
                        </p>
                      </div>
                      {(draft.bodyInstruction || "").trim() && (
                        <span className="shrink-0 rounded-full bg-jelly-blue-pale px-2 py-1 text-[10px] text-jelly-blue-deep">
                          已设置
                        </span>
                      )}
                    </div>
                    <textarea
                      value={bodyInstructionDraft}
                      onChange={(event) => setBodyInstructionDraft(event.target.value)}
                      placeholder="例如：偏实战、少讲空泛概念，每章提供一个完整示例，面向初学者…"
                      className="draft-control-no-focus-ring mt-3 min-h-[112px] w-full resize-none rounded-xl border border-[#e1e6ea] bg-[#fafbfc] px-3 py-2.5 text-[12px] leading-relaxed text-jelly-text outline-none"
                      maxLength={4000}
                    />
                    <p className="mt-1.5 text-[10px] text-jelly-text-muted">
                      {draft.status === "generating" ? "保存后从下一章开始生效。" : "本章单独要求与全文要求冲突时，以本章要求为准。"}
                    </p>
                    <div className="mt-3 flex items-center justify-end gap-2">
                      {generatedSectionCount > 0 && (
                        <button
                          type="button"
                          onClick={() => void saveBodyInstruction(true)}
                          disabled={!bodyInstructionDraft.trim() || isBusy || draft.status === "generating"}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#dfe5e9] bg-white px-3 text-[11px] font-medium text-jelly-text-soft hover:bg-[#f5f7f8] disabled:opacity-40"
                        >
                          <RefreshCcw size={12} />
                          重写已生成章节
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void saveBodyInstruction(false)}
                        disabled={!bodyInstructionChanged || isBusy}
                        className="inline-flex h-8 items-center rounded-lg bg-jelly-blue px-3 text-[11px] font-semibold text-white hover:brightness-95 disabled:opacity-40"
                      >
                        应用到后续章节
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
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-jelly-red/25 bg-white px-3 text-[12px] font-medium text-jelly-red hover:bg-jelly-red-bg disabled:opacity-50"
                >
                  <Square size={12} fill="currentColor" />
                  停止生成
                </button>
              ) : draft && draft.status !== "assembled" ? (
                <button
                  type="button"
                  onClick={() => void generateAllSections()}
                  disabled={!canGenerateSections || isBusy}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#d9e5ec] bg-white px-3 text-[12px] font-semibold text-jelly-text-soft hover:border-jelly-blue/30 hover:bg-jelly-blue-pale disabled:opacity-50"
                >
                  <Wand2 size={14} />
                  全部生成
                </button>
              ) : null}
              <button
                type="button"
                onClick={openSaveDialog}
                disabled={!canSave || isBusy}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-jelly-blue px-3.5 text-[12px] font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Save size={14} />
                保存为笔记
              </button>
              <div ref={moreMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setMoreMenuOpen((open) => !open)}
                  className="grid h-9 w-9 place-items-center rounded-lg border border-[#d9e5ec] bg-white text-jelly-text-muted hover:bg-[#f4f6f7] hover:text-jelly-text"
                  aria-label="更多草稿操作"
                  aria-expanded={moreMenuOpen}
                >
                  <MoreHorizontal size={17} />
                </button>
                {moreMenuOpen && (
                  <div className="absolute right-0 top-11 z-40 w-[156px] rounded-xl border border-[#dfe5e9] bg-white p-1.5 shadow-[0_14px_40px_rgba(31,48,61,0.16)]">
                    <button
                      type="button"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        void cancelDraft();
                      }}
                      disabled={isBusy}
                      className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[12px] text-jelly-red hover:bg-jelly-red-bg disabled:opacity-40"
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
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-jelly-text-muted transition-colors hover:bg-[#f1f4f6] hover:text-jelly-text"
              aria-label="关闭草稿工作台"
              title="关闭后可从对话中继续打开"
            >
              <X size={19} />
            </button>
          </header>

          {activeSections.length > 0 && (
            <div className="h-1 shrink-0 bg-[#edf1f4]">
              <div className="h-full bg-jelly-blue transition-[width] duration-500" style={{ width: `${progress}%` }} />
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <aside className="flex h-[168px] shrink-0 flex-col border-b border-[#e7ebef] bg-white md:h-auto md:w-[282px] md:border-b-0 md:border-r">
              <div className="flex shrink-0 items-center justify-between px-5 pb-3 pt-5">
                <p className="text-[15px] font-semibold text-jelly-text">大纲目录</p>
                <span className="rounded-full bg-[#f2f5f7] px-2 py-1 text-[11px] text-jelly-text-muted">
                  {activeSections.length} 章
                </span>
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
                          className={`flex h-11 w-full items-center gap-2.5 rounded-xl px-3 text-left transition-colors ${selected ? "bg-[#eef7fb]" : "hover:bg-[#f5f7f8]"}`}
                          aria-current={selected ? "page" : undefined}
                          aria-label={`${index + 1}. ${section.title}，${statusLabel(section.status)}`}
                          title={`${section.title} · ${statusLabel(section.status)}`}
                        >
                          <span className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border text-[9px] ${
                            completed
                              ? "border-jelly-green bg-jelly-green text-white"
                              : section.status === "generating"
                                ? "border-jelly-blue bg-jelly-blue-pale text-jelly-blue-deep"
                                : selected
                                  ? "border-jelly-blue bg-jelly-blue text-white"
                                  : "border-[#cbd5dc] bg-white text-jelly-text-muted"
                          }`}>
                            {completed ? "✓" : section.status === "generating" ? <Loader2 size={10} className="animate-spin" /> : index + 1}
                          </span>
                          <span className={`min-w-0 flex-1 truncate text-[13px] font-medium ${selected ? "text-jelly-blue-deep" : "text-jelly-text"}`}>
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

            <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#fdfdfc]">
              <div className="flex min-h-[58px] shrink-0 items-center justify-between gap-3 border-b border-[#edf0f2] bg-white/75 px-5 sm:px-7">
                <div className="min-w-0">
                  <h2 className="truncate text-[15px] font-semibold text-jelly-text">
                    {selectedSection?.title || (busyMode === "outline" ? "正在准备章节" : "选择一个章节")}
                  </h2>
                </div>
                {selectedSection?.status === "generating" && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-jelly-blue-pale px-2.5 py-1 text-[11px] text-jelly-blue-deep">
                    <Loader2 size={12} className="animate-spin" />
                    生成中
                  </span>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-[820px] px-6 py-7 sm:px-10 sm:py-10">
                  {errorText && (
                    <div className="mb-5 rounded-lg border border-jelly-red/25 bg-jelly-red-bg px-3 py-2 text-[12px] leading-relaxed text-jelly-red">
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
                  ) : sectionEditing && selectedSection ? (
                    <textarea
                      value={sectionEditContent}
                      onChange={(event) => setSectionEditContent(event.target.value)}
                      className="min-h-[520px] w-full resize-y rounded-xl border border-[#dfe5e9] bg-white p-5 font-mono text-[13px] leading-7 text-jelly-text outline-none"
                      aria-label={`编辑 ${selectedSection.title}`}
                    />
                  ) : selectedSection?.content ? (
                    <div
                      className="note-content draft-note-content"
                      onClick={(event) => void handleRenderedCodeBlockAction(event.target, event.currentTarget)}
                      dangerouslySetInnerHTML={{ __html: renderedSection }}
                    />
                  ) : selectedSection ? (
                    <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
                      <BookOpenCheck size={30} className="text-jelly-blue" strokeWidth={1.5} />
                      <h3 className="mt-4 text-[16px] font-semibold text-jelly-text">本章正文尚未生成</h3>
                      <p className="mt-2 max-w-md text-[13px] leading-relaxed text-jelly-text-muted">
                        {selectedSection.outlineText.replace(/^#{1,4}\s*/u, "") || "点击下方按钮，让 AI 生成当前章节正文。"}
                      </p>
                      <button
                        type="button"
                        onClick={() => void generateOneSection(selectedSection)}
                        disabled={isBusy || draft.status === "generating"}
                        className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-jelly-blue px-5 text-[13px] font-semibold text-white shadow-[0_8px_20px_rgba(54,125,163,0.18)] hover:brightness-95 disabled:opacity-45"
                      >
                        <Wand2 size={15} />
                        生成本章正文
                      </button>
                    </div>
                  ) : (
                    <div className="flex min-h-[360px] items-center justify-center text-[13px] text-jelly-text-muted">
                      请从左侧选择一个章节
                    </div>
                  )}
                </div>
              </div>

              <footer className="shrink-0 border-t border-[#e7ebef] bg-white px-4 py-3 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedSection?.content.trim() ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void generateOneSection(selectedSection)}
                          disabled={isBusy || draft?.status === "generating"}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#dfe5e9] bg-white px-3 text-[12px] text-jelly-text-soft hover:bg-[#f6f8f9] disabled:opacity-45"
                        >
                          <RefreshCcw size={13} />
                          重新生成本章
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (sectionEditing) {
                              void saveSectionEdit().then(() => setSectionEditing(false));
                            } else {
                              setSectionEditing(true);
                            }
                          }}
                          disabled={isBusy || !selectedSection.content.trim()}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#dfe5e9] bg-white px-3 text-[12px] text-jelly-text-soft hover:bg-[#f6f8f9] disabled:opacity-45"
                        >
                          <Pencil size={13} />
                          {sectionEditing ? "保存修改" : "编辑本章"}
                        </button>
                        {selectedSection.status !== "confirmed" && selectedSection.content.trim() && (
                          <button
                            type="button"
                            onClick={() => void confirmSection()}
                            disabled={isBusy}
                            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-jelly-green/25 bg-jelly-green-bg px-3 text-[12px] text-jelly-green disabled:opacity-45"
                          >
                            <CheckCircle2 size={13} />
                            确认本章
                          </button>
                        )}
                      </>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2">
                    {draft?.status === "generating" ? (
                      <button
                        type="button"
                        onClick={() => void stopBackgroundGeneration()}
                        disabled={isBusy}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-jelly-red/25 bg-white px-3 text-[12px] text-jelly-red disabled:opacity-45"
                      >
                        <Square size={12} fill="currentColor" />
                        停止
                      </button>
                    ) : draft?.status === "assembled" ? (
                      <button
                        type="button"
                        onClick={openSaveDialog}
                        disabled={!canSave || isBusy}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-jelly-blue px-4 text-[12px] font-semibold text-white disabled:opacity-45"
                      >
                        <Save size={14} />
                        保存为笔记
                      </button>
                    ) : completedSections === activeSections.length && activeSections.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => void assembleCurrentDraft()}
                        disabled={isBusy}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-jelly-blue px-4 text-[12px] font-semibold text-white disabled:opacity-45"
                      >
                        <FileText size={14} />
                        完成草稿
                      </button>
                    ) : null}
                  </div>
                </div>

                {selectedSection?.content.trim() && !sectionEditing && (
                  <div className="mt-3 flex items-end gap-2 rounded-xl border border-[#dde6eb] bg-[#f8fbfc] p-2.5">
                    <div className="min-w-0 flex-1">
                      <label htmlFor="draft-section-instruction" className="mb-1 block text-[10px] font-semibold text-jelly-text-muted">
                        告诉 AI 如何修改本章内容
                      </label>
                      <textarea
                        id="draft-section-instruction"
                        value={sectionInstruction}
                        onChange={(event) => setSectionInstruction(event.target.value)}
                        placeholder="例如：增加一个可运行示例，把概念解释得更适合初学者…"
                        className="min-h-[52px] w-full resize-none border-0 bg-transparent text-[12px] leading-relaxed text-jelly-text outline-none placeholder:text-[#a3adb5]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void generateOneSection(selectedSection, sectionInstruction)}
                      disabled={!sectionInstruction.trim() || isBusy || draft?.status === "generating"}
                      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-jelly-blue px-3 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Wand2 size={13} />
                      按要求修改
                    </button>
                  </div>
                )}
              </footer>
            </section>
          </div>
        </main>

        {directoryManagerOpen && draft && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="目录管理">
            <button
              type="button"
              className="absolute inset-0 bg-[#17202a]/20 backdrop-blur-[1px]"
              onClick={() => setDirectoryManagerOpen(false)}
              aria-label="关闭目录管理"
            />
            <section className="relative flex max-h-[min(720px,calc(100vh-40px))] w-[min(680px,calc(100vw-32px))] flex-col overflow-hidden rounded-[20px] border border-white/90 bg-[#fbfcfd] shadow-[0_24px_80px_rgba(28,43,56,0.24)]">
              <header className="flex h-[66px] shrink-0 items-center justify-between border-b border-[#e7ebef] bg-white px-5">
                <div>
                  <h2 className="text-[16px] font-semibold text-jelly-text">目录管理</h2>
                  <p className="mt-0.5 text-[11px] text-jelly-text-muted">添加、改名、排序或重新规划一级章节</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDirectoryManagerOpen(false)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-jelly-text-muted hover:bg-[#f1f4f6] hover:text-jelly-text"
                  aria-label="关闭目录管理"
                >
                  <X size={17} />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <div className="space-y-2">
                  {activeSections.map((section, index) => (
                    <div key={section.id} className="flex min-h-[48px] items-center gap-2 rounded-xl border border-[#e5eaee] bg-white px-3 py-2">
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#f1f5f7] text-[10px] text-jelly-text-muted">
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
                          className="draft-control-no-focus-ring h-8 min-w-0 flex-1 rounded-lg border border-[#dfe5e9] bg-[#fafbfc] px-2.5 text-[12px] text-jelly-text outline-none"
                          aria-label="修改章节名称"
                          autoFocus
                        />
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-jelly-text">{section.title}</span>
                      )}
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => void moveSection(section.id, -1)}
                          disabled={index === 0 || isBusy}
                          className="grid h-8 w-8 place-items-center rounded-lg text-jelly-text-muted hover:bg-[#f2f6f8] hover:text-jelly-blue-deep disabled:opacity-25"
                          aria-label={`上移章节 ${section.title}`}
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void moveSection(section.id, 1)}
                          disabled={index === activeSections.length - 1 || isBusy}
                          className="grid h-8 w-8 place-items-center rounded-lg text-jelly-text-muted hover:bg-[#f2f6f8] hover:text-jelly-blue-deep disabled:opacity-25"
                          aria-label={`下移章节 ${section.title}`}
                        >
                          <ChevronDown size={14} />
                        </button>
                        {renamingSectionId === section.id ? (
                          <button
                            type="button"
                            onClick={() => void saveSectionTitle(section)}
                            className="grid h-8 w-8 place-items-center rounded-lg text-jelly-blue-deep hover:bg-jelly-blue-pale"
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
                            className="grid h-8 w-8 place-items-center rounded-lg text-jelly-text-muted hover:bg-[#f2f6f8] hover:text-jelly-blue-deep"
                            aria-label={`修改章节 ${section.title}`}
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void deleteSection(section)}
                          disabled={activeSections.length <= 1 || isBusy}
                          className="grid h-8 w-8 place-items-center rounded-lg text-jelly-text-muted hover:bg-jelly-red-bg hover:text-jelly-red disabled:opacity-25"
                          aria-label={`删除章节 ${section.title}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <input
                    value={newSectionTitle}
                    onChange={(event) => setNewSectionTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void addOutlineSection();
                    }}
                    placeholder="添加一级章节"
                    className="draft-control-no-focus-ring h-9 min-w-0 flex-1 rounded-lg border border-[#dfe5e9] bg-white px-3 text-[12px] text-jelly-text outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void addOutlineSection()}
                    disabled={!newSectionTitle.trim() || isBusy}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[#eef7fb] px-3 text-[12px] font-semibold text-jelly-blue-deep hover:bg-[#e2f1f7] disabled:opacity-40"
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
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#e2e7ea] bg-white px-2.5 text-[11px] text-jelly-text-muted hover:border-jelly-blue/25 hover:text-jelly-blue-deep"
                        >
                          {section.title}
                          <span className="text-jelly-blue-deep">恢复</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-5 border-t border-[#e7ebef] pt-4">
                  <p className="text-[12px] font-semibold text-jelly-text">按新要求调整大纲</p>
                  <p className="mt-1 text-[11px] text-jelly-text-muted">说明需要增删或强化的内容，AI 会重新规划全部章节。</p>
                  <textarea
                    value={outlineInstruction}
                    onChange={(event) => setOutlineInstruction(event.target.value)}
                    placeholder="例如：减少基础内容，增加两个实战章节…"
                    className="draft-control-no-focus-ring mt-2 min-h-[72px] w-full resize-none rounded-xl border border-[#e3e8eb] bg-white px-3 py-2.5 text-[12px] leading-relaxed text-jelly-text outline-none"
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void reviseOutlineWithInstruction()}
                      disabled={!outlineInstruction.trim() || isBusy}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-jelly-blue px-3.5 text-[12px] font-semibold text-white hover:brightness-95 disabled:opacity-40"
                    >
                      <RefreshCcw size={13} />
                      按要求重新规划
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {saveDialogOpen && draft && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="保存为笔记">
            <button
              type="button"
              className="absolute inset-0 bg-[#17202a]/20 backdrop-blur-[1px]"
              onClick={() => setSaveDialogOpen(false)}
              aria-label="关闭保存弹窗"
            />
            <section className="relative w-[min(460px,calc(100vw-32px))] rounded-[20px] border border-white/90 bg-white p-5 shadow-[0_24px_80px_rgba(28,43,56,0.24)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-[16px] font-semibold text-jelly-text">保存为笔记</h2>
                  <p className="mt-1 text-[11px] text-jelly-text-muted">确认标题和保存位置后，草稿会进入正式笔记库。</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSaveDialogOpen(false)}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-jelly-text-muted hover:bg-[#f1f4f6]"
                  aria-label="关闭保存弹窗"
                >
                  <X size={17} />
                </button>
              </div>
              <div className="mt-5 space-y-4">
                <label className="block">
                  <FieldLabel>笔记标题</FieldLabel>
                  <input
                    value={saveTitle}
                    onChange={(event) => setSaveTitle(event.target.value)}
                    className="draft-control-no-focus-ring h-10 w-full rounded-xl border border-[#dfe5e9] bg-[#fafbfc] px-3 text-[13px] text-jelly-text outline-none"
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
                  className="inline-flex h-9 items-center rounded-lg border border-[#dfe5e9] bg-white px-3.5 text-[12px] font-medium text-jelly-text-soft hover:bg-[#f5f7f8]"
                >
                  继续编辑
                </button>
                <button
                  type="button"
                  onClick={() => void saveDraft()}
                  disabled={!saveTitle.trim() || isBusy}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-jelly-blue px-4 text-[12px] font-semibold text-white hover:brightness-95 disabled:opacity-40"
                >
                  <Save size={14} />
                  确认保存
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
      {confirmDialog}
    </>
  );
}
