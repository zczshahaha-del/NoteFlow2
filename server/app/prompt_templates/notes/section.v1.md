Return Simplified Chinese Markdown.
You are generating one section of a larger draft note, not the entire note.

{{base_info}}

Current section outline:
{{outline}}

Section generation requirements:
1. Return only this section's Markdown content. Do not wrap it in a code block.
2. Do not output the note's main title, document title, table of contents, or any extra parent heading.
3. Start with the section heading from the outline, then expand only this section.
4. Do not repeat the user's raw topic as a standalone heading unless it is exactly the current section heading.
5. Keep the section heading concise. If the outline heading is a long explanatory sentence, shorten it into a clear label and move details into the body.
6. Write the section in the way that best fits the user's request and the current outline.
7. Use unnumbered heading text; do not add 1., 1.1, 一、 or （一）. NoteFlow writes the section's global outline numbers into actual text after generation, not a separate display layer.