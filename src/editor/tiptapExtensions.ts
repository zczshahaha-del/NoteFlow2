import { Mark, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import CodeBlock from "@tiptap/extension-code-block";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const NoteFlowUnderline = Underline.extend({
  parseMarkdown(token, helpers) {
    return helpers.applyMark("underline", helpers.parseInline(token.tokens || []));
  },
  renderMarkdown(node, helpers) {
    return `<u>${helpers.renderChildren(node)}</u>`;
  },
  markdownTokenizer: {
    name: "underline",
    level: "inline",
    start: (source) => source.indexOf("<u>"),
    tokenize(source, _tokens, lexer) {
      const match = /^<u>([\s\S]+?)<\/u>/.exec(source);
      if (!match) return undefined;
      return {
        type: "underline",
        raw: match[0],
        text: match[1],
        tokens: lexer.inlineTokens(match[1]),
      };
    },
  },
});

const NoteFlowHighlight = Highlight.extend({
  parseMarkdown(token, helpers) {
    return helpers.applyMark("highlight", helpers.parseInline(token.tokens || []));
  },
  renderMarkdown(node, helpers) {
    return `<mark>${helpers.renderChildren(node)}</mark>`;
  },
  markdownTokenizer: {
    name: "highlight",
    level: "inline",
    start: (source) => source.indexOf("<mark>"),
    tokenize(source, _tokens, lexer) {
      const match = /^<mark>([\s\S]+?)<\/mark>/.exec(source);
      if (!match) return undefined;
      return {
        type: "highlight",
        raw: match[0],
        text: match[1],
        tokens: lexer.inlineTokens(match[1]),
      };
    },
  },
});

const NoteFlowTextStyle = TextStyle.extend({
  parseMarkdown(token, helpers) {
    return helpers.applyMark("textStyle", helpers.parseInline(token.tokens || []), {
      fontSize: token.fontSize || null,
    });
  },
  renderMarkdown(node, helpers) {
    const fontSize = typeof node.attrs?.fontSize === "string" ? node.attrs.fontSize : "";
    const content = helpers.renderChildren(node);
    return fontSize ? `<span style="font-size: ${fontSize}">${content}</span>` : content;
  },
  markdownTokenizer: {
    name: "textStyle",
    level: "inline",
    start: (source) => source.indexOf("<span"),
    tokenize(source, _tokens, lexer) {
      const match = /^<span\s+style=(?:"([^"]+)"|'([^']+)')>([\s\S]+?)<\/span>/.exec(source);
      if (!match) return undefined;
      const style = match[1] || match[2] || "";
      const fontSize = /(?:^|;)\s*font-size\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim() || null;
      const inner = match[3];
      return {
        type: "textStyle",
        raw: match[0],
        text: inner,
        tokens: lexer.inlineTokens(inner),
        fontSize,
      };
    },
  },
});

