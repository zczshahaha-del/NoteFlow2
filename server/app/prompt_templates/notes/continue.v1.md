Return Simplified Chinese Markdown.
The previous note was truncated by output length. Continue after the existing content. Return only the continuation. Do not repeat existing content. Do not wrap it in a code block.

{{base_info}}

{{outline}}

Continuation rules:
1. Do not output the # main title again.
2. If the tail ends mid-sentence, mid-list item, mid-code block, or mid-heading, continue directly.
3. Keep the existing heading numbering and hierarchy.
4. Keep new headings concise; do not turn explanatory paragraphs into headings.
5. Do not say "continue" or "below is the continuation".

Existing content tail:
{{existing_tail}}