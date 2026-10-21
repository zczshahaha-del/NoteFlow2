import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { getDocumentOutlineHeadings, type TiptapHeading } from "../editor/documentCache";
import { headingBeforeOffset } from "../utils/outlineNavigation";

/** Cache layout on document/size changes; scrolling only reads scrollTop and
 * binary-searches offsets. Never changes selection, focus, Markdown or history. */
export function useReadingHeading(editor: Editor | null, scroller: HTMLElement | null, headings: TiptapHeading[], documentTitle = "") {
  const [activeId, setActiveId] = useState(headings[0]?.id ?? "");
  const mode = useRef<"reading" | "editing">("reading");
  useEffect(() => {
    if (!editor || editor.isDestroyed || !scroller) return;
    let frame = 0, dirty = true, alive = true;
    const documentNode = editor.state.doc;
    let positions: { id: string; offset: number }[] = [];
    const publish = (id: string) => setActiveId(current => current === id ? current : id);
    const caret = () => {
      if (!editor.isFocused) return;
      mode.current = "editing";
      // Use the same title exclusion as the visible outline, including the
      // latest document before React has rendered a just-typed transaction.
      const current = getDocumentOutlineHeadings(editor.state.doc, documentTitle).filter(heading => !heading.isDocumentTitle);
      // Heading position is before its opening token; selection starts inside it.
      let low = 0, high = current.length - 1;
      if (!current.length) { publish(""); return; }
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (current[mid].position < editor.state.selection.head) low = mid; else high = mid - 1;
      }
      publish(current[low].id);
    };
    const flush = () => {
      frame = 0;
      if (!alive || editor.isDestroyed || editor.state.doc !== documentNode) return;
      // Caret tracking uses document positions, not layout. Defer this batch
      // until reading resumes instead of measuring every heading on each key.
      if (mode.current === "editing" && editor.isFocused) return;
      if (dirty) {
        dirty = false;
        const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
        positions = headings.flatMap(heading => {
          const node = editor.view.nodeDOM(heading.position);
          return node instanceof HTMLElement ? [{ id: heading.id, offset: node.getBoundingClientRect().top - origin }] : [];
        });
      }
      const atBottom = scroller.scrollTop > 0 && scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 2;
      publish(atBottom ? positions[positions.length - 1]?.id ?? "" : headingBeforeOffset(positions, scroller.scrollTop + 48));
    };
    const schedule = () => { if (alive && !frame) frame = requestAnimationFrame(flush); };
    const invalidate = () => { dirty = true; schedule(); };
    const readIntent = () => { mode.current = "reading"; };
    const wheel = (event: WheelEvent) => {
      // Horizontal code/table scrolling is not a new prose reading position.
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) readIntent();
    };
    const pointer = (event: PointerEvent) => {
      // Scrollbar gestures and reading controls, not text selection inside prose.
      if (!(event.target instanceof Element) || !event.target.closest('[contenteditable="true"]')) readIntent();
    };
    const blur = () => { mode.current = "reading"; schedule(); };
    const scroll = () => { if (!editor.isFocused || mode.current === "reading") schedule(); };
    editor.on("focus", caret); editor.on("selectionUpdate", caret); editor.on("update", caret); editor.on("blur", blur);
    scroller.addEventListener("scroll", scroll, { passive: true });
    scroller.addEventListener("wheel", wheel, { passive: true });
    scroller.addEventListener("touchmove", readIntent, { passive: true });
    scroller.addEventListener("pointerdown", pointer, { passive: true });
    window.addEventListener("resize", invalidate);
    scroller.addEventListener("load", invalidate, true);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(invalidate) : null;
    observer?.observe(scroller); observer?.observe(editor.view.dom);
    const page = scroller.querySelector(".note-page"); if (page) observer?.observe(page);
    document.fonts?.addEventListener("loadingdone", invalidate);
    void document.fonts?.ready.then(() => { if (alive) invalidate(); });
    if (mode.current === "editing") caret();
    schedule();
    return () => {
      alive = false; cancelAnimationFrame(frame); observer?.disconnect();
      editor.off("focus", caret); editor.off("selectionUpdate", caret); editor.off("update", caret); editor.off("blur", blur);
      scroller.removeEventListener("scroll", scroll); scroller.removeEventListener("wheel", wheel);
      scroller.removeEventListener("touchmove", readIntent); scroller.removeEventListener("pointerdown", pointer);
      scroller.removeEventListener("load", invalidate, true); window.removeEventListener("resize", invalidate);
      document.fonts?.removeEventListener("loadingdone", invalidate);
    };
  }, [editor, scroller, headings, documentTitle]);
  return activeId;
}
