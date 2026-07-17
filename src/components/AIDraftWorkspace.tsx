import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Eye,
  FileText,
  Folder,
  Loader2,
  Pencil,
  RefreshCcw,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { useDraftSlice, useWorkspaceSlice } from "../storeSlices";
import type { FileNode } from "../types";
import { generateNoteStream } from "../services/deepseek";
import {
  assembleNoteDraft,
  cancelNoteDraft,
  confirmDraftSection,
  createNoteDraft,
  deleteDraftSection,
  generateAllDraftSections,
  generateDraftSection,
  getNoteDraft,
  restoreDraftSection,
  saveDraftToNotes,
  stopAllDraftSections,
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
type ViewMode = "outline" | "draft";

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
const ORDERED_LIST_RE = /^\s*\d+[.)]\s+(.+?)\s*$/;

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
        if (level > 2) return;
        startSection(headingMatch[2], level, line);
        return;
      }

      const listMatch = line.match(ORDERED_LIST_RE);
      if (listMatch) {
        startSection(listMatch[1], 2, line);
      }
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

function statusClass(status: NoteDraftSectionStatus): string {
  return sectionStatusMeta[status]?.className ?? sectionStatusMeta.outline_only.className;
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
      className="h-8 w-full rounded-md border border-jelly-border bg-white px-2.5 text-[12px] text-jelly-text outline-none transition-colors focus:border-jelly-blue/45"
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
    draftSeed,
    draftCommand,
    closeDraft,
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
  const checkpointRawRequest = useMemo(() => {
    const payload = pendingCheckpoint?.checkpointType === "draft_workspace" ? pendingCheckpoint.payload : null;
    return typeof payload?.rawRequest === "string" ? payload.rawRequest.trim() : "";
  }, [pendingCheckpoint]);
  const [topic, setTopic] = useState(initialTopic);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [draft, setDraft] = useState<NoteDraftRecord | null>(null);
  const [streamingOutline, setStreamingOutline] = useState("");
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [sectionEditContent, setSectionEditContent] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("outline");
  const [busyMode, setBusyMode] = useState<BusyMode>("idle");
  const [statusText, setStatusText] = useState("");
  const [errorText, setErrorText] = useState("");
  const activeRequestRef = useRef<AbortController | null>(null);
  const completedNoteRef = useRef<string | null>(null);
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
    draft?.sections.find((section) => section.id === selectedSectionId) ??
    activeSections[0] ??
    null;
  const renderedOutline = useMemo(
    () => renderChatMarkdown(streamingOutline || draft?.outline || ""),
    [draft?.outline, streamingOutline]
  );
  const assembledContent = draft?.assembledContent || assembleLocalDraft(cleanTitle(topic), draft?.sections ?? []);
  const renderedDraft = useMemo(() => renderChatMarkdown(assembledContent), [assembledContent]);
  const canGenerateSections = Boolean(draft && activeSections.length > 0);
  const canSave = Boolean(draft?.status === "assembled" && draft.assembledContent.trim());
  const draftStep = !draft
    ? 1
    : draft.status === "assembled"
      ? 4
      : activeSections.some((section) => section.content.trim())
        ? 3
        : 2;

  useEffect(() => {
    if (!draft && !isBusy) {
      setTopic(initialTopic);
    }
  }, [draft, initialTopic, isBusy]);

  useEffect(() => {
    setSectionEditContent(selectedSection?.content ?? "");
  }, [selectedSection?.id]);

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
      current && sorted.some((section) => section.id === current) ? current : firstActive?.id ?? null
    );
  }, []);

  useEffect(() => {
    const draftId = pendingCheckpoint?.checkpointType === "draft_workspace"
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
        setViewMode(
          restored.status === "generating" ||
          restored.status === "assembled" ||
          restored.status === "saved" ||
          restored.sections.some((section) => section.content.trim())
            ? "draft"
            : "outline"
        );
        setStatusText(
          restored.status === "generating"
            ? "后台正在继续生成，刷新或关闭页面不会中断。"
            : "已恢复上次未完成的课程方案。"
        );
      })
      .catch((error) => { if (alive) setErrorText(error instanceof Error ? error.message : "恢复草稿失败"); })
      .finally(() => { if (alive) setBusyMode("idle"); });
    return () => { alive = false; };
  }, [draft, pendingCheckpoint, replaceDraft]);

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
    setViewMode("outline");

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

      const created = await createNoteDraft({
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
      if (pendingCheckpoint?.checkpointType === "draft_workspace") {
        await bindAgentCheckpoint(pendingCheckpoint.id, { draftId: created.id }).catch(() => null);
      }
      setStreamingOutline("");
      setStatusText(feedbackText.trim() ? "已根据你的反馈重新生成大纲。确认后可以逐节生成正文。" : "大纲已生成。确认后可以逐节生成正文。");
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        setErrorText(error instanceof Error ? error.message : "大纲生成失败，请稍后重试。");
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
    draft?.outline,
    draft?.topic,
    isBusy,
    replaceDraft,
    streamingOutline,
    topic,
    pendingCheckpoint,
  ]);

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
      section: NoteDraftSectionRecord
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

        await generateNoteStream({
          mode: "section",
          topic: cleanTitle(baseDraft.topic || topic),
          noteType: AUTO_NOTE_TYPE,
          writingTone: AUTO_WRITING_TONE,
          noteFormat: AUTO_NOTE_FORMAT,
          headingLevel: AUTO_HEADING_LEVEL,
          includeCode,
          includeExercises,
          extraRequest: buildSmartRequirement(baseDraft.topic || topic, "", "", rawRequest),
          memoryEnabled: isMemoryEnabled(),
          outlinePlan: buildSectionOutline(section),
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
    async (section: NoteDraftSectionRecord) => {
      if (!draft || isBusy) return;
      activeRequestRef.current?.abort();
      const controller = new AbortController();
      activeRequestRef.current = controller;
      setBusyMode("section");
      setErrorText("");
      setViewMode("draft");

      try {
        const nextDraft = await runSectionGeneration(draft, section);
        if (nextDraft) {
          setStatusText(`${section.title} 已生成，可以确认或继续修改。`);
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
    setViewMode("draft");

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
      setStatusText("正在停止后台生成，当前请求结束后会保留已完成章节。");
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
      setViewMode("draft");
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

  const deleteSelectedSection = useCallback(async () => {
    if (!draft || !selectedSection || isBusy) return;
    setBusyMode("revise");
    setErrorText("");
    try {
      const nextDraft = await deleteDraftSection(draft.id, selectedSection.id);
      replaceDraft(nextDraft);
      setStatusText(`${selectedSection.title} 已从草稿中删除，可在下方恢复。`);
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

  const saveDraft = useCallback(async () => {
    if (!draft || !canSave || isBusy) return;
    const confirmed = await confirm({
      title: "保存为正式笔记？",
      description: "保存后会进入笔记库，并创建可检索的索引。保存前你仍然可以返回继续调整草稿。",
      confirmText: "保存",
      cancelText: "继续编辑",
      tone: "primary",
    });
    if (!confirmed) return;

    setBusyMode("save");
    setErrorText("");
    try {
      const result = await saveDraftToNotes(draft.id, {
        categoryId,
        title: cleanTitle(topic),
        confirm: true,
      });
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
  }, [canSave, categoryId, closeDraft, confirm, draft, isBusy, pendingCheckpoint, reloadWorkspace, replaceDraft, topic]);

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

  return (
    <>
      <main className="document-canvas draft-workspace flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-[#fdfdfc]">
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="draft-document-scroll">
            {viewMode === "outline" ? (
              <>
                {busyMode === "outline" && (
                  <div className="mb-3 flex items-center gap-2 rounded-md border border-jelly-border bg-jelly-blue-pale px-3 py-2 text-[12px] text-jelly-blue-deep">
                    <Loader2 size={14} className="animate-spin" strokeWidth={1.8} />
                    正在生成课程目录
                  </div>
                )}
                {errorText && (
                  <p className="mb-3 rounded-md border border-jelly-red/25 bg-jelly-red-bg px-3 py-2 text-[13px] leading-relaxed text-jelly-red">
                    {errorText}
                  </p>
                )}
                {draft?.outline || streamingOutline ? (
                  <div
                    className="note-content draft-note-content"
                    onClick={(event) => void handleRenderedCodeBlockAction(event.target, event.currentTarget)}
                    dangerouslySetInnerHTML={{ __html: renderedOutline }}
                  />
                ) : (
                  <div className="note-content draft-note-content course-plan-placeholder">
                    <h1>{cleanTitle(topic)}</h1>
                    <p className="course-plan-kicker">课程方案</p>
                    <hr />
                    <h2>先在右侧和 AI 说说你想怎么学</h2>
                    <p>
                      AI 会根据你的基础、目标和希望的深度继续追问。信息足够后，课程目录会直接出现在这里。
                    </p>
                  </div>
                )}
              </>
            ) : assembledContent.trim() ? (
              <div
                className="note-content draft-note-content"
                onClick={(event) => void handleRenderedCodeBlockAction(event.target, event.currentTarget)}
                dangerouslySetInnerHTML={{ __html: renderedDraft }}
              />
            ) : (
              <div className="note-content draft-note-content course-plan-placeholder">
                <h1>{cleanTitle(topic)}</h1>
                <p className="course-plan-kicker">正在生成课程</p>
                <hr />
                <h2>{statusText || "正文生成后会直接出现在这里"}</h2>
                <p>你可以先去阅读其他笔记，右侧 AI 会持续显示生成进度。</p>
              </div>
            )}
          </div>
        </div>
      </main>
      {confirmDialog}
    </>
  );
}
