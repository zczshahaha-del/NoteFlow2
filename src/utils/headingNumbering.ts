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

function parseManualNumber(text: string): number[] | null {
  const hierarchical = text.match(/^\s*(\d+(?:\.\d+)+)(?:[.、．](?!\d)\s*|\s+)/u);
  const topLevel = text.match(/^\s*(\d+)[.、．](?!\d)\s*/u);
  const rawNumber = hierarchical?.[1] ?? topLevel?.[1];
  if (!rawNumber) return null;
  return rawNumber.split(".").map(Number);
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
    const manualParts = parseManualNumber(heading.text);

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
        displayNumber: depth < maxNumberedDepth ? `${counters.slice(0, depth).join(".")}.` : "",
        numberJoinsText: true,
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
