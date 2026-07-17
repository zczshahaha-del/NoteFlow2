import { lazy, Suspense, useRef, useEffect, useCallback, useMemo, useState } from "react";
import {
  Bold,
  Calendar,
  Check,
  ChevronDown,
  Code2,
  Eraser,
  Highlighter,
  History,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTree,
  Menu,
  MessageSquarePlus,
  Quote,
  RefreshCw,
  Strikethrough,
  Underline,
} from "lucide-react";
import { Marked } from "marked";
import TurndownService from "turndown";
import { useEditorSlice } from "../storeSlices";
import { findFileById } from "../mockData";
import OutlinePanel from "./OutlinePanel";
import { getNoteOutline, type NoteSectionRecord } from "../services/notes";
import { attachmentMarkdown, uploadAttachment } from "../services/attachments";
import { findNormalizedTextRange } from "../utils/domSelection";
import { formatDocumentTime } from "../utils/documentTime";

const VersionHistoryPanel = lazy(() => import("./VersionHistoryPanel"));

const marked = new Marked({
  breaks: true,
  gfm: true,
});

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

const CODE_LANGUAGES = [
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
] as const;

type CodeLanguage = (typeof CODE_LANGUAGES)[number]["value"];

const BLOCK_OPTIONS = [
  { value: "p", label: "正文" },
  { value: "h1", label: "标题 1" },
  { value: "h2", label: "标题 2" },
  { value: "h3", label: "标题 3" },
  { value: "h4", label: "标题 4" },
] as const;

const FONT_SIZE_OPTIONS = [
  { value: "", label: "字号" },
  { value: "11px", label: "11" },
  { value: "13px", label: "13" },
  { value: "15px", label: "15" },
  { value: "17px", label: "17" },
  { value: "20px", label: "20" },
  { value: "24px", label: "24" },
] as const;

type BlockValue = (typeof BLOCK_OPTIONS)[number]["value"];
type ToolbarPlacement = "above" | "below";
type ToolbarMenu = "block" | "fontSize" | "link" | null;

interface SelectionToolbarState {
  visible: boolean;
  left: number;
  top: number;
  placement: ToolbarPlacement;
  block: BlockValue;
  fontSize: string;
  highlightActive: boolean;
  codeActive: boolean;
}

const KEYWORDS: Partial<Record<CodeLanguage, string[]>> = {
  javascript: ["async", "await", "break", "case", "catch", "class", "const", "continue", "default", "else", "export", "for", "from", "function", "if", "import", "let", "new", "return", "switch", "throw", "try", "typeof", "while"],
  typescript: ["async", "await", "break", "case", "catch", "class", "const", "continue", "default", "else", "export", "for", "from", "function", "if", "import", "interface", "let", "new", "return", "switch", "throw", "try", "type", "typeof", "while"],
  tsx: ["async", "await", "className", "const", "export", "from", "function", "import", "interface", "props", "return", "type"],
  jsx: ["async", "await", "className", "const", "export", "from", "function", "import", "props", "return"],
  go: ["break", "case", "const", "context", "defer", "else", "for", "func", "go", "if", "import", "interface", "map", "package", "range", "return", "select", "struct", "type", "var"],
  java: ["boolean", "break", "case", "catch", "class", "else", "extends", "final", "for", "if", "implements", "import", "new", "private", "public", "return", "static", "throw", "try", "void"],
  python: ["and", "as", "async", "await", "class", "def", "elif", "else", "except", "False", "for", "from", "if", "import", "in", "is", "lambda", "None", "not", "or", "return", "True", "try", "while", "with"],
  sql: ["alter", "and", "as", "by", "create", "delete", "drop", "from", "group", "having", "in", "insert", "into", "join", "left", "limit", "not", "on", "or", "order", "right", "select", "set", "table", "update", "values", "where"],
  bash: ["case", "cd", "do", "done", "echo", "elif", "else", "esac", "export", "fi", "for", "function", "if", "in", "then", "while"],
  json: ["false", "null", "true"],
  yaml: ["false", "null", "true"],
  markdown: ["TODO", "NOTE"],
};

interface HeadingItem {
  level: number;
  text: string;
  id: string;
}

interface RenderedMarkdown {
  html: string;
  headings: HeadingItem[];
}

const RENDER_CACHE_LIMIT = 18;
const renderedMarkdownCache = new Map<string, RenderedMarkdown>();

turndown.addRule("decoratedCodeBlock", {
  filter: (node) =>
    node instanceof HTMLElement && node.classList.contains("code-block"),
  replacement: (_content, node) => {
    if (!(node instanceof HTMLElement)) return "";
    const code = normalizeCodeIndent(node.querySelector("pre code")?.textContent ?? "");
    const language = normalizeCodeLanguage(node.dataset.language ?? "");
    const suffix = code.endsWith("\n") ? "" : "\n";
    return `\n\n\`\`\`${language === "plaintext" ? "" : language}\n${code}${suffix}\`\`\`\n\n`;
  },
});

turndown.addRule("underline", {
  filter: ["u"],
  replacement: (content) => `<u>${content}</u>`,
});

turndown.addRule("strikethrough", {
  filter: (node) =>
    node instanceof HTMLElement &&
    ["DEL", "S", "STRIKE"].includes(node.tagName),
  replacement: (content) => `~~${content}~~`,
});

turndown.addRule("highlight", {
  filter: ["mark"],
  replacement: (content) => `<mark>${content}</mark>`,
});

turndown.addRule("styledSpan", {
  filter: (node) =>
    node instanceof HTMLElement &&
    node.tagName === "SPAN" &&
    Boolean(node.style.fontSize || node.style.color || node.style.backgroundColor),
  replacement: (content, node) => {
    if (!(node instanceof HTMLElement)) return content;
    const style = serializeInlineStyle(node);
    return style ? `<span style="${escapeHtmlAttribute(style)}">${content}</span>` : content;
  },
});

turndown.addRule("keyboardKey", {
  filter: ["kbd"],
  replacement: (content) => `<kbd>${content}</kbd>`,
});

turndown.addRule("taskListItem", {
  filter: (node) =>
    node instanceof HTMLElement &&
    node.tagName === "LI" &&
    Boolean(node.querySelector('input[type="checkbox"]')),
  replacement: (content, node) => {
    if (!(node instanceof HTMLElement)) return content;
    const checkbox = node.querySelector('input[type="checkbox"]');
    const checked =
      checkbox?.hasAttribute("checked") ||
      checkbox?.getAttribute("aria-checked") === "true";
    const normalized = content.replace(/^\s+/, "").replace(/\n/g, "\n  ");
    return `\n- [${checked ? "x" : " "}] ${normalized}`;
  },
});

turndown.addRule("gfmTable", {
  filter: (node) => node instanceof HTMLElement && node.tagName === "TABLE",
  replacement: (_content, node) => {
    if (!(node instanceof HTMLTableElement)) return "";
    const rows = Array.from(node.rows);
    if (rows.length === 0) return "";

    const cellMarkdown = (cell: HTMLTableCellElement) =>
      turndown
        .turndown(cell.innerHTML)
        .trim()
        .replace(/\|/g, "\\|")
        .replace(/\n+/g, "<br>");
    const columnCount = Math.max(...rows.map((row) => row.cells.length), 1);
    const firstCells = Array.from(rows[0].cells);
    const header = Array.from({ length: columnCount }, (_, index) =>
      cellMarkdown(firstCells[index] ?? document.createElement("th"))
    );
    const separator = Array.from({ length: columnCount }, (_, index) => {
      const cell = firstCells[index];
      const align = cell?.getAttribute("align") || cell?.style.textAlign;
      if (align === "center") return ":---:";
      if (align === "right") return "---:";
      return "---";
    });
    const body = rows.slice(1).map((row) => {
      const cells = Array.from(row.cells);
      return Array.from({ length: columnCount }, (_, index) =>
        cellMarkdown(cells[index] ?? document.createElement("td"))
      );
    });
    const markdownRows = [header, separator, ...body]
      .map((cells) => `| ${cells.join(" | ")} |`)
      .join("\n");
    return `\n\n${markdownRows}\n\n`;
  },
});

