import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfficeLayout,createOfficeActor,stepOfficeActor,findOfficePath,officeNeedsFrames} from '../src/client/scene/model.js';
import {quietOfficeBenchPose,drawQuietOfficeBenchPresser,QUIET_BENCH_METRICS} from '../src/client/scene/quiet-office-bench.js';
import {quietOfficeCoffeePose,drawQuietOfficeCoffeeMaker} from '../src/client/scene/quiet-office-coffee.js';
import {quietOfficeActorHit} from '../src/client/scene/quiet-office-people.js';
import {createOfficeEngine} from '../src/client/scene/engine.js';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function setup(n=12){const members=Array.from({length:n},(_,i)=>({id:'rest-'+i,state:'offline',live:false})),layout=createOfficeLayout(members);return{members,layout,actors:members.map((m,i)=>createOfficeActor(m,layout.seats[i]))};}
function place(a,l,kind,index=0,time=5){a.phase='break';a.breakKind=kind;a.path=[];if(kind==='bench'){const b=l.benches[index];b.owner=a.id;a.benchId=b.id;a.x=b.approach.x;a.y=b.y;a.benchTime=time;}else{l.coffee.owner=a.id;a.coffeeId=l.coffee.id;a.x=l.coffee.x;a.y=l.coffee.y;a.coffeeTime=time;}}
function invariant(l,actors){const owned=[...l.bikes,...l.benches,l.coffee].filter(s=>s.owner!==null);assert.equal(new Set(owned.map(s=>s.owner)).size,owned.length);for(const s of owned){const a=actors.find(a=>a.id===s.owner);assert.ok(a);assert.ok([a.bikeId,a.benchId,a.coffeeId].includes(s.id));}}
function render(draw,options={}){const calls=[],ctx={save(){},restore(){},translate(){},scale(){},fillRect(...p){calls.push([...p,this.fillStyle]);}};draw(ctx,0,0,options);return calls;}

test('two benches and the coffee operator have clear bidirectional approaches at every team size',()=>{
 for(const n of [1,2,3,6,9,12]){const {layout:l}=setup(n);assert.equal(l.benches.length,2);assert.equal(l.bikes.length,2);
  for(const b of l.benches){assert.ok(b.x+QUIET_BENCH_METRICS.left>=156);assert.ok(b.x+QUIET_BENCH_METRICS.right<l.width-16);assert.ok(b.y+QUIET_BENCH_METRICS.top>l.seats.at(-1).y+14);}
  for(const s of [...l.benches.map(b=>b.approach),l.coffee])for(const home of l.seats)for(const [from,to] of [[home,s],[s,home]]){const path=findOfficePath(l,from,to);assert.ok(path.length);for(const point of path){const cell=Math.floor(point.x/16)+','+Math.floor(point.y/16);assert.ok(!l.blocked.has(cell));assert.ok(!l.occupied.has(cell)||point===path.at(-1));}}
 }
});

test('both wrists follow the same bar, elbows keep physical lengths and grounded feet never slide',()=>{
 let top=0,bottom=0;for(let t=1.8;t<21.6;t+=.01){const p=quietOfficeBenchPose({time:t});
  for(const side of ['near','far']){assert.ok(Math.abs(distance(p[side+'Shoulder'],p[side+'Elbow'])-18)<1e-8);assert.ok(Math.abs(distance(p[side+'Elbow'],p[side+'Hand'])-19)<1e-8);if(p.grip===1)assert.deepEqual(p[side+'Hand'],p[side+'Grip']);}
  assert.deepEqual(p.nearFoot,{x:48,y:0});assert.deepEqual(p.farFoot,{x:39,y:-7});assert.deepEqual(p.hip,{x:12,y:-32});
  if(p.stage==='lockout')top=p.bar.y;if(p.stage==='pause')bottom=p.bar.y;
 }assert.ok(bottom-top>=27);
 const lower=quietOfficeBenchPose({time:4.2}),press=quietOfficeBenchPose({time:6.3});assert.equal(lower.stage,'lower');assert.equal(press.stage,'press');
});

test('bench set includes setup, four controlled repetitions, reracking and standing',()=>{
 const stages=new Set();for(let t=0;t<=24;t+=.01)stages.add(quietOfficeBenchPose({time:t}).stage);
 for(const s of ['sit','lie','grip','unrack','lower','pause','press','lockout','rack','release','stand'])assert.ok(stages.has(s));
 for(let rep=0;rep<4;rep++){assert.equal(quietOfficeBenchPose({time:3.2+rep*4.4+2.1}).stage,'pause');assert.equal(quietOfficeBenchPose({time:3.2+rep*4.4+4}).stage,'lockout');}
 assert.deepEqual(quietOfficeBenchPose({time:24}).hip,{x:48,y:-15});
});

