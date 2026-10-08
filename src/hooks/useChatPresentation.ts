import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "../types";
import { ChatTextPresentation } from "../utils/chatTextPresentation";

export function useChatPresentation(messages: ChatMessage[]) {
  const last = messages[messages.length - 1];
  const target = last?.role === "assistant" ? last : undefined;
  const [visible, setVisible] = useState(() => ({ id: target?.id, text: target?.text ?? "", pending: false }));
  const queue = useRef({ id: target?.id, value: new ChatTextPresentation(target?.text ?? "") });
  const frame = useRef<number | null>(null);
  const reduced = useRef(false);
  const publish = useCallback(() => {
    const next = { id: queue.current.id, text: queue.current.value.text, pending: queue.current.value.pending };
    setVisible(current => current.id === next.id && current.text === next.text && current.pending === next.pending ? current : next);
  }, []);
  const cancelFrame = useCallback(() => {
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);
  const finish = useCallback(() => {
    cancelFrame();
    queue.current.value.finish();
    publish();
  }, [cancelFrame, publish]);

  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onPreference = () => {
      reduced.current = media.matches;
      if (media.matches) finish();
    };
    const onVisibility = () => { if (document.hidden) finish(); };
    onPreference();
    media.addEventListener?.("change", onPreference);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelFrame();
      media.removeEventListener?.("change", onPreference);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [cancelFrame, finish]);

  useLayoutEffect(() => {
    const now = performance.now();
    if (queue.current.id !== target?.id) {
      cancelFrame();
      queue.current = { id: target?.id, value: new ChatTextPresentation("", now) };
    }
    queue.current.value.update(target?.text ?? "", target?.streamState, now);
    if (reduced.current || document.hidden) queue.current.value.finish();
    publish();
    const tick = (time: number) => {
      frame.current = null;
      queue.current.value.step(time);
      publish();
      if (queue.current.value.pending) frame.current = window.requestAnimationFrame(tick);
    };
    if (queue.current.value.pending && frame.current === null) frame.current = window.requestAnimationFrame(tick);
    else if (!queue.current.value.pending) cancelFrame();
  }, [target?.id, target?.text, target?.streamState, cancelFrame, publish]);

  // Never let a previous turn flash into a new turn or over a canonical replacement.
  const text = visible.id === target?.id && target?.text.startsWith(visible.text)
    ? visible.text : target?.streamState === "streaming" || target?.streamState === "completed" ? "" : target?.text ?? "";
  const pending = Boolean(target && target.streamState !== "stopped" && target.streamState !== "failed" && target.text !== text);
  const presented = useMemo(() => {
    if (!target || target.text === text) return messages;
    return messages.map(message => message.id === target.id ? { ...message, text } : message);
  }, [messages, target, text]);
  return { messages: presented, pending, finish };
}
