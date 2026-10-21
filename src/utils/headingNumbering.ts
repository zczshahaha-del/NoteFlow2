export interface HeadingForNumbering {
  level: number;
  text: string;
}

export type NumberedHeading<T extends HeadingForNumbering> = T & {
  displayNumber: string;
  numberJoinsText: boolean;
  hasManualNumber: boolean;
  hierarchyDepth: number;
};

function chineseNumber(value: string): number {
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  let total = 0, digit = 0;
  for (const character of value) {
    if (character in units) { total += (digit || 1) * units[character]; digit = 0; }
    else digit = digit * 10 + digits[character];
  }
  return total + digit;
}

function parseManualNumber(text: string): { parts: number[]; joinParent: boolean } | null {
  const hierarchical = text.match(/^\s*(\d+(?:\.\d+)+)(?:[.、．](?!\d)\s*|\s+)/u);
  const topLevel = text.match(/^\s*(\d+)[.、．](?!\d)\s*/u);
  const rawNumber = hierarchical?.[1] ?? topLevel?.[1];
  if (rawNumber) return { parts: rawNumber.split(".").map(Number), joinParent: true };
  // Recognize explicit numbering punctuation, never words such as “一体化”
  // or bare years/version numbers. Keep every original character editable.
  const chinese = text.match(/^\s*([零〇一二两三四五六七八九十百千]+)[、．.]\s*/u);
  const wrapped = text.match(/^\s*[（(]([零〇一二两三四五六七八九十百千]+|\d+)[）)]\s*/u);
  const chapter = text.match(/^\s*第([零〇一二两三四五六七八九十百千]+|\d+)[章节篇部](?:\s*[:：、.]?\s*)/u);
  const number = chinese?.[1] ?? wrapped?.[1] ?? chapter?.[1];
  return number ? { parts: [/^\d+$/.test(number) ? Number(number) : chineseNumber(number)], joinParent: false } : null;
}

/**
 * Adds display-only chapter numbers without changing stored heading text.
 * The shallowest heading becomes level one, so #/## and ##/### documents
 * produce the same visible hierarchy.
 */
export function numberHeadings<T extends HeadingForNumbering>(
  headings: T[],
  maxNumberedDepth = 2
): NumberedHeading<T>[] {
  if (headings.length === 0) return [];

  const baseLevel = Math.min(...headings.map((heading) => heading.level));
  const counters = Array.from({ length: 6 }, () => 0);

  return headings.map((heading) => {
    const depth = Math.max(0, Math.min(5, heading.level - baseLevel));
    const manual = parseManualNumber(heading.text);
    const manualParts = manual?.parts;

    // A local numeral in a child heading belongs to that level, not to the
    // root counter. Complete its ancestry visually; keep the source editable.
    if (manualParts?.length === 1 && depth > 0) {
      for (let index = 0; index < depth; index += 1) {
        if (counters[index] === 0) counters[index] = 1;
      }
      counters[depth] = manualParts[0];
      counters.fill(0, depth + 1);
      return {
        ...heading,
        displayNumber: manual?.joinParent && depth < maxNumberedDepth ? `${counters.slice(0, depth).join(".")}.` : "",
        numberJoinsText: !!manual?.joinParent,
        hasManualNumber: true,
        hierarchyDepth: depth,
      };
    }

    if (manualParts) {
      manualParts.slice(0, counters.length).forEach((value, index) => {
        counters[index] = value;
      });
      for (let index = manualParts.length; index < counters.length; index += 1) {
        counters[index] = 0;
      }
      return {
        ...heading,
        displayNumber: "",
        numberJoinsText: false,
        hasManualNumber: true,
        hierarchyDepth: Math.min(5, manualParts.length - 1),
      };
    }

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
      displayNumber,
      numberJoinsText: false,
      hasManualNumber: false,
      hierarchyDepth: depth,
    };
  });
}

export function headingLabel(heading: HeadingForNumbering & { displayNumber?: string; numberJoinsText?: boolean }): string {
  return `${heading.displayNumber ?? ""}${heading.displayNumber && !heading.numberJoinsText ? " " : ""}${heading.text}`;
}
