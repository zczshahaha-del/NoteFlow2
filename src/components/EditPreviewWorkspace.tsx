import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  FileText,
  GitCompareArrows,
  History,
  Loader2,
  MoreHorizontal,
  Sparkles,
  Undo2,
} from "lucide-react";
import { useChatSlice, useEditorSlice } from "../store/selectors";
import {
  listEditPreviewRevisions,
  type NoteEditPreviewRevisionRecord,
} from "../services/edits";
import { diffMarkdownLines } from "../utils/markdownDiff";
import { searchSnippetText } from "../utils/searchSnippetText";
import { findFileById } from "../workspaceTree";
import AIWritingStatus from "./AIWritingStatus";
import SoftMenu from "./SoftMenu";
import MarkdownBlockReview from "./MarkdownBlockReview";
import PreviewMarkdown from "./PreviewMarkdown";
import "./document-prose.css";
import "./edit-preview.css";

const EditablePreviewBody = lazy(() => import("./EditablePreviewBody"));

const targetTypeLabels: Record<string, string> = {
  selection: "选中内容",
  section: "当前小节",
  note: "整篇笔记",
  insert: "插入内容",
  delete: "删除内容",
};

function targetTypeLabel(type: string): string {
  return targetTypeLabels[type] ?? "修改范围";
}