function makeHeadingId(text: string): string {
  return (
    "h-" +
    text
      .replace(/[^\w一-鿿\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .toLowerCase()
  );
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function isMeaningfulHeading(text: string): boolean {
  const normalized = text.replace(/[#*\-_=~`>\s.。,:：;；|/\\]+/g, "");
  return normalized.length > 0;
}

function addHeadingIds(html: string): string {
  return html.replace(/<(h[1-4])>(.+?)<\/\1>/gi, (_, tag, inner) => {
    const plainText = inner.replace(/<[^>]*>/g, "");
    const id = makeHeadingId(plainText);
    return `<${tag} id="${id}">${inner}</${tag}>`;
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function serializeInlineStyle(node: HTMLElement): string {
  const rules: string[] = [];
  if (node.style.fontSize) rules.push(`font-size: ${node.style.fontSize}`);
  if (node.style.color) rules.push(`color: ${node.style.color}`);
  if (node.style.backgroundColor) {
    rules.push(`background-color: ${node.style.backgroundColor}`);
  }
  return rules.join("; ");
}

function normalizeCodeIndent(code: string): string {
  const hasTrailingNewline = code.endsWith("\n");
  const lines = code.replace(/\t/g, "  ").split("\n");
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  const minIndent = nonEmptyLines.reduce((min, line) => {
    const indent = line.match(/^ */)?.[0].length ?? 0;
    return Math.min(min, indent);
  }, Number.POSITIVE_INFINITY);

  if (!Number.isFinite(minIndent) || minIndent === 0) return code;
  const normalized = lines.map((line) => line.slice(minIndent)).join("\n");
  return hasTrailingNewline && !normalized.endsWith("\n")
    ? `${normalized}\n`
    : normalized;
}

function normalizeCodeLanguage(language: string): CodeLanguage {
  const normalized = language.toLowerCase().replace(/^language-/, "");
  const aliases: Record<string, CodeLanguage> = {
    js: "javascript",
    ts: "typescript",
    shell: "bash",
    sh: "bash",
    py: "python",
    yml: "yaml",
    md: "markdown",
    text: "plaintext",
    plain: "plaintext",
  };
  const value = aliases[normalized] ?? normalized;
  return CODE_LANGUAGES.some((item) => item.value === value)
    ? (value as CodeLanguage)
    : "plaintext";
}

function getLanguageFromCode(code: Element | null): CodeLanguage {
  const className = code?.getAttribute("class") ?? "";
  const match = className.match(/language-([\w-]+)/);
  return normalizeCodeLanguage(match?.[1] ?? "");
}

function highlightCode(rawCode: string, language: CodeLanguage): string {
  const keywords = KEYWORDS[language] ?? [];
  const keywordPattern = keywords.length
    ? `\\b(${keywords.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`
    : "(?!)";
  const commentPattern =
    language === "sql"
      ? "--[^\\n]*"
      : language === "python" || language === "bash" || language === "yaml"
        ? "#[^\\n]*"
        : "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/";
  const tokenPattern = new RegExp(
    `(${commentPattern})|("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\\\`(?:\\\\.|[^\\\`\\\\])*\\\`)|(\\b\\d+(?:\\.\\d+)?\\b)|${keywordPattern}|(\\b[A-Za-z_$][\\w$]*(?=\\s*\\())|(\\.[A-Za-z_$][\\w$]*)|([{}()[\\].,;:+\\-*/%=!<>|&?]+)`,
    "gi"
  );

  let html = "";
  let lastIndex = 0;
  for (const match of rawCode.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    html += escapeHtml(rawCode.slice(lastIndex, index));
    const token = escapeHtml(match[0]);
    if (match[1]) {
      html += `<span class="token-comment">${token}</span>`;
    } else if (match[2]) {
      const next = rawCode.slice(index + match[0].length).match(/^\s*:/);
      html += `<span class="${next ? "token-key" : "token-string"}">${token}</span>`;
    } else if (match[3]) {
      html += `<span class="token-number">${token}</span>`;
    } else if (match[4]) {
      html += `<span class="token-keyword">${token}</span>`;
    } else if (match[5]) {
      html += `<span class="token-function">${token}</span>`;
    } else if (match[6]) {
      html += `<span class="token-property">${token}</span>`;
    } else {
      html += `<span class="token-operator">${token}</span>`;
    }
    lastIndex = index + match[0].length;
  }
  html += escapeHtml(rawCode.slice(lastIndex));
  return html;
}

function languageLabel(language: CodeLanguage): string {
  return CODE_LANGUAGES.find((item) => item.value === language)?.label ?? "Plain Text";
}

function normalizeSourceText(value: string): string {
  return value
    .replace(/[\s#*\-_=~`>.。,:：;；|/\\()\[\]{}]+/g, "")
    .replace(/\.\.\./g, "")
    .toLowerCase();
}

function findSnippetElement(root: HTMLElement, snippet: string, sectionTitle = ""): HTMLElement | null {
  const normalizedSnippet = normalizeSourceText(snippet);
  const normalizedTitle = normalizeSourceText(sectionTitle);
  const withoutTitle = normalizedTitle && normalizedSnippet.startsWith(normalizedTitle)
    ? normalizedSnippet.slice(normalizedTitle.length)
    : normalizedSnippet;
  const probes = [withoutTitle.slice(0, 52), normalizedSnippet.slice(0, 52)]
    .filter((value, index, values) => value.length >= 6 && values.indexOf(value) === index);
  if (!probes.length) return null;
  const candidates = Array.from(
    root.querySelectorAll("p, li, blockquote, h1, h2, h3, h4, td, th")
  ) as HTMLElement[];
  return (
    candidates.find((element) => {
      const text = normalizeSourceText(element.textContent ?? "");
      return probes.some((probe) => text.includes(probe));
    }) ?? null
  );
}

function languageOptions(selected: CodeLanguage): string {
  return CODE_LANGUAGES.map(
    (item) =>
      `<button type="button" class="code-language-option ${item.value === selected ? "is-selected" : ""}" data-code-action data-language-option="${item.value}" aria-selected="${item.value === selected}">${item.label}</button>`
  ).join("");
}

function languageSearchMarkup() {
  return `
    <div class="code-language-search-wrap" data-code-action>
      <input
        type="search"
        class="code-language-search"
        data-code-action
        data-language-search
        placeholder="搜索语言"
        aria-label="搜索代码语言"
        spellcheck="false"
      />
    </div>
  `;
}

function filterCodeLanguageOptions(input: HTMLInputElement) {
  const menu = input.closest(".code-language-menu");
  if (!menu) return;
  const query = input.value.trim().toLowerCase();
  let visibleCount = 0;
  menu.querySelectorAll("[data-language-option]").forEach((option) => {
    if (!(option instanceof HTMLElement)) return;
    const haystack = `${option.dataset.languageOption ?? ""} ${option.textContent ?? ""}`.toLowerCase();
    const isVisible = !query || haystack.includes(query);
    option.hidden = !isVisible;
    if (isVisible) visibleCount += 1;
  });
  const empty = menu.querySelector("[data-language-empty]");
  if (empty instanceof HTMLElement) empty.hidden = visibleCount > 0;
}

function closeCodeLanguageMenus(root: ParentNode, except?: Element | null) {
  root.querySelectorAll(".code-language-menu.is-open").forEach((menu) => {
    if (menu === except) return;
    menu.classList.remove("is-open");
    menu.closest(".code-block")?.classList.remove("is-code-menu-open");
  });
}

function placeCodeCopyTooltip(button: HTMLButtonElement) {
  const rect = button.getBoundingClientRect();
  button.classList.toggle("is-tooltip-below", rect.top < 48);
}

function markCodeCopyHover(root: ParentNode, button: HTMLButtonElement | null) {
  root.querySelectorAll(".code-copy-button.is-hovering-copy").forEach((item) => {
    if (item !== button) item.classList.remove("is-hovering-copy");
  });
  if (!button) return;
  placeCodeCopyTooltip(button);
  button.classList.add("is-hovering-copy");
}

function showCodeToolbar(root: ParentNode, block: HTMLElement | null) {
  root.querySelectorAll(".code-block.is-code-toolbar-visible").forEach((item) => {
    if (item !== block) item.classList.remove("is-code-toolbar-visible");
  });
  block?.classList.add("is-code-toolbar-visible");
}

function hideCodeToolbarIfIdle(block: HTMLElement) {
  if (block.classList.contains("is-code-menu-open")) return;
  block.classList.remove("is-code-toolbar-visible");
}

function hashContent(content: string): string {
  let hash = 0;
  for (let index = 0; index < content.length; index += 1) {
    hash = (hash * 31 + content.charCodeAt(index)) | 0;
  }
  return `${content.length}:${hash >>> 0}`;
}

function rememberRenderedMarkdown(key: string, value: RenderedMarkdown): RenderedMarkdown {
  if (renderedMarkdownCache.has(key)) renderedMarkdownCache.delete(key);
  renderedMarkdownCache.set(key, value);
  if (renderedMarkdownCache.size > RENDER_CACHE_LIMIT) {
    const oldestKey = renderedMarkdownCache.keys().next().value;
    if (oldestKey) renderedMarkdownCache.delete(oldestKey);
  }
  return value;
}

function enhanceCodeBlocks(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;

  template.content.querySelectorAll("pre").forEach((pre) => {
    const code = pre.querySelector("code");
    const language = getLanguageFromCode(code);
    const rawCode = normalizeCodeIndent(code?.textContent ?? "");
    const wrapper = document.createElement("div");
    wrapper.className = "code-block";
    wrapper.dataset.language = language;

    const toolbar = document.createElement("div");
    toolbar.className = "code-toolbar";
    toolbar.contentEditable = "false";
    toolbar.innerHTML = `
      <div class="code-toolbar-left">
        <div class="code-window-dots" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
        <button type="button" class="code-fold-button" data-code-action data-code-fold aria-label="折叠代码块">
          <span></span>
        </button>
      </div>
      <div class="code-toolbar-actions">
        <div class="code-language-menu">
          <button type="button" class="code-language-trigger" data-code-action data-language-toggle aria-label="选择代码语言">
            <span class="code-language-current">${languageLabel(language)}</span>
            <span class="code-language-arrow"></span>
          </button>
          <div class="code-language-popover" role="listbox">
            ${languageSearchMarkup()}
            ${languageOptions(language)}
            <div class="code-language-empty" data-language-empty hidden>没有找到</div>
          </div>
        </div>
        <button type="button" class="code-copy-button" data-code-action data-copy-code aria-label="拷贝">
          <span class="code-copy-icon" aria-hidden="true"></span>
          <span class="code-copy-tooltip" aria-hidden="true">拷贝</span>
        </button>
      </div>
    `;

    const clonedPre = pre.cloneNode(true) as HTMLElement;
    const clonedCode = clonedPre.querySelector("code");
    clonedPre.classList.add("code-pre");
    if (clonedCode) {
      clonedCode.className = `language-${language}`;
      clonedCode.innerHTML = highlightCode(rawCode, language);
    }

    wrapper.append(toolbar, clonedPre);
    pre.replaceWith(wrapper);
  });

  return template.innerHTML;
}

function renderMarkdown(md: string): RenderedMarkdown {
  const cacheKey = hashContent(md);
  const cached = renderedMarkdownCache.get(cacheKey);
  if (cached) {
    renderedMarkdownCache.delete(cacheKey);
    renderedMarkdownCache.set(cacheKey, cached);
    return cached;
  }

  const template = document.createElement("template");
  template.innerHTML = enhanceCodeBlocks(addHeadingIds(marked.parse(md) as string));
  const headings = getRenderedHeadings(template.content);
  return rememberRenderedMarkdown(cacheKey, {
    html: template.innerHTML,
    headings,
  });
}

function getRenderedHeadings(root: ParentNode): HeadingItem[] {
  const seen = new Map<string, number>();
  return Array.from(root.querySelectorAll("h1, h2, h3, h4")).flatMap((heading) => {
    if (!(heading instanceof HTMLElement)) return [];
    if (heading.closest(".code-block")) return [];

    const text = stripInlineMarkdown(heading.textContent ?? "");
    if (!isMeaningfulHeading(text)) return [];

    const level = Number(heading.tagName.slice(1));
    const baseId = makeHeadingId(text);
    const count = seen.get(baseId) ?? 0;
    seen.set(baseId, count + 1);
    const id = count > 0 ? `${baseId}-${count + 1}` : baseId;
    heading.id = id;
    return [{ level, text, id }];
  });
}

function headingsEqual(a: HeadingItem[], b: HeadingItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (item, index) =>
      item.id === b[index].id &&
      item.text === b[index].text &&
      item.level === b[index].level
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

function getRangeElement(range: Range): HTMLElement | null {
  const node = range.startContainer;
  if (node instanceof HTMLElement) return node;
  return node.parentElement;
}

function getSelectionRect(range: Range): DOMRect | null {
  const rect = range.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) return rect;
  return range.getClientRects()[0] ?? null;
}

function getCurrentBlockValue(range: Range, root: HTMLElement): BlockValue {
  let element = getRangeElement(range);
  while (element && element !== root) {
    const tag = element.tagName.toLowerCase();
    if (BLOCK_OPTIONS.some((option) => option.value === tag)) {
      return tag as BlockValue;
    }
    element = element.parentElement;
  }
  return "p";
}

function getCurrentFontSize(range: Range): string {
  const element = getRangeElement(range);
  if (!element) return "";

  const inlineSize = element.closest<HTMLElement>("[style*='font-size']")?.style.fontSize;
  const size = inlineSize || window.getComputedStyle(element).fontSize;
  const roundedSize = Math.round(Number.parseFloat(size));
  const option = FONT_SIZE_OPTIONS.find(
    (item) => item.value && Math.round(Number.parseFloat(item.value)) === roundedSize
  );
  return option?.value ?? "";
}

function selectionBelongsToEditor(selection: Selection, root: HTMLElement): boolean {
  if (selection.rangeCount === 0 || selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  return root.contains(range.commonAncestorContainer);
}

function getBlockLabel(value: BlockValue): string {
  return BLOCK_OPTIONS.find((option) => option.value === value)?.label ?? "正文";
}

function getFontSizeLabel(value: string): string {
  return FONT_SIZE_OPTIONS.find((option) => option.value === value)?.label ?? "字号";
}

function normalizeLinkHref(value: string): string {
  const trimmed = value.trim();
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function getClosestInlineFormat(
  range: Range,
  root: HTMLElement,
  tagName: "mark" | "code"
): HTMLElement | null {
  let element = getRangeElement(range);
  while (element && element !== root) {
    if (element.tagName.toLowerCase() === tagName) return element;
    element = element.parentElement;
  }
  return null;
}

function getIntersectingInlineFormats(
  range: Range,
  root: HTMLElement,
  tagName: "mark" | "code"
): HTMLElement[] {
  return Array.from(root.querySelectorAll(tagName)).filter((element) =>
    range.intersectsNode(element)
  );
}

function unwrapInlineElement(element: HTMLElement): Range | null {
  const parent = element.parentNode;
  if (!parent) return null;

  const movedNodes: Node[] = [];
  while (element.firstChild) {
    const child = element.firstChild;
    movedNodes.push(child);
    parent.insertBefore(child, element);
  }
  element.remove();

  if (movedNodes.length === 0) return null;
  const range = document.createRange();
  range.setStartBefore(movedNodes[0]);
  range.setEndAfter(movedNodes[movedNodes.length - 1]);
  return range;
}

export default function NoteEditor() {
  const {
    selectedFileId,
    fileContents,
    updateFileContent,
    treeData,
    updateNodeName,
    noteSaveState,
    reindexNote,
    pendingSourceFocus,
    clearPendingSourceFocus,
    pendingEditorSelection,
    clearPendingEditorSelection,
    addSelectionToChat,
    setActiveEditorSectionId,
  } = useEditorSlice();
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const savedSelectionRef = useRef<Range | null>(null);
  const selectionAttachTimerRef = useRef<number | null>(null);
  const lastAttachedSelectionRef = useRef("");
  const isInternalUpdate = useRef(false);

  const [activeId, setActiveId] = useState("");
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleFocused, setTitleFocused] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [resumeScrollTop, setResumeScrollTop] = useState(0);
  const [showResumeButton, setShowResumeButton] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [backendSectionCount, setBackendSectionCount] = useState<number | null>(null);
  const [backendSections, setBackendSections] = useState<NoteSectionRecord[]>([]);
  const [openToolbarMenu, setOpenToolbarMenu] = useState<ToolbarMenu>(null);
  const [linkDraft, setLinkDraft] = useState("");
  const [selectionToolbar, setSelectionToolbar] = useState<SelectionToolbarState>({
    visible: false,
    left: 0,
    top: 0,
    placement: "above",
    block: "p",
    fontSize: "",
    highlightActive: false,
    codeActive: false,
  });
  const isMobileEditor = useMediaQuery("(max-width: 767px)");
  const railHeadings = useMemo(
    () => headings.filter((heading) => heading.level <= 2),
    [headings]
  );

  const selectedFile = selectedFileId
    ? findFileById(treeData, selectedFileId)
    : undefined;

  const rawContent = selectedFile
    ? (fileContents[selectedFile.id] ?? selectedFile.content ?? "")
    : "";

  const hideSelectionToolbar = useCallback(() => {
    savedSelectionRef.current = null;
    setOpenToolbarMenu(null);
    setLinkDraft("");
    setSelectionToolbar((prev) =>
      prev.visible ? { ...prev, visible: false } : prev
    );
  }, []);

  const updateSelectionToolbar = useCallback(() => {
    const editor = contentRef.current;
    const activeElement = document.activeElement;
    if (
      activeElement &&
      toolbarRef.current?.contains(activeElement) &&
      savedSelectionRef.current
    ) {
      return;
    }

    const selection = window.getSelection();
    if (!editor || !selection || !selectionBelongsToEditor(selection, editor)) {
      hideSelectionToolbar();
      return;
    }

    const range = selection.getRangeAt(0);
    const selectedText = selection.toString().trim();
    if (selectedText.length >= 2 && selectedFile) {
      if (selectionAttachTimerRef.current !== null) {
        window.clearTimeout(selectionAttachTimerRef.current);
      }
      selectionAttachTimerRef.current = window.setTimeout(() => {
        const latestSelection = window.getSelection();
        const latestText = latestSelection?.toString().trim() ?? "";
        if (
          latestText.length >= 2 &&
          latestText === selectedText &&
          latestText !== lastAttachedSelectionRef.current &&
          contentRef.current &&
          latestSelection &&
          selectionBelongsToEditor(latestSelection, contentRef.current)
        ) {
          lastAttachedSelectionRef.current = latestText;
          addSelectionToChat({
            text: latestText,
            noteId: selectedFile.id,
            noteTitle: titleDraft || selectedFile.name.replace(/\.md$/i, ""),
          });
        }
      }, 260);
    }
    if (getRangeElement(range)?.closest(".code-block")) {
      hideSelectionToolbar();
      return;
    }

    const rect = getSelectionRect(range);
    if (!rect) {
      hideSelectionToolbar();
      return;
    }

    savedSelectionRef.current = range.cloneRange();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const placement: ToolbarPlacement = rect.top < 78 ? "below" : "above";

    setSelectionToolbar({
      visible: true,
      left: clamp(rect.left + rect.width / 2, 16, Math.max(16, viewportWidth - 16)),
      top: placement === "above" ? rect.top - 10 : rect.bottom + 10,
      placement,
      block: getCurrentBlockValue(range, editor),
      fontSize: getCurrentFontSize(range),
      highlightActive: Boolean(getClosestInlineFormat(range, editor, "mark")),
      codeActive: Boolean(getClosestInlineFormat(range, editor, "code")),
    });
  }, [addSelectionToChat, hideSelectionToolbar, selectedFile, titleDraft]);

  useEffect(() => {
    return () => {
      if (selectionAttachTimerRef.current !== null) {
        window.clearTimeout(selectionAttachTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!titleFocused) {
      setTitleDraft(selectedFile?.name.replace(/\.md$/, "") ?? "");
    }
  }, [selectedFile?.id, selectedFile?.name, titleFocused]);

  // Render markdown → HTML
  useEffect(() => {
    if (contentRef.current) {
      if (!isInternalUpdate.current) {
        const rendered = renderMarkdown(rawContent);
        contentRef.current.innerHTML = rendered.html;
        setHeadings((prev) =>
          headingsEqual(prev, rendered.headings) ? prev : rendered.headings
        );
        if (rendered.headings.length === 0) setActiveId("");
        isInternalUpdate.current = false;
        return;
      }

      const nextHeadings = getRenderedHeadings(contentRef.current);
      setHeadings((prev) =>
        headingsEqual(prev, nextHeadings) ? prev : nextHeadings
      );
      if (nextHeadings.length === 0) setActiveId("");
    }
    isInternalUpdate.current = false;
  }, [selectedFileId, rawContent]);

  useEffect(() => {
    setVersionHistoryOpen(false);
    setOutlineOpen(false);
    hideSelectionToolbar();
  }, [selectedFileId, hideSelectionToolbar]);

  useEffect(() => {
    const source = pendingSourceFocus;
    if (!source || !selectedFileId || source.noteId !== selectedFileId || !contentRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      const root = contentRef.current;
      if (!root) return;

      let target: HTMLElement | null = null;
      const sectionTitle = (
        backendSections.find((section) => section.id === source.sectionId)?.title ??
        source.sectionTitle ??
        ""
      ).trim();
      const genericTitle =
        !sectionTitle ||
        sectionTitle.includes("全文") ||
        sectionTitle.includes("选中") ||
        sectionTitle === source.noteTitle;

      if (!genericTitle) {
        const normalizedTitle = normalizeSourceText(sectionTitle);
        const headingElements = Array.from(root.querySelectorAll("h1, h2, h3, h4")) as HTMLElement[];
        target =
          headingElements.find(
            (heading) => normalizeSourceText(heading.textContent ?? "") === normalizedTitle
          ) ??
          headingElements.find((heading) => {
            const text = normalizeSourceText(heading.textContent ?? "");
            return text.includes(normalizedTitle) || normalizedTitle.includes(text);
          }) ??
          null;
      }

      if (!target && source.snippet) {
        target = findSnippetElement(root, source.snippet, sectionTitle);
      }

      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("source-focus-highlight");
        window.setTimeout(() => target?.classList.remove("source-focus-highlight"), 1600);
      } else {
        scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      }
      clearPendingSourceFocus();
    }, 120);

    return () => window.clearTimeout(timer);
  }, [backendSections, clearPendingSourceFocus, headings, pendingSourceFocus, selectedFileId]);

  useEffect(() => {
    const request = pendingEditorSelection;
    if (!request || request.noteId !== selectedFileId || !contentRef.current) return;

    const timer = window.setTimeout(() => {
      const editor = contentRef.current;
      if (!editor) return;

      let range: Range | null = null;
      if (request.mode === "select" && request.markdown.trim()) {
        const rendered = renderMarkdown(request.markdown);
        const template = document.createElement("template");
        template.innerHTML = rendered.html;
        range = findNormalizedTextRange(editor, template.content.textContent ?? "");
      }

      if (!range) {
        range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(true);
      }

      editor.focus({ preventScroll: true });
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      savedSelectionRef.current = range.cloneRange();

      const targetElement =
        (range.startContainer instanceof HTMLElement
          ? range.startContainer
          : range.startContainer.parentElement)?.closest("p, li, blockquote, h1, h2, h3, h4, td, th") ??
        editor;
      if (targetElement instanceof HTMLElement) {
        targetElement.scrollIntoView({ behavior: "smooth", block: "center" });
        targetElement.classList.add("source-focus-highlight");
        window.setTimeout(() => targetElement.classList.remove("source-focus-highlight"), 1600);
      }

      updateSelectionToolbar();
      clearPendingEditorSelection();
    }, 120);

    return () => window.clearTimeout(timer);
  }, [
    clearPendingEditorSelection,
    pendingEditorSelection,
    rawContent,
    selectedFileId,
    updateSelectionToolbar,
  ]);

  useEffect(() => {
    let alive = true;
    setBackendSectionCount(null);
    setBackendSections([]);
    setActiveEditorSectionId(null);
    if (!selectedFileId) return;

    getNoteOutline(selectedFileId)
      .then((outline) => {
        if (alive) {
          setBackendSectionCount(outline.sections.length);
          setBackendSections(outline.sections);
        }
      })
      .catch(() => {
        if (alive) {
          setBackendSectionCount(null);
          setBackendSections([]);
        }
      });

    return () => {
      alive = false;
    };
  }, [selectedFileId, selectedFile?.indexStatus, noteSaveState.status, setActiveEditorSectionId]);

  useEffect(() => {
    const activeHeading = headings.find((heading) => heading.id === activeId);
    if (!activeHeading) {
      setActiveEditorSectionId(null);
      return;
    }
    const normalizedHeading = normalizeSourceText(activeHeading.text);
    const section = backendSections.find(
      (item) => normalizeSourceText(item.title) === normalizedHeading
    );
    setActiveEditorSectionId(section?.id ?? null);
  }, [activeId, backendSections, headings, setActiveEditorSectionId]);

  useEffect(() => {
    if (openToolbarMenu !== "link") return;
    const timer = window.setTimeout(() => linkInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [openToolbarMenu]);

  useEffect(() => {
    const updateSoon = () => window.setTimeout(updateSelectionToolbar, 0);
    const scroller = scrollRef.current;

    document.addEventListener("selectionchange", updateSoon);
    document.addEventListener("mouseup", updateSelectionToolbar);
    document.addEventListener("keyup", updateSelectionToolbar);
    window.addEventListener("resize", updateSelectionToolbar);
    scroller?.addEventListener("scroll", updateSelectionToolbar, { passive: true });

    return () => {
      document.removeEventListener("selectionchange", updateSoon);
      document.removeEventListener("mouseup", updateSelectionToolbar);
      document.removeEventListener("keyup", updateSelectionToolbar);
      window.removeEventListener("resize", updateSelectionToolbar);
      scroller?.removeEventListener("scroll", updateSelectionToolbar);
    };
  }, [selectedFileId, updateSelectionToolbar]);

  // Scroll tracking for active heading
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let saveTimer = 0;

    const handleScroll = () => {
      if (!contentRef.current) return;
      const hs = contentRef.current.querySelectorAll("h1, h2, h3, h4");
      let current = "";
      for (const h of hs) {
        if (h instanceof HTMLElement) {
          const rect = h.getBoundingClientRect();
          const containerRect = el.getBoundingClientRect();
          if (rect.top <= containerRect.top + 80) {
            current = h.id;
          }
        }
      }
      setActiveId(current);
      if (el.scrollTop > 100) setShowResumeButton(false);
      if (selectedFileId && el.scrollTop > 80) {
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(() => {
          try {
            window.localStorage.setItem(
              `noteflow-reading-position:${selectedFileId}`,
              String(Math.round(el.scrollTop))
            );
          } catch {
            // Reading progress is a convenience; storage failure must not affect editing.
          }
        }, 220);
      }
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => {
      window.clearTimeout(saveTimer);
      el.removeEventListener("scroll", handleScroll);
    };
  }, [selectedFileId]);

  useEffect(() => {
    if (!selectedFileId) return;
    let saved = 0;
    try {
      saved = Number(window.localStorage.getItem(`noteflow-reading-position:${selectedFileId}`) || 0);
    } catch {
      saved = 0;
    }
    setResumeScrollTop(Number.isFinite(saved) ? saved : 0);
    setShowResumeButton(saved > 320);
    window.requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0 }));
  }, [selectedFileId]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!contentRef.current) return;
      if (!toolbarRef.current?.contains(event.target as Node)) {
        setOpenToolbarMenu(null);
      }
      if (!contentRef.current.contains(event.target as Node)) {
        closeCodeLanguageMenus(contentRef.current);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const handleInput = useCallback(() => {
    if (!contentRef.current || !selectedFileId) return;
    isInternalUpdate.current = true;
    const md = turndown.turndown(contentRef.current);
    const nextHeadings = getRenderedHeadings(contentRef.current);
    setHeadings((prev) =>
      headingsEqual(prev, nextHeadings) ? prev : nextHeadings
    );
    updateFileContent(selectedFileId, md);
  }, [selectedFileId, updateFileContent]);

  const restoreSavedSelection = useCallback((): boolean => {
    const editor = contentRef.current;
    const range = savedSelectionRef.current;
    if (!editor || !range || !editor.contains(range.commonAncestorContainer)) {
      return false;
    }

    editor.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection) return false;

    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }, []);

  const commitToolbarChange = useCallback(() => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && contentRef.current) {
      const range = selection.getRangeAt(0);
      if (contentRef.current.contains(range.commonAncestorContainer)) {
        savedSelectionRef.current = range.cloneRange();
      }
    }

    handleInput();
    window.requestAnimationFrame(updateSelectionToolbar);
  }, [handleInput, updateSelectionToolbar]);

  const runEditorCommand = useCallback(
    (command: string, value?: string) => {
      if (!restoreSavedSelection()) return;
      document.execCommand(command, false, value);
      commitToolbarChange();
    },
    [commitToolbarChange, restoreSavedSelection]
  );

  const wrapSelectionWithElement = useCallback(
    (tagName: keyof HTMLElementTagNameMap, configure?: (element: HTMLElement) => void) => {
      if (!restoreSavedSelection()) return;

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

      const range = selection.getRangeAt(0);
      const wrapper = document.createElement(tagName);
      configure?.(wrapper);
      wrapper.appendChild(range.extractContents());
      range.insertNode(wrapper);
      range.selectNodeContents(wrapper);

      selection.removeAllRanges();
      selection.addRange(range);
      commitToolbarChange();
    },
    [commitToolbarChange, restoreSavedSelection]
  );

  const toggleSelectionWrapper = useCallback(
    (tagName: "mark" | "code") => {
      if (!restoreSavedSelection()) return;

      const editor = contentRef.current;
      const selection = window.getSelection();
      if (!editor || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return;
      }

      const range = selection.getRangeAt(0);
      const activeElement = getClosestInlineFormat(range, editor, tagName);
      const intersectingElements = activeElement
        ? [activeElement]
        : getIntersectingInlineFormats(range, editor, tagName);

      if (intersectingElements.length > 0) {
        const ranges = intersectingElements
          .filter(
            (element, _index, elements) =>
              !elements.some((other) => other !== element && other.contains(element))
          )
          .map((element) => unwrapInlineElement(element))
          .filter((range): range is Range => Boolean(range));

        const firstRange = ranges[0];
        const lastRange = ranges[ranges.length - 1];
        if (firstRange && lastRange) {
          const nextRange = document.createRange();
          nextRange.setStart(firstRange.startContainer, firstRange.startOffset);
          nextRange.setEnd(lastRange.endContainer, lastRange.endOffset);
          selection.removeAllRanges();
          selection.addRange(nextRange);
          savedSelectionRef.current = nextRange.cloneRange();
        }
        commitToolbarChange();
        return;
      }

      const wrapper = document.createElement(tagName);
      wrapper.appendChild(range.extractContents());
      range.insertNode(wrapper);
      range.selectNodeContents(wrapper);

      selection.removeAllRanges();
      selection.addRange(range);
      commitToolbarChange();
    },
    [commitToolbarChange, restoreSavedSelection]
  );

  const handleBlockChange = useCallback(
    (value: BlockValue) => {
      setOpenToolbarMenu(null);
      runEditorCommand("formatBlock", value);
    },
    [runEditorCommand]
  );

  const handleFontSizeChange = useCallback(
    (value: string) => {
      if (!value) return;
      setOpenToolbarMenu(null);
      wrapSelectionWithElement("span", (element) => {
        element.style.fontSize = value;
      });
    },
    [wrapSelectionWithElement]
  );

  const toggleToolbarMenu = useCallback((menu: Exclude<ToolbarMenu, null>) => {
    setOpenToolbarMenu((current) => (current === menu ? null : menu));
    if (menu === "link") setLinkDraft("");
  }, []);

  const handleAddSelectionToChat = useCallback(() => {
    if (!selectedFile || !restoreSavedSelection()) return;
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";
    if (!text) return;
    addSelectionToChat({
      text,
      noteId: selectedFile.id,
      noteTitle: titleDraft || selectedFile.name.replace(/\.md$/i, ""),
    });
    setOpenToolbarMenu(null);
  }, [addSelectionToChat, restoreSavedSelection, selectedFile, titleDraft]);

  const handleApplyLink = useCallback(
    (event?: React.FormEvent) => {
      event?.preventDefault();
      if (!linkDraft.trim()) return;
      runEditorCommand("createLink", normalizeLinkHref(linkDraft));
      setOpenToolbarMenu(null);
      setLinkDraft("");
    },
    [linkDraft, runEditorCommand]
  );

  const handleCodeBlockClick = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      if (!contentRef.current) return;
      const target = e.target;
      if (!(target instanceof Element)) return;

      const option = target.closest("[data-language-option]");
      if (option instanceof HTMLElement) {
        e.preventDefault();
        const block = option.closest(".code-block");
        const code = block?.querySelector("pre code");
        if (!(block instanceof HTMLElement) || !(code instanceof HTMLElement)) return;

        const language = normalizeCodeLanguage(option.dataset.languageOption ?? "");
        const normalizedCode = normalizeCodeIndent(code.textContent ?? "");
        block.dataset.language = language;
        code.className = `language-${language}`;
        code.innerHTML = highlightCode(normalizedCode, language);
        block.querySelector(".code-language-current")!.textContent = languageLabel(language);
        block.querySelectorAll("[data-language-option]").forEach((item) => {
          const isSelected =
            item instanceof HTMLElement && item.dataset.languageOption === language;
          item.classList.toggle("is-selected", isSelected);
          item.setAttribute("aria-selected", String(isSelected));
        });
        closeCodeLanguageMenus(contentRef.current);
        handleInput();
        return;
      }

      const languageToggle = target.closest("[data-language-toggle]");
      if (languageToggle) {
        e.preventDefault();
        const menu = languageToggle.closest(".code-language-menu");
        if (!(menu instanceof HTMLElement)) return;
        const willOpen = !menu.classList.contains("is-open");
        closeCodeLanguageMenus(contentRef.current, menu);
        menu.classList.toggle("is-open", willOpen);
        menu.closest(".code-block")?.classList.toggle("is-code-menu-open", willOpen);
        if (willOpen) {
          const search = menu.querySelector<HTMLInputElement>("[data-language-search]");
          if (search) {
            search.value = "";
            filterCodeLanguageOptions(search);
          }
        }
        return;
      }

      const copyButton = target.closest("[data-copy-code]");
      if (copyButton instanceof HTMLButtonElement) {
        placeCodeCopyTooltip(copyButton);
        const block = copyButton.closest(".code-block");
        const codeText = block?.querySelector("pre code")?.textContent ?? "";
        try {
          await navigator.clipboard.writeText(codeText);
        } catch {
          const textarea = document.createElement("textarea");
          textarea.value = codeText;
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand("copy");
          textarea.remove();
        }
        copyButton.setAttribute("aria-label", "已拷贝");
        const tooltip = copyButton.querySelector(".code-copy-tooltip");
        if (tooltip) tooltip.textContent = "已拷贝";
        copyButton.classList.add("is-copied");
        window.setTimeout(() => {
          copyButton.setAttribute("aria-label", "拷贝");
          const nextTooltip = copyButton.querySelector(".code-copy-tooltip");
          if (nextTooltip) nextTooltip.textContent = "拷贝";
          copyButton.classList.remove("is-copied");
        }, 1200);
        return;
      }

      const foldButton = target.closest("[data-code-fold]");
      if (foldButton instanceof HTMLElement) {
        e.preventDefault();
        const block = foldButton.closest(".code-block");
        if (!(block instanceof HTMLElement)) return;
        closeCodeLanguageMenus(contentRef.current);
        const collapsed = !block.classList.contains("is-collapsed");
        block.classList.toggle("is-collapsed", collapsed);
        foldButton?.setAttribute("aria-label", collapsed ? "展开代码块" : "折叠代码块");
      } else if (target.closest(".code-toolbar")) {
        return;
      } else {
        closeCodeLanguageMenus(contentRef.current);
      }
    },
    [handleInput]
  );

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const toolbar = target.closest(".document-canvas .note-content .code-toolbar");
      if (!root.contains(target) && !toolbar) return;

      const option = target.closest("[data-language-option]");
      if (option instanceof HTMLElement) {
        event.preventDefault();
        event.stopPropagation();
        const block = option.closest(".code-block");
        const code = block?.querySelector("pre code");
        if (!(block instanceof HTMLElement) || !(code instanceof HTMLElement)) return;

        const language = normalizeCodeLanguage(option.dataset.languageOption ?? "");
        const normalizedCode = normalizeCodeIndent(code.textContent ?? "");
        block.dataset.language = language;
        code.className = `language-${language}`;
        code.innerHTML = highlightCode(normalizedCode, language);
        const current = block.querySelector(".code-language-current");
        if (current) current.textContent = languageLabel(language);
        block.querySelectorAll("[data-language-option]").forEach((item) => {
          const isSelected =
            item instanceof HTMLElement && item.dataset.languageOption === language;
          item.classList.toggle("is-selected", isSelected);
          item.setAttribute("aria-selected", String(isSelected));
        });
        closeCodeLanguageMenus(root);
        handleInput();
        return;
      }

      const languageToggle = target.closest("[data-language-toggle]");
      if (languageToggle) {
        event.preventDefault();
        event.stopPropagation();
        const menu = languageToggle.closest(".code-language-menu");
        if (!(menu instanceof HTMLElement)) return;
        const willOpen = !menu.classList.contains("is-open");
        closeCodeLanguageMenus(root, menu);
        menu.classList.toggle("is-open", willOpen);
        menu.closest(".code-block")?.classList.toggle("is-code-menu-open", willOpen);
        if (willOpen) {
          const search = menu.querySelector<HTMLInputElement>("[data-language-search]");
          if (search) {
            search.value = "";
            filterCodeLanguageOptions(search);
          }
        }
        return;
      }

      const copyButton = target.closest("[data-copy-code]");
      if (copyButton instanceof HTMLButtonElement) {
        event.preventDefault();
        event.stopPropagation();
        void (async () => {
          placeCodeCopyTooltip(copyButton);
          const block = copyButton.closest(".code-block");
          const codeText = block?.querySelector("pre code")?.textContent ?? "";
          try {
            await navigator.clipboard.writeText(codeText);
          } catch {
            const textarea = document.createElement("textarea");
            textarea.value = codeText;
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand("copy");
            textarea.remove();
          }
          copyButton.setAttribute("aria-label", "已拷贝");
          const tooltip = copyButton.querySelector(".code-copy-tooltip");
          if (tooltip) tooltip.textContent = "已拷贝";
          copyButton.classList.add("is-copied");
          window.setTimeout(() => {
            copyButton.setAttribute("aria-label", "拷贝");
            const nextTooltip = copyButton.querySelector(".code-copy-tooltip");
            if (nextTooltip) nextTooltip.textContent = "拷贝";
            copyButton.classList.remove("is-copied");
          }, 1200);
        })();
      }
    };

    document.addEventListener("mousedown", onMouseDown, true);
    return () => document.removeEventListener("mousedown", onMouseDown, true);
  }, [handleInput]);

  const handleCodeBlockPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!contentRef.current || !(target instanceof Element)) return;
    const copyButton = target.closest("[data-copy-code]");
    markCodeCopyHover(
      contentRef.current,
      copyButton instanceof HTMLButtonElement ? copyButton : null
    );
  }, []);

  const handleCodeBlockPointerLeave = useCallback(() => {
    if (contentRef.current) {
      markCodeCopyHover(contentRef.current, null);
    }
  }, []);

  const handleCodeBlockMouseOver = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!contentRef.current || !(target instanceof Element)) return;
    const block = target.closest(".code-block");
    showCodeToolbar(contentRef.current, block instanceof HTMLElement ? block : null);
  }, []);

  const handleCodeBlockMouseOut = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const block = target.closest(".code-block");
    if (!(block instanceof HTMLElement)) return;
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && block.contains(nextTarget)) return;
    hideCodeToolbarIfIdle(block);
  }, []);

  const handleCodeLanguageSearchInput = useCallback((event: React.FormEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.matches("[data-language-search]")) return;
    event.stopPropagation();
    filterCodeLanguageOptions(target);
  }, []);

  const handleCodeLanguageSearchKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.matches("[data-language-search]")) return;
    event.stopPropagation();
    if (event.key !== "Enter") return;
    event.preventDefault();
    const firstVisible = target
      .closest(".code-language-menu")
      ?.querySelector<HTMLElement>("[data-language-option]:not([hidden])");
    firstVisible?.click();
  }, []);

  const looksLikeMarkdown = useCallback((text: string): boolean => {
    return (
      /^#{1,6}\s|[*-]\s|`{1,3}|\[.*\]\(.*\)|^\d+\.\s|\*\*|__/m.test(text)
    );
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = Array.from(e.clipboardData.files);
      if (files.length && selectedFileId) {
        e.preventDefault();
        void Promise.all(files.map((file) => uploadAttachment(file, selectedFileId)))
          .then((items) => {
            const block = items.map(attachmentMarkdown).join("\n\n");
            updateFileContent(selectedFileId, `${rawContent.trimEnd()}\n\n${block}\n`);
          })
          .catch(() => undefined);
        return;
      }
      const plainText = e.clipboardData.getData("text/plain");
      if (!plainText || !looksLikeMarkdown(plainText)) return;

      e.preventDefault();
      const html = renderMarkdown(plainText).html;

      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const fragment = range.createContextualFragment(html);
        range.insertNode(fragment);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }

      handleInput();
    },
    [handleInput, looksLikeMarkdown, rawContent, selectedFileId, updateFileContent]
  );

  const handleAttachmentDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const files = Array.from(event.dataTransfer.files);
      if (!files.length || !selectedFileId) return;
      event.preventDefault();
      void Promise.all(files.map((file) => uploadAttachment(file, selectedFileId)))
        .then((items) => {
          const block = items.map(attachmentMarkdown).join("\n\n");
          updateFileContent(selectedFileId, `${rawContent.trimEnd()}\n\n${block}\n`);
        })
        .catch(() => undefined);
    },
    [rawContent, selectedFileId, updateFileContent]
  );

  const appendAttachmentMarkdown = useCallback(
    (markdown: string) => {
      if (!selectedFileId) return;
      updateFileContent(selectedFileId, `${rawContent.trimEnd()}\n\n${markdown}\n`);
    },
    [rawContent, selectedFileId, updateFileContent]
  );

  const scrollToHeading = useCallback((id: string) => {
    if (!contentRef.current) return;
    const el = contentRef.current.querySelector(`#${CSS.escape(id)}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveId(id);
    }
  }, []);

  const handleTitleChange = useCallback(
    (value: string) => {
      if (!selectedFile) return;
      setTitleDraft(value);
      const normalizedTitle = value.trim() || "未命名笔记";
      updateNodeName(selectedFile.id, `${normalizedTitle}.md`);
    },
    [selectedFile, updateNodeName]
  );

  const saveStatusLabel =
    noteSaveState.status === "unsaved"
      ? "未保存"
      : noteSaveState.status === "saving"
        ? "保存中"
        : noteSaveState.status === "offline"
          ? "离线已保存"
        : noteSaveState.status === "error"
          ? "保存失败"
          : "已保存";
  const saveStatusClass =
    noteSaveState.status === "error"
      ? "text-rose-500"
      : noteSaveState.status === "offline"
        ? "text-jelly-amber"
      : noteSaveState.status === "saving" || noteSaveState.status === "unsaved"
        ? "text-jelly-blue-deep"
        : "text-jelly-text-muted";
  const indexStatus = selectedFile?.indexStatus ?? "pending";
  const indexStatusLabel =
    indexStatus === "indexed"
      ? "已完成"
      : indexStatus === "indexing"
        ? "更新中"
        : indexStatus === "failed"
          ? "失败"
          : indexStatus === "outdated"
            ? "待更新"
            : "待解析";
  const indexStatusClass =
    indexStatus === "failed"
      ? "text-rose-500"
      : indexStatus === "indexed"
        ? "text-jelly-green"
        : "text-jelly-blue-deep";
  const canReindex = indexStatus !== "indexing";
  const createdAtLabel = formatDocumentTime(selectedFile?.createdAt);
  const updatedAtLabel = formatDocumentTime(selectedFile?.updatedAt);

  if (!selectedFile) {
    return (
      <main className="document-empty-state flex min-w-0 flex-1 items-center justify-center bg-white px-8 text-center">
        <div>
          <p className="text-[18px] font-semibold text-jelly-text">选择一篇笔记开始阅读</p>
          <p className="mt-2 text-[13px] text-jelly-text-muted">从左侧目录打开笔记，或新建一篇笔记。</p>
        </div>
      </main>
    );
  }

  return (
    <main className="document-editor document-canvas relative flex min-w-0 flex-1 overflow-hidden bg-white">
      {selectionToolbar.visible && (
        <div
          ref={toolbarRef}
          className={`selection-toolbar is-${selectionToolbar.placement}`}
          style={{
            left: selectionToolbar.left,
            top: selectionToolbar.top,
          }}
          role="toolbar"
          aria-label="选中文本格式工具栏"
          onMouseDown={(event) => {
            const target = event.target as HTMLElement;
            if (!target.closest("input")) event.preventDefault();
          }}
        >
          <div className={`selection-toolbar-dropdown ${openToolbarMenu === "block" ? "is-open" : ""}`}>
            <button
              type="button"
              className="selection-toolbar-trigger selection-toolbar-block-trigger"
              onClick={() => toggleToolbarMenu("block")}
              aria-haspopup="listbox"
              aria-expanded={openToolbarMenu === "block"}
              aria-label="文本样式"
            >
              <span>{getBlockLabel(selectionToolbar.block)}</span>
              <ChevronDown size={14} strokeWidth={2.1} />
            </button>
            {openToolbarMenu === "block" && (
              <div className="selection-toolbar-menu selection-toolbar-block-menu" role="listbox">
                {BLOCK_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`selection-toolbar-option is-${option.value} ${selectionToolbar.block === option.value ? "is-selected" : ""}`}
                    onClick={() => handleBlockChange(option.value)}
                    role="option"
                    aria-selected={selectionToolbar.block === option.value}
                  >
                    <span>{option.label}</span>
                    {selectionToolbar.block === option.value && (
                      <Check size={14} strokeWidth={2.3} />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={`selection-toolbar-dropdown ${openToolbarMenu === "fontSize" ? "is-open" : ""}`}>
            <button
              type="button"
              className="selection-toolbar-trigger selection-toolbar-size-trigger"
              onClick={() => toggleToolbarMenu("fontSize")}
              aria-haspopup="listbox"
              aria-expanded={openToolbarMenu === "fontSize"}
              aria-label="字号"
            >
              <span>{getFontSizeLabel(selectionToolbar.fontSize)}</span>
              <ChevronDown size={14} strokeWidth={2.1} />
            </button>
            {openToolbarMenu === "fontSize" && (
              <div className="selection-toolbar-menu selection-toolbar-size-menu" role="listbox">
                {FONT_SIZE_OPTIONS.filter((option) => option.value).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`selection-toolbar-option ${selectionToolbar.fontSize === option.value ? "is-selected" : ""}`}
                    onClick={() => handleFontSizeChange(option.value)}
                    role="option"
                    aria-selected={selectionToolbar.fontSize === option.value}
                  >
                    <span style={{ fontSize: option.value }}>{option.label}</span>
                    {selectionToolbar.fontSize === option.value && (
                      <Check size={14} strokeWidth={2.3} />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <span className="selection-toolbar-divider" aria-hidden="true" />

          <button
            type="button"
            className="selection-toolbar-button selection-toolbar-button-accent"
            onClick={handleAddSelectionToChat}
            title="加入对话"
            aria-label="加入对话"
          >
            <MessageSquarePlus size={18} strokeWidth={2.1} />
          </button>

          <span className="selection-toolbar-divider" aria-hidden="true" />

          <button type="button" className="selection-toolbar-button" onClick={() => runEditorCommand("bold")} title="加粗" aria-label="加粗">
            <Bold size={18} strokeWidth={2.2} />
          </button>
          <button type="button" className="selection-toolbar-button" onClick={() => runEditorCommand("italic")} title="斜体" aria-label="斜体">
            <Italic size={18} strokeWidth={2.1} />
          </button>
          <button type="button" className="selection-toolbar-button" onClick={() => runEditorCommand("underline")} title="下划线" aria-label="下划线">
            <Underline size={18} strokeWidth={2.1} />
          </button>
          <button type="button" className="selection-toolbar-button" onClick={() => runEditorCommand("strikeThrough")} title="删除线" aria-label="删除线">
            <Strikethrough size={18} strokeWidth={2.1} />
          </button>
          <button
            type="button"
            className={`selection-toolbar-button selection-toolbar-button-accent ${selectionToolbar.highlightActive ? "is-active" : ""}`}
            onClick={() => toggleSelectionWrapper("mark")}
            title={selectionToolbar.highlightActive ? "取消高亮" : "高亮"}
            aria-label={selectionToolbar.highlightActive ? "取消高亮" : "高亮"}
          >
            <Highlighter size={18} strokeWidth={2.1} />
          </button>

          <span className="selection-toolbar-divider" aria-hidden="true" />

          <button
            type="button"
            className={`selection-toolbar-button ${selectionToolbar.codeActive ? "is-active" : ""}`}
            onClick={() => toggleSelectionWrapper("code")}
            title={selectionToolbar.codeActive ? "取消行内代码" : "行内代码"}
            aria-label={selectionToolbar.codeActive ? "取消行内代码" : "行内代码"}
          >
            <Code2 size={18} strokeWidth={2.1} />
          </button>
          <div className={`selection-toolbar-popover-anchor ${openToolbarMenu === "link" ? "is-open" : ""}`}>
            <button
              type="button"
              className="selection-toolbar-button"
              onClick={() => toggleToolbarMenu("link")}
              title="链接"
              aria-label="链接"
              aria-haspopup="dialog"
              aria-expanded={openToolbarMenu === "link"}
            >
              <Link size={18} strokeWidth={2.1} />
            </button>
            {openToolbarMenu === "link" && (
              <div className="selection-link-popover" role="dialog" aria-label="添加链接">
                <form className="selection-link-form" onSubmit={handleApplyLink}>
                  <Link size={15} strokeWidth={2} />
                  <input
                    ref={linkInputRef}
                    value={linkDraft}
                    onChange={(event) => setLinkDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setOpenToolbarMenu(null);
                    }}
                    className="selection-link-input"
                    placeholder="粘贴链接"
                    aria-label="链接地址"
                  />
                  <button type="submit" className="selection-link-submit" disabled={!linkDraft.trim()}>
                    应用
                  </button>
                </form>
              </div>
            )}
          </div>
          <button type="button" className="selection-toolbar-button" onClick={() => runEditorCommand("insertUnorderedList")} title="无序列表" aria-label="无序列表">
            <List size={18} strokeWidth={2.1} />
          </button>
          <button type="button" className="selection-toolbar-button" onClick={() => runEditorCommand("insertOrderedList")} title="有序列表" aria-label="有序列表">
            <ListOrdered size={18} strokeWidth={2.1} />
          </button>
          <button type="button" className="selection-toolbar-button" onClick={() => runEditorCommand("formatBlock", "blockquote")} title="引用" aria-label="引用">
            <Quote size={18} strokeWidth={2.1} />
          </button>
          <button type="button" className="selection-toolbar-button" onClick={() => runEditorCommand("removeFormat")} title="清除格式" aria-label="清除格式">
            <Eraser size={18} strokeWidth={2.1} />
          </button>
        </div>
      )}

      {!isMobileEditor && railHeadings.length > 1 && (
        <nav className="chapter-rail" aria-label="章节快速导航">
          <button
            type="button"
            className="chapter-rail-toc"
            onClick={() => setOutlineOpen(true)}
            aria-label="打开本文目录"
          >
            <ListTree size={15} strokeWidth={1.8} />
            <span>本文目录</span>
          </button>
          <div className="chapter-rail-track">
            {railHeadings.map((heading) => (
              <button
                key={heading.id}
                type="button"
                className={`chapter-rail-item ${activeId === heading.id ? "is-active" : ""}`}
                onClick={() => scrollToHeading(heading.id)}
                title={heading.text}
              >
                <span className="chapter-rail-mark" />
                <span className="chapter-rail-label">{heading.text}</span>
              </button>
            ))}
          </div>
        </nav>
      )}

      {isMobileEditor && !outlineOpen && headings.length > 1 && (
        <button
          type="button"
          className="floating-launcher absolute left-14 top-3 z-40 flex h-10 w-10 items-center justify-center text-jelly-text-soft"
          onClick={() => setOutlineOpen(true)}
          aria-label="打开本文目录"
          title="本文目录"
        >
          <Menu size={18} strokeWidth={1.8} />
        </button>
      )}

      {outlineOpen && (
        <div className="absolute inset-0 z-[65] flex justify-end" role="dialog" aria-modal="true" aria-label="本文目录">
          <button
            type="button"
            className="drawer-backdrop absolute inset-0"
            onClick={() => setOutlineOpen(false)}
            aria-label="关闭本文目录"
          />
          <aside className="drawer-surface relative h-full w-[340px] max-w-[86vw] border-l border-jelly-border shadow-[-18px_0_46px_rgba(15,23,42,0.08)]">
            <OutlinePanel
              headings={headings}
              activeId={activeId}
              onHeadingClick={(id) => {
                scrollToHeading(id);
                setOutlineOpen(false);
              }}
              onClose={() => setOutlineOpen(false)}
            />
          </aside>
        </div>
      )}

      <div ref={scrollRef} className="document-scroll flex-1 overflow-y-auto overflow-x-hidden bg-white">

        <article className="note-page mx-auto max-w-[780px]">
          {/* Title section */}
          <div className="mb-8">
            <input
              value={titleDraft}
              onChange={(event) => handleTitleChange(event.target.value)}
              onFocus={() => setTitleFocused(true)}
              onBlur={() => {
                setTitleFocused(false);
                if (!titleDraft.trim()) handleTitleChange("未命名笔记");
              }}
              className="document-title block w-full border-none bg-transparent px-0 py-1 text-[clamp(2.05rem,4vw,2.7rem)] font-bold leading-tight text-jelly-text outline-none placeholder:text-jelly-text-muted focus:ring-0"
              placeholder="未命名笔记"
              aria-label="文档标题"
            />
            <div className="document-meta-row mt-4 flex flex-wrap items-center gap-2 text-[13px] text-jelly-text-muted">
              {createdAtLabel && (
                <>
                  <span>创建于 {createdAtLabel}</span>
                  {updatedAtLabel && <span>·</span>}
                </>
              )}
              {updatedAtLabel && <span>更新于 {updatedAtLabel}</span>}
            </div>
            {showResumeButton && resumeScrollTop > 0 && (
              <button
                type="button"
                className="continue-reading-button"
                onClick={() => {
                  scrollRef.current?.scrollTo({ top: resumeScrollTop, behavior: "smooth" });
                  setShowResumeButton(false);
                }}
              >
                继续上次阅读
                <span aria-hidden="true">→</span>
              </button>
            )}
          </div>

          {/* Content */}
          <div
            ref={contentRef}
            data-testid="note-editor-content"
            aria-label="笔记正文"
            className="note-content min-h-[56vh] outline-none"
            contentEditable
            suppressContentEditableWarning
            onInput={(event) => {
              const target = event.target;
              if (target instanceof HTMLInputElement && target.matches("[data-language-search]")) return;
              handleInput();
            }}
            onInputCapture={handleCodeLanguageSearchInput}
            onKeyDownCapture={handleCodeLanguageSearchKeyDown}
            onMouseDownCapture={handleCodeBlockClick}
            onPointerMove={handleCodeBlockPointerMove}
            onPointerLeave={handleCodeBlockPointerLeave}
            onMouseOver={handleCodeBlockMouseOver}
            onMouseOut={handleCodeBlockMouseOut}
            onPaste={handlePaste}
            onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
            onDrop={handleAttachmentDrop}
          />
        </article>
      </div>
      {versionHistoryOpen && (
        <Suspense
          fallback={(
            <div className="absolute inset-0 z-[55] flex justify-end">
              <div className="drawer-backdrop absolute inset-0" />
              <div className="drawer-surface relative flex h-full w-[480px] max-w-full items-center justify-center border-l border-jelly-border text-[13px] text-jelly-text-muted">
                正在加载版本历史…
              </div>
            </div>
          )}
        >
          <VersionHistoryPanel
            noteId={selectedFile.id}
            noteTitle={selectedFile.name.replace(/\.md$/i, "")}
            currentContent={rawContent}
            onClose={() => setVersionHistoryOpen(false)}
          />
        </Suspense>
      )}
    </main>
  );
}
