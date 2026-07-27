import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowUpRight, Link2, Loader2, Sparkles, Unlink } from "lucide-react";
import { useEditorSlice, useWorkspaceSlice } from "../store/selectors";
import { getRelatedNotes } from "../services/notes";
import type { ChatSource, FileNode } from "../types";
import { extractWikiLinks, findWikiBacklinks, flattenWikiNotes, normalizeWikiTitle } from "../utils/wikiLinks";

export default function NoteRelationsPanel({ note, content }: { note: FileNode; content: string }) {
  const { treeData, fileContents, setSelectedFileId } = useWorkspaceSlice();
  const { focusChatSource } = useEditorSlice();
  const [related, setRelated] = useState<ChatSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const notes = useMemo(() => flattenWikiNotes(treeData, fileContents), [fileContents, treeData]);
  const title = note.name.replace(/\.md$/i, "");
  const outgoing = useMemo(() => extractWikiLinks(content), [content]);
  const backlinks = useMemo(() => findWikiBacklinks(notes, note.id, title), [note.id, notes, title]);
  const noteByTitle = useMemo(
    () => new Map(notes.map((item) => [normalizeWikiTitle(item.title), item])),
    [notes]
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    void getRelatedNotes(note.id)
      .then((items) => { if (alive) setRelated(items.filter((item) => item.noteId !== note.id).slice(0, 5)); })
      .catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : "相关笔记加载失败"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [note.id, note.tags, note.updatedAt]);

  const openWikiLink = (targetTitle: string) => {
    const target = noteByTitle.get(normalizeWikiTitle(targetTitle));
    if (target) setSelectedFileId(target.node.id);
  };

  return (
    <section className="mt-12 border-t border-jelly-border pt-6" aria-label="笔记关联">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-jelly-text"><Link2 size={15} className="text-jelly-blue-deep" />关联与反向链接</h2>
          <p className="mt-1 text-[12px] text-jelly-text-muted">输入 [[笔记名]] 建立可追踪的双向链接</p>
        </div>
        {loading && <Loader2 size={14} className="animate-spin text-jelly-blue-deep" />}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <RelationGroup title="链接到" empty="正文还没有 Wiki 链接">
          {outgoing.map((link, index) => {
            const resolved = noteByTitle.has(normalizeWikiTitle(link.title));
            return (
              <button key={`${link.raw}-${index}`} type="button" disabled={!resolved} onClick={() => openWikiLink(link.title)} className="group flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-jelly-text-soft hover:bg-jelly-card disabled:cursor-default disabled:opacity-55">
                <span className="truncate">{link.label}</span>{resolved ? <ArrowUpRight size={12} /> : <Unlink size={12} />}
              </button>
            );
          })}
        </RelationGroup>
        <RelationGroup title="反向链接" empty="还没有其他笔记引用本文">
          {backlinks.map((item) => (
            <button key={item.node.id} type="button" onClick={() => setSelectedFileId(item.node.id)} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-jelly-text-soft hover:bg-jelly-card">
              <span className="min-w-0"><span className="block truncate font-medium text-jelly-text">{item.title}</span><span className="block truncate text-[11px] text-jelly-text-muted">{item.path}</span></span><ArrowUpRight size={12} />
            </button>
          ))}
        </RelationGroup>
        <RelationGroup title="智能相关" empty={error || "暂无足够相关内容"} icon={<Sparkles size={12} />}>
          {related.map((source, index) => (
            <button key={`${source.noteId}-${source.sectionId ?? "note"}-${source.chunkId ?? index}-${index}`} type="button" onClick={() => focusChatSource(source)} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-jelly-text-soft hover:bg-jelly-card">
              <span className="min-w-0"><span className="block truncate font-medium text-jelly-text">{source.noteTitle}</span><span className="block truncate text-[11px] text-jelly-text-muted">{source.sectionTitle || source.snippet || "打开相关位置"}</span></span><ArrowUpRight size={12} />
            </button>
          ))}
        </RelationGroup>
      </div>
    </section>
  );
}

function RelationGroup({ title, empty, icon, children }: { title: string; empty: string; icon?: ReactNode; children: ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="min-h-28 rounded-lg border border-jelly-border bg-jelly-surface p-3">
      <h3 className="mb-2 flex items-center gap-1 text-[12px] font-semibold text-jelly-text">{icon}{title}</h3>
      {hasChildren ? children : <p className="px-2 py-3 text-[11px] leading-5 text-jelly-text-muted">{empty}</p>}
    </div>
  );
}
