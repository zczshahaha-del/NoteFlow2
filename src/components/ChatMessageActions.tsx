import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy } from "lucide-react";
import { copyMessageText } from "../utils/messageClipboard";
import { formatChatMessageTime } from "../utils/chatMessageTime";

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
  const button = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  const [hint, setHint] = useState<{ left: number; top: number } | null>(null);
  const hintShowTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const hintHideTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const available = Boolean(text.trim()) && !busy;
  const label = role === "user" ? "复制消息" : "复制回复";
  const cancelHintTimers = useCallback(() => {
    if (hintShowTimer.current !== null) window.clearTimeout(hintShowTimer.current);
    if (hintHideTimer.current !== null) window.clearTimeout(hintHideTimer.current);
    hintShowTimer.current = hintHideTimer.current = null;
    document.removeEventListener("scroll", cancelHintTimers, true);
    window.removeEventListener("resize", cancelHintTimers);
    window.removeEventListener("blur", cancelHintTimers);
  }, []);
  const hideHint = useCallback(() => { cancelHintTimers(); setHint(null); }, [cancelHintTimers]);
  const showHint = (delay: number) => {
    cancelHintTimers();
    if (!available || hint) return;
    hintShowTimer.current = window.setTimeout(() => {
      cancelHintTimers();
      const target = button.current;
      if (!target?.isConnected || target.disabled) return;
      const rect = target.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) return;
      const width = 72, height = 30, gap = 8, margin = 8;
      const left = Math.max(margin, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - margin));
      const above = rect.top - height - gap;
      const top = above >= margin ? above : Math.min(rect.bottom + gap, window.innerHeight - height - margin);
      setHint({ left, top });
    }, delay);
    // Cancel pending hints too: scrolling / leaving the window must not open one later.
    document.addEventListener("scroll", cancelHintTimers, true);
    window.addEventListener("resize", cancelHintTimers);
    window.addEventListener("blur", cancelHintTimers);
  };
  const leaveHint = () => {
    cancelHintTimers();
    if (hint) hintHideTimer.current = window.setTimeout(hideHint, 120);
  };
  const time = useMemo(() => formatChatMessageTime(createdAt), [createdAt]);
  useEffect(() => {
    request.current++;
    pending.current = false;
    setState("idle");
    hideHint();
    return () => {
      request.current++;
      cancelHintTimers();
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [text, busy, hideHint, cancelHintTimers]);

  useEffect(() => {
    if (!hint) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) hideHint();
    };
    // Portal hints never clip inside the scroller or remain at stale coordinates.
    document.addEventListener("scroll", hideHint, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", hideHint);
    window.addEventListener("blur", hideHint);
    return () => {
      document.removeEventListener("scroll", hideHint, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", hideHint);
      window.removeEventListener("blur", hideHint);
    };
  }, [hint, hideHint]);

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

  const timeElement = time && <time className="nf-chat-message-time" dateTime={time.dateTime} aria-label={`消息时间 ${time.full}`}>{time.label}</time>;
  return <div className="nf-chat-message-actions" data-role={role} aria-hidden={!available || undefined}>
    {role === "user" && timeElement}
    <button ref={button} type="button" className="nf-chat-copy" data-copy-state={state} data-hint-open={Boolean(hint)}
      aria-label={label} aria-describedby={hint ? hintId : undefined} aria-busy={state === "copying" || undefined}
      onMouseEnter={() => { if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) showHint(300); }}
      onMouseLeave={leaveHint} onBlur={hideHint}
      onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) showHint(0); }}
      aria-disabled={state === "copying" || undefined} disabled={!available} onClick={() => void copy()}>
      {state === "copied" ? <Check size={14} strokeWidth={1.6} aria-hidden="true" /> : <Copy size={14} strokeWidth={1.6} aria-hidden="true" />}
    </button>
    {role === "assistant" && timeElement}
    {state === "error" && <span className="nf-chat-copy-error" role="alert">复制失败，请重试</span>}
    {state === "copied" && <span className="sr-only" role="status">已复制</span>}
    {hint && createPortal(<span id={hintId} role="tooltip" className="nf-chat-copy-tooltip" style={hint}
      onMouseEnter={cancelHintTimers} onMouseLeave={leaveHint}>
      {state === "copied" ? "已复制" : label}
    </span>, document.body)}
  </div>;
});
