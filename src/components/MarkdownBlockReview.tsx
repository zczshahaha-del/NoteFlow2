import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { compareMarkdownBlocks, markdownReferenceContext } from "../utils/markdownReview";
import PreviewMarkdown from "./PreviewMarkdown";

/** Keep the new text on one reading line; old text is adjacent to its change. */
export default function MarkdownBlockReview({ oldContent, newContent }: { oldContent: string; newContent: string }) {
  const blocks = useMemo(() => {
    let number = 0;
    return compareMarkdownBlocks(oldContent, newContent)
      .filter(block => block.oldContent.trim() || block.newContent.trim())
      .map(block => ({ ...block, number: block.kind === "equal" ? 0 : ++number }));
  }, [oldContent, newContent]);
  const originalReferences = useMemo(() => markdownReferenceContext(oldContent), [oldContent]);
  const newReferences = useMemo(() => markdownReferenceContext(newContent), [newContent]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  return <section className="nf-edit-block-review" aria-label="段落对照">
    {blocks.map(block => {
      const open = expanded.has(block.id);
      const changed = block.kind !== "equal";
      return <article key={block.id} className="nf-edit-review-block" data-kind={block.kind}>
        {changed && <div className="nf-edit-change-heading">
          <span className="nf-edit-change-label">{block.kind === "add" ? "新增" : block.kind === "remove" ? "已删除" : "改写"}</span>
          {block.oldContent.trim() && <button type="button" className="nf-edit-button nf-edit-original-toggle" aria-label={`${open ? "收起" : "查看"}第 ${block.number} 处改动的原文`} aria-expanded={open} aria-controls={open ? `review-original-${block.id}` : undefined}
            onClick={() => setExpanded(current => { const next = new Set(current); if (open) next.delete(block.id); else next.add(block.id); return next; })}>
            {open ? "收起原文" : "查看原文"}<ChevronDown size={12} aria-hidden="true" />
          </button>}
        </div>}
        {block.newContent.trim() && <PreviewMarkdown content={block.newContent} context={newReferences} />}
        {open && <section id={`review-original-${block.id}`} className="nf-edit-original" aria-label={`第 ${block.number} 处改动的原文`}>
          <span className="nf-edit-original-label">原文</span><PreviewMarkdown content={block.oldContent} context={originalReferences} />
        </section>}
      </article>;
    })}
  </section>;
}
