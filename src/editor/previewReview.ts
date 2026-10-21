import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { compareMarkdownBlocks, markdownReferenceContext, type MarkdownReviewBlock } from "../utils/markdownReview";
import { renderPreviewMarkdown } from "../components/PreviewMarkdown";
import { handleRenderedCodeBlockAction } from "../utils/chatMarkdown";

const key = new PluginKey<DecorationSet>("preview-review");

// Decorations are outside the document model: copying, serializing and undoing
// the draft never includes comparison labels or the old read-only excerpts.
export const PreviewReview = Extension.create({
  name: "previewReview",
  addProseMirrorPlugins() {
    return [new Plugin({
      key,
      state: {
        init: () => DecorationSet.empty,
        apply: (tr, previous) => tr.getMeta(key) ?? previous.map(tr.mapping, tr.doc),
      },
      props: { decorations: state => key.getState(state) },
    })];
  },
});

function reviewWidget(block: MarkdownReviewBlock, number: number, context: string, expanded: Set<string>) {
  const wrapper = document.createElement("div");
  wrapper.className = "nf-edit-review-block nf-edit-inline-review";
  wrapper.dataset.kind = block.kind;
  wrapper.contentEditable = "false";
  const heading = document.createElement("div");
  heading.className = "nf-edit-change-heading";
  const label = document.createElement("span");
  label.className = "nf-edit-change-label";
  label.textContent = block.kind === "add" ? "新增" : block.kind === "remove" ? "已删除" : "改写";
  heading.append(label);
  wrapper.append(heading);
  if (block.oldContent.trim()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nf-edit-button nf-edit-original-toggle";
    heading.append(button);
    const update = () => {
      const open = expanded.has(block.id);
      button.textContent = open ? "收起原文" : "查看原文";
      button.setAttribute("aria-label", `${open ? "收起" : "查看"}第 ${number} 处改动的原文`);
      button.setAttribute("aria-expanded", String(open));
      wrapper.querySelector(".nf-edit-original")?.remove();
      if (open) {
        const original = document.createElement("section");
        original.className = "nf-edit-original";
        original.setAttribute("aria-label", `第 ${number} 处改动的原文`);
        original.innerHTML = '<span class="nf-edit-original-label">原文 · 只读</span><div class="note-content chat-markdown">'
          + renderPreviewMarkdown(block.oldContent, context) + "</div>";
        original.addEventListener("click", event => { void handleRenderedCodeBlockAction(event.target, original); });
        wrapper.append(original);
      }
    };
    button.addEventListener("click", () => { if (expanded.has(block.id)) expanded.delete(block.id); else expanded.add(block.id); update(); });
    update();
  }
  return wrapper;
}

export function updatePreviewReview(editor: Editor, oldContent: string, newContent: string, enabled: boolean, expanded: Set<string>) {
  if (editor.isDestroyed) return;
  if (!enabled) {
    if (key.getState(editor.state) === DecorationSet.empty) return;
    editor.view.dispatch(editor.state.tr.setMeta(key, DecorationSet.empty).setMeta("addToHistory", false).setMeta("preventUpdate", true));
    return;
  }
  const doc = editor.state.doc;
  const blocks = compareMarkdownBlocks(oldContent, newContent);
  const references = markdownReferenceContext(newContent);
  const originalReferences = markdownReferenceContext(oldContent);
  const offsets: number[] = [0];
  doc.forEach(node => offsets.push(offsets[offsets.length - 1] + node.nodeSize));
  const ranges: { block: MarkdownReviewBlock; start: number; end: number }[] = [];
  let index = 0;
  let aligned = true;
  for (const block of blocks) {
    const start = index;
    if (block.newContent.trim()) {
      const source = block.newContent.replace(/^(?:\r?\n)+|(?:\r?\n)+$/g, "");
      const parsed = editor.schema.nodeFromJSON(editor.markdown!.parse(references ? references + "\n\n" + source : source));
      for (let child = 0; child < parsed.childCount; child++) {
        if (index >= doc.childCount || !parsed.child(child).eq(doc.child(index))) {
          aligned = false; break;
        }
        index++;
      }
    }
    if (!aligned) break;
    ranges.push({ block, start: offsets[start], end: offsets[index] });
  }
  // Exotic Markdown / reference-only blocks can parse differently in isolation.
  // Never attach an old paragraph to a guessed position; use one full reference.
  if (!aligned || index !== doc.childCount) {
    ranges.splice(0, ranges.length, { block: { id: "full-reference", kind: oldContent === newContent ? "equal" : "replace", oldContent, newContent }, start: 0, end: doc.content.size });
  }
  const decorations: Decoration[] = [];
  let number = 0;
  for (const { block, start, end } of ranges) {
    if (block.kind === "equal") continue;
    const changeNumber = ++number;
    decorations.push(Decoration.widget(start, () => reviewWidget(block, changeNumber, originalReferences, expanded), {
      key: `${block.id}-${changeNumber}`, side: -1, stopEvent: () => true, ignoreSelection: true,
    }));
    doc.nodesBetween(start, end, (node, pos, parent) => {
      if (parent === doc && node.isBlock) {
        decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: "nf-edit-changed-text", "data-change-kind": block.kind }));
      }
      return false;
    });
  }
  // Other plugins can append incidental trailing-node work to a meta-only
  // transaction; showing a reference must never be treated as a manual save.
  editor.view.dispatch(editor.state.tr.setMeta(key, DecorationSet.create(doc, decorations)).setMeta("addToHistory", false).setMeta("preventUpdate", true));
}
