import { Lexer, type Token, type Tokens } from "marked";
import { headingNumberPrefixLength, numberHeadings } from "./headingNumbering.ts";
import { searchSnippetText } from "./searchSnippetText.ts";

// Materialize display numbers only in an export copy. Outside ordinal spans,
// preserve source formatting, code and line endings rather than reserializing.
export function numberedMarkdown(source: string, documentTitle = ""): string {
  const offsets: number[] = [];
  let normalized = "";
  for (let index = 0; index < source.length; index++) {
    offsets.push(index);
    normalized += source[index] === "\r" ? "\n" : source[index];
    if (source[index] === "\r" && source[index + 1] === "\n") index++;
  }
  const headings: { level: number; text: string; offset: number; removals: { from: number; to: number }[] }[] = [];
  const rootTokens = Lexer.lex(normalized, { gfm: true });
  const firstBlock = rootTokens.find(token => token.type !== "space");
  const compare = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const inlineTextSpans = (tokens: Token[], raw: string, offset: number, wrappers: { from: number; to: number; first: number; length: number }[]): { text: string; offset: number; editable: boolean }[] | null => {
    let cursor = 0;
    const spans: { text: string; offset: number; editable: boolean }[] = [];
    for (const token of tokens) {
      const start = raw.indexOf(token.raw, cursor);
      if (start < 0) return null;
      if ("tokens" in token && Array.isArray(token.tokens)) {
        const children = inlineTextSpans(token.tokens, token.raw, offset + start, wrappers);
        if (!children) return null;
        if (children.length) wrappers.push({ from: offset + start, to: offset + start + token.raw.length, first: children[0].offset, length: children.reduce((sum, child) => sum + child.text.length, 0) });
        spans.push(...children);
      } else if (token.type === "html" && /^<\/?(?:u|mark|span|kbd)(?:\s[^>]*)?>$/i.test(token.raw)) {
        // Supported inline style tags contribute no visible heading letters.
        spans.push({ text: "", offset: offset + start, editable: true });
      } else if ("text" in token && typeof token.text === "string") {
        const codeStart = token.type === "codespan" ? token.raw.indexOf(token.text) : -1;
        spans.push({ text: token.text, offset: offset + start + Math.max(0, codeStart), editable: token.type === "text" && token.text === token.raw || codeStart >= 0 });
      } else spans.push({ text: "\ufffc", offset: offset + start, editable: false });
      cursor = start + token.raw.length;
    }
    return spans;
  };
  const unindent = (text: string, map: number[], prefix: (line: string, first: boolean) => number) => {
    let content = "", positions: number[] = [], cursor = 0;
    for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
      const remove = prefix(line, cursor === 0);
      content += line.slice(remove);
      for (let index = cursor + remove; index < cursor + line.length; index++) positions.push(map[index]);
      cursor += line.length;
    }
    return { content, positions };
  };
  const collect = (tokens: Token[], text: string, map: number[]): boolean => {
    let cursor = 0;
    for (const token of tokens) {
      const start = text.indexOf(token.raw, cursor);
      if (start < 0) return false;
      const end = start + token.raw.length;
      const positions = map.slice(start, end);
      if (token.type === "heading") {
        const heading = token as Tokens.Heading;
        const prefix = /^(?: {0,3}#{1,6}[ \t]+| {0,3})/.exec(token.raw)![0].length;
        // Parse as a heading, otherwise “1. 运行” is mistaken for a list and
        // loses its manual number during plain-text extraction.
        const text = searchSnippetText(`# ${heading.text}`);
        if (!text.trim()) { cursor = end; continue; }
        if (token === firstBlock && heading.depth === 1 && documentTitle && compare(text) === compare(documentTitle) && !headingNumberPrefixLength(text)) { cursor = end; continue; }
        const wrappers: { from: number; to: number; first: number; length: number }[] = [];
        const spans = inlineTextSpans(heading.tokens ?? [], heading.raw.slice(prefix), prefix, wrappers);
        if (!spans) return false;
        let remaining = headingNumberPrefixLength(spans.map(span => span.text).join(""));
        const prefixLength = remaining;
        if (headingNumberPrefixLength(text) && !prefixLength) return false;
        let textCursor = 0;
        const textStarts = new Map(spans.map(span => { const start = textCursor; textCursor += span.text.length; return [span.offset, start]; }));
        const removals: { from: number; to: number }[] = [];
        for (const span of spans) {
          if (!remaining) break;
          if (!span.text.length) continue;
          // Unmapped escapes/entities are exported intact, never guessed.
          if (!span.editable) return false;
          const length = Math.min(remaining, span.text.length);
          const from = positions[span.offset], last = positions[span.offset + length - 1];
          if (from === undefined || last === undefined) return false;
          removals.push({ from, to: last + 1 });
          remaining -= length;
        }
        // If an ordinal consumed the whole bold/link/code label, remove its
        // empty wrapper too; leftover **** would become a Markdown rule.
        for (const wrapper of wrappers) {
          if ((textStarts.get(wrapper.first) ?? Infinity) + wrapper.length <= prefixLength) {
            const from = positions[wrapper.from], last = positions[wrapper.to - 1];
            if (from === undefined || last === undefined) return false;
            removals.push({ from, to: last + 1 });
          }
        }
        const merged: { from: number; to: number }[] = [];
        for (const range of removals.sort((a, b) => a.from - b.from)) {
          const last = merged[merged.length - 1];
          if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
          else merged.push({ ...range });
        }
        headings.push({ level: heading.depth, text, offset: positions[prefix], removals: merged });
      } else if (token.type === "blockquote") {
        const inner = unindent(token.raw, positions, line => /^ {0,3}> ?/.exec(line)?.[0].length ?? 0);
        if (!collect((token as Tokens.Blockquote).tokens, inner.content, inner.positions)) return false;
      } else if (token.type === "list") {
        let itemCursor = 0;
        for (const item of (token as Tokens.List).items) {
          const itemStart = token.raw.indexOf(item.raw, itemCursor);
          if (itemStart < 0) return false;
          const indent = /^\s*(?:[-+*]|\d+[.)])[ \t]+/.exec(item.raw)?.[0].length ?? 0;
          const inner = unindent(item.raw, positions.slice(itemStart, itemStart + item.raw.length),
            (line, first) => first ? indent : Math.min(/^ */.exec(line)![0].length, indent));
          if (!collect(item.tokens, inner.content, inner.positions)) return false;
          itemCursor = itemStart + item.raw.length;
        }
      }
      cursor = end;
    }
    return true;
  };
  // Unusual Markdown that cannot be mapped exactly is exported intact.
  if (!collect(rootTokens, normalized, offsets)) return source;
  let output = source;
  const edits = numberHeadings(headings).flatMap(heading => [
    ...heading.removals.map(range => ({ ...range, insert: "" })),
    { from: heading.offset, to: heading.offset, insert: heading.displayNumber + " " },
  ]).sort((a, b) => b.from - a.from || b.to - a.to);
  for (const edit of edits) {
    output = output.slice(0, edit.from) + edit.insert + output.slice(edit.to);
  }
  return output;
}
