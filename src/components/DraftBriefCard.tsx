import { useLayoutEffect, useRef, useState } from "react";
import type { DraftBrief } from "../utils/draftBrief";
import { sameDraftBrief } from "../utils/draftBrief";
import AIWritingStatus from "./AIWritingStatus";
import { useConfirmDialog } from "./ConfirmDialog";
import "./draft-brief-card.css";

export default function DraftBriefCard({ brief, generatedBrief, current, busy, pending, hasOutline, hasBody, label, error, historicalAction,
  onEdit, onGenerate, onOpen }: {
  brief: DraftBrief; generatedBrief?: DraftBrief | null; current: boolean; busy: boolean; pending: boolean;
  hasOutline: boolean; hasBody: boolean; label: string; error?: string; historicalAction: string;
  onEdit: (patch: { title?: string; requirements?: string }) => void; onGenerate: () => void; onOpen: () => void;
}) {
  const requirementsRef = useRef<HTMLTextAreaElement>(null);
  const initialBrief = useRef(brief);
  const [emptyError, setEmptyError] = useState(false);
  const submitting = useRef(false);
  const { confirm, confirmDialog } = useConfirmDialog();
  const baseline = generatedBrief ?? initialBrief.current;
  const changed = hasOutline && !sameDraftBrief(brief, baseline);
  const locked = !current || busy || pending;
  useLayoutEffect(() => {
    const field = requirementsRef.current;
    if (!field) return;
    const resize = () => {field.style.height = "auto";field.style.height = `${Math.min(220, Math.max(86, field.scrollHeight))}px`;field.style.overflowY = field.scrollHeight > 220 ? "auto" : "hidden";};
    resize();
    let width = field.clientWidth;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {if (field.clientWidth !== width) {width = field.clientWidth; resize();}});
    observer?.observe(field);
    return () => observer?.disconnect();
  }, [brief.requirements]);
  const act = async () => {
    if (locked || submitting.current) return;
    if (!brief.title.trim()) {setEmptyError(true); return;}
    if (hasOutline && !changed) {onOpen(); return;}
    submitting.current = true;
    try {
      if (hasBody && !await confirm({title: "按新要求重做大纲？", description: "重新生成成功后会替换当前大纲和章节正文。生成失败时保留已有内容。", confirmText: "重新生成", cancelText: "保留内容", tone: "danger"})) return;
      onGenerate();
    } finally {submitting.current = false;}
  };
  return <>
    <section className="nf-draft-brief-card" aria-label="AI 笔记草稿">
      <header><span className="nf-draft-brief-brand">AI 草稿</span><AIWritingStatus compact label={busy ? label : !hasOutline && current ? "待生成大纲" : label} step={0} /></header>
      <div className="nf-draft-brief-fields">
        <label><span className="nf-draft-brief-label">标题</span><input aria-label="草稿标题" value={brief.title} maxLength={160} readOnly={!current} disabled={current && (busy || pending)}
          onChange={e => {setEmptyError(false);onEdit({title:e.target.value});}}
          onKeyDown={e => {if(e.key === "Enter" && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229){e.preventDefault();requirementsRef.current?.focus();}}} /></label>
        <label className="nf-draft-brief-requirements"><span className="nf-draft-brief-label">要求 <span>选填</span></span><textarea ref={requirementsRef} aria-label="草稿要求" value={brief.requirements} maxLength={2000} rows={3} readOnly={!current} disabled={current && (busy || pending)} placeholder={"希望怎么写？\n可以补充适用对象、篇幅或内容重点。"} onChange={e => onEdit({requirements:e.target.value})} /></label>
        {emptyError && <p className="nf-draft-brief-error" role="alert">请先填写标题。</p>}
        {error && current && <p className="nf-draft-brief-error" role="alert">{error}</p>}
        {changed && current && <p className="nf-draft-brief-change" role="status">标题或要求已调整，已有内容保持不变。</p>}
      </div>
      <footer><button type="button" disabled={locked} onClick={() => void act()}>
        {!current ? historicalAction : pending ? "大纲生成中…" : busy ? label : changed ? "重新生成大纲" : hasOutline ? label === "大纲待确认" ? "查看大纲" : "查看草稿" : error ? "重新生成大纲" : "生成大纲"}
      </button></footer>
    </section>
    {confirmDialog}
  </>;
}
