import assert from "node:assert/strict";
import domino from "@mixmark-io/domino";
import { Marked } from "marked";
import TurndownService from "turndown";
import { editorFixtures } from "./editor-fixtures.mjs";

const browserWindow = domino.createWindow("<!doctype html><html><body></body></html>");
globalThis.window = browserWindow;
globalThis.document = browserWindow.document;
globalThis.HTMLElement = browserWindow.HTMLElement;
globalThis.HTMLTableElement = browserWindow.HTMLTableElement;

const marked = new Marked({ breaks: true, gfm: true });
const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

function normalizeCodeLanguage(language) {
  const normalized = language.toLowerCase().replace(/^language-/, "");
  const aliases = { js: "javascript", ts: "typescript", shell: "bash", sh: "bash", py: "python", yml: "yaml", md: "markdown" };
  return aliases[normalized] || normalized || "plaintext";
}

turndown.addRule("decoratedCodeBlock", {
  filter: (node) => node instanceof HTMLElement && node.classList.contains("code-block"),
  replacement: (_content, node) => {
    const code = node.querySelector("pre code")?.textContent || "";
    const language = normalizeCodeLanguage(node.getAttribute("data-language") || "");
    const suffix = code.endsWith("\n") ? "" : "\n";
    return `\n\n\`\`\`${language === "plaintext" ? "" : language}\n${code}${suffix}\`\`\`\n\n`;
  },
});
turndown.addRule("underline", { filter: ["u"], replacement: (content) => `<u>${content}</u>` });
turndown.addRule("strikethrough", {
  filter: (node) => node instanceof HTMLElement && ["DEL", "S", "STRIKE"].includes(node.tagName),
  replacement: (content) => `~~${content}~~`,
});
turndown.addRule("highlight", { filter: ["mark"], replacement: (content) => `<mark>${content}</mark>` });
turndown.addRule("styledSpan", {
  filter: (node) => node instanceof HTMLElement && node.tagName === "SPAN" && Boolean(node.getAttribute("style")),
  replacement: (content, node) => `<span style="${node.getAttribute("style")}">${content}</span>`,
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
    const checkbox = node.querySelector('input[type="checkbox"]');
    const checked = checkbox?.hasAttribute("checked") || checkbox?.getAttribute("aria-checked") === "true";
    const normalized = content.replace(/^\s+/, "").replace(/\n/g, "\n  ");
    return `\n- [${checked ? "x" : " "}] ${normalized}`;
  },
});
turndown.addRule("gfmTable", {
  filter: (node) => node instanceof HTMLElement && node.tagName === "TABLE",
  replacement: (_content, node) => {
    const rows = Array.from(node.rows || []);
    if (!rows.length) return "";
    const cellMarkdown = (cell) => turndown.turndown(cell?.innerHTML || "").trim().replace(/\|/g, "\\|").replace(/\n+/g, "<br>");
    const columns = Math.max(...rows.map((row) => row.cells.length), 1);
    const firstCells = Array.from(rows[0].cells);
    const header = Array.from({ length: columns }, (_, index) => cellMarkdown(firstCells[index]));
    const separator = Array.from({ length: columns }, (_, index) => {
      const align = firstCells[index]?.getAttribute("align") || firstCells[index]?.style?.textAlign;
      return align === "center" ? ":---:" : align === "right" ? "---:" : "---";
    });
    const body = rows.slice(1).map((row) => {
      const cells = Array.from(row.cells);
      return Array.from({ length: columns }, (_, index) => cellMarkdown(cells[index]));
    });
    return `\n\n${[header, separator, ...body].map((cells) => `| ${cells.join(" | ")} |`).join("\n")}\n\n`;
  },
});

function renderEditorHtml(markdown) {
  const template = document.createElement("template");
  template.innerHTML = marked.parse(markdown);
  template.content.querySelectorAll("pre").forEach((pre) => {
    const code = pre.querySelector("code");
    const language = normalizeCodeLanguage(code?.getAttribute("class") || "");
    const wrapper = document.createElement("div");
    wrapper.className = "code-block";
    wrapper.setAttribute("data-language", language);
    pre.replaceWith(wrapper);
    wrapper.appendChild(pre);
  });
  return template.innerHTML;
}

function semanticSignature(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const tags = ["h1", "h2", "p", "strong", "em", "a", "img", "ul", "ol", "li", "input", "blockquote", "table", "tr", "th", "td", "pre", "code", "u", "mark", "kbd", "del"];
  return {
    text: template.content.textContent.replace(/\s+/g, " ").trim(),
    tags: Object.fromEntries(tags.map((tag) => [tag, template.content.querySelectorAll(tag).length])),
  };
}

const results = editorFixtures.map((fixture) => {
  const firstHtml = renderEditorHtml(fixture.markdown);
  const serialized = turndown.turndown(firstHtml).trim();
  fixture.required.forEach((pattern) => assert.match(serialized, pattern, `${fixture.name} lost ${pattern}`));
  const secondHtml = renderEditorHtml(serialized);
  assert.deepEqual(semanticSignature(secondHtml), semanticSignature(firstHtml), `${fixture.name} semantic signature changed`);
  return { name: fixture.name, ok: true, outputLength: serialized.length };
});

console.log(JSON.stringify({
  ok: true,
  fixtureCount: results.length,
  results,
  knownGaps: [
    "contentEditable still depends on deprecated execCommand for selection formatting",
    "complex merged-cell tables are flattened to a rectangular GFM table",
    "selection and native undo history require browser-level integration tests",
  ],
}));
