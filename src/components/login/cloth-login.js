// Original solver/actor routines retained; viewport geometry and entry cadence are adapted separately.
// React owns authentication and field state; this controller only renders the cloth.
import { clothStageLayout } from './cloth-stage-layout.js';

export function mountClothLogin(root,onEntranceReady) {
  const cleanups=[];
  try { return createClothLogin(root,cleanups,onEntranceReady); }
  catch(error){
    cleanups.splice(0).reverse().forEach(cleanup=>cleanup());
    root.removeAttribute('data-cloth-ready');
    throw error;
  }
}
function createClothLogin(root,cleanups,onEntranceReady) {
  const scene=root.querySelector('.cl-scene');
  let destroyed=false;
  const listen=(target,type,handler,options)=>{
    target.addEventListener(type,handler,options);
    cleanups.push(()=>target.removeEventListener(type,handler,options));
  };
  const canvas=root.querySelector('.cl-cloth'),shadow=root.querySelector('.cl-shadow'),fx=root.querySelector('.cl-fx');
  const sc=shadow.getContext('2d'),fc=fx.getContext('2d'),form=root.querySelector('form'),enter=root.querySelector('.cl-enter');
  const dragSurface=root.querySelector('.cl-drag-surface');
  let email,password,fields=[];
  function refreshFields(){
    email=root.querySelector('.cl-email');password=root.querySelector('.cl-password');
    fields=[email,password].filter(Boolean);
    focusedField=fields.includes(document.activeElement)?document.activeElement:null;
    focused=Boolean(focusedField);
  }
  let focusedField=null,formState={loading:false,feedback:'',tone:'info'};
  const status=root.querySelector('.cl-status'),probe=root.querySelector('.cl-probe'),bubble=root.querySelector('.cl-bubble');
  const texture=document.createElement('canvas'),tc=texture.getContext('2d'),reduced=matchMedia('(prefers-reduced-motion:reduce)');
  const gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false});
  const fallback=gl?null:canvas.getContext('2d');
  if(!sc||!fc||!tc||(!gl&&!fallback))throw Error('Canvas is unavailable');
  const NX=20,NY=26,STRIDE=NX+1,DT=1/120,F=950,settings={softness:1.2,weight:1.15,swing:1};
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v)),mix=(a,b,q)=>a+(b-a)*q;
  const pt=(x,y)=>({x,y}),smooth=t=>{t=clamp(t);return t*t*(3-2*t);};
  const LEAD=.20,LAND=3.08,END=LAND+1.97;
  let STEP=.48,LIFT=.40,steps=6,entranceAnnounced=false;
  let W=720,H=650,CW=326,CH=448,OX=197,OY=89,dpr=1,palette={},mode='drag';
  let nodes=[],links=[],triangles=[],edgeMap=new Map(),projected=[],indices=[],pins=[],dirty=true,textureDirty=true;
  let grab=null,pending=null,last=0,accumulator=0,raf=0,awakeUntil=0,torn=0,suppressClick=false,focused=false,accepted=false,active=true;
  let gpu=null,frameCount=0,releaseAge=20,relaxRadius=32,clickTimer=0;
  let ctx=fc,S=1.05,ground=524,endX=OX,cardHeld=false,welcome=false;
  let entryTime=0,entryOffset=0,entryVelocity=0,entryAcceleration=0,entryLoad=1,entryStarted=false,carrierPatch=[],loadTrail=[];
  cleanups.push(()=>{
    destroyed=true;active=false;
    if(pending)release({pointerId:pending.id,preventDefault(){}});
    if(raf)cancelAnimationFrame(raf);raf=0;clearTimeout(clickTimer);
    if(gpu){
      [gpu.position,gpu.normal,gpu.uv,gpu.index].forEach(buffer=>gl.deleteBuffer(buffer));
      gl.deleteTexture(gpu.texture);gl.deleteProgram(gpu.program);
    }
    root.removeAttribute('data-cloth-ready');
  });
  function keys(t,frames){if(t<=frames[0][0])return frames[0][1];for(let i=1;i<frames.length;i++)if(t<=frames[i][0])return mix(frames[i-1][1],frames[i][1],smooth((t-frames[i-1][0])/(frames[i][0]-frames[i-1][0])));return frames.at(-1)[1];}
  function save(action){
    root.dataset.lastAction=action;
  }
  function colors(){
    ['bg','paper','ink','soft','thread','shadow','button','button-ink','metal','shine','face','face-shade','face-ink','rope','scarf','knit','knit-shade','shoe','stitch','error'].forEach(k=>{probe.style.color='var(--cl-'+k+')';palette[k]=getComputedStyle(probe).color;});palette.line=palette.thread;textureDirty=true;dirty=true;
    palette.uiFont=getComputedStyle(scene).fontFamily;
    palette.buttonRadius=parseFloat(getComputedStyle(enter).borderRadius)||4;
    // Same quiet 4×5 cloth repeat as paintTexture, including half-pixel threads.
    // Decorative only: input values are never copied into this bitmap.
    const tile=document.createElement('canvas');tile.width=8;tile.height=10;
    const c=tile.getContext('2d');c.scale(2,2);c.globalAlpha=.04;c.lineWidth=.5;
    for(let x=0;x<=4;x+=2){c.strokeStyle=x===2?palette.shine:palette.ink;c.beginPath();c.moveTo(x,0);c.lineTo(x,5);c.stroke();}
    for(let y=0;y<=5;y+=2.5){c.strokeStyle=y===2.5?palette.thread:palette.shine;c.beginPath();c.moveTo(0,y);c.lineTo(4,y);c.stroke();}
    scene.style.setProperty('--cl-input-weave',`url("${tile.toDataURL()}")`);
  }
  function updateMode(){
    scene.dataset.mode=mode;
  }
  function finishEntrance(){
    const arriving=entryTime<LAND;
    entryStarted=true;entryTime=END;entryOffset=entryVelocity=entryAcceleration=entryLoad=0;loadTrail=[];cardHeld=true;dirty=true;
    for(const id of pins){const n=nodes[id];if(n){n.w=0;n.x=n.px=n.rx;n.y=n.py=n.ry;n.z=n.pz=0;}}
    updateMode();scene.dataset.entrance='ready';
    if(arriving)status.textContent='登录框已放好，可以继续拖拽或输入。';
  }
  function startEntrance(user=false){
    if(reduced.matches){finishEntrance();render();return;}
    if(formState.loading)return;
    fields.forEach(field=>field.blur());cardHeld=false;welcome=false;entryStarted=true;entryTime=0;entryOffset=W+32-OX;entryVelocity=entryAcceleration=0;entryLoad=.25;loadTrail=[];
    createCloth(false);status.textContent='小人正在拉来你的笔记。';updateMode();render();wake(13000);
    if(user)save('重播小人拉布料入场');
  }
  function updateEntrance(){
    if(entryTime>=END){entryAcceleration=entryLoad=0;return;}
    const previous=entryTime;entryTime=Math.min(END,entryTime+DT);
    const p=motion(entryTime),offset=Math.max(0,p.cx-OX-14*S*Math.sin(p.progress*Math.PI));
    const velocity=(offset-entryOffset)/DT;
    entryAcceleration=mix(entryAcceleration,clamp(-(velocity-entryVelocity)/DT*.65,-1800,1800),.12);
    entryOffset=offset;entryVelocity=velocity;
    entryLoad=mix(entryLoad,p.effort*(1-smooth((entryTime-(LAND-.18))/.72)),.10);
    loadTrail.unshift(entryLoad);if(loadTrail.length>40)loadTrail.pop();
    if(previous<LAND&&entryTime>=LAND){beginRecovery();status.textContent='登录框已放好，可以继续拖拽或输入。';updateMode();}
  }
  function idx(x,y){return y*STRIDE+x;}
  function key(a,b){return a<b?a+':'+b:b+':'+a;}
  function createCloth(animated=false){
    nodes=[];links=[];triangles=[];edgeMap=new Map();grab=null;pending=null;torn=0;accepted=false;releaseAge=20;relaxRadius=32;
    pins=[idx(1,1),idx(NX-1,1)];
    for(let y=0;y<=NY;y++)for(let x=0;x<=NX;x++){
      const rx=OX+CW*x/NX,ry=OY+CH*y/NY;
      const z=animated&&!reduced.matches?Math.sin(x/NX*Math.PI)*Math.sin(y/NY*Math.PI)*5:0;
      const dx=rx-OX,dy=ry-OY-CH*.82,distance=Math.hypot(dx,dy);
      const pinned=pins.includes(idx(x,y));
      nodes.push({x:rx,y:ry,z,px:rx,py:ry,pz:z,rx,ry,w:pinned?0:1,pinned,pullDistance:distance,pullAngle:Math.atan2(dy,dx)});
    }
    function link(a,b,type){
      const n=nodes[a],m=nodes[b],l={a,b,type,rest:Math.hypot(n.rx-m.rx,n.ry-m.ry),broken:false};
      const id=links.push(l)-1;if(type!=='bend')edgeMap.set(key(a,b),id);
    }
    for(let y=0;y<=NY;y++)for(let x=0;x<=NX;x++){
      const a=idx(x,y);
      if(x<NX)link(a,idx(x+1,y),'edge');
      if(y<NY)link(a,idx(x,y+1),'edge');
      if(x<NX&&y<NY){link(a,idx(x+1,y+1),'shear');link(idx(x+1,y),idx(x,y+1),'shear');}
      if(x<NX-1)link(a,idx(x+2,y),'bend');
      if(y<NY-1)link(a,idx(x,y+2),'bend');
      if(x<NX&&y<NY){
        const b=idx(x+1,y),c=idx(x,y+1),d=idx(x+1,y+1);
        triangles.push({ids:[a,b,c]},{ids:[b,d,c]});
      }
    }
    triangles.forEach(t=>{const [a,b,c]=t.ids;t.edges=[edgeMap.get(key(a,b)),edgeMap.get(key(b,c)),edgeMap.get(key(c,a))];});
    carrierPatch=[];nodes.forEach((n,id)=>{const radius=32*S;if(n.w&&n.pullDistance<radius)carrierPatch.push({id,w:Math.exp(-n.pullDistance*n.pullDistance/(radius*radius*.4))});});
    rebuildTriangles();scene.dataset.torn='0';scene.dataset.grab='idle';status.textContent='登录框已准备好，可以拖动布面。';
    textureDirty=true;dirty=true;wake(3000);
  }
  function rebuildTriangles(){
    indices=[];triangles.forEach(t=>{t.alive=t.edges.every(id=>!links[id].broken);if(t.alive)indices.push(...t.ids);});
    if(gpu){gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,gpu.index);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.DYNAMIC_DRAW);}
  }
  function stroke(points,width,color){
    ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);
    for(let i=1;i<points.length;i++)ctx.lineTo(points[i].x,points[i].y);
    ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=color||palette.ink;ctx.stroke();
  }
  function oval(x,y,rx,ry,fill,outline,width=1.5){
    ctx.beginPath();ctx.ellipse(x,y,Math.max(0,rx),Math.max(0,ry),0,0,Math.PI*2);
    if(fill){ctx.fillStyle=fill;ctx.fill();}
    if(outline){ctx.strokeStyle=outline;ctx.lineWidth=width;ctx.stroke();}
  }
  function limb(a,b,c,width,color){
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineTo(c.x,c.y);
    ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=color||palette.ink;ctx.stroke();
  }
  function elbow(a,b,l1,l2,bend){
    const d=clamp(Math.hypot(b.x-a.x,b.y-a.y),Math.abs(l1-l2)+.01,l1+l2-.01);
    const phi=Math.atan2(b.y-a.y,b.x-a.x)+bend*Math.acos(clamp((l1*l1+d*d-l2*l2)/(2*l1*d),-1,1));
    return pt(a.x+Math.cos(phi)*l1,a.y+Math.sin(phi)*l1);
  }
  function motion(t){
    const narrow=W<410;
    const distance=W+32-endX;
    const restX=OX-75*S;
    const startX=restX+distance,stepLength=distance/(steps/2);
    // Alternate the forward foot first. Planted feet retain world coordinates.
    function foot(offset,parity){
      let x=startX+offset*S,y=ground,tilt=0,load=1;
      for(let i=parity;i<steps;i+=2){
        const q=clamp((t-LEAD-i*STEP)/LIFT);
        x-=stepLength*smooth(q);
        if(q>0&&q<1){y=ground-Math.sin(q*Math.PI)*11*S;tilt=-Math.sin(q*Math.PI)*.16;load=0;}
      }
      return {x,y,tilt,load};
    }
    const footA=foot(-19,1),footB=foot(19,0);
    const center=(footA.x+footB.x)/2;
    const progress=clamp((startX-center)/distance);
    const walking=t>LEAD&&t<LAND;
    const beat=walking?Math.sin(Math.PI*clamp(((t-LEAD)%STEP)/LIFT)):0;
    const effort=(keys(t,[[0,.25],[LEAD,.96],[LAND-.2,.96],[LAND,.5],[LAND+.5,0],[END,0]])+beat*.13)*settings.weight;
    const weightShift=5*S*effort;
    const actorX=center+weightShift;
    let stamp=0;
    for(let i=0;i<steps;i++){
      const q=clamp((t-(LEAD+i*STEP+LIFT))/.16);
      stamp+=Math.sin(q*Math.PI)*Math.exp(-q*1.5);
    }
    const reachLimit=71*S;
    const horizontal=Math.max(Math.abs(actorX-footA.x),Math.abs(actorX-footB.x));
    const legHeight=Math.sqrt(Math.max(10*S*S,reachLimit*reachLimit-horizontal*horizontal));
    const hipHeight=Math.min((72-effort*12-stamp*2)*S,legHeight+7*S);
    const hip=pt(actorX,ground-hipHeight);
    const rawLean=(9+22*effort)*S;
    const lean=Math.min(rawLean,actorX-25*S)*(1-smooth((t-LAND)/.65));
    const shoulder=pt(actorX-lean,hip.y-48*S);
    const head=pt(shoulder.x+1.5*S,shoulder.y-27*S);
    const settled=t>=LAND,u=Math.max(0,t-LAND);
    const envelope=Math.exp(-2.2*u)*(1-smooth((u-1.4)/.55));
    const sway=settled?envelope*Math.cos(u*2*Math.PI*1.45):0;
    const rotate=settled?-2.4*sway*settings.swing:(mix(2.5,-2.4,smooth((t-(LAND-.35))/.35))+beat*.45)*settings.swing;
    const cx=cardHeld?endX:mix(endX+distance,endX,progress);
    const rotation=cardHeld?0:rotate,theta=rotation*Math.PI/180;
    const cy=ground-CH-12-Math.abs(Math.sin(theta))*CW*.5;
    const release=smooth((t-(LAND+.2))/.5);
    const shoulderB=pt(shoulder.x-4*S,shoulder.y+2*S);
    const reach=keys(t,[[0,56],[LEAD,52],[LAND-.22,49],[LAND,34],[END,34]]);
    const hand=pt(shoulder.x+mix(reach,23,release)*S,shoulder.y+mix(15,48,release)*S);
    const handB=pt(hand.x-5*S,hand.y-5*S);
    const wipe=Math.sin(Math.PI*clamp((t-(LAND+.75))/.68));
    if(wipe>0){hand.x=mix(hand.x,head.x+18*S,wipe);hand.y=mix(hand.y,head.y-10*S,wipe);}
    if(welcome){hand.x=shoulder.x+37*S;hand.y=shoulder.y-20*S;}
    const eA=elbow(shoulder,hand,32*S,31*S,wipe>.3||welcome?-1:1);
    const eB=elbow(shoulderB,handB,31*S,31*S,1);
    const ankleA=pt(footA.x,footA.y-7*S),ankleB=pt(footB.x,footB.y-7*S);
    const kneeA=elbow(hip,ankleA,37*S,36*S,-1),kneeB=elbow(hip,ankleB,37*S,36*S,-1);
    const anchor=pt(cx+CW*.5-CW*.5*Math.cos(theta)+CH*.28*Math.sin(theta),cy+CH-CW*.5*Math.sin(theta)-CH*.28*Math.cos(theta));
    return {t,u,settled,land:LAND,progress,effort,release,hip,shoulder,shoulderB,head,footA,footB,ankleA,ankleB,kneeA,kneeB,hand,handB,eA,eB,anchor,actorX,cx,cy,rotation,theta,wipe,rock:sway,rockLag:sway,headTilt:effort*.065-sway*.025};
  }
  function shoe(p){
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.tilt||0);ctx.scale(S,S);
    ctx.beginPath();ctx.moveTo(-10,-1);ctx.quadraticCurveTo(-12,-8,-6,-9);ctx.lineTo(2,-8);ctx.quadraticCurveTo(7,-4,14,-4);ctx.quadraticCurveTo(18,-3,17,0);ctx.lineTo(-10,0);ctx.closePath();ctx.fillStyle=palette.shoe;ctx.fill();ctx.strokeStyle=palette.ink;ctx.lineWidth=1.6;ctx.stroke();
    stroke([pt(-10,0),pt(17,0)],3,palette['knit-shade']);stroke([pt(-8,-2),pt(15,-2)],1,palette.face);stroke([pt(-2,-7),pt(3,-6)],1,palette['face-ink']);stroke([pt(2,-5),pt(7,-4)],1,palette['face-ink']);ctx.restore();
  }
  function glove(p,angle){
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(angle);ctx.scale(S,S);
    ctx.beginPath();ctx.moveTo(-5,-4);ctx.bezierCurveTo(-4,-8,3,-7,5,-3);ctx.bezierCurveTo(10,-2,9,5,4,6);ctx.bezierCurveTo(-3,8,-8,3,-5,-4);ctx.fillStyle=palette.face;ctx.fill();ctx.strokeStyle=palette['face-ink'];ctx.lineWidth=1.6;ctx.stroke();
    ctx.beginPath();ctx.moveTo(-1,-2);ctx.quadraticCurveTo(4,-3,4,1);ctx.moveTo(3,4);ctx.lineTo(5,3);ctx.strokeStyle=palette['face-ink'];ctx.lineWidth=1;ctx.stroke();ctx.restore();
  }
  function drawHead(p){
    ctx.save();ctx.translate(p.head.x,p.head.y);ctx.rotate(p.headTilt);ctx.scale(S,S);
    const ink=palette['face-ink'];
    ctx.beginPath();ctx.moveTo(-19,-10);ctx.bezierCurveTo(-14,-27,8,-29,20,-16);ctx.bezierCurveTo(28,-7,27,11,17,19);ctx.bezierCurveTo(7,28,-12,25,-19,13);ctx.bezierCurveTo(-24,5,-24,-3,-19,-10);ctx.closePath();const skin=ctx.createLinearGradient(-20,-22,23,24);skin.addColorStop(0,palette.face);skin.addColorStop(.7,palette.face);skin.addColorStop(1,palette['face-shade']);ctx.fillStyle=skin;ctx.fill();ctx.strokeStyle=palette.ink;ctx.lineWidth=1.9;ctx.stroke();
    ctx.beginPath();ctx.moveTo(-21,1);ctx.bezierCurveTo(-29,-5,-28,10,-20,9);ctx.fillStyle=palette.face;ctx.fill();ctx.lineWidth=1.7;ctx.stroke();
    ctx.beginPath();ctx.moveTo(-12,-21);ctx.bezierCurveTo(-16,-34,-5,-36,-6,-25);ctx.moveTo(-5,-24);ctx.bezierCurveTo(-1,-39,10,-36,3,-26);ctx.moveTo(3,-24);ctx.quadraticCurveTo(14,-32,15,-24);ctx.strokeStyle=palette.ink;ctx.lineWidth=1.8;ctx.stroke();
    const strain=p.effort>1.1;
    if(strain){
      ctx.beginPath();ctx.moveTo(0,-5);ctx.lineTo(7,-2);ctx.lineTo(1,1);ctx.moveTo(12,-4);ctx.lineTo(19,-1);ctx.lineTo(13,2);ctx.strokeStyle=ink;ctx.lineWidth=1.65;ctx.stroke();
      ctx.beginPath();ctx.moveTo(-1,-11);ctx.quadraticCurveTo(4,-10,8,-7);ctx.moveTo(11,-7);ctx.quadraticCurveTo(15,-9,19,-11);ctx.lineWidth=1.6;ctx.stroke();
      ctx.beginPath();ctx.roundRect(5,9,13,6,2);ctx.fillStyle=palette.face;ctx.fill();ctx.strokeStyle=ink;ctx.lineWidth=1.4;ctx.stroke();stroke([pt(10,10),pt(10,14)],.7,ink);stroke([pt(14,10),pt(14,14)],.7,ink);
    }else{
      oval(4,-2,3.4,4.4,palette.face,ink,1.1);oval(15,-2,3.1,4.1,palette.face,ink,1.1);
      const look=p.settled?0:1.2;oval(4+look,-1,1.7,2.4,ink);oval(15+look,-1,1.6,2.2,ink);
      ctx.beginPath();ctx.moveTo(0,-10);ctx.quadraticCurveTo(4,-12,8,-10);ctx.moveTo(12,-10);ctx.quadraticCurveTo(16,-12,19,-9);ctx.strokeStyle=ink;ctx.lineWidth=1.1;ctx.stroke();
      ctx.beginPath();ctx.moveTo(6,11);ctx.quadraticCurveTo(12,18,19,9);ctx.lineWidth=1.5;ctx.stroke();
    }
    ctx.beginPath();ctx.moveTo(21,1);ctx.quadraticCurveTo(29,6,21,7);ctx.strokeStyle=ink;ctx.lineWidth=1.2;ctx.stroke();
    ctx.save();ctx.globalAlpha=.24;stroke([pt(-8,10),pt(-7,12)],1,palette.scarf);stroke([pt(-5,10),pt(-4,12)],1,palette.scarf);ctx.restore();
    if(p.effort>.8){
      const dropY=-15+Math.sin(p.t*3)*2;
      ctx.beginPath();ctx.moveTo(31,dropY-7);ctx.bezierCurveTo(39,dropY+3,35,dropY+9,31,dropY+5);ctx.bezierCurveTo(28,dropY+3,29,dropY-2,31,dropY-7);ctx.fillStyle=palette.line;ctx.fill();ctx.strokeStyle=palette.ink;ctx.lineWidth=1;ctx.stroke();
    }
    ctx.restore();
  }
  function scarf(p){
    const x=p.shoulder.x,y=p.shoulder.y-3*S,flow=(p.effort*9+p.rockLag*10)*S;
    ctx.beginPath();ctx.moveTo(x-5*S,y-4*S);ctx.lineTo(x+7*S,y-2*S);ctx.lineTo(x+6*S,y+4*S);ctx.lineTo(x-7*S,y+3*S);ctx.closePath();ctx.fillStyle=palette.scarf;ctx.fill();ctx.strokeStyle=palette.ink;ctx.lineWidth=1.1*S;ctx.stroke();
    ctx.beginPath();ctx.moveTo(x-4*S,y+2*S);ctx.quadraticCurveTo(x-15*S-flow,y+5*S,x-22*S-flow,y-3*S);ctx.lineTo(x-18*S-flow,y+8*S);ctx.quadraticCurveTo(x-13*S,y+13*S,x,y+5*S);ctx.closePath();ctx.fillStyle=palette.scarf;ctx.fill();ctx.lineWidth=1*S;ctx.stroke();
  }

  function sweater(p){
    const a=p.shoulder,b=p.hip;
    ctx.beginPath();ctx.moveTo(a.x-9*S,a.y-2*S);
    ctx.quadraticCurveTo(a.x-17*S,a.y+7*S,b.x-11*S,b.y-8*S);
    ctx.quadraticCurveTo(b.x,b.y-3*S,b.x+12*S,b.y-7*S);
    ctx.quadraticCurveTo(b.x+10*S,b.y-28*S,a.x+12*S,a.y+3*S);
    ctx.quadraticCurveTo(a.x+5*S,a.y-3*S,a.x-9*S,a.y-2*S);
    const fill=ctx.createLinearGradient(a.x-12*S,a.y,b.x+16*S,b.y);
    fill.addColorStop(0,palette.knit);fill.addColorStop(1,palette['knit-shade']);
    ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=palette.ink;ctx.lineWidth=1.5*S;ctx.stroke();
    ctx.save();ctx.globalAlpha=.5;
    stroke([pt(b.x-9*S,b.y-11*S),pt(b.x+10*S,b.y-10*S)],1,palette.stitch);
    stroke([pt(a.x+5*S,a.y+21*S),pt(a.x+8*S,a.y+29*S)],1,palette.stitch);
    ctx.restore();
    oval(a.x+5*S,a.y+15*S,2*S,2*S,palette.scarf);
  }
  function person(p){
    ctx.save();ctx.globalAlpha=.67;
    limb(p.hip,p.kneeB,p.ankleB,5*S);
    limb(p.shoulderB,p.eB,p.handB,4*S);
    ctx.restore();
    shoe(p.footB);
    limb(p.hip,p.kneeA,p.ankleA,5*S);
    shoe(p.footA);
    stroke([p.shoulder,pt(p.head.x,p.head.y+22*S)],4*S);
    sweater(p);
    scarf(p);drawHead(p);glove(p.handB,.35);
    limb(p.shoulder,p.eA,p.hand,4.2*S);
    stroke([p.shoulder,pt(mix(p.shoulder.x,p.eA.x,.44),mix(p.shoulder.y,p.eA.y,.44))],10*S,palette.knit);
    glove(p.hand,.3-p.effort*.08);
  }
  function dust(p){
    Array.from({length:steps},(_,i)=>LEAD+i*STEP+LIFT).forEach((at,i)=>{
      const q=(p.t-at)/.24;if(q<0||q>1)return;
      const f=i%2?p.footA:p.footB;
      ctx.save();ctx.globalAlpha=(1-q)*.19;
      for(let j=0;j<4;j++)oval(f.x+(j-1.5)*8*S*q,ground-2-Math.sin(q*Math.PI)*3*S,(1+q*2)*S,.8*S,palette.soft);
      ctx.restore();
    });
  }

  function paintTexture(){
    const scale=2;texture.width=Math.round(CW*scale);texture.height=CH*scale;tc.setTransform(scale,0,0,scale,0,0);
    tc.fillStyle=palette.paper;tc.fillRect(0,0,CW,CH);
    tc.save();tc.globalAlpha=.04;tc.lineWidth=.5;
    for(let x=0;x<CW;x+=2){tc.strokeStyle=(Math.round(x/2)%2)?palette.shine:palette.ink;tc.beginPath();tc.moveTo(x,0);tc.lineTo(x,CH);tc.stroke();}
    for(let y=0;y<CH;y+=2.5){tc.strokeStyle=(Math.round(y/2.5)%2)?palette.thread:palette.shine;tc.beginPath();tc.moveTo(0,y);tc.lineTo(CW,y);tc.stroke();}tc.restore();
    tc.strokeStyle=palette.thread;tc.lineWidth=.8;tc.setLineDash([2.5,3]);tc.strokeRect(9,9,CW-18,CH-18);tc.setLineDash([]);
    const pad=28,content=CW-pad*2,small=CW<285;
    tc.fillStyle=palette.ink;tc.font='600 '+(CW<250?22:small?25:28)+'px '+palette.uiFont;tc.fillText(formState.title||'登录',pad,93);
    tc.fillStyle=palette.soft;
    tc.font='400 11px '+palette.uiFont;tc.fillText(formState.primaryLabel||'邮箱',pad,155);
    if(password)tc.fillText(formState.passwordLabel||'密码',pad,238);
    // Native inputs exclusively own their value, placeholder, caret and boundary.
    tc.fillStyle=palette.button;tc.beginPath();tc.roundRect(pad,330,content,48,palette.buttonRadius);tc.fill();
    tc.fillStyle=palette['button-ink'];tc.font='500 14px '+palette.uiFont;tc.textAlign='center';tc.fillText(formState.buttonLabel||'获取验证码',CW/2,360);tc.textAlign='left';
    if(gpu){gl.bindTexture(gl.TEXTURE_2D,gpu.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,texture);}
    textureDirty=false;
  }
  function setupGPU(){
    if(!gl)return;
    const vertex='attribute vec3 position;attribute vec3 normal;attribute vec2 uv;varying vec2 vUV;varying vec3 vN;void main(){gl_Position=vec4(position,1.0);vUV=uv;vN=normal;}';
    const fragment='precision mediump float;uniform sampler2D cloth;varying vec2 vUV;varying vec3 vN;void main(){vec3 n=normalize(vN);float d=abs(dot(n,normalize(vec3(-0.48,-0.55,1.0))));vec4 tex=texture2D(cloth,vUV);float shade=0.48+0.60*d;float fold=pow(1.0-abs(n.z),2.0);gl_FragColor=vec4(tex.rgb*shade*(1.0-fold*0.22),tex.a);}';
    const shaders=[];
    function shader(type,text){const s=gl.createShader(type);shaders.push(s);gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
    const program=gl.createProgram();
    try{
      gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));
      gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
    }catch(error){gl.deleteProgram(program);throw error;}
    finally{shaders.forEach(s=>gl.deleteShader(s));}
    gpu={program,position:gl.createBuffer(),normal:gl.createBuffer(),uv:gl.createBuffer(),index:gl.createBuffer(),texture:gl.createTexture(),p:gl.getAttribLocation(program,'position'),n:gl.getAttribLocation(program,'normal'),u:gl.getAttribLocation(program,'uv')};
    const uv=[];for(let y=0;y<=NY;y++)for(let x=0;x<=NX;x++)uv.push(x/NX,y/NY);
    gl.bindBuffer(gl.ARRAY_BUFFER,gpu.uv);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(uv),gl.STATIC_DRAW);
    gl.bindTexture(gl.TEXTURE_2D,gpu.texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);gl.clearColor(0,0,0,0);
  }
  function project(p){const s=F/(F-p.z);return {x:W/2+(p.x-W/2)*s+entryOffset,y:(OY+CH*.48)+(p.y-(OY+CH*.48))*s,z:p.z};}
  function sample(u,v){
    const x=clamp(u,0,1)*NX,y=clamp(v,0,1)*NY,ix=Math.min(NX-1,Math.floor(x)),iy=Math.min(NY-1,Math.floor(y)),a=x-ix,b=y-iy;
    const n=[nodes[idx(ix,iy)],nodes[idx(ix+1,iy)],nodes[idx(ix,iy+1)],nodes[idx(ix+1,iy+1)]];
    return project({x:mix(mix(n[0].x,n[1].x,a),mix(n[2].x,n[3].x,a),b),y:mix(mix(n[0].y,n[1].y,a),mix(n[2].y,n[3].y,a),b),z:mix(mix(n[0].z,n[1].z,a),mix(n[2].z,n[3].z,a),b)});
  }
  function positionControl(el,x,y,w){
    if(!el)return;
    if(el.classList.contains('cl-field')){
      el.style.width=w+'px';
      // Editing already flattens this cloth patch. Use a normal, stable hit-test box
      // instead of keeping the browser's caret/selection inside an animated matrix.
      if(focused){
        el.style.left=(OX+x)+'px';el.style.top=(OY+y)+'px';el.style.transform='none';return;
      }
      el.style.left='0px';el.style.top='0px';
    }
    const p=sample(x/CW,y/CH),a=sample((x+1)/CW,y/CH),b=sample(x/CW,(y+1)/CH);
    el.style.width=w+'px';el.style.transform='matrix('+[a.x-p.x,a.y-p.y,b.x-p.x,b.y-p.y,p.x,p.y].join(',')+')';
  }
  function normalAt(i){
    const x=i%STRIDE,y=Math.floor(i/STRIDE),l=nodes[idx(Math.max(0,x-1),y)],r=nodes[idx(Math.min(NX,x+1),y)],u=nodes[idx(x,Math.max(0,y-1))],d=nodes[idx(x,Math.min(NY,y+1))];
    const ax=r.x-l.x,ay=r.y-l.y,az=r.z-l.z,bx=d.x-u.x,by=d.y-u.y,bz=d.z-u.z;
    let nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx,len=Math.hypot(nx,ny,nz)||1;return [nx/len,ny/len,nz/len];
  }
  function drawFallback(){
    fallback.clearRect(0,0,W,H);
    for(const t of triangles){if(!t.alive)continue;const p=t.ids.map(i=>projected[i]),uv=t.ids.map(i=>({x:(i%STRIDE)/NX*texture.width,y:Math.floor(i/STRIDE)/NY*texture.height}));
      const [a,b,c]=uv,[d,e,f]=p,det=(b.x-a.x)*(c.y-a.y)-(c.x-a.x)*(b.y-a.y);if(Math.abs(det)<1e-6)continue;
      const A=((e.x-d.x)*(c.y-a.y)-(f.x-d.x)*(b.y-a.y))/det,B=((e.y-d.y)*(c.y-a.y)-(f.y-d.y)*(b.y-a.y))/det;
      const C=((f.x-d.x)*(b.x-a.x)-(e.x-d.x)*(c.x-a.x))/det,D=((f.y-d.y)*(b.x-a.x)-(e.y-d.y)*(c.x-a.x))/det;
      fallback.save();fallback.beginPath();fallback.moveTo(d.x,d.y);fallback.lineTo(e.x,e.y);fallback.lineTo(f.x,f.y);fallback.closePath();fallback.clip();fallback.transform(A,B,C,D,d.x-A*a.x-C*a.y,d.y-B*a.x-D*a.y);fallback.drawImage(texture,0,0);fallback.restore();
    }
  }
  function render(){
    if(textureDirty)paintTexture();projected=nodes.map(project);
    sc.clearRect(0,0,W,H);sc.save();sc.filter='blur(14px)';sc.globalAlpha=.2;sc.fillStyle=palette.shadow;
    sc.beginPath();const rim=[];for(let x=0;x<=NX;x++)rim.push(idx(x,0));for(let y=1;y<=NY;y++)rim.push(idx(NX,y));for(let x=NX-1;x>=0;x--)rim.push(idx(x,NY));for(let y=NY-1;y>0;y--)rim.push(idx(0,y));
    rim.forEach((i,k)=>{const p=projected[i],sx=p.x+p.z*.08,sy=p.y+13+p.z*.09;if(k)sc.lineTo(sx,sy);else sc.moveTo(sx,sy);});sc.closePath();sc.fill();sc.restore();
    dragSurface.style.clipPath='polygon('+rim.map(i=>projected[i].x.toFixed(1)+'px '+projected[i].y.toFixed(1)+'px').join(',')+')';
    if(gpu){
      const pos=[],norm=[];nodes.forEach((n,i)=>{const p=projected[i];pos.push(p.x/W*2-1,1-p.y/H*2,-p.z/600);norm.push(...normalAt(i));});
      gl.viewport(0,0,canvas.width,canvas.height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      function attribute(buffer,data,location,size){gl.bindBuffer(gl.ARRAY_BUFFER,buffer);if(data)gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.DYNAMIC_DRAW);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,0,0);}
      attribute(gpu.position,pos,gpu.p,3);attribute(gpu.normal,norm,gpu.n,3);attribute(gpu.uv,null,gpu.u,2);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,gpu.index);gl.bindTexture(gl.TEXTURE_2D,gpu.texture);gl.drawElements(gl.TRIANGLES,indices.length,gl.UNSIGNED_SHORT,0);
    }else drawFallback();
    positionControl(email?.closest('.cl-field'),28,164,CW-56);positionControl(password?.closest('.cl-field'),28,247,CW-56);positionControl(enter,28,330,CW-56);
    fc.clearRect(0,0,W,H);
    for(const i of pins){const p=projected[i];fc.save();fc.translate(p.x,p.y);fc.shadowColor=palette.shadow;fc.shadowBlur=4;fc.shadowOffsetY=2;
      const g=fc.createLinearGradient(-5,-5,5,5);g.addColorStop(0,palette.shine);g.addColorStop(.55,palette.metal);g.addColorStop(1,palette.thread);fc.fillStyle=g;fc.beginPath();fc.arc(0,0,4.2,0,Math.PI*2);fc.fill();fc.shadowBlur=0;fc.strokeStyle=palette.metal;fc.lineWidth=.7;fc.stroke();fc.restore();}
    if(torn){fc.save();fc.strokeStyle=palette.thread;fc.lineWidth=.8;fc.globalAlpha=.7;
      for(const l of links){if(!l.broken||l.type!=='edge')continue;const a=projected[l.a],b=projected[l.b],dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1;
        for(let j=0;j<3;j++){const q=.2+j*.3;fc.beginPath();fc.moveTo(a.x+dx*q,a.y+dy*q);fc.lineTo(a.x+dx*q-dy/d*3,a.y+dy*q+dx/d*3);fc.stroke();}}
      fc.restore();}
    drawActor();
    scene.dataset.entrance=entryTime<LAND?'entering':entryTime<END?'settling':'ready';scene.dataset.time=entryTime.toFixed(3);
    if(!entranceAnnounced&&entryTime>=LAND){entranceAnnounced=true;onEntranceReady?.();}
    dirty=false;frameCount++;scene.dataset.frames=String(frameCount);
  }
  function drawActor(){
    const p=motion(entryTime),anchor=sample(0,.82);ctx=fc;
    [p.footA,p.footB].forEach(f=>{ctx.save();ctx.globalAlpha=.08+f.load*.10;oval(f.x,ground+2,13*S,2.2*S,palette.shadow);ctx.restore();});
    const rope=1-smooth((entryTime-(LAND+.12))/.58);
    if(rope>0){
      ctx.save();ctx.globalAlpha=rope;
      ctx.beginPath();ctx.moveTo(p.handB.x,p.handB.y);ctx.quadraticCurveTo(mix(p.handB.x,anchor.x,.5),mix(p.handB.y,anchor.y,.5)+5+8*p.release,anchor.x,anchor.y);ctx.strokeStyle=palette.rope;ctx.lineWidth=2.2*S;ctx.lineCap='round';ctx.stroke();
      oval(anchor.x+1,anchor.y,3.3*S,5*S,null,palette.rope,1.3*S);ctx.restore();
    }
    person(p);dust(p);
    bubble.textContent=W<410?(entryTime<LAND?'嘿咻！':entryTime<LAND+.8?'放好啦～':'慢慢写～'):(entryTime<LAND?'嘿——咻！':entryTime<LAND+.8?'给你放好了。':'慢慢写～');
    const bw=W<410?69:111;
    bubble.style.left=clamp(p.head.x-34*S,8,Math.max(8,OX+entryOffset-bw-12))+'px';
    bubble.style.top=(p.head.y-29*S-42)+'px';bubble.style.opacity=entryTime<.06?'0':'1';
  }
  function grabPoint(){const p={x:0,y:0,z:0};grab.ids.forEach((id,i)=>{const n=nodes[id],w=grab.weights[i];p.x+=n.x*w;p.y+=n.y*w;p.z+=n.z*w;});return p;}
  function limitGrab(){
    if(!grab||mode==='tear')return;
    if(!grab.radii){
      let x=0,y=0;grab.ids.forEach((id,i)=>{x+=nodes[id].rx*grab.weights[i];y+=nodes[id].ry*grab.weights[i];});
      grab.radii=pins.map(id=>Math.hypot(x-nodes[id].rx,y-nodes[id].ry)*1.015);
    }
    // A taut piece of cloth cannot reach beyond its material distance from either pin.
    for(let k=0;k<6;k++)pins.forEach((id,i)=>{
      const p=nodes[id],dx=grab.tx-p.rx,dy=grab.ty-p.ry,dz=grab.tz,d=Math.hypot(dx,dy,dz),r=grab.radii[i];
      if(d>r){const s=r/d;grab.tx=p.rx+dx*s;grab.ty=p.ry+dy*s;grab.tz=dz*s;}
    });
  }
  function hold(){
    if(!grab)return;
    const p=grabPoint(),sum=grab.ids.reduce((s,id,i)=>s+nodes[id].w*grab.weights[i]*grab.weights[i],0)||1;
    const dx=grab.tx-p.x,dy=grab.ty-p.y,dz=grab.tz-p.z;
    if(!grab.patch){
      let rx=0,ry=0;grab.ids.forEach((id,i)=>{rx+=nodes[id].rx*grab.weights[i];ry+=nodes[id].ry*grab.weights[i];});
      const radius=Math.max(CW/NX,CH/NY)*2.4;
      grab.patch=[];nodes.forEach((n,id)=>{if(!n.w||grab.ids.includes(id))return;const d=Math.hypot(n.rx-rx,n.ry-ry);if(d<radius)grab.patch.push({id,w:Math.exp(-d*d/(radius*radius*.36))});});
    }
    // A fingertip loads a small patch; nearby threads follow instead of making a sharp dent.
    grab.patch.forEach(({id,w})=>{const n=nodes[id];n.x+=dx*w*.075;n.y+=dy*w*.075;n.z+=dz*w*.075;});
    grab.ids.forEach((id,i)=>{const n=nodes[id],w=n.w*grab.weights[i]/sum*.42;n.x+=dx*w;n.y+=dy*w;n.z+=dz*w;});
  }
  function releaseCloth(){
    nodes.forEach(n=>{if(!n.w)return;const vx=clamp((n.x-n.px)*.6,-1.7,1.7),vy=clamp((n.y-n.py)*.6,-1.7,1.7),vz=clamp((n.z-n.pz)*.6,-1.5,1.5);n.px=n.x-vx;n.py=n.y-vy;n.pz=n.z-vz;});
    grab=null;beginRecovery();
  }
  function beginRecovery(){
    releaseAge=0;relaxRadius=32;
    for(const n of nodes)relaxRadius=Math.max(relaxRadius,Math.hypot(n.x-n.rx,n.y-n.ry,n.z));
  }
  function stabilizeEditing(){
    if(!focused)return;
    // Fade the stationary input area into the weave instead of leaving a hard seam.
    for(const n of nodes){
      const dx=Math.max(OX+14-n.rx,n.rx-(OX+CW-14),0);
      const dy=Math.max(OY+143-n.ry,n.ry-(OY+309),0);
      const weight=(1-smooth(dx/56))*(1-smooth(dy/72));
      if(!weight)continue;
      n.x=mix(n.x,n.rx,weight);n.px=mix(n.px,n.rx,weight);
      n.y=mix(n.y,n.ry,weight);n.py=mix(n.py,n.ry,weight);
      n.z*=1-weight;n.pz*=1-weight;
    }
  }
  function recoverCloth(){
    if(grab||entryTime<END)return;
    // Preserve the first swings, then gently remove folds that the distance solver can trap.
    const blend=1-Math.exp(-DT*1.1*smooth((releaseAge-1.25)/1.75));
    if(!blend)return;
    const limit=4+relaxRadius*Math.exp(-1.2*Math.max(0,releaseAge-1.25));
    for(const n of nodes){if(!n.w)continue;
      n.x=mix(n.x,n.rx,blend);n.px=mix(n.px,n.rx,blend);
      n.y=mix(n.y,n.ry,blend);n.py=mix(n.py,n.ry,blend);
      n.z*=1-blend;n.pz*=1-blend;
      // A shrinking envelope unfolds inverted folds without changing the grip or the first rebounds.
      const dx=n.x-n.rx,dy=n.y-n.ry,d=Math.hypot(dx,dy,n.z);
      if(d>limit){
        const scale=limit/d,x=n.rx+dx*scale,y=n.ry+dy*scale,z=n.z*scale;
        n.px+=x-n.x;n.py+=y-n.y;n.pz+=z-n.z;n.x=x;n.y=y;n.z=z;
      }
    }
  }
  function needsRecovery(){
    if(reduced.matches||entryTime<END)return false;
    return nodes.some(n=>n.w&&((n.x-n.rx)**2+(n.y-n.ry)**2+n.z*n.z>64||(n.x-n.px)**2+(n.y-n.py)**2+(n.z-n.pz)**2>.04));
  }
  function tearLink(l){
    if(l.broken)return;const a=nodes[l.a],b=nodes[l.b],cx=(a.rx+b.rx)/2,cy=(a.ry+b.ry)/2;
    l.broken=true;torn++;
    for(const q of links){if(q.broken||q.type!=='bend')continue;const n=nodes[q.a],m=nodes[q.b],vx=m.rx-n.rx,vy=m.ry-n.ry,d=vx*vx+vy*vy;
      const t=clamp(((cx-n.rx)*vx+(cy-n.ry)*vy)/d,0,1);if(Math.hypot(cx-n.rx-vx*t,cy-n.ry-vy*t)<CW/NX*.8)q.broken=true;}
    a.pz-=.8;b.pz+=.8;
  }
  function step(){
    updateEntrance();
    if(!grab)releaseAge+=DT;
    const carrying=!focused&&!grab?1-smooth((entryTime-(LAND-.12))/.65):0;
    // During transport the corners are soft guides. Only the rope is a firm grip.
    for(const id of pins)nodes[id].w=carrying>.001?.7:0;
    for(const n of nodes){if(!n.w){n.x=n.px=n.rx;n.y=n.py=n.ry;n.z=n.pz=0;continue;}
      const damping=focused?.978:.9915,zDamping=focused?.972:.9905;
      const vx=clamp((n.x-n.px)*damping,-10,10),vy=clamp((n.y-n.py)*damping,-10,10),vz=clamp((n.z-n.pz)*zDamping,-10,10);
      n.px=n.x;n.py=n.y;n.pz=n.z;
      const recover=clamp(releaseAge/.65,0,1),home=grab?.8:mix(mix(2,10,recover),3.2,carrying);
      const trail=clamp(n.pullDistance/Math.hypot(CW,CH*.82));
      const pull=Math.exp(-n.pullDistance*n.pullDistance/1100)*entryLoad;
      const resistance=(-entryVelocity*1.15+entryAcceleration*.65)*(.2+.8*trail)*carrying;
      n.x+=vx+((n.rx-n.x)*home+resistance-pull*240)*DT*DT;
      n.y+=vy+(155+(n.ry-n.y)*home)*DT*DT;
      // A load at the hem fans into the weave; the far edge keeps its momentum.
      const lag=Math.round(trail*.20/DT),load=loadTrail[lag]||0;
      const fan=Math.sin(n.pullAngle*9+n.pullDistance/175)*(1-Math.exp(-n.pullDistance/32))*Math.exp(-n.pullDistance/330);
      const fold=fan*(68+18*trail)*load;
      n.z+=vz+(-n.z*(grab?1.3:mix(mix(2,8,recover),2.5,carrying))+(fold-n.z)*42*carrying+pull*100)*DT*DT;
      if(n.pinned&&carrying>.001){
        n.x+=(n.rx-n.x)*.016;n.y+=(n.ry-n.y)*.028;n.z+=(0-n.z)*.01;
      }
      n.x=clamp(n.x,-70,W+70);n.y=clamp(n.y,50,H-49);n.z=clamp(n.z,-180,240);
    }
    if(grab){grab.tx=mix(grab.tx,grab.targetX,.14);grab.ty=mix(grab.ty,grab.targetY,.14);grab.tz=mix(grab.tz,grab.targetZ,.11);limitGrab();}
    let changed=false;
    const iterations=grab||entryLoad>.02?28:12;
    for(let k=0;k<iterations;k++){
      if(grab&&k<iterations-6)hold();
      if(entryLoad>.02&&!focused&&!grab&&k<iterations-6)carrierPatch.forEach(({id,w})=>{const n=nodes[id],f=w*.065;n.x+=(n.rx-29*S*entryLoad-n.x)*f;n.y+=(n.ry-8*S*entryLoad-n.y)*f;n.z+=(31*entryLoad-n.z)*f;});
      for(const l of links){if(l.broken)continue;const a=nodes[l.a],b=nodes[l.b],w=a.w+b.w;if(!w)continue;
        const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,d=Math.hypot(dx,dy,dz)||.001;
        if(grab&&mode==='tear'&&l.type!=='bend'&&d/l.rest>1.72&&k<2){tearLink(l);changed=true;continue;}
        const strength=l.type==='bend'?(carrying>.001?.008:.018)/settings.softness:l.type==='shear'?.66:.985;
        const s=(d-l.rest)/d*strength/w;
        a.x+=dx*s*a.w;a.y+=dy*s*a.w;a.z+=dz*s*a.w;b.x-=dx*s*b.w;b.y-=dy*s*b.w;b.z-=dz*s*b.w;
      }
      for(const i of pins){const n=nodes[i];if(!n.w){n.x=n.rx;n.y=n.ry;n.z=0;}else{const f=.003+(1-carrying)*.16;n.x+=(n.rx-n.x)*f;n.y+=(n.ry-n.y)*f;n.z+=(0-n.z)*f;}}
      stabilizeEditing();
    }
    recoverCloth();
    if(changed){rebuildTriangles();scene.dataset.torn=String(torn);}
    dirty=true;
  }
  function tick(now){
    raf=0;if(destroyed||!active||document.hidden)return;
    const elapsed=Math.min(.045,(now-(last||now))/1000);last=now;
    if(!reduced.matches||grab){accumulator+=elapsed;let n=0;while(accumulator>=DT&&n++<6){step();accumulator-=DT;}}
    if(dirty)render();
    if(grab||pending||now<awakeUntil||needsRecovery())raf=requestAnimationFrame(tick);else{last=0;accumulator=0;}
  }
  function wake(ms=6000){awakeUntil=Math.max(awakeUntil,performance.now()+ms);if(!destroyed&&!raf&&active&&!document.hidden)raf=requestAnimationFrame(tick);}
  function barycentric(p,a,b,c){
    const d=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(Math.abs(d)<.01)return null;
    const u=((b.y-c.y)*(p.x-c.x)+(c.x-b.x)*(p.y-c.y))/d,v=((c.y-a.y)*(p.x-c.x)+(a.x-c.x)*(p.y-c.y))/d,w=1-u-v;
    return u>=-.015&&v>=-.015&&w>=-.015?[u,v,w]:null;
  }
  function hit(p){
    let best=null,depth=-Infinity;
    for(const t of triangles){if(!t.alive)continue;const [a,b,c]=t.ids.map(i=>projected[i]),weights=barycentric(p,a,b,c);if(!weights)continue;
      const z=a.z*weights[0]+b.z*weights[1]+c.z*weights[2];if(z>depth){best={ids:t.ids,weights};depth=z;}}
    return best;
  }
  // The full composition may be enlarged; hit testing stays in solver coordinates.
  function pointer(e){const b=scene.getBoundingClientRect();return {x:(e.clientX-b.left)*W/b.width,y:(e.clientY-b.top)*H/b.height};}
  listen(scene,'pointerdown',e=>{
    if(e.button!==0||pending||grab||e.target.closest('input,button'))return;
    const p=pointer(e),h=hit(p);if(!h)return;
    if(entryTime<LAND){finishEntrance();render();}
    pending={...h,id:e.pointerId,start:p,latest:p};
    e.preventDefault();scene.setPointerCapture(e.pointerId);
    scene.dataset.grab='ready';wake();
  });
  listen(scene,'pointermove',e=>{
    if(!pending||e.pointerId!==pending.id)return;const p=pointer(e);pending.latest=p;
    const distance=Math.hypot(p.x-pending.start.x,p.y-pending.start.y);
    if(!grab&&distance>5){
      if(focused)focusedField?.blur();e.preventDefault();scene.setPointerCapture(e.pointerId);
      grab={ids:pending.ids,weights:pending.weights};const q=grabPoint();Object.assign(grab,{tx:q.x,ty:q.y,tz:q.z,targetX:q.x,targetY:q.y,targetZ:q.z});
      scene.dataset.grab='holding';status.textContent=mode==='tear'?'正在撕开布面。':'正在抓住布面。';
    }
    if(grab){
      e.preventDefault();const z=Math.min(125,28+distance*.32),s=F/(F-z),cx=W/2,cy=OY+CH*.48;
      grab.targetX=cx+(clamp(p.x,14,W-14)-entryOffset-cx)/s;grab.targetY=cy+(clamp(p.y,78,H-55)-cy)/s;grab.targetZ=z;wake();
    }
  },{passive:false});
  function release(e){
    if(!pending||e.pointerId!==pending.id)return;const was=Boolean(grab);if(was){e.preventDefault();suppressClick=true;clearTimeout(clickTimer);clickTimer=setTimeout(()=>suppressClick=false,0);}
    if(was)releaseCloth();pending=null;scene.dataset.grab='idle';
    if(scene.hasPointerCapture(e.pointerId))scene.releasePointerCapture(e.pointerId);
    if(was&&reduced.matches){nodes.forEach(n=>{n.x=n.px=n.rx;n.y=n.py=n.ry;n.z=n.pz=0;});dirty=true;}
    if(was){status.textContent=torn?'布面已撕开，可以点复原再试一次。':reduced.matches?'布面已恢复平整。':'已松手，布面正在轻轻摆动。';save(torn?'撕开布面':'拖动后松手');wake(11000);}
  }
  listen(scene,'pointerup',release);listen(scene,'pointercancel',release);listen(scene,'lostpointercapture',e=>{if(pending?.id===e.pointerId)release(e);});
  listen(window,'pointerup',release);listen(window,'pointercancel',release);
  listen(window,'blur',()=>{if(pending)release({pointerId:pending.id,preventDefault(){}});});
  listen(form,'click',e=>{if(suppressClick){e.preventDefault();e.stopImmediatePropagation();}},true);
  // Flatten before the browser resolves a mouse caret position, not midway through focus.
  function prepareEditing(field){
    // A second click/drag inside the same field belongs entirely to native editing.
    if(focused&&focusedField===field&&document.activeElement===field)return;
    refreshFields();
    if(pending)release({pointerId:pending.id,preventDefault(){}});
    finishEntrance();focused=true;focusedField=field;
    if(torn)createCloth(false);beginRecovery();stabilizeEditing();textureDirty=true;dirty=true;render();wake();
  }
  // Delegate to the stable form: React replaces inputs between email/code/reset steps.
  listen(form,'pointerdown',e=>{if(e.button===0&&e.target.matches('.cl-input'))prepareEditing(e.target);},true);
  listen(form,'focus',e=>{if(e.target.matches('.cl-input'))prepareEditing(e.target);},true);
  listen(form,'blur',e=>{
    if(!e.target.matches('.cl-input'))return;
    focusedField=null;focused=false;beginRecovery();textureDirty=true;dirty=true;wake();
  },true);
  listen(form,'input',()=>{textureDirty=true;dirty=true;wake();});
  listen(form,'change',()=>{textureDirty=true;dirty=true;wake();});
  function resize(){
    const r=scene.getBoundingClientRect();if(r.width<1)return;
    const style=getComputedStyle(scene),width=parseFloat(style.width),height=parseFloat(style.height);
    const changed=Math.abs(W-width)>.5||Math.abs(H-height)>.5;W=width;H=height;
    scene.style.setProperty('--cl-scene-width',W+'px');
    ({CW,CH,OX,OY,S,ground,endX,steps,STEP,LIFT}=clothStageLayout(W,H));
    form.style.setProperty('--cl-card-left',OX+'px');form.style.setProperty('--cl-card-width',CW+'px');
    form.style.setProperty('--cl-support-top',(scene.offsetTop+OY+CH+12)+'px');
    scene.style.setProperty('--cl-card-top',OY+'px');
    // Keep the canvas sharp at the rendered size without enlarging the solver mesh.
    dpr=Math.min(devicePixelRatio||1,2)*r.width/W;
    if(!entryStarted)entryOffset=W+32-OX;else if(changed)finishEntrance();
    [canvas,shadow,fx].forEach(c=>{c.width=Math.round(W*dpr);c.height=Math.round(H*dpr);});sc.setTransform(dpr,0,0,dpr,0,0);fc.setTransform(dpr,0,0,dpr,0,0);fallback?.setTransform(dpr,0,0,dpr,0,0);
    colors();if(changed||!nodes.length)createCloth(false);else{textureDirty=true;dirty=true;wake();}render();
  }
  root.dataset.clothReady='true';
  refreshFields();setupGPU();updateMode();resize();
  if(focused){finishEntrance();render();wake();}else startEntrance();
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(scene);resizeObserver.observe(root);cleanups.push(()=>resizeObserver.disconnect());
  const intersectionObserver=new IntersectionObserver(es=>{active=es.some(e=>e.isIntersecting);if(active)wake();else if(raf){cancelAnimationFrame(raf);raf=0;last=0;}},{threshold:.05});intersectionObserver.observe(scene);cleanups.push(()=>intersectionObserver.disconnect());
  listen(document,'visibilitychange',()=>{if(document.hidden){if(pending)release({pointerId:pending.id,preventDefault(){}});if(raf)cancelAnimationFrame(raf);raf=0;last=0;}else wake();});
  listen(matchMedia('(prefers-color-scheme:dark)'),'change',()=>{colors();wake();});
  listen(reduced,'change',()=>{if(reduced.matches){finishEntrance();createCloth(false);render();}wake();});
  const themeObserver=new MutationObserver(()=>{colors();wake();});
  themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  cleanups.push(()=>themeObserver.disconnect());
  root.dataset.clothReady='true';
  return {
    update(state){
      if(destroyed)return;
      formState={...formState,...state};refreshFields();
      textureDirty=true;dirty=true;render();wake();
    },
    destroy(){
      if(destroyed)return;
      cleanups.splice(0).reverse().forEach(cleanup=>cleanup());
    }
  };
}
