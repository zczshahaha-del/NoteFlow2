import { useEffect, useMemo, useState } from "react";
import { buildOutlineModel, outlineAncestors, visibleOutlineNodes, type OutlineHeading } from "../utils/outlineNavigation";

export function useHeadingGroups(headings: OutlineHeading[], activeId: string) {
  const model = useMemo(() => buildOutlineModel(headings), [headings]);
  const [choices, setChoices] = useState<Map<string, boolean>>(() => new Map());
  const collapsed = useMemo(() => {
    const result = new Set(model.defaults);
    outlineAncestors(model, activeId).forEach(key => result.delete(key));
    choices.forEach((closed, key) => { if (closed && model.expandable.has(key)) result.add(key); else result.delete(key); });
    return result;
  }, [choices, model, activeId]);
  useEffect(() => {
    const keys = outlineAncestors(model, activeId);
    setChoices(current => {
      const next = new Map([...current].filter(([key]) => model.expandable.has(key)));
      keys.forEach(key => { if (next.get(key) === true) next.delete(key); });
      return next.size === current.size && [...next].every(([key, value]) => current.get(key) === value) ? current : next;
    });
  }, [activeId, model]);
  const rows = useMemo(() => visibleOutlineNodes(model, collapsed), [model, collapsed]);
  return {
    model, rows, collapsed,
    toggle: (key: string) => setChoices(current => new Map(current).set(key, !collapsed.has(key))),
    expandAll: () => setChoices(new Map([...model.expandable].map(key => [key, false]))),
    // Restore the quiet overview, keeping the currently read branch exposed.
    collapseGroups: () => setChoices(new Map()),
  };
}
export type HeadingGroups = ReturnType<typeof useHeadingGroups>;
