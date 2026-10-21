import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createKnowledgeJsonBlob, createKnowledgeZipBlob } from "../src/utils/exportKnowledgeZip.ts";
import { parseZipMarkdown } from "../src/utils/importKnowledge.ts";
const dom=new JSDOM('<!doctype html><body></body>',{pretendToBeVisual:true});
for(const key of ['window','document','navigator','Node','Element','HTMLElement','Text','DOMParser','MutationObserver'] as const)Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?dom.window:dom.window[key]});
Object.defineProperty(globalThis,'getComputedStyle',{value:dom.window.getComputedStyle.bind(dom.window),configurable:true});
const [{Editor},{createNoteFlowTiptapExtensions}]=await Promise.all([import('@tiptap/core'),import('../src/editor/tiptapExtensions.ts')]);
const source='## **4. CRUD**\n\n### 4.1 增\n\n### 未编号\n\n## 一、中文章节\n\n```md\n## 1. 代码不动\n```\n\n结尾。';
const editor=new Editor({element:document.createElement('div'),extensions:createNoteFlowTiptapExtensions(),content:source,contentType:'markdown'});
editor.commands.selectAll();const doc=editor.state.doc;
const copy=editor.view.serializeForClipboard(editor.state.selection.content());
const labels=['4. CRUD','4.1 增','未编号','一、中文章节'];
assert.deepEqual([...copy.dom.querySelectorAll('h2,h3')].map(n=>n.textContent),labels);
assert(copy.text.includes('4.1 增')&&!copy.text.includes('4.1 4.1'));
assert.equal(editor.state.doc,doc);
editor.commands.setTextSelection({from:1,to:4});
assert.equal(editor.view.serializeForClipboard(editor.state.selection.content()).text,'4. ','Digits can be selected and copied independently');
editor.commands.setContent(copy.dom.innerHTML);
assert.deepEqual([...editor.view.dom.querySelectorAll('h2,h3')].map(n=>n.textContent),labels);
editor.destroy();dom.window.close();
const tree=[{id:'note',name:'笔记.md',type:'file' as const}],contents={note:source};
for(const text of [source,source.replaceAll('\n','\r\n'),'章节\n===\n\n> ## 3. 引用\n\n- ### 一、列表\n','## <b>一、HTML</b>']){
 const records=await parseZipMarkdown(await createKnowledgeZipBlob(tree,{note:text}).arrayBuffer());
 assert.equal(records[0].content,text,'Markdown export preserves the literal source, not a rewritten numbered copy');
 assert.equal(JSON.parse(await createKnowledgeJsonBlob(tree,{note:text}).text()).fileContents.note,text);
}
assert.equal(contents.note,source);
console.log('heading copy/export passed: actual clipboard, partial digit copy, paste, source-exact ZIP/JSON, CRLF, nested and special Markdown');
