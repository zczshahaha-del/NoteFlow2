import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronRight } from "lucide-react";
import type { HeadingGroups } from "../hooks/useHeadingGroups";
import type { OutlineHeading } from "../utils/outlineNavigation";
import { headingLabel } from "../utils/headingNumbering";
import "./chapter-navigation.css";

export default function ChapterRail({ headings, activeId, onHeadingClick, groups }: {
  headings: OutlineHeading[]; activeId: string; onHeadingClick: (id: string) => void; groups: HeadingGroups;
}) {
  const navRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const grouped = headings.length > 100 && groups.model.expandable.size > 0;
  const rows = grouped ? groups.rows : headings.map(item => ({ node: { item, key: item.id, children: [] }, depth: item.hierarchyDepth ?? 0 }));
  // A bounded overview, independent of the scrollable labels. Each slot covers
  // a stable contiguous range, so even very long notes fit without moving ticks.
  const ticks = useMemo(() => {
    const count = Math.min(headings.length, 60);
    return Array.from({ length: count }, (_, index) => {
      const start = Math.floor(index * headings.length / count);
      const end = Math.floor((index + 1) * headings.length / count);
      const depth = Math.min(...headings.slice(start, end).map(item => item.hierarchyDepth ?? item.level - 1));
      return { start, end, depth };
    });
  }, [headings]);
  const activeIndex = headings.findIndex(item => item.id === activeId);
  // Reveal the current label once on entry, never chase it while the user is
  // browsing the list or scrolling prose. The compact overview has no scrollTop.
  useLayoutEffect(() => {
    if (!open) return;
    const nav = navRef.current;
    const track = nav?.querySelector<HTMLElement>(".chapter-rail-track");
    const active = track?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!track || !active) return;
    const row = active.closest<HTMLElement>(".chapter-rail-row");
    if (!row) return;
    // Local offsets do not include the panel's entrance transform.
    if (row.offsetTop < track.scrollTop) track.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > track.scrollTop + track.clientHeight)
      track.scrollTop = row.offsetTop + row.offsetHeight - track.clientHeight;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !navRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <nav ref={navRef} className="chapter-rail" aria-label="章节快速导航" data-grouped={grouped} data-open={open}
    onPointerEnter={event => { if (event.pointerType === "mouse") setOpen(true); }}
    onPointerLeave={event => { if (event.pointerType === "mouse" && !navRef.current?.querySelector(":focus-visible")) setOpen(false); }}
    onFocusCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(true); }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); navRef.current?.querySelector<HTMLButtonElement>(".chapter-rail-overview")?.focus(); } }}>
    <button type="button" className="chapter-rail-overview" aria-label="展开章节目录" aria-expanded={open}
      onClick={() => setOpen(true)} style={{ "--chapter-tick-count": ticks.length } as CSSProperties}>
      {ticks.map(tick => <span key={tick.start} className={`chapter-rail-tick ${activeIndex >= tick.start && activeIndex < tick.end ? "is-active" : ""}`}
        aria-hidden="true" style={{ "--chapter-tick-width": `${Math.max(7, 16 - Math.min(tick.depth, 3) * 4)}px` } as CSSProperties} />)}
    </button>
    <div className="chapter-rail-panel" inert={!open}>
    {grouped && <div className="chapter-rail-tools">
      <button type="button" onClick={groups.expandAll}>展开全部</button>
      <button type="button" onClick={groups.collapseGroups}>收起分组</button>
    </div>}
    <div className="chapter-rail-track">
      {rows.map(({ node, depth }) => {
        const heading = node.item;
        const expandable = grouped && node.children.length > 0;
        const label = headingLabel(heading);
        const item = <button type="button" className={`chapter-rail-item ${activeId === heading.id ? "is-active" : ""}`}
          data-heading-id={heading.id} aria-current={activeId === heading.id ? "location" : undefined}
          onClick={() => onHeadingClick(heading.id)} title={label}
          style={{ "--chapter-indent": `${Math.min(depth, 3) * 12}px` } as CSSProperties}>
          <span className="chapter-rail-label">{label}</span>
        </button>;
        return expandable ? <div key={heading.id} className="chapter-rail-row" style={{ "--chapter-indent": `${Math.min(depth, 3) * 12}px` } as CSSProperties}>
          {item}
          <button type="button" className="chapter-rail-group-toggle" aria-expanded={!groups.collapsed.has(node.key)}
            aria-label={`${groups.collapsed.has(node.key) ? "展开" : "收起"}小节：${heading.text}`} onClick={() => groups.toggle(node.key)}>
            <ChevronRight size={12} aria-hidden="true" />
          </button>
        </div> : <div key={heading.id} className="chapter-rail-row">{item}</div>;
      })}
    </div>
    </div>
  </nav>;
}
