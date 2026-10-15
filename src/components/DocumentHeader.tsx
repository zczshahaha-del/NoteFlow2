import { useEffect, useId, useRef, useState } from "react";
import { ChevronRight, Folder, MoreHorizontal } from "lucide-react";
import SoftMenu from "./SoftMenu";
import type { FileNode } from "../types";
import { formatDocumentTime } from "../utils/documentTime";
import "./document-metadata.css";

interface DocumentHeaderProps {
  note: FileNode;
  folders: string[];
  title: string;
  onTitleChange: (title: string) => void;
  onTitleCommit: (title: string) => void;
  onTitleEditingChange: (editing: boolean) => void;
  matchingBodyTitle: boolean;
  bodyEditing: boolean;
  saveStatus: "idle" | "unsaved" | "saving" | "saved" | "offline" | "error";
  showHeadingNumbers: boolean;
  onToggleHeadingNumbers: () => void;
}

const saveLabels = {
  idle: "正文自动保存",
  unsaved: "正文待保存",
  saving: "正在保存正文…",
  saved: "正文已同步",
  offline: "正文仅存本机",
  error: "正文未同步",
};

export default function DocumentHeader({ note, folders, title, onTitleChange, onTitleCommit, onTitleEditingChange,
  matchingBodyTitle, bodyEditing, saveStatus, showHeadingNumbers, onToggleHeadingNumbers }: DocumentHeaderProps) {
  const titleId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [titleFocused, setTitleFocused] = useState(false);
  const [compactTitle, setCompactTitle] = useState(matchingBodyTitle);
  const menuRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const cancelRename = useRef(false);
  // Do not resize the header under a caret while a title/H1 is being edited.
  useEffect(() => {
    if (!titleFocused && !bodyEditing) setCompactTitle(matchingBodyTitle);
  }, [matchingBodyTitle, titleFocused, bodyEditing]);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [menuOpen]);
  const location = ["知识库", ...folders].join(" / ");
  const created = formatDocumentTime(note.createdAt);
  const updated = formatDocumentTime(note.updatedAt);
  return <header className="document-header" data-title-mode={compactTitle ? "body" : "document"}>
    <div className="document-location" aria-label={`笔记位置：${location}`} title={location}>
      <Folder size={13} aria-hidden="true" />
      <span>知识库</span>
      {folders.length > 0 && <><ChevronRight size={12} aria-hidden="true" /><span className="document-location-path">{folders.join(" / ")}</span></>}
    </div>
    <div className="document-title-field">
      {compactTitle && <label htmlFor={titleId} className="document-title-hint">文档名</label>}
      <input id={titleId} value={title} aria-label="文档标题" className="document-title"
        onFocus={() => { cancelRename.current = false; onTitleEditingChange(true); setTitleFocused(true); }}
        onChange={event => onTitleChange(event.target.value)}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => {
          if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Escape") {
            event.preventDefault();
            cancelRename.current = true;
            onTitleChange(note.name.replace(/\.md$/i, ""));
            event.currentTarget.blur();
          } else if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        onBlur={event => {
          composing.current = false;
          onTitleEditingChange(false);
          if (!cancelRename.current) onTitleCommit(event.currentTarget.value);
          cancelRename.current = false;
          setTitleFocused(false);
        }} />
    </div>
    <div className="document-meta-row">
      <div className="document-meta-summary">
        <span className="document-save-state" data-save-status={saveStatus} aria-live="polite" aria-atomic="true">
          <span className="document-save-dot" aria-hidden="true" />{saveLabels[saveStatus]}
        </span>
        <div className="document-meta-dates">
          {created && <span className="document-meta-date">创建于 {created}</span>}
          {updated && <span className="document-meta-date">更新于 {updated}</span>}
        </div>
      </div>
      <div ref={menuRef} className="document-meta-menu">
        <button type="button" className="document-view-menu-trigger" aria-label="文档显示设置"
          aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}>
          <MoreHorizontal size={17} />
        </button>
        <SoftMenu open={menuOpen} onClose={() => setMenuOpen(false)}
          className="document-view-menu nf-action-menu absolute right-0 top-full z-40 mt-1.5"
          role="menu" aria-label="文档显示设置">
          <button type="button" className="nf-soft-menu-item" role="menuitemcheckbox" aria-checked={showHeadingNumbers}
            onClick={() => { onToggleHeadingNumbers(); setMenuOpen(false); }}>
            <span className="nf-menu-checkbox" aria-hidden="true">{showHeadingNumbers ? "✓" : ""}</span>
            <span><span className="nf-menu-label">显示章节编号</span><span className="nf-menu-description">自动编号一级和二级标题</span></span>
          </button>
        </SoftMenu>
      </div>
    </div>
  </header>;
}
