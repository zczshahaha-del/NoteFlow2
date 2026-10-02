import { useEffect, useRef, useState, type ComponentProps } from "react";
import "./menu-ui.css";

type SoftMenuProps = ComponentProps<"div"> & {
  open: boolean;
  onClose: () => void;
};

/** Keep only the visual exit mounted; closed contents cannot receive input. */
export default function SoftMenu({ open, onClose, className = "", children, ...props }: SoftMenuProps) {
  const [present, setPresent] = useState(open);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    if (!present) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setPresent(false);
      return;
    }
    const timer = window.setTimeout(() => setPresent(false), 130);
    return () => window.clearTimeout(timer);
  }, [open, present]);

  if (!open && !present) return null;
  return (
    <div {...props} ref={panelRef} className={`nf-soft-menu ${className}`}
      data-open={open} inert={!open} aria-hidden={!open || undefined}
      onClickCapture={(event) => {
        if (!open) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        props.onClickCapture?.(event);
      }}
      onKeyDown={(event) => {
        if (!open) return;
        props.onKeyDown?.(event);
        if (event.defaultPrevented || event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.stopPropagation();
        event.preventDefault();
        panelRef.current?.parentElement?.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')?.focus({ preventScroll: true });
        onClose();
      }}>
      {children}
    </div>
  );
}
