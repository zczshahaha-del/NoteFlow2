import { Lexer, type Token, type Tokens } from "marked";

export type MarkdownReviewKind = "equal" | "add" | "replace" | "remove";

export interface MarkdownReviewBlock {
  id: string;
  kind: MarkdownReviewKind;
  oldContent: string;
  newContent: string;
}

interface SourceBlock {
  content: string;
  start: number;
  end: number;
  heading: string | null;
  section: number;
}

interface HeadingAnchor {
  block: number;
  title: string;
  sectionContent: string;
}

type Match = readonly [number, number];

// Limit both parsing and quadratic matching. Larger inputs remain an exact,
// reviewable replacement instead of guessing paragraph correspondences.
const MAX_SOURCE_CHARACTERS = 400_000;
const MAX_BLOCKS = 4_000;
const MAX_LCS_CELLS = 500_000;

function sourceBlocks(source: string): SourceBlock[] | null {
  const normalized = source.replace(/\r\n?/g, "\n");
  const tokens = Lexer.lex(normalized, { gfm: true });
  const blocks: SourceBlock[] = [];
  let normalizedOffset = 0;
  let sourceOffset = 0;
  let section = -1;
  let leadingWhitespace = "";

  // Marked normalizes CRLF before lexing. Advance through the original source
  // rather than returning token.raw, so even mixed line endings round-trip.
  const takeSource = (end: number) => {
    const start = sourceOffset;
    while (normalizedOffset < end) {
      if (source[sourceOffset] === "\r" && source[sourceOffset + 1] === "\n") sourceOffset += 2;
      else sourceOffset += 1;
      normalizedOffset += 1;
    }
    return source.slice(start, sourceOffset);
  };

  const append = (content: string, heading: string | null, whitespace = false) => {
    if (!content) return;
    const previous = blocks[blocks.length - 1];
    if (whitespace && previous) {
      previous.content += content;
      previous.end += content.length;
      return;
    }
    if (whitespace) {
      leadingWhitespace += content;
      return;
    }
    const start = sourceOffset - content.length - leadingWhitespace.length;
    if (heading !== null) section = blocks.length;
    blocks.push({ content: leadingWhitespace + content, start, end: sourceOffset, heading, section });
    leadingWhitespace = "";
  };

  for (const token of tokens) {
    // Duplicate reference definitions can be absent from Marked's token list.
    // Keep such gaps as source blocks; never silently drop them from a review.
    const start = normalized.indexOf(token.raw, normalizedOffset);
    if (start < 0) return null;
    if (start > normalizedOffset) append(takeSource(start), null);
    const content = takeSource(start + token.raw.length);
    const heading = token.type === "heading" ? `${token.depth}:${token.text.trim()}` : null;
    append(content, heading, token.type === "space");
    if (blocks.length > MAX_BLOCKS) return null;
  }
  if (normalizedOffset < normalized.length) append(takeSource(normalized.length), null);
  if (leadingWhitespace) blocks.push({ content: leadingWhitespace, start: 0, end: source.length, heading: null, section: -1 });
  return blocks;
}

function headingsOf(blocks: SourceBlock[]): HeadingAnchor[] {
  const headings: HeadingAnchor[] = [];
  blocks.forEach((block, index) => {
    if (block.heading !== null) headings.push({ block: index, title: block.heading, sectionContent: "" });
  });
  headings.forEach((heading, index) => {
    const end = headings[index + 1]?.block ?? blocks.length;
    heading.sectionContent = blocks.slice(heading.block, end).map(block => block.content).join("");
  });
  return headings;
}

function uniqueMatches<T>(
  oldItems: T[], newItems: T[], same: (oldItem: T, newItem: T) => boolean, key: (item: T) => string,
): Match[] {
  const oldIndices = new Map<string, number>();
  const newIndices = new Map<string, number>();
  oldItems.forEach((item, index) => { const value = key(item); oldIndices.set(value, oldIndices.has(value) ? -1 : index); });
  newItems.forEach((item, index) => { const value = key(item); newIndices.set(value, newIndices.has(value) ? -1 : index); });
  const candidates: Match[] = [];
  for (const [value, oldIndex] of oldIndices) {
    const newIndex = newIndices.get(value);
    if (oldIndex >= 0 && newIndex !== undefined && newIndex >= 0 && same(oldItems[oldIndex], newItems[newIndex])) {
      candidates.push([oldIndex, newIndex]);
    }
  }
  // Patience anchors preserve order in O(n log n); repeated text is left in the
  // unmatched range instead of being attached to a potentially wrong section.
  const tails: number[] = [];
  const previous: number[] = [];
  candidates.forEach((candidate, index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (candidates[tails[middle]][1] < candidate[1]) low = middle + 1;
      else high = middle;
    }
    previous[index] = low > 0 ? tails[low - 1] : -1;
    tails[low] = index;
  });
  const result: Match[] = [];
  for (let index = tails[tails.length - 1] ?? -1; index >= 0; index = previous[index]) result.push(candidates[index]);
  return result.reverse();
}

