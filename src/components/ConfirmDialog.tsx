import { AlertTriangle, Info, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type ConfirmTone = "danger" | "primary" | "neutral";

interface ConfirmDialogOptions {
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: ConfirmTone;
}

interface ConfirmDialogProps extends ConfirmDialogOptions {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

type ConfirmRequest = ConfirmDialogOptions & {
  resolve: (confirmed: boolean) => void;
};

const toneClassNames: Record<
  ConfirmTone,
  { icon: string; confirm: string; Icon: typeof AlertTriangle }
> = {
  danger: {
    icon: "bg-jelly-red-bg text-jelly-red",
    confirm: "ui-button-danger",
    Icon: AlertTriangle,
  },
  primary: {
    icon: "bg-jelly-blue-pale text-jelly-blue-deep",
    confirm: "bg-jelly-blue text-white hover:brightness-90",
    Icon: Info,
  },
  neutral: {
    icon: "bg-jelly-blue-pale text-jelly-text-soft",
    confirm: "bg-jelly-text text-white hover:bg-jelly-blue-deep",
    Icon: Info,
  },
};

function ConfirmDialog({
  open,
  title,
  description,
  confirmText = "确认",
  cancelText = "取消",
  tone = "primary",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const toneClasses = toneClassNames[tone];
  const Icon = toneClasses.Icon;

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      if (tone === "danger") {
        cancelButtonRef.current?.focus();
        return;
      }
      confirmButtonRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, tone]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-[rgba(20,29,38,0.28)] px-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="panel-surface w-full max-w-[380px] p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${toneClasses.icon}`}>
            <Icon size={18} strokeWidth={1.9} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <h2 id="confirm-dialog-title" className="text-[15px] font-semibold leading-6 text-jelly-text">
                {title}
              </h2>
              <button
                type="button"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-jelly-text-muted transition-colors hover:bg-jelly-blue-pale hover:text-jelly-text"
                onClick={onCancel}
                aria-label="关闭确认弹窗"
              >
                <X size={15} strokeWidth={1.9} />
              </button>
            </div>
            {description && (
              <div className="mt-2 text-[13px] leading-relaxed text-jelly-text-soft">
                {description}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancelButtonRef}
            type="button"
            className="ui-button ui-button-secondary h-9 px-3"
            onClick={onCancel}
          >
            {cancelText}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            className={`ui-button h-9 px-3 ${toneClasses.confirm}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </section>
    </div>
  );
}

export function useConfirmDialog() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const requestRef = useRef<ConfirmRequest | null>(null);

  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  const confirm = useCallback((options: ConfirmDialogOptions) => {
    return new Promise<boolean>((resolve) => {
      setRequest({ ...options, resolve });
    });
  }, []);

  const close = useCallback((confirmed: boolean) => {
    const current = requestRef.current;
    requestRef.current = null;
    setRequest(null);
    current?.resolve(confirmed);
  }, []);

  return {
    confirm,
    confirmDialog: (
      <ConfirmDialog
        open={Boolean(request)}
        title={request?.title ?? ""}
        description={request?.description}
        confirmText={request?.confirmText}
        cancelText={request?.cancelText}
        tone={request?.tone}
        onConfirm={() => close(true)}
        onCancel={() => close(false)}
      />
    ),
  };
}