test('bench sprites stay within bounds in all stages, preserve six palettes and integer grayscale',()=>{
 const identities=new Set();for(let palette=0;palette<6;palette++){identities.add(JSON.stringify(render(drawQuietOfficeBenchPresser,{palette,time:5.3})));for(let time=0;time<=24;time+=.2)for(const [x,y,w,h,c] of render(drawQuietOfficeBenchPresser,{palette,time})){assert.ok([x,y,w,h].every(Number.isInteger));assert.match(c,/^#([0-9a-f]{2})\1\1$/i);assert.ok(x>=QUIET_BENCH_METRICS.left&&x+w<=QUIET_BENCH_METRICS.right&&y>=QUIET_BENCH_METRICS.top&&y+h<=QUIET_BENCH_METRICS.bottom);}}assert.equal(identities.size,6);
});

test('two bench reservations and the single coffee reservation are exclusive with a nonblocking fallback',()=>{
 const {members,layout:l,actors}=setup(5);actors.forEach((a,i)=>{a.seed=0;a.breakCount=i<3?4:1;a.wait=0;stepOfficeActor(a,members[i],l,.04,'lively');});
 assert.deepEqual(actors.map(a=>a.breakKind),['bench','bench','coffee','walk','walk']);invariant(l,actors);
});

test('12 agents use both benches, both bikes and one coffee machine over ten minutes without duplicate owners',()=>{
 const {members,layout:l,actors}=setup(),seen=new Set();let maxBenches=0;
 for(let frame=0;frame<15000;frame++){actors.forEach((a,i)=>stepOfficeActor(a,members[i],l,.04,'lively'));invariant(l,actors);const benchers=actors.filter(a=>a.phase==='break'&&a.breakKind==='bench');maxBenches=Math.max(maxBenches,benchers.length);actors.filter(a=>a.phase==='break').forEach(a=>seen.add(a.benchId||a.bikeId||a.coffeeId||a.breakKind));}
 assert.equal(maxBenches,2);for(const s of ['bench-1','bench-2','bike-1','bike-2','coffee-1','phone','walk'])assert.ok(seen.has(s));
});

test('work or approval safely reracks each bench and returns continuously without releasing another owner',()=>{
 for(const state of ['thinking','streaming','tool-running','waiting-approval','blocked','error','provisioning'])for(const index of [0,1]){
  const {members,layout:l,actors}=setup(2);actors.forEach((a,i)=>place(a,l,'bench',i));const a=actors[index],other=l.benches[1-index].owner,working={...members[index],state},before={x:a.x,y:a.y};
  stepOfficeActor(a,working,l,.04,'lively');assert.equal(a.phase,'break');assert.ok(a.benchExit);assert.equal(a.benchExit.from.loaded,true);assert.ok(officeNeedsFrames([working],[a],'lively',false));assert.deepEqual({x:a.x,y:a.y},before);
  const exitStart=quietOfficeBenchPose({time:a.benchTime,exit:{...a.benchExit,time:0}});assert.deepEqual(exitStart.bar,a.benchExit.from.bar);
  for(let i=0;i<1600;i++){const p={x:a.x,y:a.y};stepOfficeActor(a,working,l,.04,'lively');assert.ok(distance(a,p)<=1.520001);}
  assert.equal(a.phase,'desk');assert.equal(a.benchId,null);assert.equal(l.benches[index].owner,null);assert.equal(l.benches[1-index].owner,other);
 }
});

test('coffee process presses a real control, brews only into the tray cup, then takes and drinks it',()=>{
 const stages=new Set();let fill=-1;for(let t=0;t<14.5;t+=.01){const p=quietOfficeCoffeePose({time:t});stages.add(p.stage);if(p.brewing){assert.equal(p.cupInTray,true);assert.deepEqual(p.cup,{x:59,y:232});assert.ok(p.fill>=fill);fill=p.fill;}if(p.stage==='sip'){assert.equal(p.brewing,false);assert.equal(p.cupInTray,false);assert.deepEqual(p.hand,p.cup);}}
 assert.deepEqual([...stages],['place-cup','press-button','brew','take-cup','sip','put-back','release']);assert.ok(fill>.99);
});

test('coffee recall stops pouring immediately and puts the same cup down before returning',()=>{
 for(const time of [0,1.5,3,7.5,10,13]){const {members,layout:l,actors}=setup(1),a=actors[0];place(a,l,'coffee',0,time);const working={...members[0],officeRuntimeFacts:{waitingApproval:true}};stepOfficeActor(a,working,l,.04,'lively');assert.ok(a.coffeeExit);const p=quietOfficeCoffeePose({time:a.coffeeTime,exit:a.coffeeExit});assert.equal(p.brewing,false);for(let i=0;i<1200;i++)stepOfficeActor(a,working,l,.04,'lively');assert.equal(a.phase,'desk');assert.equal(l.coffee.owner,null);assert.equal(a.coffeeId,null);}
});

test('unfinished offline tasks never reserve any lounge machine or imply completion',()=>{
 const {members,layout:l,actors}=setup();for(let i=0;i<4000;i++)actors.forEach((a,j)=>stepOfficeActor(a,{...members[j],officeTaskFacts:{unfinishedCount:1}},l,.04,'lively'));
 assert.ok([...l.bikes,...l.benches,l.coffee].every(s=>s.owner===null));actors.forEach(a=>assert.equal(distance(a,a.home),0));
});

test('reduced motion freezes coffee and bench sprites regardless of elapsed or exit time',()=>{
 for(const draw of [drawQuietOfficeBenchPresser,drawQuietOfficeCoffeeMaker])assert.deepEqual(render(draw,{animate:false,time:1}),render(draw,{animate:false,time:100,exit:{time:1,from:{}}}));
});

test('bench click targets include heads and both grip positions without selecting their neighbour',()=>{
 const {layout:l,actors}=setup(2);actors.forEach((a,i)=>place(a,l,'bench',i));for(const a of actors)for(const p of [{x:a.x-92,y:a.y-42},{x:a.x-60,y:a.y-70},{x:a.x-10,y:a.y-1}])assert.deepEqual(actors.filter(other=>quietOfficeActorHit(other,p)).map(a=>a.id),[a.id]);
});

function engineHarness(){const members=setup(2).members,l=createOfficeLayout(members);let current={members,scheme:'light',active:true,visible:true,reduced:false,mode:'lively'},now=100,id=0;const frames=new Map(),listeners=new Map();const ctx=new Proxy({},{get(t,k){return t[k]??(()=>{});},set(t,k,v){t[k]=v;return true;}});const doc={hidden:false,createElement:()=>({getContext:()=>ctx}),addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:k=>listeners.delete(k)};const environment={document:doc,now:()=>now,requestFrame:f=>{frames.set(++id,f);return id;},cancelFrame:id=>frames.delete(id),Observer:null};const e=createOfficeEngine({canvas:{dataset:{},getContext:()=>ctx},layout:l,getCurrent:()=>current,environment});return{e,l,frames,doc,listeners,update(p){current={...current,...p};e.wake(true);},advance(ms){now+=ms;const pending=[...frames];frames.clear();pending.forEach(([,f])=>f(now));}};}

test('benches and coffee retain one throttled RAF, freeze when hidden/reduced and release on removal/disposal',()=>{
 for(const kind of ['bench','coffee']){
  const h=engineHarness(),a=h.e.actors[0];place(a,h.l,kind);for(let i=0;i<20;i++)h.e.wake();assert.equal(h.frames.size,1);const before=kind==='bench'?a.benchTime:a.coffeeTime;h.advance(40);assert.ok((kind==='bench'?a.benchTime:a.coffeeTime)>before);
  h.update({reduced:true});const frozen=JSON.stringify(a);assert.equal(h.frames.size,0);h.advance(50000);h.e.wake(true);assert.equal(JSON.stringify(a),frozen);
  h.update({reduced:false});assert.equal(h.frames.size,1);h.doc.hidden=true;h.listeners.get('visibilitychange')();assert.equal(h.frames.size,0);h.advance(50000);h.doc.hidden=false;h.listeners.get('visibilitychange')();assert.equal(h.frames.size,1);
  h.update({members:[]});assert.equal(h.frames.size,0,'removed actors must not leave an animation loop');assert.ok([...h.l.bikes,...h.l.benches,h.l.coffee].every(s=>s.owner===null));h.e.dispose();assert.equal(h.frames.size,0);
 }
 const h=engineHarness();h.e.actors.forEach((a,i)=>place(a,h.l,'bench',i));h.e.dispose();assert.ok(h.l.benches.every(b=>b.owner===null));assert.equal(h.frames.size,0);
});
