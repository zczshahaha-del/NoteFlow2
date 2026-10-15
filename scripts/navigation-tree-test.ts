import assert from 'node:assert/strict';
import { createNavigationTreeSelector } from '../src/store/navigationTree.ts';
import type { FileNode } from '../src/types.ts';
const select = createNavigationTreeSelector();
const original: FileNode[] = [{id:'folder',name:'目录',type:'folder',children:[{id:'note',name:'笔记.md',type:'file',content:'old',contentHash:'old',indexStatus:'indexed',createdAt:'time',updatedAt:'time',tags:['tag'],favorite:true}]}];
const view = select(original);
assert.equal(view[0].children?.[0].content,undefined);
assert.deepEqual(view[0].children?.[0].tags,['tag']);
const next: FileNode[] = [{...original[0],children:[{...original[0].children![0],content:'new',contentHash:'new',indexStatus:'outdated'}]}];
assert.equal(select(next),view,'Body and indexing changes are not library layout changes');
assert.equal(select(original),view,'Repeated snapshots return a cached stable view');
for (const patch of [{name:'重命名.md'},{favorite:false},{pinned:true},{tags:['new']},{updatedAt:'later'},{summary:'summary'}]) {
 const tree=[{...next[0],children:[{...next[0].children![0],...patch}]}];
 assert.notEqual(select(tree),view);assert.deepEqual(select(tree)[0].children?.[0],{...view[0].children![0],...patch});
}
assert.equal(select([]).length,0,'Deletion is visible');
const moved=[original[0].children![0],{...original[0],children:[]}];
assert.equal(select(moved)[0].id,'note');assert.equal(select(moved)[1].children?.length,0);
assert.equal(original[0].children![0].content,'old','Never mutate full source content');
console.log('Navigation metadata view: content/index stability, snapshot cache, 6 metadata changes, deletion, move and source immutability passed');
