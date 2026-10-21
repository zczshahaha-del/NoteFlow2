import assert from "node:assert/strict";
import { outlineHeadings, headingLabel, headingNumberPrefixLength } from "../src/utils/headingNumbering.ts";
const headings=[{level:2,text:'4. CRUD'},{level:3,text:'4.1 增'},{level:4,text:'一、深入'},{level:2,text:'没有编号'}];
assert.deepEqual(outlineHeadings(headings).map(headingLabel),headings.map(h=>h.text));
assert.deepEqual(outlineHeadings(headings).map(h=>h.hierarchyDepth),[0,1,2,0]);
assert.deepEqual(outlineHeadings([...headings].reverse()).map(headingLabel),[...headings].reverse().map(h=>h.text),'Moving headings never rewrites their text');
for(let seed=0;seed<40;seed++){
 const input=Array.from({length:25},(_,i)=>({level:1+(seed+i*5)%6,text:['1. ','一、','9.8.7 ','','第十二章 '][i%5]+`主题${seed}·${i}`}));
 assert.deepEqual(outlineHeadings(input).map(headingLabel),input.map(h=>h.text));
}
for(const text of ['2026 年总结','3D 图形','1.5版本变化','一体化设计','1.'])assert.equal(headingNumberPrefixLength(text),0);
assert.equal(headingNumberPrefixLength('4.1 增'),4,'Legacy index matching can ignore a known prefix, but never changes editor text');
assert.deepEqual(outlineHeadings([]),[]);
console.log('heading outline passed: verbatim labels, no automatic counters or inferred hierarchy, protected names and all depths');
