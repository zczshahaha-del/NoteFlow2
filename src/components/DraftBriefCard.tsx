import { useId, useLayoutEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import type { DraftBrief } from "../utils/draftBrief";
import "./draft-brief-card.css";

interface Props {
  brief: DraftBrief;
  current: boolean;
  busy: boolean;
  pending: boolean;
  hasOutline: boolean;
  canOpen: boolean;
  label: string;
  error?: string;
  historicalAction: string;
  onEdit: (patch: { title?: string; requirements?: string }) => void;
  onGenerate: () => void;
  onOpen: () => void;
}

export default function DraftBriefCard({ brief, current, busy, pending, hasOutline, canOpen, label, error,
  historicalAction, onEdit, onGenerate, onOpen }: Props) {
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const requirementsRef = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const [emptyError, setEmptyError] = useState(false);
  const summary = hasOutline || !current;
  const locked = busy || pending;

  useLayoutEffect(() => {
    if (summary) return;
    const resize = () => {
      for (const [field, max] of [[titleRef.current, 104], [requirementsRef.current, 152]] as const) {
        if (!field) continue;
        field.style.height = "auto";
        field.style.height = `${Math.min(max, field.scrollHeight)}px`;
        field.style.overflowY = field.scrollHeight > max ? "auto" : "hidden";
      }
    };
    resize();
    const field = requirementsRef.current;
    let width = field?.clientWidth;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      if (field?.clientWidth !== width) { width = field?.clientWidth; resize(); }
    });
    if (field) observer?.observe(field);
    return () => observer?.disconnect();
  }, [brief.title, brief.requirements, summary]);

  const generate = () => {
    if (locked || summary) return;
    if (!brief.title.trim()) {
      setEmptyError(true);
      titleRef.current?.focus();
      return;
    }
    onGenerate();
  };

  return (
    <section className="nf-draft-brief-card" data-stage={summary ? "ready" : "brief"} aria-label="AI 笔记草稿">
      <header className="nf-draft-brief-header">
        <span className="nf-draft-brief-brand"><FileText size={14} strokeWidth={1.6} />笔记草稿</span>
        <span className="nf-draft-brief-status" role="status">
          {!current ? historicalAction : pending ? "正在规划…" : busy ? label : hasOutline ? label : "待确认"}
        </span>
      </header>

      {summary ? (
        <div className="nf-draft-brief-summary">
          <h3>{brief.title}</h3>
          {brief.requirements.trim() && <p>{brief.requirements}</p>}
        </div>
      ) : (
        <div className="nf-draft-brief-fields">
          <textarea ref={titleRef} className="nf-draft-brief-title" aria-label="草稿标题"
            value={brief.title} maxLength={160} rows={1} disabled={locked} placeholder="给这份笔记起个标题…"
            onChange={event => { setEmptyError(false); onEdit({ title: event.target.value }); }}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                event.preventDefault();
                requirementsRef.current?.focus();
              }
            }} />
          <div className="nf-draft-brief-requirements">
            <textarea ref={requirementsRef} aria-label="草稿要求" aria-describedby={hintId}
              value={brief.requirements} maxLength={2000} rows={1} disabled={locked}
              placeholder="这份笔记有什么要求？（选填）"
              onChange={event => onEdit({ requirements: event.target.value })} />
            <p id={hintId} className="nf-draft-brief-hint">用于规划大纲和生成正文</p>
          </div>
        </div>
      )}

      {emptyError && <p className="nf-draft-brief-error" role="alert">请先填写标题。</p>}
      {error && current && <p className="nf-draft-brief-error" role="alert">{error}</p>}
      <footer>
        <button type="button" disabled={!current || (summary ? !canOpen : locked)} onClick={summary ? onOpen : generate}>
          {!current ? historicalAction : summary ? "打开草稿" : locked ? "生成大纲中…" : error ? "重试生成大纲" : "生成大纲"}
        </button>
      </footer>
    </section>
  );
}