function matchesOf<T>(
  oldItems: T[], newItems: T[], budget: { remaining: number },
  same: (oldItem: T, newItem: T) => boolean, key: (item: T) => string,
  weight: (oldItem: T, newItem: T) => number = () => 1,
): Match[] {
  if (!oldItems.length || !newItems.length) return [];
  const columns = newItems.length + 1;
  const cells = (oldItems.length + 1) * columns;
  if (cells > budget.remaining) return uniqueMatches(oldItems, newItems, same, key);
  budget.remaining -= cells;
  const table = new Uint32Array(cells);
  for (let oldIndex = oldItems.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newItems.length - 1; newIndex >= 0; newIndex -= 1) {
      const index = oldIndex * columns + newIndex;
      const matched = same(oldItems[oldIndex], newItems[newIndex])
        ? table[(oldIndex + 1) * columns + newIndex + 1] + weight(oldItems[oldIndex], newItems[newIndex])
        : 0;
      table[index] = Math.max(matched, table[index + columns], table[index + 1]);
    }
  }
  const matches: Match[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldItems.length && newIndex < newItems.length) {
    const index = oldIndex * columns + newIndex;
    if (same(oldItems[oldIndex], newItems[newIndex]) && table[index] === table[(oldIndex + 1) * columns + newIndex + 1] + weight(oldItems[oldIndex], newItems[newIndex])) {
      matches.push([oldIndex, newIndex]);
      oldIndex += 1;
      newIndex += 1;
    } else if (table[index + columns] >= table[index + 1]) oldIndex += 1;
    else newIndex += 1;
  }
  return matches;
}

/**
 * A source-preserving, single-column review. Each changed range keeps its nearby
 * original. Concatenating either side reproduces that input byte-for-byte (JS
 * string code units); it is never safe to use independently rendered blocks to
 * infer that Markdown reference definitions have local scope.
 */
