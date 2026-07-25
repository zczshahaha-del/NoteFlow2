import { Marked } from "marked";

const marked = new Marked({
  breaks: true,
  gfm: true,
});

const LANGUAGE_LABELS: Record<string, string> = {
  js: "JavaScript",
  javascript: "JavaScript",
  ts: "TypeScript",
  typescript: "TypeScript",
  tsx: "TSX",
  jsx: "JSX",
  go: "Go",
  java: "Java",
  py: "Python",
  python: "Python",
  sql: "SQL",
  bash: "Bash",
  shell: "Shell",
  sh: "Shell",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  markdown: "Markdown",
  md: "Markdown",
  text: "Plain Text",
};

const CODE_LANGUAGES = [
  ["text", "Plain Text"],
  ["javascript", "JavaScript"],
  ["typescript", "TypeScript"],
  ["tsx", "TSX"],
  ["jsx", "JSX"],
  ["go", "Go"],
  ["java", "Java"],
  ["python", "Python"],
  ["sql", "SQL"],
  ["bash", "Bash"],
  ["json", "JSON"],
  ["yaml", "YAML"],
  ["markdown", "Markdown"],
] as const;

const KEYWORDS: Record<string, string[]> = {
  javascript: ["async", "await", "catch", "class", "const", "else", "export", "for", "from", "function", "if", "import", "let", "new", "return", "throw", "try"],
  typescript: ["async", "await", "catch", "class", "const", "else", "export", "for", "from", "function", "if", "import", "interface", "let", "return", "type"],
  tsx: ["async", "await", "className", "const", "export", "from", "function", "import", "interface", "return", "type"],
  jsx: ["async", "await", "className", "const", "export", "from", "function", "import", "return"],
  go: ["case", "const", "defer", "else", "for", "func", "go", "if", "import", "interface", "map", "package", "range", "return", "struct", "type", "var"],
  java: ["boolean", "catch", "class", "else", "extends", "final", "for", "if", "import", "new", "private", "public", "return", "static", "try", "void"],
  python: ["and", "as", "async", "await", "class", "def", "elif", "else", "except", "False", "for", "from", "if", "import", "in", "None", "return", "True", "try", "while", "with"],
  sql: ["alter", "and", "as", "by", "create", "delete", "drop", "from", "group", "insert", "into", "join", "limit", "order", "select", "table", "update", "values", "where"],
  bash: ["case", "cd", "do", "done", "echo", "elif", "else", "export", "fi", "for", "function", "if", "in", "then", "while"],
  json: ["false", "null", "true"],
  yaml: ["false", "null", "true"],
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeLanguage(language: string): string {
  const normalized = language.toLowerCase().replace(/^language-/, "");
  const aliases: Record<string, string> = {
    js: "javascript",
    ts: "typescript",
    py: "python",
    sh: "bash",
    shell: "bash",
    yml: "yaml",
    md: "markdown",
  };
  return aliases[normalized] ?? (normalized || "text");
}

function languageLabel(language: string): string {
  return LANGUAGE_LABELS[language] ?? (language === "text" ? "Text" : language);
}

function highlightCode(rawCode: string, language: string): string {
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
      html += `<span class="chat-token-comment">${token}</span>`;
    } else if (match[2]) {
      const next = rawCode.slice(index + match[0].length).match(/^\s*:/);
      html += `<span class="${next ? "chat-token-key" : "chat-token-string"}">${token}</span>`;
    } else if (match[3]) {
      html += `<span class="chat-token-number">${token}</span>`;
    } else if (match[4]) {
      html += `<span class="chat-token-keyword">${token}</span>`;
    } else if (match[5]) {
      html += `<span class="chat-token-function">${token}</span>`;
    } else if (match[6]) {
      html += `<span class="chat-token-property">${token}</span>`;
    } else {
      html += `<span class="chat-token-operator">${token}</span>`;
    }
    lastIndex = index + match[0].length;
  }
  html += escapeHtml(rawCode.slice(lastIndex));
  return html;
}

function sanitizeHtml(root: DocumentFragment): void {
  root.querySelectorAll("script, style, iframe, object, embed").forEach((node) => node.remove());
  root.querySelectorAll("*").forEach((node) => {
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on") || value.startsWith("javascript:")) {
        node.removeAttribute(attr.name);
      }
    }
  });
}

function enhanceCodeBlocks(root: DocumentFragment): void {
  root.querySelectorAll("pre").forEach((pre) => {
    const code = pre.querySelector("code");
    const rawCode = code?.textContent ?? "";
    const language = normalizeLanguage(code?.className.match(/language-([\w-]+)/)?.[1] ?? "");

    const wrapper = document.createElement("div");
    wrapper.className = "chat-code-block code-block rendered-code-block";
    wrapper.dataset.language = language;
    const languageOptions = CODE_LANGUAGES.map(
      ([value, label]) =>
        `<button type="button" class="code-language-option ${value === language ? "is-selected" : ""}" data-language-option="${value}" aria-selected="${value === language}">${label}</button>`
    ).join("");
    wrapper.innerHTML = `
      <div class="chat-code-toolbar code-toolbar">
        <div class="code-toolbar-actions">
          <div class="code-language-menu">
            <button type="button" class="code-language-trigger" data-language-toggle aria-label="选择代码语言" aria-expanded="false">
              <span class="code-language-current">${languageLabel(language)}</span>
              <span class="code-language-arrow" aria-hidden="true"></span>
            </button>
            <div class="code-language-popover" role="listbox">${languageOptions}</div>
          </div>
          <button type="button" class="code-copy-button" data-chat-copy data-copy-code aria-label="复制代码">复制</button>
        </div>
      </div>
      <pre class="code-pre"><code class="language-${language}">${highlightCode(rawCode, language)}</code></pre>
    `;

    pre.replaceWith(wrapper);
  });
}

