import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<html><body></body></html>', { pretendToBeVisual: true });
Object.assign(globalThis, { window:dom.window, document:dom.window.document,
  HTMLElement:dom.window.HTMLElement, requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT:true });
Object.defineProperty(globalThis, 'navigator', { configurable:true, value:dom.window.navigator });
const captures=new WeakMap();
HTMLElement.prototype.setPointerCapture=function(id){captures.set(this,id);};
HTMLElement.prototype.hasPointerCapture=function(id){return captures.get(this)===id;};
HTMLElement.prototype.releasePointerCapture=function(){captures.delete(this);};
const { createRoot } = await import('react-dom/client');
const vite=await createServer({appType:'custom',logLevel:'silent',server:{middlewareMode:true}});
try {
  const {default:Handle}=await vite.ssrLoadModule('/src/components/LibraryResizeHandle.tsx');
  for(const resizeEdge of ['right','left']) {
    const container=document.createElement('div');document.body.append(container);
    const root=createRoot(container),commits=[],previews=[];
    const width=resizeEdge==='right'?260:500,origin=260,final=resizeEdge==='right'?100:400;
    await act(async()=>root.render(React.createElement(Handle,{width,minWidth:220,maxWidth:680,resizeEdge,
      onCommit:n=>commits.push(n),onPreview:(n,dragging)=>previews.push({n,dragging})})));
    const handle=container.querySelector('[role="separator"]');
    const pointer=async(type,x)=>act(async()=>{
      const event=new dom.window.MouseEvent(type,{bubbles:true,clientX:x,button:0});
      Object.defineProperty(event,'pointerId',{value:1});handle.dispatchEvent(event);
    });
    await pointer('pointerdown',origin);
    await pointer('pointermove',origin-10);
    // The release position differs from the last delivered move (coalesced tail).
    await pointer('pointerup',final);
    const expected=resizeEdge==='right'?220:360;
    assert.deepEqual(commits,[expected],'Release must use its own final coordinate, not a stale move');
    assert.deepEqual(previews.at(-1),{n:expected,dragging:false});
    assert.equal(document.body.style.cursor,'');assert.equal(document.body.style.userSelect,'');
    await pointer('pointerdown',origin);await pointer('pointermove',final);
    await act(async()=>handle.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    await pointer('pointerup',final);
    assert.deepEqual(commits,[expected],'Escape cancels without a second commit');
    assert.deepEqual(previews.at(-1),{n:width,dragging:false});
    await act(async()=>root.unmount());container.remove();
  }
  console.log(JSON.stringify({ok:true,finalReleaseCoordinate:true,bothEdges:true,escapeCancel:true}));
} finally {await vite.close();dom.window.close();}
