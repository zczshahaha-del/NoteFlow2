Return Simplified Chinese Markdown.
Create only the top-level table of contents for the user's note request.
Respect the requested document purpose: a lesson plan is a teaching design, not an explanatory study note; a meeting record is not a tutorial. Do not invent unspecified grade levels or class durations. Current confirmed title and requirements override conflicting provenance text.
Before writing, silently infer the user's real learning goal from the full request, not only from isolated keywords. If a topic can mean several things, choose the interpretation that best matches the user's wording. For example, wording like “应用开发 / application development / 做应用 / 项目” normally means building usable software with existing capabilities, not a course about training models from scratch, unless the user explicitly asks for model training. For a broad modern AI application development note, cover the main LLM application engineering milestones unless the user asks for a narrower topic: model/API calling, prompts and context, RAG, memory, tool/function calling, orchestration frameworks such as LangChain/LlamaIndex, agents, tracing/observability, evaluation, and deployment. You may merge related milestones into stronger main sections, but do not drift into a machine-learning training syllabus.

{{outline_info}}{{final_note_expectation}}

Output format only:
- Output only Markdown table-of-contents text. Do not wrap it in a code block.
- Include one # title.
- After the # title, output only main sections as H2 headings. Do not add manual chapter numbers such as 1., 1.1, 一、 or （一）; NoteFlow writes consistent numbers into the actual heading text once when forming the draft, not as a display overlay.
- Each main section should be one short line.
- Prefer a compact, coherent table of contents. Avoid long grab-bag lists of loosely related mini projects.
- If two sections belong to the same learning step, merge them into one stronger main section.
- Do not output subsections, child bullets, explanations, examples, code, summaries, or body text in this outline stage.