const KeyboardKey = Mark.create({
  name: "keyboardKey",
  parseHTML() {
    return [{ tag: "kbd" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["kbd", mergeAttributes(HTMLAttributes), 0];
  },
  parseMarkdown(token, helpers) {
    return helpers.applyMark("keyboardKey", helpers.parseInline(token.tokens || []));
  },
  renderMarkdown(node, helpers) {
    return `<kbd>${helpers.renderChildren(node)}</kbd>`;
  },
  markdownTokenizer: {
    name: "keyboardKey",
    level: "inline",
    start: (source) => source.indexOf("<kbd>"),
    tokenize(source, _tokens, lexer) {
      const match = /^<kbd>([\s\S]+?)<\/kbd>/.exec(source);
      if (!match) return undefined;
      return {
        type: "keyboardKey",
        raw: match[0],
        text: match[1],
        tokens: lexer.inlineTokens(match[1]),
      };
    },
  },
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
let closeActiveCodeLanguageMenu: (() => void) | null = null;

const KEYWORDS: Partial<Record<CodeLanguage, string[]>> = {
  javascript: ["async", "await", "break", "case", "catch", "class", "const", "continue", "default", "else", "export", "for", "from", "function", "if", "import", "let", "new", "return", "switch", "throw", "try", "typeof", "while"],
  typescript: ["async", "await", "break", "case", "catch", "class", "const", "continue", "default", "else", "export", "for", "from", "function", "if", "import", "interface", "let", "new", "return", "switch", "throw", "try", "type", "typeof", "while"],
  tsx: ["async", "await", "className", "const", "export", "from", "function", "import", "interface", "props", "return", "type"],
  jsx: ["async", "await", "className", "const", "export", "from", "function", "import", "props", "return"],
  go: ["break", "case", "const", "context", "defer", "else", "error", "for", "func", "go", "if", "import", "interface", "map", "nil", "package", "range", "return", "select", "struct", "type", "var"],
  java: ["boolean", "break", "case", "catch", "class", "else", "extends", "final", "for", "if", "implements", "import", "new", "private", "public", "return", "static", "throw", "try", "void"],
  python: ["and", "as", "async", "await", "class", "def", "elif", "else", "except", "False", "for", "from", "if", "import", "in", "is", "lambda", "None", "not", "or", "return", "True", "try", "while", "with"],
  sql: ["alter", "and", "as", "by", "create", "delete", "drop", "from", "group", "having", "in", "insert", "into", "join", "left", "limit", "not", "on", "or", "order", "right", "select", "set", "table", "update", "values", "where"],
  bash: ["case", "cd", "do", "done", "echo", "elif", "else", "esac", "export", "fi", "for", "function", "go", "if", "in", "npm", "pnpm", "then", "while", "yarn"],
  json: ["false", "null", "true"],
  yaml: ["false", "null", "true"],
  markdown: ["TODO", "NOTE"],
};

type CodeToken = {
  from: number;
  to: number;
  className: string;
};

function normalizeCodeLanguage(language: string): CodeLanguage {
  const normalized = language.toLowerCase().trim().replace(/^language-/, "");
  const aliases: Record<string, CodeLanguage> = {
    js: "javascript",
    ts: "typescript",
    shell: "bash",
    sh: "bash",
    zsh: "bash",
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

function inferCodeLanguage(code: string): CodeLanguage {
  const text = code.trim();
  if (!text) return "plaintext";
  if (/^(go\s+(get|mod|run|test|build|env)\b|npm\s+|pnpm\s+|yarn\s+|cd\s+|export\s+)/m.test(text)) {
    return "bash";
  }
  if (/\b(package\s+main|func\s+\w+|gorm\.|fmt\.|return\s+nil|var\s+\w+)/.test(text)) {
    return "go";
  }
  if (/\b(select|insert|update|delete|from|where|join|limit)\b/i.test(text)) {
    return "sql";
  }
  if (/^\s*[{[]/.test(text) && /["'][\w-]+["']\s*:/.test(text)) {
    return "json";
  }
  return "plaintext";
}

function createCodeToolbarElement(language: CodeLanguage) {
  const toolbar = document.createElement("div");
  toolbar.className = "code-toolbar";
  toolbar.contentEditable = "false";

  const actions = document.createElement("div");
  actions.className = "code-toolbar-actions";

  const menu = document.createElement("div");
  menu.className = "code-language-menu";

  const languageButton = document.createElement("button");
  languageButton.type = "button";
  languageButton.className = "code-language-trigger";
  languageButton.dataset.languageToggle = "";
  languageButton.setAttribute("aria-label", "选择代码语言");
  languageButton.setAttribute("aria-expanded", "false");
  const languageCurrent = document.createElement("span");
  languageCurrent.className = "code-language-current";
  languageCurrent.textContent = CODE_LANGUAGES.find((item) => item.value === language)?.label ?? "Plain Text";
  const languageArrow = document.createElement("span");
  languageArrow.className = "code-language-arrow";
  languageArrow.setAttribute("aria-hidden", "true");
  languageButton.append(languageCurrent, languageArrow);
  menu.append(languageButton);

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "code-copy-button";
  copyButton.dataset.codeAction = "";
  copyButton.dataset.copyCode = "";
  copyButton.setAttribute("aria-label", "拷贝");

  const copyIcon = document.createElement("span");
  copyIcon.className = "code-copy-icon";
  copyIcon.setAttribute("aria-hidden", "true");

  const copyTooltip = document.createElement("span");
  copyTooltip.className = "code-copy-tooltip";
  copyTooltip.setAttribute("aria-hidden", "true");
  copyTooltip.textContent = "拷贝";
  copyButton.append(copyIcon, copyTooltip);

  actions.append(menu, copyButton);
  toolbar.append(actions);
  return { toolbar, menu, languageButton, languageCurrent, copyButton, copyTooltip };
}

function openCodeLanguageMenu({
  trigger,
  selected,
  onSelect,
  onClose,
}: {
  trigger: HTMLButtonElement;
  selected: CodeLanguage;
  onSelect: (language: CodeLanguage) => void;
  onClose: () => void;
}) {
  closeActiveCodeLanguageMenu?.();

  const popover = document.createElement("div");
  popover.className = "code-language-floating-popover";
  popover.setAttribute("role", "listbox");
  popover.setAttribute("aria-label", "代码语言");

  const searchWrap = document.createElement("div");
  searchWrap.className = "code-language-floating-search-wrap";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "code-language-floating-search";
  search.placeholder = "搜索语言";
  search.setAttribute("aria-label", "搜索代码语言");
  search.spellcheck = false;
  searchWrap.append(search);

  const optionsWrap = document.createElement("div");
  optionsWrap.className = "code-language-floating-options";
  const options = CODE_LANGUAGES.map((item) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = `code-language-floating-option ${item.value === selected ? "is-selected" : ""}`;
    option.dataset.languageOption = item.value;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(item.value === selected));
    option.textContent = item.label;
    optionsWrap.append(option);
    return option;
  });
  const empty = document.createElement("div");
  empty.className = "code-language-floating-empty";
  empty.hidden = true;
  empty.textContent = "没有找到匹配的语言";
  optionsWrap.append(empty);
  popover.append(searchWrap, optionsWrap);
  document.body.append(popover);

  const position = () => {
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(202, window.innerWidth - 24);
    const gap = 7;
    const below = window.innerHeight - rect.bottom - gap - 12;
    const above = rect.top - gap - 12;
    const openAbove = below < 220 && above > below;
    const available = Math.max(150, openAbove ? above : below);
    popover.style.width = `${width}px`;
    popover.style.left = `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`;
    optionsWrap.style.maxHeight = `${Math.max(102, Math.min(228, available - 62))}px`;
    const height = popover.getBoundingClientRect().height;
    popover.style.top = `${openAbove ? Math.max(12, rect.top - height - gap) : rect.bottom + gap}px`;
  };

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    popover.remove();
    document.removeEventListener("mousedown", onOutsideMouseDown, true);
    window.removeEventListener("resize", position);
    window.removeEventListener("scroll", position, true);
    if (closeActiveCodeLanguageMenu === close) closeActiveCodeLanguageMenu = null;
    onClose();
  };
  const onOutsideMouseDown = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (!popover.contains(target) && !trigger.contains(target)) close();
  };

  options.forEach((option) => {
    option.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onSelect(normalizeCodeLanguage(option.dataset.languageOption ?? "plaintext"));
      close();
    });
  });

  const filterOptions = () => {
    const query = search.value.trim().toLowerCase();
    let visibleCount = 0;
    options.forEach((option) => {
      const matches = !query || `${option.dataset.languageOption ?? ""} ${option.textContent ?? ""}`.toLowerCase().includes(query);
      option.hidden = !matches;
      if (matches) visibleCount += 1;
    });
    empty.hidden = visibleCount > 0;
  };
  search.addEventListener("input", filterOptions);
  search.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      trigger.focus();
      return;
    }
    if (event.key !== "Enter") return;
    const firstVisible = options.find((option) => !option.hidden);
    if (!firstVisible) return;
    event.preventDefault();
    firstVisible.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });

  closeActiveCodeLanguageMenu = close;
  position();
  window.addEventListener("resize", position);
  window.addEventListener("scroll", position, true);
  window.setTimeout(() => document.addEventListener("mousedown", onOutsideMouseDown, true), 0);
  window.requestAnimationFrame(() => search.focus());
  return close;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function codeTokenRanges(rawCode: string, language: CodeLanguage): CodeToken[] {
  const keywords = KEYWORDS[language] ?? [];
  const keywordPattern = keywords.length
    ? `\\b(${keywords.map(escapeRegExp).join("|")})\\b`
    : "(?!)";
  const commentPattern =
    language === "sql"
      ? "--[^\\n]*"
      : language === "python" || language === "bash" || language === "yaml"
        ? "#[^\\n]*"
        : "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/";
  const tokenPattern = new RegExp(
    `(${commentPattern})|("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`)|(\\b\\d+(?:\\.\\d+)?\\b)|${keywordPattern}|(\\b[A-Za-z_$][\\w$]*(?=\\s*\\())|(\\.[A-Za-z_$][\\w$]*)|([{}()[\\].,;:+\\-*/%=!<>|&?]+)`,
    "gi"
  );
  const tokens: CodeToken[] = [];
  for (const match of rawCode.matchAll(tokenPattern)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (from === to) continue;
    if (match[1]) {
      tokens.push({ from, to, className: "token-comment" });
    } else if (match[2]) {
      const next = rawCode.slice(to).match(/^\s*:/);
      tokens.push({ from, to, className: next ? "token-key" : "token-string" });
    } else if (match[3]) {
      tokens.push({ from, to, className: "token-number" });
    } else if (match[4]) {
      tokens.push({ from, to, className: "token-keyword" });
    } else if (match[5]) {
      tokens.push({ from, to, className: "token-function" });
    } else if (match[6]) {
      tokens.push({ from, to, className: "token-property" });
    } else {
      tokens.push({ from, to, className: "token-operator" });
    }
  }
  return tokens;
}

const codeHighlightPlugin = new Plugin({
  key: new PluginKey("noteflowCodeHighlight"),
  props: {
    decorations(state) {
      const decorations: Decoration[] = [];
      state.doc.descendants((node: ProseMirrorNode, position: number) => {
        if (node.type.name !== "codeBlock") return;
        const storedLanguage = typeof node.attrs.language === "string" ? node.attrs.language : "";
        const language = normalizeCodeLanguage(storedLanguage || inferCodeLanguage(node.textContent));
        codeTokenRanges(node.textContent, language).forEach((token) => {
          decorations.push(
            Decoration.inline(position + 1 + token.from, position + 1 + token.to, {
              class: token.className,
            })
          );
        });
      });
      return DecorationSet.create(state.doc, decorations);
    },
  },
});

const NoteFlowCodeBlock = CodeBlock.extend({
  renderHTML({ node, HTMLAttributes }) {
    const storedLanguage = typeof node.attrs.language === "string" ? node.attrs.language : "";
    const language = normalizeCodeLanguage(storedLanguage || inferCodeLanguage(node.textContent));
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        class: "code-block",
        "data-language": language,
      }),
      ["pre", { class: "code-pre" }, ["code", { class: `language-${language}` }, 0]],
    ];
  },
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), codeHighlightPlugin];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let currentNode = node;
      let menuClose: (() => void) | null = null;
      let copyResetTimer: number | null = null;
      const initialLanguage = normalizeCodeLanguage(
        (typeof node.attrs.language === "string" ? node.attrs.language : "") || inferCodeLanguage(node.textContent)
      );

      const dom = document.createElement("div");
      dom.className = "code-block";
      dom.dataset.language = initialLanguage;

      const toolbarView = createCodeToolbarElement(initialLanguage);
      const pre = document.createElement("pre");
      pre.className = "code-pre";
      const code = document.createElement("code");
      code.className = `language-${initialLanguage}`;
      code.setAttribute("aria-label", "可编辑代码");
      pre.append(code);
      dom.append(toolbarView.toolbar, pre);

      const syncLanguage = (language: CodeLanguage) => {
        dom.dataset.language = language;
        code.className = `language-${language}`;
        toolbarView.languageCurrent.textContent = CODE_LANGUAGES.find((item) => item.value === language)?.label ?? "Plain Text";
      };

      const closeMenu = () => {
        const close = menuClose;
        menuClose = null;
        close?.();
        toolbarView.menu.classList.remove("is-open");
        toolbarView.languageButton.setAttribute("aria-expanded", "false");
      };

      const selectLanguage = (language: CodeLanguage) => {
        const position = getPos();
        if (typeof position !== "number") return;
        const transaction = editor.view.state.tr.setNodeMarkup(position, undefined, {
          ...currentNode.attrs,
          language,
        });
        editor.view.dispatch(transaction);
        syncLanguage(language);
        closeMenu();
        window.requestAnimationFrame(() => editor.view.focus());
      };

      const showMenu = () => {
        closeMenu();
        toolbarView.menu.classList.add("is-open");
        toolbarView.languageButton.setAttribute("aria-expanded", "true");
        const storedLanguage = typeof currentNode.attrs.language === "string" ? currentNode.attrs.language : "";
        menuClose = openCodeLanguageMenu({
          trigger: toolbarView.languageButton,
          selected: normalizeCodeLanguage(storedLanguage || inferCodeLanguage(currentNode.textContent)),
          onSelect: selectLanguage,
          onClose: () => {
            menuClose = null;
            toolbarView.menu.classList.remove("is-open");
            toolbarView.languageButton.setAttribute("aria-expanded", "false");
          },
        });
      };

      const copyCode = () => {
        const codeText = currentNode.textContent;
        toolbarView.copyButton.setAttribute("aria-label", "已拷贝");
        toolbarView.copyTooltip.textContent = "已拷贝";
        toolbarView.copyButton.classList.add("is-copied");
        if (copyResetTimer !== null) window.clearTimeout(copyResetTimer);
        copyResetTimer = window.setTimeout(() => {
          toolbarView.copyButton.setAttribute("aria-label", "拷贝");
          toolbarView.copyTooltip.textContent = "拷贝";
          toolbarView.copyButton.classList.remove("is-copied");
          copyResetTimer = null;
        }, 1100);
        void navigator.clipboard.writeText(codeText).catch(() => {
          const textarea = document.createElement("textarea");
          textarea.value = codeText;
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand("copy");
          textarea.remove();
        });
      };

      const onToolbarMouseDown = (event: MouseEvent) => {
        const target = event.target;
        if (!(target instanceof Node)) return;

        const element = target instanceof Element ? target : target.parentElement;
        const languageButton = element?.closest("[data-language-toggle]");
        if (languageButton && toolbarView.toolbar.contains(languageButton)) {
          const handledEvent = event as MouseEvent & { __noteFlowCodeToolbarHandled?: boolean };
          if (handledEvent.__noteFlowCodeToolbarHandled) return;
          handledEvent.__noteFlowCodeToolbarHandled = true;
          event.preventDefault();
          event.stopPropagation();
          if (menuClose) {
            closeMenu();
            return;
          }
          showMenu();
          return;
        }

        const copyButton = element?.closest("[data-copy-code]");
        if (copyButton && toolbarView.toolbar.contains(copyButton)) {
          const handledEvent = event as MouseEvent & { __noteFlowCodeToolbarHandled?: boolean };
          if (handledEvent.__noteFlowCodeToolbarHandled) return;
          handledEvent.__noteFlowCodeToolbarHandled = true;
          event.preventDefault();
          event.stopPropagation();
          copyCode();
          return;
        }
      };
      toolbarView.toolbar.addEventListener("mousedown", onToolbarMouseDown, true);

      return {
        dom,
        contentDOM: code,
        update(updatedNode) {
          if (updatedNode.type !== currentNode.type) return false;
          currentNode = updatedNode;
          const storedLanguage = typeof updatedNode.attrs.language === "string" ? updatedNode.attrs.language : "";
          syncLanguage(normalizeCodeLanguage(storedLanguage || inferCodeLanguage(updatedNode.textContent)));
          return true;
        },
        stopEvent(event) {
          const target = event.target;
          return target instanceof Node && toolbarView.toolbar.contains(target);
        },
        ignoreMutation(mutation) {
          return toolbarView.toolbar.contains(mutation.target);
        },
        destroy() {
          toolbarView.toolbar.removeEventListener("mousedown", onToolbarMouseDown, true);
          closeMenu();
          if (copyResetTimer !== null) window.clearTimeout(copyResetTimer);
        },
      };
    };
  },
});

export function createNoteFlowTiptapExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: { openOnClick: false },
      underline: false,
      codeBlock: false,
    }),
    NoteFlowCodeBlock,
    Markdown.configure({
      markedOptions: { gfm: true, breaks: true },
    }),
    NoteFlowUnderline,
    NoteFlowHighlight,
    NoteFlowTextStyle,
    FontSize,
    KeyboardKey,
    TableKit.configure({
      table: { resizable: false },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Image,
  ];
}
