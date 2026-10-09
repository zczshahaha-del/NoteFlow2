import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyMessageText } from "../utils/messageClipboard";

export default memo(function ChatMessageActions({ text, role, busy, createdAt }: {
  text: string;
  role: "user" | "assistant";
  busy: boolean;
  createdAt?: string | null;
}) {
  const [state, setState] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const request = useRef(0);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const available = Boolean(text.trim()) && !busy;
  const time = useMemo(() => {
    const date = createdAt ? new Date(createdAt) : null;
    if (!date || !Number.isFinite(date.getTime())) return null;
    return { label: `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`,
      full: date.toLocaleString("zh-CN", { hour12: false }) };
  }, [createdAt]);
  useEffect(() => {
    request.current++;
    pending.current = false;
    setState("idle");
    return () => {
      request.current++;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [text, busy]);

  const copy = async () => {
    if (!available || pending.current) return;
    pending.current = true;
    const current = ++request.current;
    if (timer.current !== null) window.clearTimeout(timer.current);
    setState("copying");
    try {
      await copyMessageText(text);
      if (current !== request.current) return;
      setState("copied");
      timer.current = window.setTimeout(() => {
        if (current === request.current) setState("idle");
        timer.current = null;
      }, 1200);
    } catch {
      if (current === request.current) setState("error");
    } finally {
      if (current === request.current) pending.current = false;
    }
  };

  return <div className="nf-chat-message-actions" data-role={role} aria-hidden={!available || undefined}>
    {time && <time className="nf-chat-message-time" dateTime={createdAt!} aria-label={`消息时间 ${time.full}`}>{time.label}</time>}
    <button type="button" className="nf-chat-copy" data-copy-state={state}
      aria-label={role === "user" ? "复制消息" : "复制回复"} aria-busy={state === "copying" || undefined}
      aria-disabled={state === "copying" || undefined} disabled={!available} onClick={() => void copy()}>
      {state === "copied" ? <Check size={14} strokeWidth={1.6} aria-hidden="true" /> : <Copy size={14} strokeWidth={1.6} aria-hidden="true" />}
    </button>
    {state === "error" && <span className="nf-chat-copy-error" role="alert">复制失败，请重试</span>}
    {state === "copied" && <span className="sr-only" role="status">已复制</span>}
  </div>;
});
