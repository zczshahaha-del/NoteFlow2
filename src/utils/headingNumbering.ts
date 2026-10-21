export interface HeadingForNumbering {
  level: number;
  text: string;
}

export type NumberedHeading<T extends HeadingForNumbering> = T & {
  displayNumber: string;
  numberJoinsText: boolean;
  hasManualNumber: boolean;
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

/**
 * Adds display-only chapter numbers without changing stored heading text.
 * The shallowest heading becomes level one, so #/## and ##/### documents
 * produce the same visible hierarchy.
 */
export function numberHeadings<T extends HeadingForNumbering>(
  headings: T[],
  maxNumberedDepth = 6
): NumberedHeading<T>[] {
  if (headings.length === 0) return [];

  const baseLevel = Math.min(...headings.map((heading) => heading.level));
  const counters = Array.from({ length: 6 }, () => 0);

  return headings.map((heading) => {
    const depth = Math.max(0, Math.min(5, heading.level - baseLevel));
    const prefixLength = headingNumberPrefixLength(heading.text);
    // Only structure and order own the counters. Old textual ordinals never
    // change the starting point, infer a level, or reset a parent chapter.
    for (let index = 0; index < depth; index += 1) {
      if (counters[index] === 0) counters[index] = 1;
    }
    counters[depth] += 1;
    for (let index = depth + 1; index < counters.length; index += 1) {
      counters[index] = 0;
    }

    const parts = counters.slice(0, depth + 1);
    const displayNumber =
      depth < maxNumberedDepth
        ? depth === 0
          ? `${parts[0]}.`
          : parts.join(".")
        : "";

    return {
      ...heading,
      text: heading.text.slice(prefixLength),
      displayNumber,
      numberJoinsText: false,
      hasManualNumber: prefixLength > 0,
      hierarchyDepth: depth,
    };
  });
}

export function headingLabel(heading: HeadingForNumbering & { displayNumber?: string; numberJoinsText?: boolean }): string {
  return `${heading.displayNumber ?? ""}${heading.displayNumber && !heading.numberJoinsText ? " " : ""}${heading.text}`;
}
