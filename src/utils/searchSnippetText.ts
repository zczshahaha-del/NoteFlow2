import { Lexer, type Token, type Tokens } from "marked";

function decodeText(value: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, name: string) => {
    if (!name.startsWith("#")) return named[name.toLowerCase()] ?? entity;
    const point = name[1]?.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
  });
}

function fragmentText(value: string): string {
  // Search snippets may begin/end inside a Markdown construct, or have their
  // newlines flattened upstream. Never apply these repairs to actual code tokens.
  return decodeText(value
    .replace(/^(?:\.{3}|…)[^\s)]*\/[^\s)]*\)\s*(?=[-–—]\s)/, "… ")
    .replace(/`{3,}\s*(?:>\s*)?/g, " ")
    .replace(/`+/g, "")
    .replace(/^(\s*(?:\.{3}|…)?\s*)\*\*(?=\S)/, "$1")
    .replace(/\*\*(?=(?:\.{3}|…)?$)/g, ""));
}

function tokensText(tokens: Token[]): string {
  let result = "";
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if (token.type === "text" && !token.tokens && !token.escaped && next?.type === "link" && /^https?:\/\//i.test(next.raw)) {
      // A clipped [label](URL is lexed as plain text followed by an autolink.
      const label = (token.text as string).match(/!?\[([^\]]+)\]\($/);
      if (label) {
        result += fragmentText(token.text.slice(0, label.index)) + tokensText(Lexer.lexInline(label[1]));
        index += 1;
        continue;
      }
      if (token.text.endsWith("[") && next.raw.endsWith("]")) {
        result += fragmentText(token.text.slice(0, -1)) + decodeText(next.text.slice(0, -1));
        index += 1;
        continue;
      }
    }
    switch (token.type) {
      case "space": case "br": case "hr": result += " "; break;
      case "def": case "checkbox": break;
      case "code": result += token.text + " "; break;
      case "codespan": result += token.text; break;
      case "escape": result += decodeText(token.text); break;
      case "html":
        // Return text only; do not create a DOM, fetch images, or render HTML.
        result += decodeText(token.text
          .replace(/<(script|style|iframe|object|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
          .replace(/<\/?(?:p|div|br|li|h[1-6]|tr|section|blockquote)\b[^>]*>/gi, " ")
          .replace(/<[^>]*>/g, ""));
        break;
      case "list": result += (token as Tokens.List).items.map(item => tokensText(item.tokens)).join(" ") + " "; break;
      case "table": {
        const table = token as Tokens.Table;
        result += [table.header, ...table.rows].map(row => row.map(cell => tokensText(cell.tokens)).join(" · ")).join(" ") + " ";
        break;
      }
      default: {
        const children = "tokens" in token ? token.tokens : undefined;
        const text = children ? tokensText(children) : fragmentText("text" in token ? token.text ?? "" : "");
        result += text + (["paragraph", "heading", "blockquote", "list_item"].includes(token.type) ? " " : "");
      }
    }
  }
  return result;
}

/** Display-only preview: never mutate a source, query, or stored Markdown. */
export function searchSnippetText(markdown: string): string {
  return tokensText(Lexer.lex(markdown, { gfm: true })).replace(/\s+/g, " ").trim();
}
