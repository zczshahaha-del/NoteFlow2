import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  CalendarClock,
  FileClock,
  Loader2,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import { listNoteVersions, type NoteVersionRecord } from "../services/notes";
import { useEditorSlice } from "../store/selectors";
import { useConfirmDialog } from "./ConfirmDialog";

interface VersionHistoryPanelProps {
  noteId: string;
  noteTitle: string;
  currentContent: string;
  onClose: () => void;
}

function formatVersionTime(value: string | null): string {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return date.toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sourceLabel(source: string): string {
  if (source === "auto_save") return "自动保存";
  if (source === "restore") return "版本恢复";
  if (source === "ai_edit") return "AI 修改";
  if (source === "manual_edit") return "手动编辑";
  return source || "历史版本";
}

function diffSummary(previous: string, current: string) {
  const oldLines = previous.split("\n");
  const newLines = current.split("\n");
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    added: Math.max(0, newLines.length - prefix - suffix),
    removed: Math.max(0, oldLines.length - prefix - suffix),
    oldLines: oldLines.length,
    newLines: newLines.length,
  };
}

export default function VersionHistoryPanel({
  noteId,
  noteTitle,
  currentContent,
  onClose,
}: VersionHistoryPanelProps) {
  const { restoreNoteVersion } = useEditorSlice();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [versions, setVersions] = useState<NoteVersionRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [restoring, setRestoring] = useState(false);

  const loadVersions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const items = await listNoteVersions(noteId);
      setVersions(items);
      setSelectedId((current) => {
        if (current && items.some((item) => item.id === current)) return current;
        return items[0]?.id ?? null;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载版本历史失败");
    } finally {
      setLoading(false);
    }
  }, [noteId]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const selected = versions.find((version) => version.id === selectedId) ?? null;
  const stats = useMemo(
    () => (selected ? diffSummary(selected.content, currentContent) : null),
    [currentContent, selected]
  );

  const restoreSelected = async () => {
    if (!selected || restoring) return;
    const approved = await confirm({
      title: "恢复这个历史版本？",
      description: (
        <span>
          当前内容会先保存为一个新版本，再恢复到 <strong>{formatVersionTime(selected.createdAt)}</strong> 的内容。
        </span>
      ),
      confirmText: "确认恢复",
      tone: "primary",
    });
    if (!approved) return;
    setRestoring(true);
    setError("");
    try {
      await restoreNoteVersion(noteId, selected.id);
      onClose();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "恢复版本失败");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <>
      <div className="absolute inset-0 z-[55] flex justify-end" role="dialog" aria-modal="true" aria-label="版本历史">
        <button type="button" className="drawer-backdrop absolute inset-0" onClick={onClose} aria-label="关闭版本历史" />
        <aside className="drawer-surface relative flex h-full w-[480px] max-w-full flex-col border-l border-jelly-border">
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-jelly-border px-4 py-4 sm:px-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[15px] font-semibold text-jelly-text">
                <FileClock size={17} className="text-jelly-blue-deep" strokeWidth={1.8} />
                版本历史
              </div>
              <p className="mt-1 truncate text-[12px] text-jelly-text-muted">{noteTitle}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-md text-jelly-text-muted hover:bg-jelly-blue-pale hover:text-jelly-blue-deep"
                onClick={() => void loadVersions()}
                aria-label="刷新版本历史"
                title="刷新"
              >
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-md text-jelly-text-muted hover:bg-jelly-blue-pale hover:text-jelly-text"
                onClick={onClose}
                aria-label="关闭版本历史"
              >
                <X size={16} strokeWidth={1.9} />
              </button>
            </div>
          </header>

          {error && (
            <div className="mx-4 mt-3 rounded-lg border border-jelly-red/25 bg-jelly-red-bg px-3 py-2 text-[12px] leading-5 text-jelly-red sm:mx-5">
              {error}
            </div>
          )}

          {loading && versions.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center text-jelly-text-muted">
              <Loader2 size={22} className="mb-3 animate-spin text-jelly-blue-deep" />
              <p className="text-[13px]">正在读取版本历史</p>
            </div>
          ) : versions.length === 0 ? (
            <div className="m-5 flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-jelly-border bg-jelly-surface px-6 text-center">
              <CalendarClock size={28} className="mb-3 text-jelly-blue-deep opacity-70" strokeWidth={1.5} />
              <p className="text-[14px] font-semibold text-jelly-text">还没有历史版本</p>
              <p className="mt-1 text-[12px] leading-5 text-jelly-text-muted">继续编辑或应用 AI 修改后，旧内容会安全保存在这里。</p>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 border-b border-jelly-border px-4 py-3 sm:px-5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-jelly-text-muted">选择版本</p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {versions.map((version, index) => (
                    <button
                      key={version.id}
                      type="button"
                      onClick={() => setSelectedId(version.id)}
                      className={`min-w-[150px] rounded-lg border px-3 py-2 text-left transition-colors ${
                        selectedId === version.id
                          ? "border-jelly-blue/35 bg-jelly-blue-pale"
                          : "border-jelly-border bg-jelly-card hover:border-jelly-blue/25"
                      }`}
                    >
                      <span className="block text-[12px] font-semibold text-jelly-text">{formatVersionTime(version.createdAt)}</span>
                      <span className="mt-1 block truncate text-[11px] text-jelly-text-muted">
                        {index === 0 ? "最近版本" : sourceLabel(version.source)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {selected && stats && (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="shrink-0 border-b border-jelly-border px-4 py-3 sm:px-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="status-chip border-jelly-green/20 bg-jelly-green-bg text-jelly-green">当前新增 {stats.added} 行</span>
                      <span className="status-chip border-jelly-red/20 bg-jelly-red-bg text-jelly-red">历史多出 {stats.removed} 行</span>
                      <span className="status-chip bg-jelly-card text-jelly-text-muted">{stats.oldLines} → {stats.newLines} 行</span>
                    </div>
                    <p className="mt-2 text-[12px] leading-5 text-jelly-text-soft">
                      {selected.changeSummary || `${sourceLabel(selected.source)}保存的内容快照`}
                    </p>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto bg-jelly-surface px-4 py-4 sm:px-5">
                    <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-jelly-text-soft">
                      <ArrowDownToLine size={14} /> 历史内容预览
                    </div>
                    <pre className="min-h-full whitespace-pre-wrap break-words rounded-xl border border-jelly-border bg-jelly-card p-4 font-sans text-[13px] leading-6 text-jelly-text-soft">
                      {selected.content || "（这个版本没有正文内容）"}
                    </pre>
                  </div>

                  <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-jelly-border px-4 py-3 sm:px-5">
                    <span className="text-[11px] text-jelly-text-muted">恢复前会自动保留当前内容</span>
                    <button
                      type="button"
                      className="ui-button ui-button-primary h-9 px-3"
                      onClick={() => void restoreSelected()}
                      disabled={restoring}
                    >
                      {restoring ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                      恢复此版本
                    </button>
                  </footer>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
      {confirmDialog}
    </>
  );
}
