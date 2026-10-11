import { createLowlight } from "lowlight";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import rust from "highlight.js/lib/languages/rust";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export const CODE_LANGUAGES = [
  { value: "auto", label: "自动识别" },
  { value: "plaintext", label: "Plain Text" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "tsx", label: "TSX" },
  { value: "jsx", label: "JSX" },
  { value: "go", label: "Go" },
  { value: "java", label: "Java" },
  { value: "python", label: "Python" },
  { value: "sql", label: "SQL" },
  { value: "bash", label: "Bash" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "markdown", label: "Markdown" },
  { value: "rust", label: "Rust" },
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "csharp", label: "C#" },
  { value: "html", label: "HTML / XML" },
  { value: "css", label: "CSS" },
] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number]["value"];
export type CodeToken = { from: number; to: number; className: string };
type CodeHighlight = { language: Exclude<CodeLanguage, "auto">; tokens: CodeToken[] };

// Import only the supported grammars, not the library's complete language bundle.
const lowlight = createLowlight({ javascript, typescript, go, java, python, sql, bash, json, yaml, markdown, rust, c, cpp, csharp, xml, css });
const grammarNames: Partial<Record<CodeLanguage, string>> = { jsx: "javascript", tsx: "typescript", html: "xml" };
const autoLanguages = ["javascript", "typescript", "go", "java", "python", "sql", "bash", "json", "yaml", "markdown", "rust", "c", "cpp", "csharp", "xml", "css"];
const aliases: Record<string, CodeLanguage> = {
  js: "javascript", ts: "typescript", shell: "bash", sh: "bash", zsh: "bash", py: "python", yml: "yaml", md: "markdown",
  text: "plaintext", plain: "plaintext", txt: "plaintext", "c++": "cpp", "c#": "csharp", cs: "csharp", rs: "rust", xml: "html",
};

export function normalizeCodeLanguage(value: unknown): CodeLanguage {
  if (typeof value !== "string") return "auto";
  const normalized = value.toLowerCase().trim().replace(/^language-/, "");
  const language = aliases[normalized] ?? normalized;
  return CODE_LANGUAGES.some(item => item.value === language) ? language as CodeLanguage : "auto";
}

