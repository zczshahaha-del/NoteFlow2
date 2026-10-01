import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./settings-ui.css";

/** Keep closing surfaces mounted long enough for the exit transition. */
export function useSurfacePresence(open: boolean) {
  const [present, setPresent] = useState(open);
  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    const timer = window.setTimeout(() => setPresent(false), 180);
    return () => window.clearTimeout(timer);
  }, [open]);
  return open || present;
}

interface OverlayDialogProps {
  open: boolean;
  onClose: () => void;
  label: string;
  themeMode: "light" | "dark";
  className?: string;
  role?: "dialog" | "alertdialog";
  children: ReactNode;
}

export default function OverlayDialog({ open, onClose, label, themeMode, className = "", role = "dialog", children }: OverlayDialogProps) {
  const present = useSurfacePresence(open);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = overlayRef.current;
    const background = Array.from(document.body.children)
      .filter((node): node is HTMLElement => node instanceof HTMLElement && node !== overlay)
      .map((node) => ({ node, inert: node.inert }));
    const previousOverflow = document.body.style.overflow;
    for (const { node } of background) node.inert = true;
    document.body.style.overflow = "hidden";
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled)'
    ) ?? []).filter((node) => !node.closest('[hidden], [inert], [aria-hidden="true"]'));
    (dialogRef.current?.querySelector<HTMLElement>("[data-dialog-initial-focus]") ?? focusable()[0])?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      } else if (event.key === "Tab") {
        const controls = focusable();
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
          event.preventDefault(); first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      for (const { node, inert } of background) node.inert = inert;
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [open]);

  if (!present) return null;
  return createPortal(
    <div ref={overlayRef} className="nf-settings-system nf-overlay" data-theme={themeMode} data-open={open} inert={!open} aria-hidden={!open || undefined}
      onMouseDown={(event) => { if (open && event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} role={role} aria-modal="true" aria-label={label} className={`nf-dialog ${className}`}>
        {children}
      </section>
    </div>, document.body
  );
}
