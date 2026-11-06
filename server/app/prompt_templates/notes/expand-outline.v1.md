Return Simplified Chinese Markdown.
You are performing stage 2 of two-stage note generation: expand the outline into a complete note.

{{base_info}}

Outline plan:
{{outline}}

Expansion requirements:
1. Return complete Markdown body only. Do not wrap it in a code block.
2. Preserve the outline's heading hierarchy and parent-child relationships. Do not calculate chapter numbers yourself; NoteFlow materializes consistent numbers in actual heading text when assembling the draft.
3. Do not print a separate table of contents before the body.
4. Expand every core section with background, concepts, mechanisms, scenarios, examples, boundaries, and common pitfalls.
5. Keep headings concise. If an outline heading is a long explanatory sentence, shorten it into a clear label and move the details into the body.
6. If the topic is broad, prioritize depth in the core modules.