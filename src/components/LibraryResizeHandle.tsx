import { useEffect, useId, useRef, useState } from "react";

/** Preview only the layout variable while dragging; commit preferences once on release. */
export default function LibraryResizeHandle({ width, maxWidth, onPreview, onCommit, minWidth = 220, resizeEdge = "right", label = "调整目录宽度" }: {
  width: number;
  maxWidth: number;
  onPreview: (width: number, dragging: boolean) => void;
  onCommit: (width: number) => void;
  minWidth?: number;
  resizeEdge?: "left" | "right";
  label?: string;
}) {
  const [value, setValue] = useState(width);
  const hintId = useId();
  const drag = useRef<null | { id: number; x: number; start: number; next: number; node: HTMLDivElement; cursor: string; select: string }>(null);
  const frame = useRef<number | null>(null);
  const callbacks = useRef({ onPreview, onCommit });
  callbacks.current = { onPreview, onCommit };
  const clamp = (next: number) => Math.round(Math.max(minWidth, Math.min(maxWidth, next)));

  const release = () => {
    const current = drag.current;
    drag.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (!current) return null;
    document.body.style.cursor = current.cursor;
    document.body.style.userSelect = current.select;
    if (current.node.hasPointerCapture(current.id)) current.node.releasePointerCapture(current.id);
    return current;
  };
  const finish = (cancel = false) => {
    const current = release();
    if (!current) return;
    const next = cancel ? current.start : current.next;
    setValue(next);
    callbacks.current.onPreview(next, false);
    if (!cancel) callbacks.current.onCommit(next);
  };

  useEffect(() => { setValue(width); }, [width]);
  useEffect(() => {
    const blur = () => finish();
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("blur", blur);
      if (release()) callbacks.current.onPreview(width, false);
    };
  }, [width, maxWidth]);

  return (
    <>
      <div className={`library-resize-handle ${resizeEdge === "left" ? "ai-resize-handle" : ""}`} role="separator" aria-orientation="vertical"
        aria-label={label} aria-describedby={hintId} aria-valuemin={minWidth} aria-valuemax={maxWidth}
        aria-valuenow={value} aria-valuetext={`${value} 像素`} tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0 || drag.current) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { id: event.pointerId, x: event.clientX, start: width, next: width,
            node: event.currentTarget, cursor: document.body.style.cursor, select: document.body.style.userSelect };
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
          callbacks.current.onPreview(width, true);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.id !== event.pointerId) return;
          current.next = clamp(current.start + (event.clientX - current.x) * (resizeEdge === "left" ? -1 : 1));
          if (frame.current === null) frame.current = requestAnimationFrame(() => {
            frame.current = null;
            if (!drag.current) return;
            setValue(drag.current.next);
            callbacks.current.onPreview(drag.current.next, true);
          });
        }}
        onPointerUp={(event) => {
          const current = drag.current;
          if (!current || current.id !== event.pointerId) return;
          // The browser may coalesce the final pointermove; the release itself
          // carries the authoritative end point. Do not commit a stale preview.
          current.next = clamp(current.start + (event.clientX - current.x) * (resizeEdge === "left" ? -1 : 1));
          finish();
        }}
        onPointerCancel={() => finish()}
        onLostPointerCapture={() => finish()}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape" && drag.current) {
            event.preventDefault(); event.stopPropagation(); finish(true); return;
          }
          if (drag.current || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const next = clamp(event.key === "Home" ? minWidth : event.key === "End" ? maxWidth :
            width + (event.key === "ArrowRight" ? 1 : -1) * (resizeEdge === "left" ? -1 : 1) * (event.shiftKey ? 32 : 16));
          setValue(next); callbacks.current.onPreview(next, false); callbacks.current.onCommit(next);
        }}><span aria-hidden="true" /></div>
      <span id={hintId} className="sr-only">拖动调整宽度；左右方向键微调，Home 最窄，End 最宽。拖动时按 Escape 取消。</span>
    </>
  );
}
