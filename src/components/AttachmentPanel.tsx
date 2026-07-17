import { useCallback, useEffect, useRef, useState } from "react";
import { File, Image, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import {
  attachmentMarkdown,
  deleteAttachment,
  listNoteAttachments,
  uploadAttachment,
  type AttachmentRecord,
} from "../services/attachments";

export default function AttachmentPanel({ noteId, onInsert }: { noteId: string; onInsert: (markdown: string) => void }) {
  const [items, setItems] = useState<AttachmentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setItems(await listNoteAttachments(noteId)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "附件加载失败"); }
    finally { setLoading(false); }
  }, [noteId]);

  useEffect(() => { void reload(); }, [reload]);

  const uploadFiles = async (files: File[]) => {
    if (!files.length || uploading) return;
    setUploading(true);
    setError("");
    try {
      for (const file of files) {
        const item = await uploadAttachment(file, noteId);
        onInsert(attachmentMarkdown(item));
        setItems((current) => [item, ...current.filter((value) => value.id !== item.id)]);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "附件上传失败");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (item: AttachmentRecord) => {
    try {
      await deleteAttachment(item.id);
      setItems((current) => current.filter((value) => value.id !== item.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "附件删除失败");
    }
  };

  return (
    <section className="mt-6 rounded-lg border border-jelly-border bg-jelly-surface p-3" aria-label="附件管理">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-jelly-text"><Paperclip size={14} className="text-jelly-blue-deep" />附件</h2>
          <p className="mt-1 text-[11px] text-jelly-text-muted">支持粘贴、拖拽或选择文件，单个最大 10 MB</p>
        </div>
        <button type="button" className="ui-button ui-button-secondary h-8 px-3" onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}上传附件
        </button>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(event) => void uploadFiles(Array.from(event.target.files ?? []))} />
      </div>
      <div
        className="mt-3 rounded-md border border-dashed border-jelly-border px-3 py-3 text-center text-[11px] text-jelly-text-muted transition-colors hover:border-jelly-blue/35"
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
        onDrop={(event) => { event.preventDefault(); void uploadFiles(Array.from(event.dataTransfer.files)); }}
      >
        将图片或文件拖到这里，会上传并插入正文
      </div>
      {error && <p className="mt-2 rounded-md bg-jelly-red-bg px-2 py-1.5 text-[11px] text-jelly-red">{error}</p>}
      {loading ? (
        <p className="mt-3 flex items-center gap-2 text-[11px] text-jelly-text-muted"><Loader2 size={12} className="animate-spin" />加载附件…</p>
      ) : items.length > 0 ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-2 rounded-md border border-jelly-border bg-white px-2 py-2">
              {item.contentType.startsWith("image/") ? <Image size={14} className="text-jelly-blue-deep" /> : <File size={14} className="text-jelly-text-muted" />}
              <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-medium text-jelly-text">{item.fileName}</span><span className="text-[10px] text-jelly-text-muted">{Math.max(1, Math.round(item.size / 1024))} KB</span></span>
              <button type="button" className="flex h-7 w-7 items-center justify-center rounded-md text-jelly-text-muted hover:bg-jelly-red-bg hover:text-jelly-red" onClick={() => void remove(item)} aria-label={`删除附件 ${item.fileName}`}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
