import type { ChatMessage } from "../types";

interface GraphemeSegmenter {
  segment(text: string): Iterable<{ segment: string; index: number }>;
}
const Segmenter = (Intl as unknown as {
  Segmenter?: new (locale?: string, options?: { granularity: "grapheme" }) => GraphemeSegmenter;
}).Segmenter;
const segmenter = Segmenter ? new Segmenter(undefined, { granularity: "grapheme" }) : null;

/** Advance complete glyphs, never half an emoji / surrogate pair. */
export function advanceChatGlyphs(text: string, from: number, count: number): number {
  if (count <= 0) return from;
  const rest = text.slice(from);
  if (segmenter) {
    let end = from;
    for (const item of segmenter.segment(rest)) {
      end = from + item.index + item.segment.length;
      if (--count <= 0) break;
    }
    return end;
  }
  const points = Array.from(rest);
  let consumed = 0;
  for (let index = 0; index < points.length && count > 0; count--) {
    const first = points[index++];
    consumed += first.length;
    const regional = (value: string) => {
      const code = value.codePointAt(0) ?? 0;
      return code >= 0x1f1e6 && code <= 0x1f1ff;
    };
    if (regional(first) && points[index] && regional(points[index])) consumed += points[index++].length;
    while (index < points.length) {
      const next = points[index];
      const code = next.codePointAt(0) ?? 0;
      if (/\p{M}|[\uFE0E\uFE0F]/u.test(next) || code >= 0x1f3fb && code <= 0x1f3ff) {
        consumed += points[index++].length;
      } else if (next === "\u200d" && points[index + 1]) {
        consumed += points[index++].length + points[index++].length;
      } else break;
    }
  }
  return from + consumed;
}

/** Display-only queue. The store always retains the complete received answer. */
export class ChatTextPresentation {
  private target: string;
  private offset: number;
  private lastFrame: number;
  private credit = 0;
  private completionDeadline: number | null = null;

  constructor(text = "", now = 0) {
    this.target = text;
    this.offset = text.length;
    this.lastFrame = now;
  }

  get text(): string { return this.target.slice(0, this.offset); }
  get pending(): boolean { return this.offset < this.target.length; }

  update(text: string, status: ChatMessage["streamState"], now: number): void {
    const wasPending = this.pending;
    const replaced = !text.startsWith(this.target);
    this.target = text;
    if (replaced || status === "stopped" || status === "failed" || !status) {
      this.finish();
      return;
    }
    if (!wasPending) {
      this.lastFrame = now;
      this.credit = 0;
    }
    // A first real glyph immediately replaces the thinking state.
    if (this.offset === 0 && text) this.offset = advanceChatGlyphs(text, 0, 1);
    if (status === "completed" && this.completionDeadline === null) {
      this.completionDeadline = now + 900;
    }
  }

  step(now: number): void {
    if (!this.pending) return;
    if (this.completionDeadline !== null && now >= this.completionDeadline) {
      this.finish();
      return;
    }
    const elapsed = Math.max(0, Math.min(48, now - this.lastFrame)) / 1000;
    this.lastFrame = now;
    const remaining = this.target.length - this.offset;
    // Accelerate when chunks arrive in bursts, instead of building a long tail.
    let speed = Math.max(90, remaining / 0.45);
    if (this.completionDeadline !== null) {
      speed = Math.max(speed, remaining / Math.max(0.016, (this.completionDeadline - now) / 1000));
    }
    this.credit += speed * elapsed;
    const glyphs = Math.floor(this.credit);
    if (!glyphs) return;
    this.credit -= glyphs;
    this.offset = advanceChatGlyphs(this.target, this.offset, glyphs);
  }

  finish(): void {
    this.offset = this.target.length;
    this.credit = 0;
  }
}