export function compareMarkdownBlocks(oldMarkdown: string, newMarkdown: string): MarkdownReviewBlock[] {
  const result: MarkdownReviewBlock[] = [];
  const append = (oldContent: string, newContent: string, oldOffset: number, newOffset: number) => {
    if (!oldContent && !newContent) return;
    const kind: MarkdownReviewKind = oldContent === newContent ? "equal" : !oldContent ? "add" : !newContent ? "remove" : "replace";
    result.push({ id: `review-${oldOffset.toString(36)}-${newOffset.toString(36)}-${kind}`, kind, oldContent, newContent });
  };
  if (oldMarkdown === newMarkdown || !oldMarkdown || !newMarkdown || oldMarkdown.length > MAX_SOURCE_CHARACTERS || newMarkdown.length > MAX_SOURCE_CHARACTERS) {
    append(oldMarkdown, newMarkdown, 0, 0);
    return result;
  }
  let oldBlocks: SourceBlock[] | null;
  let newBlocks: SourceBlock[] | null;
  try {
    oldBlocks = sourceBlocks(oldMarkdown);
    newBlocks = sourceBlocks(newMarkdown);
  } catch {
    // Unparseable/oversized Markdown must still be reviewable and restorable.
    append(oldMarkdown, newMarkdown, 0, 0);
    return result;
  }
  if (!oldBlocks || !newBlocks) {
    append(oldMarkdown, newMarkdown, 0, 0);
    return result;
  }
  const previousBlocks = oldBlocks;
  const currentBlocks = newBlocks;
  const oldHeadings = headingsOf(previousBlocks);
  const newHeadings = headingsOf(currentBlocks);
  const budget = { remaining: MAX_LCS_CELLS };
  // Prefer the largest ordered set of heading anchors. Within equal-size sets,
  // complete section identity disambiguates repeated heading names.
  const headingWeight = oldHeadings.length + newHeadings.length + 1;
  const headingPairs = matchesOf(oldHeadings, newHeadings, budget,
    (oldHeading, newHeading) => oldHeading.title === newHeading.title,
    heading => `${heading.title}\0${heading.sectionContent}`,
    (oldHeading, newHeading) => headingWeight + Number(oldHeading.sectionContent === newHeading.sectionContent));
  const sectionPairs = new Map(headingPairs.map(([oldIndex, newIndex]) => [oldHeadings[oldIndex].block, newHeadings[newIndex].block]));
  const compatibleSections = (oldBlock: SourceBlock, newBlock: SourceBlock) => oldBlock.section === -1
    ? newBlock.section === -1
    : sectionPairs.get(oldBlock.section) === newBlock.section;
  const contentOf = (blocks: SourceBlock[], start: number, end: number) => blocks.slice(start, end).map(block => block.content).join("");
  const offsetOf = (blocks: SourceBlock[], index: number, source: string) => blocks[index]?.start ?? source.length;
  const appendWholeRange = (oldStart: number, oldEnd: number, newStart: number, newEnd: number) => append(
    contentOf(previousBlocks, oldStart, oldEnd), contentOf(currentBlocks, newStart, newEnd),
    offsetOf(previousBlocks, oldStart, oldMarkdown), offsetOf(currentBlocks, newStart, newMarkdown));
  const appendRange = (oldStart: number, oldEnd: number, newStart: number, newEnd: number) => {
    // A rewritten tail of a matched section can sit next to an entirely new or
    // deleted section. Keep that section distinct instead of absorbing it into
    // the preceding rewrite just because there is no unchanged paragraph gap.
    if (oldStart < oldEnd && newStart < newEnd && compatibleSections(previousBlocks[oldStart], currentBlocks[newStart])) {
      const oldSection = previousBlocks[oldStart].section;
      const newSection = currentBlocks[newStart].section;
      let oldSplit = oldStart;
      let newSplit = newStart;
      while (oldSplit < oldEnd && previousBlocks[oldSplit].section === oldSection) oldSplit += 1;
      while (newSplit < newEnd && currentBlocks[newSplit].section === newSection) newSplit += 1;
      appendWholeRange(oldStart, oldSplit, newStart, newSplit);
      appendWholeRange(oldSplit, oldEnd, newSplit, newEnd);
    } else appendWholeRange(oldStart, oldEnd, newStart, newEnd);
  };
  const appendRegion = (oldStart: number, oldEnd: number, newStart: number, newEnd: number) => {
    const pairs = matchesOf(previousBlocks.slice(oldStart, oldEnd), currentBlocks.slice(newStart, newEnd), budget,
      (oldBlock, newBlock) => oldBlock.content === newBlock.content && compatibleSections(oldBlock, newBlock),
      block => block.content);
    let oldCursor = oldStart;
    let newCursor = newStart;
    for (const [oldLocal, newLocal] of pairs) {
      const oldIndex = oldStart + oldLocal;
      const newIndex = newStart + newLocal;
      appendRange(oldCursor, oldIndex, newCursor, newIndex);
      appendRange(oldIndex, oldIndex + 1, newIndex, newIndex + 1);
      oldCursor = oldIndex + 1;
      newCursor = newIndex + 1;
    }
    appendRange(oldCursor, oldEnd, newCursor, newEnd);
  };
  let oldCursor = 0;
  let newCursor = 0;
  for (const [oldIndex, newIndex] of headingPairs) {
    const oldBlock = oldHeadings[oldIndex].block;
    const newBlock = newHeadings[newIndex].block;
    appendRegion(oldCursor, oldBlock, newCursor, newBlock);
    appendRange(oldBlock, oldBlock + 1, newBlock, newBlock + 1);
    oldCursor = oldBlock + 1;
    newCursor = newBlock + 1;
  }
  appendRegion(oldCursor, previousBlocks.length, newCursor, currentBlocks.length);
  return result;
}

/** Prepend this context when independently rendering one review block. */
export function markdownReferenceContext(markdown: string): string {
  if (markdown.length > MAX_SOURCE_CHARACTERS) return "";
  try {
    const definitions: string[] = [];
    const collect = (tokens: Token[]) => {
      for (const token of tokens) {
        if (token.type === "def") definitions.push(token.raw);
        else if (token.type === "blockquote") collect((token as Tokens.Blockquote).tokens);
        else if (token.type === "list") (token as Tokens.List).items.forEach(item => collect(item.tokens));
      }
    };
    collect(Lexer.lex(markdown, { gfm: true }));
    return definitions.join("\n");
  } catch {
    return "";
  }
}
