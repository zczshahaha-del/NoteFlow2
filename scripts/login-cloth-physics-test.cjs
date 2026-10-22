const fs=require('fs');
const path=require('path');
const s=fs.readFileSync(path.join(__dirname,'../src/components/login/cloth-login.js'),'utf8');
// Fingerprint the supplied core, not our React/event/texture integration.
// A changed gait, drawing, mesh solver or recovery routine must fail explicitly.
const assert=require('node:assert/strict'),ts=require('typescript'),{createHash}=require('node:crypto');
const coreNames=['keys','finishEntrance','updateEntrance','idx','key','createCloth','rebuildTriangles','stroke','oval','motion','person','dust','project','sample','normalAt','drawFallback','drawActor','grabPoint','limitGrab','hold','releaseCloth','beginRecovery','stabilizeEditing','recoverCloth','needsRecovery','tearLink','step'];
const tree=ts.createSourceFile('cloth.js',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),parts={};
function visit(node){if(ts.isFunctionDeclaration(node)&&coreNames.includes(node.name?.text))parts[node.name.text]=node.getText(tree);ts.forEachChild(node,visit)}
visit(tree);assert.equal(Object.keys(parts).length,coreNames.length);
assert.equal(createHash('sha256').update(coreNames.map(name=>parts[name]).join('\n')).digest('hex'),'b7f123dda4fa806a631f67029d065159954eb22b236353b6cfeabad1006a9b0f');
const section=(a,b)=>s.slice(s.indexOf(a),s.indexOf(b));
const layoutSource=fs.readFileSync(path.join(__dirname,'../src/components/login/cloth-stage-layout.js'),'utf8');
const layoutTree=ts.createSourceFile('layout.js',layoutSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const layoutFunction=layoutTree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='clothStageLayout').getText(layoutTree).replace(/^export\s+/,'');
const make=new Function('W','H',`
 const NX=20,NY=26,STRIDE=NX+1,DT=1/120,F=950,LEAD=.2,LAND=3.08,END=5.05;
 H=H||850;const settings={softness:1.2,weight:1.15,swing:1};
 ${layoutFunction}
 const {CW,CH,OX,OY,S,ground,endX,steps,STEP,LIFT}=clothStageLayout(W,H);
 const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v)),mix=(a,b,q)=>a+(b-a)*q,pt=(x,y)=>({x,y}),smooth=t=>{t=clamp(t);return t*t*(3-2*t);};
 let nodes=[],links=[],triangles=[],edgeMap=new Map(),indices=[],pins=[],dirty=false,textureDirty=false;
 let grab=null,pending=null,torn=0,accepted=false,mode='drag',releaseAge=20,relaxRadius=32,focused=false,cardHeld=false,welcome=false;
 let entryTime=0,entryOffset=W+32-OX,entryVelocity=0,entryAcceleration=0,entryLoad=.25,entryStarted=true,carrierPatch=[],loadTrail=[];
 const scene={dataset:{}},status={},reduced={matches:false},gpu=null,wake=()=>{},updateMode=()=>{};
 ${section('  function keys(', '  function save(')}
 ${section('  function finishEntrance(', '  function startEntrance(')}
 ${section('  function updateEntrance(', '  function idx(')}
 ${section('  function idx(', '  function stroke(')}
 ${section('  function stroke(', '  function paintTexture(')}
 ${section('  function project(', '  function sample(')}
 ${section('  function grabPoint(', '  function tick(')}
 createCloth(false);
 return {
   get width(){return CW;},get offset(){return entryOffset;},get time(){return entryTime;},pose:motion,
   simulate(n){for(let i=0;i<n;i++)step();},
   bounds(){const p=nodes.map(project);return {min:Math.min(...p.map(n=>n.x)),max:Math.max(...p.map(n=>n.x))};},
   drag({x=16,y=22,dx=100,dy=-120,z=90}={}){finishEntrance();const a=idx(x,y);grab={ids:[a,idx(x+1,y),idx(x,y+1)],weights:[.2,.4,.4]};const p=grabPoint();Object.assign(grab,{tx:p.x,ty:p.y,tz:p.z,targetX:p.x+dx,targetY:p.y+dy,targetZ:z});},
   release(){releaseCloth();},focus(){focused=true;beginRecovery();stabilizeEditing();},get recovering(){return needsRecovery();},
   stats(){let finite=true,maxStrain=0,rest=0,pinError=0,editError=0;for(const n of nodes){finite&&=Number.isFinite(n.x+n.y+n.z+n.px+n.py+n.pz);rest=Math.max(rest,Math.hypot(n.x-n.rx,n.y-n.ry,n.z));if(focused&&n.rx>=OX+14&&n.rx<=OX+CW-14&&n.ry>=OY+143&&n.ry<=OY+309)editError=Math.max(editError,Math.hypot(n.x-n.rx,n.y-n.ry,n.z));}for(const i of pins){const n=nodes[i];pinError=Math.max(pinError,Math.hypot(n.x-n.rx,n.y-n.ry,n.z));}for(const l of links){if(l.broken||l.type!=='edge')continue;const a=nodes[l.a],b=nodes[l.b];maxStrain=Math.max(maxStrain,Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)/l.rest);}return {finite,maxStrain,rest,pinError,editError,torn};},
   scale:S,steps,layout:{CW,CH,OX,OY}
 };
`);
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
for(const width of [316,400,540,720,1024,1280,1920]){
 const m=make(width);let leg=0,arm=0,unplanted=0;
 for(let t=0;t<5.05;t+=1/120){const p=m.pose(t),S=m.scale;
   leg=Math.max(leg,Math.abs(dist(p.hip,p.kneeA)-37*S),Math.abs(dist(p.ankleA,p.kneeA)-36*S),Math.abs(dist(p.hip,p.kneeB)-37*S),Math.abs(dist(p.ankleB,p.kneeB)-36*S));
   arm=Math.max(arm,Math.abs(dist(p.shoulder,p.eA)-32*S),Math.abs(dist(p.hand,p.eA)-31*S));if(!p.footA.load&&!p.footB.load)unplanted++;
 }
 console.log(JSON.stringify({width,steps:m.steps,scale:m.scale,leg,arm,unplanted}));if(leg>1e-5||arm>1e-5||unplanted)process.exitCode=1;
 assert.ok(m.scale<=1.16,'wide screens must not enlarge the actor');
 assert.equal(m.layout.OY+(m.layout.CH+56)/2,425,'resting composition is vertically centered');
}
// Focusing during a large rebound must not leave a crease at the input boundary.
for(const width of [316,720,1280]){
 for(const gesture of [{x:2,y:21,dx:-130,dy:-180,z:125,held:90},{x:1,y:24,dx:-180,dy:-260,z:125,held:20}]){
  const m=make(width);m.simulate(660);m.drag(gesture);m.simulate(gesture.held);m.release();m.simulate(8);m.focus();m.simulate(720);
  const settled=m.stats();console.log(JSON.stringify({width,case:'focus-during-rebound',gripRow:gesture.y,settled}));
  if(!settled.finite||settled.torn||settled.rest>8||settled.maxStrain>1.12||settled.editError>1e-5)process.exitCode=1;
 }
}
for(const width of [316,720,1280,1920]){
 const m=make(width);const initial=m.bounds();let first=null,full=null,peakStrain=1,peakAt=0;
 for(let i=0;i<660;i++){m.simulate(1);if(i%6===0){const b=m.bounds();if(first===null&&b.min<width)first=m.time;if(full===null&&b.min>=0&&b.max<width)full=m.time;if(m.stats().maxStrain>peakStrain){peakStrain=m.stats().maxStrain;peakAt=m.time;}}}
 const arrived=m.stats();console.log(JSON.stringify({width,initial,first,full,peakStrain,peakAt,arrived}));
 if(initial.min<width||first>1||full>3.0||!arrived.finite||arrived.pinError>1e-5||peakStrain>1.2||m.offset!==0)process.exitCode=1;
 if(width===720){m.drag();m.simulate(120);const held=m.stats();m.release();m.simulate(1200);const settled=m.stats(),recovering=m.recovering;m.focus();m.simulate(120);const editing=m.stats();console.log(JSON.stringify({width,held,settled,recovering,editing}));if(!held.finite||held.torn||!settled.finite||settled.rest>8||recovering||editing.editError>1e-5)process.exitCode=1;}
}
