import { useEffect, useState } from "react";
import { Hash, Plus, Star, X } from "lucide-react";
import { useWorkspaceSlice } from "../storeSlices";
import type { FileNode } from "../types";

export default function NoteMetadataControls({ note }: { note: FileNode }) {
  const { setNoteTags, toggleNodeFavorite } = useWorkspaceSlice();
  const [draft, setDraft] = useState("");
  const tags = note.tags ?? [];

  useEffect(() => setDraft(""), [note.id]);

  const addTag = () => {
    const next = draft.trim().replace(/^#/, "");
    if (!next) return;
    setNoteTags(note.id, [...tags, next]);
    setDraft("");
  };

  return (
    <div className="document-tags-row mt-3 flex flex-wrap items-center gap-2" aria-label="笔记标签与收藏">
      <button
        type="button"
        className={`document-meta-action inline-flex h-7 items-center gap-1 px-1 text-[12px] transition-colors ${
          note.favorite
            ? "text-jelly-amber"
            : "text-jelly-text-muted hover:text-jelly-text"
        }`}
        onClick={() => toggleNodeFavorite(note.id)}
        aria-pressed={Boolean(note.favorite)}
      >
        <Star size={12} fill={note.favorite ? "currentColor" : "none"} />
        {note.favorite ? "已收藏" : "收藏"}
      </button>
      {tags.map((tag) => (
        <span key={tag} className="inline-flex h-7 items-center gap-1 px-1 text-[12px] text-jelly-blue-deep">
          <Hash size={11} />{tag}
          <button type="button" onClick={() => setNoteTags(note.id, tags.filter((item) => item !== tag))} aria-label={`移除标签 ${tag}`}>
            <X size={11} />
          </button>
        </span>
      ))}
      {tags.length < 12 && (
        <form
          className="document-tag-input flex h-7 items-center border-b border-transparent px-1 focus-within:border-jelly-blue/55"
          onSubmit={(event) => { event.preventDefault(); addTag(); }}
        >
          <Plus size={11} className="text-jelly-text-muted" />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => { if (draft.trim()) addTag(); }}
            className="w-20 bg-transparent px-1 text-[12px] text-jelly-text outline-none placeholder:text-jelly-text-muted"
            placeholder="添加标签"
            aria-label="添加标签"
            maxLength={24}
          />
        </form>
      )}
    </div>
  );
}
