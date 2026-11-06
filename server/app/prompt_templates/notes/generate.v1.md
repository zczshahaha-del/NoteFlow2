Return Simplified Chinese Markdown.
Generate a Markdown note according to the requirements below. Return only the Markdown body. Do not wrap it in a code block.

{{base_info}}

Writing requirements:
1. The content must be substantial and complete, not a shallow outline.
2. Use exactly one # main title and unnumbered H2 sections such as "## Basics". Do not calculate 1., 1.1, 一、 or （一） yourself; NoteFlow materializes consistent numbers in actual heading text when forming the draft, leaving the main title unnumbered.
3. Keep headings short and structural: headings should be concise labels, not full explanatory sentences. Put explanation, examples, and caveats in body text under the heading.
4. Explain background, concepts, mechanisms, scenarios, examples, boundaries, and common pitfalls for each core point.
5. If the topic is broad, make the core modules solid instead of ending early.
6. The user's additional requirement has the highest priority.