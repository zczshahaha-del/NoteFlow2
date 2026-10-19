import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  FileText,
  GitCompareArrows,
  History,
  Loader2,
  Sparkles,
  Undo2,
  Wand2,
} from "lucide-react";
import { useChatSlice, useEditorSlice } from "../store/selectors";
import {
  listEditPreviewRevisions,
  type NoteEditPreviewRevisionRecord,
} from "../services/edits";
import { renderChatMarkdown } from "../utils/chatMarkdown";
import { diffMarkdownLines } from "../utils/markdownDiff";
import AIWritingStatus from "./AIWritingStatus";
import "./document-prose.css";
import "./edit-preview.css";

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

function PreviewMarkdown({ content }: { content: string }) {
  const html = useMemo(() => renderChatMarkdown(content || "（空内容）"), [content]);

  return (
    <div
      className="note-content chat-markdown max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default function EditPreviewWorkspace() {
  const {
    activeEditPreview,
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
  const [auxiliaryPanel, setAuxiliaryPanel] = useState<"summary" | "history" | null>(null);
  const revisionInputRef = useRef<HTMLTextAreaElement>(null);
  const summaryTriggerRef = useRef<HTMLButtonElement>(null);
  const historyTriggerRef = useRef<HTMLButtonElement>(null);
  const busy = chatLoading || operation !== null;

  const diff = useMemo(
    () => viewMode === "diff" ? diffMarkdownLines(activeEditPreview?.oldContent ?? "", activeEditPreview?.newContent ?? "") : null,
    [viewMode, activeEditPreview?.newContent, activeEditPreview?.oldContent]
  );
  useEffect(() => { setViewMode("result"); setAuxiliaryPanel(null); }, [activeEditPreview?.id]);

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
      return;
    }
    let alive = true;
    setRevisions([]);
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
      if (revisions[index].newContent === activeEditPreview?.newContent) return index;
    }
    return -1;
  }, [activeEditPreview?.newContent, revisions]);
  const undoRevision = currentRevisionIndex > 0
    ? revisions[currentRevisionIndex - 1]
    : currentRevisionIndex < 0
      ? revisions[revisions.length - 1] ?? null
      : null;

  const restoreRevision = useCallback(async (revisionId: string) => {
    if (!revisionId || busy || !revisionsReady || !revisions.some(revision => revision.id === revisionId)) return;
    const initiator = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fromHistory = !!initiator?.closest("#edit-preview-history");
    const previewId = activeEditPreview?.id;
    setOperation("restore");
    try { await restoreEditPreviewRevisionRequest(revisionId); }
    catch { /* Store exposes the failure; keep the existing preview. */ }
    finally {
      setOperation(null);
      requestAnimationFrame(() => {
        const trigger = historyTriggerRef.current;
        if (!fromHistory || (document.activeElement !== document.body && document.activeElement !== initiator) || trigger?.closest("[data-preview-id]")?.getAttribute("data-preview-id") !== previewId) return;
        trigger?.focus({ preventScroll: true });
      });
    }
  }, [activeEditPreview?.id, busy, revisionsReady, revisions, restoreEditPreviewRevisionRequest]);

  const handleRevise = useCallback(() => {
    const text = revisionText.trim();
    if (!text || busy) return;
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
    (auxiliaryPanel === "summary" ? summaryTriggerRef : historyTriggerRef).current?.focus({ preventScroll: true });
    setAuxiliaryPanel(null);
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
              从右侧 AI 助手发出修改指令后，这里会显示原文和修改后内容。
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

  const operationLabel = operation === "apply" ? "正在应用并保存" : operation === "cancel" ? "正在取消修改"
    : operation === "revise" ? "正在调整预览" : operation === "restore" ? "正在恢复预览版本" : "AI 正在处理";

  return (
    <main className="edit-preview-workspace document-canvas nf-prose-refined flex min-w-0 flex-1 flex-col" data-preview-id={activeEditPreview.id} data-view-mode={viewMode} onKeyDown={auxiliaryPanel ? closeAuxiliaryPanel : undefined}>
      <header className="nf-edit-header">
        <div className="nf-edit-identity">
          <div className="nf-edit-heading"><Wand2 size={16} aria-hidden="true" /><h1>修改预览</h1></div>
          <div className="nf-edit-meta">
            <span>{targetTypeLabel(activeEditPreview.targetType)}</span><span aria-hidden="true">·</span>
            <AIWritingStatus compact kind="edit" step={operation === "apply" ? 2 : 1} label={busy ? operationLabel : "修改待确认"} />
          </div>
        </div>
        <div className="nf-edit-actions">
          <button type="button" className="nf-edit-button" disabled={busy}
            onClick={() => { if (busy) return; setOperation("cancel"); void cancelEditPreviewRequest().finally(() => setOperation(null)); }}>取消</button>
          <button type="button" className="nf-edit-button nf-edit-primary" disabled={busy}
            onClick={() => { if (busy) return; setOperation("apply"); void applyEditPreviewRequest().finally(() => setOperation(null)); }}>
            {operation === "apply" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}应用修改
          </button>
        </div>
      </header>

      <div className="nf-edit-scroll">
        <div className="nf-edit-frame">
          {editPreviewError && <div role="alert" className="nf-edit-error">{editPreviewError}</div>}
          <div className="nf-edit-reviewbar">
            <div className="nf-edit-views" role="group" aria-label="预览查看方式">
              <button type="button" className="nf-edit-button" onClick={() => setViewMode("result")} aria-pressed={viewMode === "result"}>修改后</button>
              <button type="button" className="nf-edit-button" onClick={() => setViewMode("compare")} aria-pressed={viewMode === "compare"}>对照原文</button>
              <button type="button" className="nf-edit-button" onClick={() => setViewMode("diff")} aria-pressed={viewMode === "diff"}><GitCompareArrows size={14} aria-hidden="true" />详细差异</button>
            </div>
            <div className="nf-edit-tools">
              <button ref={summaryTriggerRef} type="button" className="nf-edit-button" aria-expanded={auxiliaryPanel === "summary"} aria-controls={auxiliaryPanel === "summary" ? "edit-preview-summary" : undefined}
                onClick={() => setAuxiliaryPanel(current => current === "summary" ? null : "summary")}>
                修改说明<ChevronDown size={13} aria-hidden="true" />
              </button>
              <button ref={historyTriggerRef} type="button" className="nf-edit-button" aria-expanded={auxiliaryPanel === "history"} aria-controls={auxiliaryPanel === "history" ? "edit-preview-history" : undefined} data-error={!!revisionError || undefined}
                onClick={() => setAuxiliaryPanel(current => current === "history" ? null : "history")}>
                <History size={14} aria-hidden="true" />版本记录
              </button>
            </div>
          </div>

          {auxiliaryPanel === "summary" && <section id="edit-preview-summary" className="nf-edit-auxiliary" aria-label="修改说明">
            {activeEditPreview.changeSummary.length > 0 ? <ul className="nf-edit-summary-list">{activeEditPreview.changeSummary.map((item, index) => <li key={index + "-" + item}>{item}</li>)}</ul> : <p>AI 暂未返回修改说明。</p>}
          </section>}

          {auxiliaryPanel === "history" && <section id="edit-preview-history" className="nf-edit-auxiliary" aria-label="预览版本">
            <div className="nf-edit-history-heading"><h2>预览版本</h2><button type="button" className="nf-edit-button" onClick={() => undoRevision && void restoreRevision(undoRevision.id)} disabled={!undoRevision || busy || !revisionsReady}><Undo2 size={14} aria-hidden="true" />撤销上次调整</button></div>
            {revisionLoading ? <p role="status">正在读取版本…</p> : revisionError ? <div role="alert" className="nf-edit-history-error">{revisionError}<button type="button" className="nf-edit-button" disabled={busy} onClick={() => setRevisionReload(value => value + 1)}>重试读取</button></div> : revisions.length === 0 ? <p>暂无可恢复的预览版本。</p> : <div className="nf-edit-revisions">
              {revisions.map((revision, index) => {
                const current = index === currentRevisionIndex;
                const date = revision.createdAt ? new Date(revision.createdAt) : null;
                const time = date && !Number.isNaN(date.getTime()) ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
                return <button type="button" className="nf-edit-revision" key={revision.id} aria-label={current ? "第 " + (index + 1) + " 版，当前预览" : "恢复第 " + (index + 1) + " 版"} aria-current={current ? "true" : undefined} disabled={current || busy || !revisionsReady} onClick={() => void restoreRevision(revision.id)}>
                  <span className="nf-edit-revision-name">第 {index + 1} 版<span>{revision.source === "generated" ? "初始生成" : "继续调整"}{time && " · " + time}</span></span><span className="nf-edit-revision-action">{current ? "当前" : "恢复"}</span>
                </button>;
              })}
            </div>}
          </section>}

          {viewMode === "result" ? <section className="edit-preview-result" aria-label="修改后正文"><PreviewMarkdown content={activeEditPreview.newContent} /></section> : viewMode === "diff" && diff ? <section className="nf-edit-diff" aria-label="详细差异正文">
            <div className="nf-edit-diff-summary"><span>+{diff.added} 行</span><span>−{diff.removed} 行</span>{diff.simplified && <span>长文已使用精简对比</span>}</div>
            <div className="nf-edit-diff-scroll" role="region" tabIndex={0} aria-label="左右滚动查看完整差异">
              <div className="nf-edit-diff-row nf-edit-diff-heading"><span>旧</span><span>新</span><span /><span>内容</span></div>
              {diff.rows.map((row, index) => <div key={row.kind + "-" + row.oldLine + "-" + row.newLine + "-" + index} className="nf-edit-diff-row" data-kind={row.kind}>
                <span>{row.oldLine ?? ""}</span><span>{row.newLine ?? ""}</span><span>{row.kind === "add" ? "+" : row.kind === "remove" ? "−" : ""}</span><span>{row.text || " "}</span>
              </div>)}
            </div>
          </section> : <div className="nf-edit-compare">
            <section aria-label="原文对照"><h2>原文</h2><PreviewMarkdown content={activeEditPreview.oldContent} /></section>
            <section aria-label="修改后对照"><h2>修改后</h2><PreviewMarkdown content={activeEditPreview.newContent} /></section>
          </div>}
        </div>
      </div>

      <footer className="nf-edit-footer">
        <div className="nf-edit-composer">
          <textarea ref={revisionInputRef} rows={1} value={revisionText} onChange={event => setRevisionText(event.target.value)} onKeyDown={handleKeyDown} placeholder="还想怎么调整？" aria-label="继续调整预览" aria-description="Ctrl 或 Command 加 Enter 提交。只调整预览，应用后才写入笔记。" />
          <button type="button" className="nf-edit-button nf-edit-adjust" onClick={handleRevise} disabled={!revisionText.trim() || busy} aria-label="调整预览">
            {operation === "revise" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Wand2 size={14} aria-hidden="true" />}调整
          </button>
        </div>
      </footer>
    </main>
  );
}
