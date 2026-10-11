import "./note-entry.css";

export default function NoteOpeningStatus({ error, onRetry }: {
  error?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className="note-opening-status" role={error ? "alert" : "status"}>
      {!error && <span className="note-opening-dot" aria-hidden="true" />}
      <p>{error ? "这篇笔记暂时没能打开" : "正在打开笔记…"}</p>
      {error && onRetry && <button type="button" onClick={onRetry}>再试一次</button>}
    </div>
  );
}
