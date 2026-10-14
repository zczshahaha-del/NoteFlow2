import assert from 'node:assert/strict';
import { resolveWorkspaceLayout } from '../src/utils/workspaceLayout.ts';

let cases = 0;
for (const viewportWidth of [320, 736, 768, 959, 960, 1000, 1179, 1180, 1277, 1280, 1440, 1920]) {
  for (const libraryWidth of [220, 260, 343, 420]) for (const aiWidth of [320, 500, 680]) {
    for (const libraryRequested of [false, true]) for (const aiRequested of [false, true]) {
      for (const priority of ['library', 'ai'] as const) {
        const n = resolveWorkspaceLayout({ viewportWidth, libraryWidth, aiWidth, libraryRequested, aiRequested, priority });
        assert.equal(n.aiDocked, viewportWidth >= 960);
        assert(n.aiWidth >= 320 && n.aiWidth <= n.aiMaxWidth);
        assert(n.libraryWidth >= 220 && n.libraryWidth <= n.libraryMaxWidth);
        assert(!n.aiVisible || aiRequested);
        assert(!n.libraryVisible || libraryRequested);
        if (n.aiDocked && n.aiVisible) assert(viewportWidth - n.rightWidth - (n.libraryVisible ? n.libraryWidth : 0) >= 640);
        if (viewportWidth >= 960 && viewportWidth < 1180 && aiRequested && libraryRequested) {
          assert.equal(n.libraryVisible, priority === 'library');
          assert.equal(n.aiVisible, priority === 'ai');
        }
        cases++;
      }
    }
  }
}
const sample = (viewportWidth: number) => resolveWorkspaceLayout({ viewportWidth, libraryWidth:343, aiWidth:500, libraryRequested:true, aiRequested:true, priority:'ai' });
assert.equal(sample(1280).aiWidth - sample(1277).aiWidth, 3);
assert.equal(sample(1277).libraryWidth, 220);
console.log(JSON.stringify({ok:true,cases,readingBudget:640,no1280Cliff:true}));
