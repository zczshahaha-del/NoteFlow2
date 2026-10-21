import { Lexer, type Token, type Tokens } from "marked";
import { numberHeadings } from "./headingNumbering.ts";
import { searchSnippetText } from "./searchSnippetText.ts";

// Materialize display numbers only in a copy/export. Original Markdown, code,
// inline formatting and line endings remain byte-for-byte unchanged.
export function numberedMarkdown(source: string): string {
  const offsets: number[] = [];
  let normalized = "";
  for (let index = 0; index < source.length; index++) {
    offsets.push(index);
    normalized += source[index] === "\r" ? "\n" : source[index];
    if (source[index] === "\r" && source[index + 1] === "\n") index++;
  }
  const headings: { level: number; text: string; offset: number }[] = [];
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
        headings.push({ level: heading.depth, text: searchSnippetText(`# ${heading.text}`), offset: positions[prefix] });
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
  if (!collect(Lexer.lex(normalized, { gfm: true }), normalized, offsets)) return source;
  let output = source;
  for (const heading of numberHeadings(headings).reverse()) {
    if (heading.displayNumber && heading.offset !== undefined) {
      const prefix = heading.displayNumber + (heading.numberJoinsText ? "" : " ");
      output = output.slice(0, heading.offset) + prefix + output.slice(heading.offset);
    }
  }
  return output;
}