function inferCodeLanguage(code: string): Exclude<CodeLanguage, "auto"> {
  // A small bounded sample selects the grammar; the chosen grammar parses the
  // entire block. Strong signatures resolve short snippets with tied scores.
  const sample = code.slice(0, 12000).trim();
  if (!sample) return "plaintext";
  if (/^(?:package\s+\w+|func\s+(?:\([^\n]*\)\s*)?\w+\s*\(|(?:var|type)\s+\w+\s+(?:\[\]|struct\b|map\[))/m.test(sample) || /\b(?:gorm\.|db\.(?:Preload|AutoMigrate|Unscoped)\s*\()/.test(sample)) return "go";
  if (/^(?:from\s+[\w.]+\s+import\s|(?:async\s+)?def\s+\w+\s*\(|class\s+\w+(?:\([^\n]*\))?:)/m.test(sample)) return "python";
  if (/^(?:public\s+(?:final\s+)?class\s+\w+)|\bpublic\s+static\s+void\s+main\s*\(/m.test(sample)) return "java";
  if (/^\s*#include\s*[<"](?:iostream|vector|string|memory)[>"]|^\s*(?:using\s+namespace\s+std\b|std::)/m.test(sample)) return "cpp";
  if (/^(?:export\s+)?(?:interface\s+\w+|type\s+\w+\s*=)|^(?:export\s+)?(?:const|let)\s+\w+\s*:\s*\w+/m.test(sample)) return "typescript";
  if (/^(?:(?:export\s+(?:default\s+)?)?(?:const|let|var)\s+\w+\s*=|(?:export\s+)?(?:async\s+)?function\s+\w+\s*\()/m.test(sample)) return "javascript";
  if (/^(?:go\s+(?:get|mod|run|test|build|env)\b|npm\s+|pnpm\s+|yarn\s+|cd\s+|export\s+\w+=)/m.test(sample)) return "bash";
  const tree = lowlight.highlightAuto(sample, { subset: autoLanguages });
  const language = normalizeCodeLanguage(tree.data?.language);
  return language === "auto" ? "plaintext" : language;
}

function tokenClass(classes: string[]): string | undefined {
  if (classes.includes("hljs-comment")) return "token-comment";
  if (classes.includes("hljs-string") || classes.includes("hljs-regexp")) return "token-string";
  if (classes.includes("hljs-number") || classes.includes("hljs-literal")) return "token-number";
  if (classes.includes("hljs-attr") || classes.includes("hljs-attribute") || classes.includes("hljs-property")) return "token-property";
  if (classes.includes("function_") || classes.includes("hljs-function")) return "token-function";
  if (classes.some(name => ["hljs-keyword", "hljs-type", "hljs-built_in", "hljs-name", "hljs-title", "hljs-section"].includes(name))) return "token-keyword";
  if (classes.some(name => ["hljs-operator", "hljs-punctuation", "hljs-selector-tag", "hljs-selector-class", "hljs-selector-id", "hljs-meta", "hljs-bullet"].includes(name))) return "token-operator";
}

type SyntaxTree = ReturnType<typeof lowlight.highlight>;
function rangesFromTree(tree: SyntaxTree, code: string, language: CodeHighlight["language"]): CodeToken[] {
  const tokens: CodeToken[] = [];
  let offset = 0;
  const visit = (node: SyntaxTree["children"][number], inherited?: string) => {
    if (node.type === "text") {
      const to = offset + node.value.length; // ProseMirror uses UTF-16 offsets too.
      if (inherited && to > offset) tokens.push({ from: offset, to, className: inherited });
      offset = to;
    } else if (node.type === "element") {
      const classes = node.properties.className;
      const className = tokenClass(Array.isArray(classes) ? classes.map(String) : []) ?? inherited;
      node.children.forEach(child => visit(child, className));
    }
  };
  tree.children.forEach(child => visit(child));
  // Some grammars mark declarations but not calls or punctuation. Supplement
  // only unstyled gaps, never keywords, strings, comments or other parsed spans.
  if (!["json", "yaml", "markdown", "html", "css"].includes(language)) {
    const gaps: [number, number][] = [];
    let end = 0;
    for (const token of tokens) {
      if (token.from > end) gaps.push([end, token.from]);
      end = token.to;
    }
    if (end < code.length) gaps.push([end, code.length]);
    for (const [from, to] of gaps) {
      for (const match of code.slice(from, to).matchAll(/\b[A-Za-z_$][\w$]*\b|[{}()[\].,;:+\-*/%=!<>|&?]+/g)) {
        const start = from + (match.index ?? 0);
        const stop = start + match[0].length;
        const isName = /^[A-Za-z_$]/.test(match[0]);
        const className = !isName ? "token-operator"
          : /^\s*\(/.test(code.slice(stop, to)) ? "token-function"
          : code[start - 1] === "." ? "token-property" : undefined;
        if (className) tokens.push({ from: start, to: stop, className });
      }
    }
  }
  return tokens.sort((a, b) => a.from - b.from);
}

export function highlightCode(code: string, storedLanguage: unknown): CodeHighlight {
  const requested = normalizeCodeLanguage(storedLanguage);
  const language = requested === "auto" ? inferCodeLanguage(code) : requested;
  if (language === "plaintext" || !code) return { language, tokens: [] };
  const tree = lowlight.highlight(grammarNames[language] ?? language, code);
  return { language, tokens: rangesFromTree(tree, code, language) };
}

// Immutable nodes are shared across selection changes and edits elsewhere.
// Weak keys retain neither old documents nor a global cache of note text.
const nodeHighlights = new WeakMap<ProseMirrorNode, CodeHighlight>();
export function getCodeHighlight(node: ProseMirrorNode): CodeHighlight {
  let result = nodeHighlights.get(node);
  if (!result) {
    result = highlightCode(node.textContent, node.attrs.language);
    nodeHighlights.set(node, result);
  }
  return result;
}
