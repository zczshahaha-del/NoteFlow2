export interface HeadingForNumbering {
  level: number;
  text: string;
}

export type NumberedHeading<T extends HeadingForNumbering> = T & {
  displayNumber: string;
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
      hasManualNumber: false,
      hierarchyDepth: depth,
    };
  });
}
