export interface HeadingForNumbering {
  level: number;
  text: string;
}

export type OutlineHeadingMetadata<T extends HeadingForNumbering> = T & {
  hierarchyDepth: number;
  isDocumentTitle?: boolean;
};

function ordinalPrefix(text: string): RegExpMatchArray | null {
  const hierarchical = text.match(/^\s*(\d+(?:\.\d+)+)(?:[.、．](?!\d)\s*|\s+)/u);
  const topLevel = text.match(/^\s*(\d+)[.、．](?!\d)\s*/u);
  // Recognize explicit ordinal syntax, not words such as “一体化” or bare
  // years/version names. The ordinal's numeric value never enters a counter.
  const chinese = text.match(/^\s*([零〇一二两三四五六七八九十百千]+)[、．.]\s*/u);
  const wrapped = text.match(/^\s*[（(]([零〇一二两三四五六七八九十百千]+|\d+)[）)]\s*/u);
  const chapter = text.match(/^\s*第([零〇一二两三四五六七八九十百千]+|\d+)[章节篇部](?:\s*[:：、.]?\s*)/u);
  return hierarchical ?? topLevel ?? chinese ?? wrapped ?? chapter;
}

/** Recognized ordinal prefix only; never consume an empty title or years. */
export function headingNumberPrefixLength(text: string): number {
  let length = 0;
  for (let index = 0; index < 4; index++) {
    const prefix = ordinalPrefix(text.slice(length));
    if (!prefix || !text.slice(length + prefix[0].length).trim()) break;
    length += prefix[0].length;
  }
  return length;
}

/** Only derive outline depth. Labels are the actual editable heading text. */
export function outlineHeadings<T extends HeadingForNumbering>(headings: T[]): OutlineHeadingMetadata<T>[] {
  if (headings.length === 0) return [];

  const baseLevel = Math.min(...headings.map((heading) => heading.level));
  return headings.map(heading => ({ ...heading, hierarchyDepth: Math.max(0, Math.min(5, heading.level - baseLevel)) }));
}

export function headingLabel(heading: HeadingForNumbering): string {
  return heading.text;
}
