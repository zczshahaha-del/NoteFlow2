import { useEffect, useRef, useState, type ReactNode } from "react";

/** Keep the same surface alive through exit and interrupted / reversed transitions. */
export default function LibraryDrawer({ open, onClose, children, resizeHandle, side = "left" }: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  resizeHandle?: ReactNode;
  side?: "left" | "right";
}) {
  const [present, setPresent] = useState(open);
  const [shown, setShown] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let firstFrame = 0;
    let secondFrame = 0;
    let timer = 0;
    if (open) {
      setPresent(true);
      if (reduced) setShown(true);
      else firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => setShown(true));
      });
    } else {
      setShown(false);
      timer = window.setTimeout(() => setPresent(false), reduced ? 0 : 240);
    }
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    const trigger = active instanceof HTMLElement && active !== document.body && active !== document.documentElement ? active : null;
    const overlay = overlayRef.current;
    const background = Array.from(overlay?.parentElement?.children ?? [])
      .filter((node): node is HTMLElement => node instanceof HTMLElement && node !== overlay)
      .map(node => ({ node, inert: node.inert }));
    for (const { node } of background) node.inert = true;
    const frame = requestAnimationFrame(() => {
      surfaceRef.current?.querySelector<HTMLButtonElement>(side === "left" ? 'button[aria-label="收起目录"]' : 'button[aria-label="收起 AI 助手"]')?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      for (const { node, inert } of background) node.inert = inert;
      // The phone launcher is replaced while the drawer is open; return to its new node.
      const returnTarget = trigger?.isConnected ? trigger :
        document.querySelector<HTMLButtonElement>(side === "left" ? 'button[aria-label="打开知识库"], button[aria-label="展开目录"]' : 'button[aria-label="展开 AI 助手"]');
      returnTarget?.focus({ preventScroll: true });
    };
  }, [open, side]);

  if (!open && !present) return null;
  return (
    <div ref={overlayRef} className={`library-drawer ${side === "right" ? "ai-drawer" : ""}`} data-open={open && shown} role="dialog" aria-modal="true"
      aria-label={side === "left" ? "知识库" : "AI 助手"} aria-hidden={!open || undefined} inert={!open}
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || !event.currentTarget.contains(event.target as Node)) return;
        if (event.key === "Escape" && (event.target as HTMLElement).closest('[role="dialog"], [role="alertdialog"]') !== event.currentTarget) return;
        if (event.key === "Escape") {
          event.preventDefault(); event.stopPropagation(); onClose();
        } else if (event.key === "Tab") {
          const controls = Array.from(surfaceRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]'
          ) ?? []).filter(node => !node.closest('[inert], [aria-hidden="true"]') && node.getClientRects().length);
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <button type="button" className="library-drawer-veil" onClick={onClose} aria-label={side === "left" ? "关闭知识库" : "关闭 AI 助手"} tabIndex={-1} />
      <div ref={surfaceRef} className="library-drawer-surface">{children}{open && resizeHandle}</div>
    </div>
  );
}
