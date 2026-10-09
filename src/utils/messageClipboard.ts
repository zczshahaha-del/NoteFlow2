/** User-triggered message copy. Never read the clipboard or report a failed write as success. */
export async function copyMessageText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch { /* Older browsers / denied permissions can still allow a gesture-based copy. */ }

  const active = document.activeElement;
  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const input = active instanceof window.HTMLInputElement || active instanceof window.HTMLTextAreaElement ? active : null;
  const inputSelection = input ? { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection } : null;
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.tabIndex = -1;
  field.dataset.messageCopyFallback = "true";
  Object.assign(field.style, { position: "fixed", left: "-10000px", top: "0", opacity: "0" });
  document.body.appendChild(field);
  try {
    field.select();
    if (typeof document.execCommand !== "function" || !document.execCommand("copy")) {
      throw new Error("复制失败，请重试");
    }
  } finally {
    field.remove();
    // Focus/selection restoration is best effort and must not invalidate a successful copy.
    try {
      if (active instanceof window.HTMLElement && active.isConnected) {
        active.focus({ preventScroll: true });
        if (input && inputSelection?.start != null && inputSelection.end != null) {
          input.setSelectionRange(inputSelection.start, inputSelection.end, inputSelection.direction ?? undefined);
        }
      }
      if (selection && ranges.length) {
        selection.removeAllRanges();
        for (const range of ranges) if (range.commonAncestorContainer.isConnected) selection.addRange(range);
      }
    } catch { /* A selection target may have disappeared during the gesture. */ }
  }
}