function enhanceCitations(root: DocumentFragment, validCitationCount = 0): void {
  const citationPattern =
    /(?:【\s*来源\s*(\d+)\s*】|\[\s*来源\s*(\d+)\s*\]|（\s*来源\s*(\d+)\s*）|\(\s*来源\s*(\d+)\s*\)|【\s*(\d+)\s*】|\[\s*(\d+)\s*\])/gu;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const parent = node.parentElement;
    if (!parent) continue;
    if (parent.closest("pre, code, a, button, .chat-code-block")) continue;
    if (!citationPattern.test(node.textContent ?? "")) continue;
    citationPattern.lastIndex = 0;
    textNodes.push(node as Text);
  }

  textNodes.forEach((node) => {
    const text = node.textContent ?? "";
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    citationPattern.lastIndex = 0;

    for (const match of text.matchAll(citationPattern)) {
      const index = match.index ?? 0;
      if (index > lastIndex) {
        fragment.append(document.createTextNode(text.slice(lastIndex, index)));
      }
      const sourceIndex = match.slice(1).find(Boolean) ?? "";
      const numericIndex = Number(sourceIndex);
      if (!Number.isInteger(numericIndex) || numericIndex < 1 || numericIndex > validCitationCount) {
        fragment.append(document.createTextNode(match[0]));
        lastIndex = index + match[0].length;
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chat-citation";
      button.dataset.chatCitation = sourceIndex;
      button.textContent = sourceIndex;
      button.setAttribute("aria-label", `查看引用 ${sourceIndex}`);
      fragment.append(button);
      lastIndex = index + match[0].length;
    }

    if (lastIndex < text.length) {
      fragment.append(document.createTextNode(text.slice(lastIndex)));
    }
    node.replaceWith(fragment);
  });
}

export function renderChatMarkdown(markdown: string, validCitationCount = 0): string {
  const template = document.createElement("template");
  template.innerHTML = marked.parse(markdown || "") as string;
  sanitizeHtml(template.content);
  enhanceCodeBlocks(template.content);
  enhanceCitations(template.content, validCitationCount);
  return template.innerHTML;
}

function closeRenderedCodeMenus(root: ParentNode, except?: Element | null): void {
  root.querySelectorAll(".code-language-menu.is-open").forEach((menu) => {
    if (menu === except) return;
    menu.classList.remove("is-open");
    menu.querySelector("[data-language-toggle]")?.setAttribute("aria-expanded", "false");
  });
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

/** Shared interaction for Markdown rendered in drafts and chat messages. */
export async function handleRenderedCodeBlockAction(
  target: EventTarget | null,
  root: ParentNode = document
): Promise<boolean> {
  if (!(target instanceof Element)) return false;

  const languageOption = target.closest("[data-language-option]");
  if (languageOption instanceof HTMLElement) {
    const block = languageOption.closest(".rendered-code-block");
    const code = block?.querySelector("pre code");
    if (!(block instanceof HTMLElement) || !(code instanceof HTMLElement)) return false;
    const language = normalizeLanguage(languageOption.dataset.languageOption ?? "text");
    const rawCode = code.textContent ?? "";
    block.dataset.language = language;
    code.className = `language-${language}`;
    code.innerHTML = highlightCode(rawCode, language);
    block.querySelector(".code-language-current")!.textContent = languageLabel(language);
    block.querySelectorAll("[data-language-option]").forEach((option) => {
      const selected = option instanceof HTMLElement && option.dataset.languageOption === language;
      option.classList.toggle("is-selected", selected);
      option.setAttribute("aria-selected", String(selected));
    });
    closeRenderedCodeMenus(root);
    return true;
  }

  const languageToggle = target.closest("[data-language-toggle]");
  if (languageToggle instanceof HTMLElement) {
    const menu = languageToggle.closest(".code-language-menu");
    if (!(menu instanceof HTMLElement)) return false;
    const willOpen = !menu.classList.contains("is-open");
    closeRenderedCodeMenus(root, menu);
    menu.classList.toggle("is-open", willOpen);
    languageToggle.setAttribute("aria-expanded", String(willOpen));
    return true;
  }

  const copyButton = target.closest("[data-copy-code]");
  if (copyButton instanceof HTMLButtonElement) {
    const codeText = copyButton.closest(".rendered-code-block")?.querySelector("pre code")?.textContent ?? "";
    if (!codeText) return false;
    await copyText(codeText);
    copyButton.textContent = "已复制";
    copyButton.setAttribute("aria-label", "已复制代码");
    copyButton.classList.add("is-copied");
    window.setTimeout(() => {
      copyButton.textContent = "复制";
      copyButton.setAttribute("aria-label", "复制代码");
      copyButton.classList.remove("is-copied");
    }, 1200);
    return true;
  }

  if (!target.closest(".code-toolbar")) closeRenderedCodeMenus(root);
  return false;
}
