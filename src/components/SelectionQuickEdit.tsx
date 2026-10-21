import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { Loader2, Sparkles, X } from "lucide-react";
import { applySelectionEdit, selectionEditIsCurrent, type SelectionEditSnapshot } from "../editor/quickSelectionEdit";
import { rewriteSelection } from "../services/edits";
import { isMemoryEnabled } from "../services/memories";
import { useAppStore } from "../store";
import PreviewMarkdown from "./PreviewMarkdown";
import "./selection-quick-edit.css";

export default function SelectionQuickEdit({ editor, noteId, snapshot, onClose }: {
  editor: Editor; noteId: string; snapshot: SelectionEditSnapshot; onClose: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const request = useRef<AbortController | null>(null);
  const owner = useRef(useAppStore.getState().hydratedUserId);
  const tooLong = snapshot.markdown.length > 16000;
  const current = () => selectionEditIsCurrent(editor, snapshot)
    && useAppStore.getState().selectedFileId === noteId
    && useAppStore.getState().hydratedUserId === owner.current;

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    const update = () => { if (!current()) { setStale(true); request.current?.abort(); } };
    editor.on("transaction", update);
    const unsubscribe = useAppStore.subscribe(update);
    return () => { editor.off("transaction", update); unsubscribe(); request.current?.abort(); request.current = null; };
  }, [editor, snapshot, noteId]);

  useLayoutEffect(() => {
    const place = () => {
      if (!panel.current || editor.isDestroyed) return;
      const start = editor.view.coordsAtPos(Math.min(snapshot.from, editor.state.doc.content.size));
      const end = editor.view.coordsAtPos(Math.min(snapshot.to, editor.state.doc.content.size));
      const box = panel.current.getBoundingClientRect();
      const below = Math.max(start.bottom, end.bottom) + 10;
      panel.current.style.left = `${Math.max(12, Math.min(start.left, window.innerWidth - box.width - 12))}px`;
      panel.current.style.top = `${Math.max(12, Math.min(below + box.height < window.innerHeight - 12 ? below : start.top - box.height - 10, window.innerHeight - box.height - 12))}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [editor, snapshot]);

  const close = () => {
    request.current?.abort();
    if (current()) editor.chain().focus(undefined, { scrollIntoView: false }).setTextSelection({ from: snapshot.from, to: snapshot.to }).run();
    onClose();
  };
  const generate = async () => {
    if (request.current || stale || tooLong || !current()) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError("");
    try {
      const content = await rewriteSelection({ noteId, selectedMarkdown: snapshot.markdown,
        currentDraft: draft ?? undefined, instruction, memoryEnabled: isMemoryEnabled() }, controller.signal);
      if (request.current === controller && !controller.signal.aborted && current()) { setDraft(content); setInstruction(""); }
    } catch (cause) {
      if (request.current === controller && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "修改失败，请重试。");
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  };
  return createPortal(<div ref={panel} className="nf-selection-edit" role="dialog" aria-label="AI 改一下" onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void generate(); }
  }}>
    <header><span><Sparkles size={15} />AI 改一下</span><button type="button" aria-label="关闭快捷修改" onClick={close}><X size={16} /></button></header>
    {draft !== null && <section className="nf-selection-edit-result" aria-label="选区修改结果">
      {draft ? <PreviewMarkdown content={draft} /> : <p>采用后将删除选中文字。</p>}
    </section>}
    <div className="nf-selection-edit-input"><textarea ref={input} rows={2} maxLength={2000} value={instruction} onChange={event => setInstruction(event.target.value)}
      placeholder={draft === null ? "希望怎么改？例如：更通俗一点…" : "还想怎么调整…"} aria-label="快捷修改意见" disabled={busy || stale || tooLong} /></div>
    {(stale || tooLong || error) && <p className="nf-selection-edit-error" role="alert">{stale ? "正文已变化，请重新选中文字。当前结果未应用。" : tooLong ? "选中文字过长，请分段修改。" : error}</p>}
    <footer><button type="button" onClick={close}>取消</button>
      <div><button type="button" className={draft === null ? "is-primary" : ""} disabled={busy || stale || tooLong} onClick={() => void generate()}>
        {busy && <Loader2 size={14} className="animate-spin" />}{busy ? "修改中" : draft === null ? instruction.trim() ? "开始修改" : "直接润色" : "继续修改"}</button>
      {draft !== null && <button type="button" className="is-primary" disabled={busy || stale} onClick={() => {
        if (!current() || !applySelectionEdit(editor, snapshot, draft)) { setStale(true); return; }
        onClose();
      }}>采用</button>}</div>
    </footer>
  </div>, document.body);
}