export default function EditPreviewWorkspace() {
  const {
    activeEditPreview,
    editPreviewDraft,
    updateEditPreviewDraft,
    flushEditPreviewDraft,
    treeData,
    editPreviewError,
    applyEditPreviewRequest,
    cancelEditPreviewRequest,
    reviseEditPreviewRequest,
    restoreEditPreviewRevisionRequest,
    closeEditPreview,
  } = useEditorSlice();
  const { chatLoading } = useChatSlice();
  const [revisionText, setRevisionText] = useState("");
  const [viewMode, setViewMode] = useState<"result" | "compare" | "diff">("result");
  const [revisions, setRevisions] = useState<NoteEditPreviewRevisionRecord[]>([]);
  const [revisionError, setRevisionError] = useState("");
  const [operation, setOperation] = useState<"apply" | "cancel" | "revise" | "restore" | null>(null);
  const [revisionLoading, setRevisionLoading] = useState(false);
  const [revisionOwnerId, setRevisionOwnerId] = useState("");
  const [revisionReload, setRevisionReload] = useState(0);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [summaryOverflows, setSummaryOverflows] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionError, setActionError] = useState("");
  const revisionInputRef = useRef<HTMLTextAreaElement>(null);
  const summaryTriggerRef = useRef<HTMLButtonElement>(null);
  const summaryTextRef = useRef<HTMLParagraphElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const menuAnchorRef = useRef<HTMLDivElement>(null);
  const historyCloseRef = useRef<HTMLButtonElement>(null);
  const diffReturnRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const revisionLoadOwner = useRef("");
  const busy = chatLoading || operation !== null;
  const draftContent = editPreviewDraft?.content ?? activeEditPreview?.newContent ?? "";
  const manualDirty = !!editPreviewDraft && editPreviewDraft.content !== editPreviewDraft.savedContent;
  const previewContentRef = useRef(draftContent);
  previewContentRef.current = draftContent;
  const summaryItems = useMemo(() => activeEditPreview?.changeSummary.filter(item => item.trim()) ?? [], [activeEditPreview?.changeSummary]);

  useLayoutEffect(() => {
    const text = summaryTextRef.current;
    if (!text) return;
    const measure = () => setSummaryOverflows(text.scrollWidth > text.clientWidth + 1);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(text);
    return () => observer?.disconnect();
  }, [summaryExpanded, summaryItems, activeEditPreview?.id]);

  const previewTitle = useMemo(() => {
    if (!activeEditPreview) return "修改预览";
    const { targetType, oldContent, noteId } = activeEditPreview;
    // Name the original target, so an AI title change never relabels its scope.
    const heading = targetType === "section" ? oldContent.trimStart().match(/^#{1,6}[ \t]+([^\r\n]+)/)?.[1] : "";
    const title = targetType === "note" ? findFileById(treeData, noteId)?.name.replace(/\.md$/i, "") : heading && searchSnippetText(heading);
    return title ? `修改「${title}」` : `修改${targetTypeLabel(targetType)}`;
  }, [activeEditPreview?.noteId, activeEditPreview?.targetType, activeEditPreview?.oldContent, treeData]);
  const scopeDescription = useMemo(() => {
    if (!activeEditPreview) return "";
    const note = findFileById(treeData, activeEditPreview.noteId)?.name.replace(/\.md$/i, "");
    const excerpt = searchSnippetText(activeEditPreview.oldContent).replace(/\s+/g, " ").trim();
    const scope = activeEditPreview.targetType === "section" ? "本次范围：这一小节（含子标题）"
      : activeEditPreview.targetType === "note" ? "本次范围：整篇笔记"
      : activeEditPreview.targetType === "insert" ? "插入位置：所选内容之后"
      : activeEditPreview.targetType === "delete" ? "本次删除：所选范围"
      : `本次范围：选中文字${excerpt ? `「${excerpt.length > 40 ? excerpt.slice(0, 40) + "…" : excerpt}」` : ""}`;
    return `${note && activeEditPreview.targetType !== "note" ? note + " · " : ""}${scope}`;
  }, [activeEditPreview, treeData]);

  const diff = useMemo(
    () => viewMode === "diff" ? diffMarkdownLines(activeEditPreview?.oldContent ?? "", draftContent) : null,
    [viewMode, draftContent, activeEditPreview?.oldContent]
  );
  useEffect(() => {
    setViewMode("result"); setSummaryExpanded(false); setHistoryOpen(false); setMenuOpen(false); setActionError("");
  }, [activeEditPreview?.id]);

  useEffect(() => {
    if (!manualDirty || busy || editPreviewDraft?.status === "error" || !activeEditPreview) return;
    const id = activeEditPreview.id;
    const timer = window.setTimeout(() => { void flushEditPreviewDraft(id).catch(() => {}); }, 650);
    return () => window.clearTimeout(timer);
  }, [manualDirty, draftContent, busy, editPreviewDraft?.status, activeEditPreview?.id, flushEditPreviewDraft]);

  useEffect(() => {
    const id = activeEditPreview?.id;
    return () => { if (id) void flushEditPreviewDraft(id).catch(() => {}); };
  }, [activeEditPreview?.id, flushEditPreviewDraft]);

  useEffect(() => {
    if (!menuOpen) return;
    menuAnchorRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && !menuAnchorRef.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
    };
  }, [menuOpen]);

  useLayoutEffect(() => {
    const input = revisionInputRef.current;
    if (!input) return;
    const resize = () => {
      input.style.height = "0px";
      const maximum = parseFloat(window.getComputedStyle(input).maxHeight) || 88;
      const height = input.scrollHeight;
      input.style.height = `${Math.min(height, maximum)}px`;
      input.style.overflowY = height > maximum ? "auto" : "hidden";
    };
    resize();
    let width = input.clientWidth;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      if (input.clientWidth === width) return;
      width = input.clientWidth;
      resize();
    });
    observer?.observe(input);
    return () => observer?.disconnect();
  }, [revisionText, activeEditPreview?.id]);

  useEffect(() => {
    if (!activeEditPreview?.id) {
      setRevisions([]);
      revisionLoadOwner.current = "";
      return;
    }
    let alive = true;
    if (revisionLoadOwner.current !== activeEditPreview.id) {
      setRevisions([]);
      setRevisionOwnerId("");
      revisionLoadOwner.current = activeEditPreview.id;
    }
    setRevisionLoading(true);
    setRevisionError("");
    void listEditPreviewRevisions(activeEditPreview.id)
      .then((items) => { if (alive) { setRevisions(items); setRevisionOwnerId(activeEditPreview.id); } })
      .catch(() => {
        if (alive) setRevisionError("暂时无法读取修订记录，当前预览已保留。");
      })
      .finally(() => { if (alive) setRevisionLoading(false); });
    return () => { alive = false; };
  }, [activeEditPreview?.id, activeEditPreview?.newContent, revisionReload]);
  const revisionsReady = !revisionLoading && revisionOwnerId === activeEditPreview?.id;

  const currentRevisionIndex = useMemo(() => {
    for (let index = revisions.length - 1; index >= 0; index -= 1) {
      if (revisions[index].newContent === draftContent) return index;
    }
    return -1;
  }, [draftContent, revisions]);
  const undoRevision = currentRevisionIndex > 0
    ? revisions[currentRevisionIndex - 1]
    : currentRevisionIndex < 0
      ? revisions[revisions.length - 1] ?? null
      : null;

  const restoreRevision = useCallback(async (revisionId?: string) => {
    if (!activeEditPreview || busy || (revisionId && (!revisionsReady || !revisions.some(revision => revision.id === revisionId)))) return;
    const initiator = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fromHistory = !!initiator?.closest("#edit-preview-history");
    const fromUndo = initiator === undoRef.current;
    const previewId = activeEditPreview?.id;
    const contentAtStart = previewContentRef.current;
    const stillCurrent = () => moreTriggerRef.current?.closest("[data-preview-id]")?.getAttribute("data-preview-id") === previewId;
    setOperation("restore");
    setActionError("");
    try {
      await flushEditPreviewDraft(previewId);
      if (!stillCurrent()) return;
      let targetId = revisionId;
      if (!targetId) {
        // Saving pending manual edits may have just created a new version.
        const latest = await listEditPreviewRevisions(previewId);
        if (!stillCurrent()) return;
        let current = -1;
        for (let index = latest.length - 1; index >= 0; index -= 1) {
          if (latest[index].newContent === contentAtStart) { current = index; break; }
        }
        targetId = current > 0 ? latest[current - 1].id : undefined;
      }
      if (targetId) await restoreEditPreviewRevisionRequest(targetId);
    }
    catch (error) { if (stillCurrent()) setActionError(error instanceof Error ? error.message : "恢复失败，修改稿已保留。"); }
    finally {
      setOperation(null);
      requestAnimationFrame(() => {
        if ((!fromHistory && !fromUndo) || (document.activeElement !== document.body && document.activeElement !== initiator) || moreTriggerRef.current?.closest("[data-preview-id]")?.getAttribute("data-preview-id") !== previewId) return;
        (fromHistory ? moreTriggerRef.current : revisionInputRef.current)?.focus({ preventScroll: true });
      });
    }
  }, [activeEditPreview?.id, busy, revisionsReady, revisions, flushEditPreviewDraft, restoreEditPreviewRevisionRequest]);

  const handleRevise = useCallback(() => {
    const text = revisionText.trim();
    if (!text || busy) return;
    setActionError("");
    setOperation("revise");
    void reviseEditPreviewRequest(text).then(success => {
      if (success) setRevisionText(current => current.trim() === text ? "" : current);
    }).finally(() => setOperation(null));
  }, [busy, reviseEditPreviewRequest, revisionText]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        handleRevise();
      }
    },
    [handleRevise]
  );

  const closeAuxiliaryPanel = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    event.stopPropagation();
    if (menuOpen) { setMenuOpen(false); moreTriggerRef.current?.focus({ preventScroll: true }); }
    else if (historyOpen) { setHistoryOpen(false); moreTriggerRef.current?.focus({ preventScroll: true }); }
    else if (summaryExpanded) { setSummaryExpanded(false); summaryTriggerRef.current?.focus({ preventScroll: true }); }
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Escape") { closeAuxiliaryPanel(event); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
    items[next]?.focus({ preventScroll: true });
  };

  if (!activeEditPreview) {
    return (
      <main className="flex min-w-0 flex-1 flex-col border-x border-jelly-border bg-jelly-bg">
        <div className="flex h-full items-center justify-center px-8">
          <div className="max-w-sm text-center">
            <Sparkles
              size={24}
              strokeWidth={1.4}
              className="mx-auto mb-3 text-jelly-text-muted"
            />
            <h2 className="text-base font-semibold text-jelly-text">没有正在确认的修改</h2>
            <p className="mt-2 text-sm leading-relaxed text-jelly-text-muted">
              从右侧 AI 助手发出修改指令后，这里会显示修改稿。
            </p>
            <button
              type="button"
              onClick={closeEditPreview}
              className="mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-jelly-border bg-white px-3 text-sm font-medium text-jelly-text-soft transition-colors hover:border-jelly-blue/25 hover:bg-jelly-blue-pale hover:text-jelly-blue-deep"
            >
              <FileText size={15} strokeWidth={1.8} />
              返回笔记
            </button>
          </div>
        </div>
      </main>
    );
  }

  const operationLabel = operation === "apply" ? "正在应用并保存" : operation === "cancel" ? "正在放弃修改"
    : operation === "revise" ? "正在调整预览" : operation === "restore" ? "正在恢复预览版本" : "AI 正在处理";
  const canExpandSummary = summaryExpanded || summaryItems.length > 1 || summaryOverflows;
  const failure = editPreviewError || editPreviewDraft?.error || actionError;
  const previewLabel = busy ? operationLabel : editPreviewDraft?.status === "saving" ? "正在保留手动修改，尚未写入笔记"
    : manualDirty ? "手动修改待保留，尚未写入笔记" : "预览中，尚未写入笔记";

  return (
    <main className="edit-preview-workspace document-canvas nf-prose-refined flex min-w-0 flex-1 flex-col" data-preview-id={activeEditPreview.id} data-view-mode={viewMode} onKeyDown={menuOpen || historyOpen || summaryExpanded ? closeAuxiliaryPanel : undefined}>
      <header className="nf-edit-header">
        <div className="nf-edit-identity">
          <div className="nf-edit-heading"><h1 title={previewTitle}>{previewTitle}</h1></div>
          <p className="nf-edit-scope" title={scopeDescription}>{scopeDescription}</p>
          <div className="nf-edit-meta">
            <AIWritingStatus compact kind="edit" step={operation === "apply" ? 2 : 1} label={previewLabel} />
          </div>
        </div>
        <div className="nf-edit-actions">
          <div ref={menuAnchorRef} className="nf-edit-more">
            <button ref={moreTriggerRef} type="button" className="nf-edit-button nf-edit-more-trigger" aria-label="更多预览操作" aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuOpen ? "edit-preview-menu" : undefined}
              onClick={() => setMenuOpen(current => !current)}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault(); setMenuOpen(true);
                  requestAnimationFrame(() => {
                    const items = menuAnchorRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
                    (event.key === "ArrowUp" ? items?.[items.length - 1] : items?.[0])?.focus({ preventScroll: true });
                  });
                }
              }}><MoreHorizontal size={17} aria-hidden="true" /></button>
            <SoftMenu open={menuOpen} onClose={() => setMenuOpen(false)} className="nf-edit-menu" role="menu" id="edit-preview-menu" aria-label="更多预览操作" onKeyDown={handleMenuKeyDown}
              onKeyDownCapture={event => {
                // Leave composition Escape to the IME, before SoftMenu's fallback.
                if (event.key === "Escape" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.stopPropagation();
              }}>
              <button type="button" className="nf-soft-menu-item" role="menuitem" onClick={() => {
                setMenuOpen(false); setHistoryOpen(true); setViewMode("result");
                requestAnimationFrame(() => { scrollRef.current?.scrollTo({ top: 0, behavior: "instant" }); historyCloseRef.current?.focus({ preventScroll: true }); });
              }}><History size={15} aria-hidden="true" />历史版本</button>
              <button type="button" className="nf-soft-menu-item" role="menuitem" onClick={() => {
                setMenuOpen(false); setHistoryOpen(false); setViewMode("diff");
                requestAnimationFrame(() => { scrollRef.current?.scrollTo({ top: 0, behavior: "instant" }); diffReturnRef.current?.focus({ preventScroll: true }); });
              }}><GitCompareArrows size={15} aria-hidden="true" />详细差异</button>
            </SoftMenu>
          </div>
          <button type="button" className="nf-edit-button" disabled={busy}
            onClick={() => { if (busy) return; setOperation("cancel"); void cancelEditPreviewRequest().finally(() => setOperation(null)); }}>放弃</button>
          <button type="button" className="nf-edit-button nf-edit-primary" disabled={busy}
            onClick={() => { if (busy) return; setOperation("apply"); void applyEditPreviewRequest().finally(() => setOperation(null)); }}>
            {operation === "apply" && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}应用到笔记
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="nf-edit-scroll">
        <div className="nf-edit-frame">
          {failure && <div role="alert" className="nf-edit-error">{failure}{manualDirty && <button type="button" className="nf-edit-button" disabled={busy} onClick={() => { setActionError(""); void flushEditPreviewDraft(activeEditPreview.id).catch(() => {}); }}>重试保存预览</button>}</div>}
          <div className="nf-edit-reviewbar">
            <section className="nf-edit-summary" aria-label="修改说明" data-expanded={summaryExpanded}>
              {summaryExpanded && summaryItems.length > 0 ? <ul id="edit-preview-summary" className="nf-edit-summary-list">{summaryItems.map((item, index) => <li key={index + "-" + item}>{item}</li>)}</ul> : <p ref={summaryTextRef}>{summaryItems[0] || "修改后的内容已准备好"}</p>}
              {canExpandSummary && <button ref={summaryTriggerRef} type="button" className="nf-edit-button nf-edit-summary-toggle" aria-label={summaryExpanded ? "收起修改说明" : "展开修改说明"} aria-expanded={summaryExpanded} aria-controls={summaryExpanded && summaryItems.length > 0 ? "edit-preview-summary" : undefined}
                onClick={() => setSummaryExpanded(current => !current)}><ChevronDown size={13} aria-hidden="true" /></button>}
            </section>
            {viewMode === "diff" ? <button ref={diffReturnRef} type="button" className="nf-edit-button" onClick={() => setViewMode("result")}>返回修改稿</button> : activeEditPreview.targetType !== "delete" && <button type="button" className="nf-edit-button" onClick={() => setViewMode(current => current === "compare" ? "result" : "compare")} aria-pressed={viewMode === "compare"}>{viewMode === "compare" ? "收起对照" : "对照原文"}</button>}
          </div>

          {historyOpen && <section id="edit-preview-history" className="nf-edit-auxiliary" aria-label="预览版本">
            <div className="nf-edit-history-heading"><h2>历史版本</h2><button ref={historyCloseRef} type="button" className="nf-edit-button" aria-label="关闭历史版本" onClick={() => { setHistoryOpen(false); moreTriggerRef.current?.focus({ preventScroll: true }); }}>收起</button></div>
            {revisionError ? <div role="alert" className="nf-edit-history-error">{revisionError}<button type="button" className="nf-edit-button" disabled={busy} onClick={() => setRevisionReload(value => value + 1)}>重试读取</button></div> : revisionLoading || revisionOwnerId !== activeEditPreview.id ? <p role="status">正在读取版本…</p> : revisions.length === 0 ? <p>暂无可恢复的预览版本。</p> : <div className="nf-edit-revisions">
              {revisions.map((revision, index) => {
                const current = index === currentRevisionIndex;
                const name = index === 0 ? "初始稿" : revision.source === "manual" ? `手动修改 ${index}` : `第${["", "一", "二", "三", "四", "五", "六", "七", "八", "九"][index] || index}次调整`;
                const date = revision.createdAt ? new Date(revision.createdAt) : null;
                const time = date && !Number.isNaN(date.getTime()) ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
                return <button type="button" className="nf-edit-revision" key={revision.id} aria-label={current ? name + "，当前预览" : "恢复" + name} aria-current={current ? "true" : undefined} disabled={current || busy || !revisionsReady} onClick={() => void restoreRevision(revision.id)}>
                  <span className="nf-edit-revision-name">{name}{time && <span>{time}</span>}</span><span className="nf-edit-revision-action">{current ? "当前" : "恢复"}</span>
                </button>;
              })}
            </div>}
          </section>}

          <section className="edit-preview-result" aria-label="修改后正文" hidden={viewMode === "diff"}>
            {activeEditPreview.targetType === "delete" ? <div className="nf-edit-deletion"><span className="nf-edit-change-label">将删除</span><PreviewMarkdown content={activeEditPreview.oldContent} /></div> : <Suspense fallback={<PreviewMarkdown content={draftContent} />}>
              <EditablePreviewBody key={activeEditPreview.id} previewId={activeEditPreview.id} content={draftContent} oldContent={activeEditPreview.oldContent} showComparison={viewMode === "compare"} disabled={busy}
                onChange={updateEditPreviewDraft} onBlur={() => { void flushEditPreviewDraft(activeEditPreview.id).catch(() => {}); }} />
            </Suspense>}
          </section>
          {viewMode === "diff" && diff ? <section className="nf-edit-diff" aria-label="详细差异正文">
            <div className="nf-edit-diff-summary"><span>+{diff.added} 行</span><span>−{diff.removed} 行</span>{diff.simplified && <span>长文已使用精简对比</span>}</div>
            <div className="nf-edit-diff-scroll" role="region" tabIndex={0} aria-label="左右滚动查看完整差异">
              <div className="nf-edit-diff-row nf-edit-diff-heading"><span>旧</span><span>新</span><span /><span>内容</span></div>
              {diff.rows.map((row, index) => <div key={row.kind + "-" + row.oldLine + "-" + row.newLine + "-" + index} className="nf-edit-diff-row" data-kind={row.kind}>
                <span>{row.oldLine ?? ""}</span><span>{row.newLine ?? ""}</span><span>{row.kind === "add" ? "+" : row.kind === "remove" ? "−" : ""}</span><span>{row.text || " "}</span>
              </div>)}
            </div>
          </section> : viewMode === "compare" && activeEditPreview.targetType === "delete" ? <MarkdownBlockReview key={activeEditPreview.id} oldContent={activeEditPreview.oldContent} newContent={draftContent} /> : null}
        </div>
      </div>

      <footer className="nf-edit-footer">
        {activeEditPreview.targetType === "delete" ? <p className="nf-edit-scope">应用后删除上方内容。想保留它，可以选择“放弃”。</p> : <div className="nf-edit-composer">
          <textarea ref={revisionInputRef} rows={1} value={revisionText} onChange={event => setRevisionText(event.target.value)} onKeyDown={handleKeyDown} placeholder="告诉 AI 还需要怎么改…" aria-label="继续修改预览" aria-description="Ctrl 或 Command 加 Enter 提交。只调整预览，应用到笔记后才保存。" />
          <button type="button" className="nf-edit-button nf-edit-adjust" onClick={handleRevise} disabled={!revisionText.trim() || busy}>
            {operation === "revise" && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}继续修改
          </button>
        </div>}
        {(manualDirty || (undoRevision && revisionOwnerId === activeEditPreview.id)) && <div className="nf-edit-undo-row"><button ref={undoRef} type="button" className="nf-edit-button" onClick={() => void restoreRevision()} disabled={busy || (!manualDirty && !revisionsReady)}><Undo2 size={13} aria-hidden="true" />撤销上次调整</button></div>}
      </footer>
    </main>
  );
}
