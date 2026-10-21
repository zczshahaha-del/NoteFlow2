import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FileNode } from "../types";
import { formatDocumentTime } from "../utils/documentTime";
import "./document-metadata.css";

interface DocumentHeaderProps {
  note: FileNode;
  title: string;
  onTitleChange: (title: string) => void;
  onTitleCommit: (title: string) => void;
  onTitleEditingChange: (editing: boolean) => void;
  matchingBodyTitle: boolean;
  bodyEditing: boolean;
}

export default function DocumentHeader({ note, title, onTitleChange, onTitleCommit, onTitleEditingChange,
  matchingBodyTitle, bodyEditing }: DocumentHeaderProps) {
  const titleId = useId();
  const [titleFocused, setTitleFocused] = useState(false);
  const [compactTitle, setCompactTitle] = useState(matchingBodyTitle);
  const composing = useRef(false);
  const cancelRename = useRef(false);
  const titleField = useRef<HTMLTextAreaElement>(null);
  const resizeTitle = () => {
    const field = titleField.current;
    if (!field) return;
    field.style.height = "0px";
    field.style.height = `${field.scrollHeight}px`;
  };
  useLayoutEffect(resizeTitle, [title, compactTitle]);
  useEffect(() => {
    const field = titleField.current;
    if (!field) return;
    let width = field.getBoundingClientRect().width;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const next = field.getBoundingClientRect().width;
      if (next !== width) { width = next; resizeTitle(); }
    });
    observer?.observe(field);
    window.addEventListener("resize", resizeTitle);
    return () => { observer?.disconnect(); window.removeEventListener("resize", resizeTitle); };
  }, []);
  // Do not resize the header under a caret while a title/H1 is being edited.
  useEffect(() => {
    if (!titleFocused && !bodyEditing) setCompactTitle(matchingBodyTitle);
  }, [matchingBodyTitle, titleFocused, bodyEditing]);
  const created = formatDocumentTime(note.createdAt);
  return <header className="document-header" data-title-mode={compactTitle ? "body" : "document"}>
    <div className="document-title-field">
      {compactTitle && <label htmlFor={titleId} className="document-title-hint">文档名</label>}
      <textarea ref={titleField} rows={1} id={titleId} value={title} aria-label="文档标题" className="document-title"
        onFocus={() => { cancelRename.current = false; onTitleEditingChange(true); setTitleFocused(true); }}
        onChange={event => onTitleChange(event.target.value.replace(/[\r\n]+/g, " "))}
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
    {created && <div className="document-meta-row">
      {created && <time className="document-meta-date" dateTime={note.createdAt ?? undefined}>创建于 {created}</time>}
    </div>}
  </header>;
}
