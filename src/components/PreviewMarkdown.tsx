import { useMemo } from "react";
import { handleRenderedCodeBlockAction, renderChatMarkdown } from "../utils/chatMarkdown";

export function renderPreviewMarkdown(content: string, context = "") {
    const template = document.createElement("template");
    template.innerHTML = renderChatMarkdown(`${context}\n\n${content}`, 0, { scrollTables: true });
    template.content.querySelectorAll(".code-language-menu").forEach(menu => {
      const label = document.createElement("span");
      label.className = "nf-edit-code-language";
      label.textContent = menu.querySelector(".code-language-current")?.textContent ?? "Text";
      menu.replaceWith(label);
    });
    return template.innerHTML;
}

/** Read-only review text: language labels describe the source; only copy acts. */
export default function PreviewMarkdown({ content, context = "" }: { content: string; context?: string }) {
  const html = useMemo(() => renderPreviewMarkdown(content, context), [content, context]);
  return <div className="note-content chat-markdown max-w-none" dangerouslySetInnerHTML={{ __html: html }}
    onClick={event => { void handleRenderedCodeBlockAction(event.target, event.currentTarget); }} />;
}
