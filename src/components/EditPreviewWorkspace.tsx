import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  FileText,
  GitCompareArrows,
  History,
  Loader2,
  RefreshCcw,
  Sparkles,
  Undo2,
  Wand2,
  X,
} from "lucide-react";
import { useChatSlice, useEditorSlice } from "../storeSlices";
import {
  listEditPreviewRevisions,
  type NoteEditPreviewRevisionRecord,
} from "../services/edits";
import { renderChatMarkdown } from "../utils/chatMarkdown";
import { diffMarkdownLines } from "../utils/markdownDiff";

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
      className="chat-markdown max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default function EditPreviewWorkspace() {
  const {
    activeEditPreview,
    applyEditPreviewRequest,
    cancelEditPreviewRequest,
    reviseEditPreviewRequest,
    restoreEditPreviewRevisionRequest,
    closeEditPreview,
  } = useEditorSlice();
  const { chatLoading } = useChatSlice();
  const [revisionText, setRevisionText] = useState("");
  const [viewMode, setViewMode] = useState<"diff" | "full">("diff");
  const [revisions, setRevisions] = useState<NoteEditPreviewRevisionRecord[]>([]);
  const [revisionError, setRevisionError] = useState("");

  const diff = useMemo(
    () => diffMarkdownLines(activeEditPreview?.oldContent ?? "", activeEditPreview?.newContent ?? ""),
    [activeEditPreview?.newContent, activeEditPreview?.oldContent]
  );

  useEffect(() => {
    if (!activeEditPreview?.id) {
      setRevisions([]);
      return;
    }
    let alive = true;
    setRevisionError("");
    void listEditPreviewRevisions(activeEditPreview.id)
      .then((items) => { if (alive) setRevisions(items); })
      .catch(() => {
        if (alive) setRevisionError("修订记录将在后端服务重启后可用");
      });
    return () => { alive = false; };
  }, [activeEditPreview?.id, activeEditPreview?.newContent]);

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
    if (!revisionId || chatLoading) return;
    await restoreEditPreviewRevisionRequest(revisionId).catch(() => undefined);
  }, [chatLoading, restoreEditPreviewRevisionRequest]);

  const handleRevise = useCallback(() => {
    const text = revisionText.trim();
    if (!text || chatLoading) return;
    reviseEditPreviewRequest(text);
    setRevisionText("");
  }, [chatLoading, reviseEditPreviewRequest, revisionText]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        handleRevise();
      }
    },
    [handleRevise]
  );

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

  return (
    <main className="flex min-w-0 flex-1 flex-col border-x border-jelly-border bg-jelly-bg">
      <div className="shrink-0 border-b border-jelly-border bg-white px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Wand2 size={17} strokeWidth={1.8} className="text-jelly-blue-deep" />
              <h1 className="truncate text-sm font-semibold text-jelly-text">
                AI 修改预览
              </h1>
              <span className="rounded-md border border-jelly-blue/20 bg-jelly-blue-pale px-2 py-1 text-[12px] font-medium text-jelly-blue-deep">
                {targetTypeLabel(activeEditPreview.targetType)}
              </span>
            </div>
            <p className="mt-1 truncate text-[12px] text-jelly-text-muted">
              正式笔记尚未改变，应用后才会保存并更新索引。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={cancelEditPreviewRequest}
              disabled={chatLoading}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-jelly-border bg-white px-3 text-[13px] font-medium text-jelly-text-soft transition-colors hover:border-jelly-red/30 hover:bg-jelly-red-bg hover:text-jelly-red disabled:cursor-not-allowed disabled:opacity-55"
            >
              <X size={15} strokeWidth={1.9} />
              取消
            </button>
            <button
              type="button"
              onClick={applyEditPreviewRequest}
              disabled={chatLoading}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-jelly-blue px-3 text-[13px] font-semibold text-white shadow-[0_2px_8px_rgba(122,175,207,0.22)] transition-colors hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-55"
            >
              {chatLoading ? (
                <Loader2 size={15} strokeWidth={1.9} className="animate-spin" />
              ) : (
                <CheckCircle2 size={15} strokeWidth={1.9} />
              )}
              应用修改
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-4 rounded-md border border-jelly-border bg-white px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-jelly-text">
            <Sparkles size={14} strokeWidth={1.8} className="text-jelly-blue-deep" />
            修改摘要
          </div>
          {activeEditPreview.changeSummary.length > 0 ? (
            <ul className="space-y-1 text-[13px] leading-relaxed text-jelly-text-soft">
              {activeEditPreview.changeSummary.map((item, index) => (
                <li key={`${item}-${index}`} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-jelly-blue" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-jelly-text-muted">AI 暂未返回摘要。</p>
          )}
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex overflow-hidden rounded-md border border-jelly-border bg-white">
            <button
              type="button"
              onClick={() => setViewMode("diff")}
              className={`flex h-8 items-center gap-1.5 px-3 text-[12px] ${viewMode === "diff" ? "bg-jelly-blue-pale font-semibold text-jelly-blue-deep" : "text-jelly-text-soft hover:bg-jelly-surface"}`}
            >
              <GitCompareArrows size={14} strokeWidth={1.8} /> 行级 Diff
            </button>
            <button
              type="button"
              onClick={() => setViewMode("full")}
              className={`h-8 px-3 text-[12px] ${viewMode === "full" ? "bg-jelly-blue-pale font-semibold text-jelly-blue-deep" : "text-jelly-text-soft hover:bg-jelly-surface"}`}
            >
              全文预览
            </button>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="rounded-md bg-jelly-green-bg px-2 py-1 text-jelly-green">+{diff.added} 行</span>
            <span className="rounded-md bg-jelly-red-bg px-2 py-1 text-jelly-red">-{diff.removed} 行</span>
            {diff.simplified && <span className="text-jelly-text-muted">长文已使用精简对比</span>}
          </div>
        </div>

        {viewMode === "diff" ? (
          <section className="min-h-[420px] overflow-hidden rounded-md border border-jelly-border bg-white">
            <div className="grid grid-cols-[42px_42px_28px_minmax(0,1fr)] border-b border-jelly-border bg-jelly-surface px-1 py-2 text-[11px] font-medium text-jelly-text-muted">
              <span className="text-center">旧</span>
              <span className="text-center">新</span>
              <span />
              <span>内容</span>
            </div>
            <div className="max-h-[62vh] overflow-auto font-mono text-[12px] leading-5">
              {diff.rows.map((row, index) => (
                <div
                  key={`${row.kind}-${row.oldLine ?? "x"}-${row.newLine ?? "x"}-${index}`}
                  className={`grid min-w-[560px] grid-cols-[42px_42px_28px_minmax(0,1fr)] border-b border-jelly-border/50 px-1 ${row.kind === "add" ? "bg-jelly-green-bg text-jelly-green" : row.kind === "remove" ? "bg-jelly-red-bg text-jelly-red" : "text-jelly-text-soft"}`}
                >
                  <span className="select-none border-r border-jelly-border/60 pr-2 text-right text-jelly-text-muted">{row.oldLine ?? ""}</span>
                  <span className="select-none border-r border-jelly-border/60 pr-2 text-right text-jelly-text-muted">{row.newLine ?? ""}</span>
                  <span className="select-none text-center font-semibold">{row.kind === "add" ? "+" : row.kind === "remove" ? "−" : ""}</span>
                  <span className="whitespace-pre-wrap break-words px-2">{row.text || " "}</span>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <div className="grid min-h-[420px] grid-cols-1 gap-4 xl:grid-cols-2">
            <section className="min-h-0 rounded-md border border-jelly-border bg-white">
              <div className="border-b border-jelly-border px-4 py-2.5">
                <h2 className="text-[13px] font-semibold text-jelly-text">原文</h2>
              </div>
              <div className="max-h-[62vh] overflow-y-auto px-4 py-3">
                <PreviewMarkdown content={activeEditPreview.oldContent} />
              </div>
            </section>

            <section className="min-h-0 rounded-md border border-jelly-blue/25 bg-white">
              <div className="border-b border-jelly-blue/15 bg-jelly-blue-pale px-4 py-2.5">
                <h2 className="text-[13px] font-semibold text-jelly-blue-deep">修改后</h2>
              </div>
              <div className="max-h-[62vh] overflow-y-auto px-4 py-3">
                <PreviewMarkdown content={activeEditPreview.newContent} />
              </div>
            </section>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-jelly-border bg-white px-4 py-3 sm:px-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => undoRevision && void restoreRevision(undoRevision.id)}
            disabled={!undoRevision || chatLoading}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-jelly-border bg-white px-3 text-[12px] text-jelly-text-soft hover:bg-jelly-blue-pale hover:text-jelly-blue-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Undo2 size={14} strokeWidth={1.8} /> 撤销上次调整
          </button>
          <label className="flex min-w-0 items-center gap-1.5 text-[12px] text-jelly-text-muted">
            <History size={14} strokeWidth={1.8} />
            <span className="shrink-0">恢复旧版</span>
            <select
              value={currentRevisionIndex >= 0 ? revisions[currentRevisionIndex]?.id : ""}
              onChange={(event) => void restoreRevision(event.target.value)}
              disabled={revisions.length === 0 || chatLoading}
              className="h-8 min-w-0 max-w-[260px] rounded-md border border-jelly-border bg-white px-2 text-[12px] text-jelly-text-soft outline-none focus:border-jelly-blue/40 disabled:opacity-50"
            >
              <option value="">选择预览版本</option>
              {revisions.map((revision, index) => (
                <option key={revision.id} value={revision.id}>
                  {index + 1}. {revision.source === "generated" ? "初始生成" : "继续调整"}{revision.createdAt ? ` · ${new Date(revision.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
                </option>
              ))}
            </select>
          </label>
          {revisionError && <span className="text-[11px] text-jelly-amber">{revisionError}</span>}
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-end">
          <textarea
            value={revisionText}
            onChange={(event) => setRevisionText(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="继续调整这份预览，例如：再通俗一点，补一个项目例子..."
            className="min-h-16 flex-1 resize-none rounded-md border border-jelly-border bg-white px-3 py-2 text-[13px] leading-relaxed text-jelly-text outline-none transition-colors placeholder:text-jelly-text-muted focus:border-jelly-blue/35 focus:shadow-[0_0_0_3px_rgba(122,175,207,0.08)]"
          />
          <button
            type="button"
            onClick={handleRevise}
            disabled={!revisionText.trim() || chatLoading}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-jelly-border bg-white px-3 text-[13px] font-medium text-jelly-text-soft transition-colors hover:border-jelly-blue/25 hover:bg-jelly-blue-pale hover:text-jelly-blue-deep disabled:cursor-not-allowed disabled:opacity-55"
          >
            {chatLoading ? (
              <Loader2 size={15} strokeWidth={1.9} className="animate-spin" />
            ) : (
              <RefreshCcw size={15} strokeWidth={1.9} />
            )}
            调整预览
          </button>
        </div>
      </div>
    </main>
  );
}
