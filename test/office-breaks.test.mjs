import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfficeActor,createOfficeLayout,stepOfficeActor,officeNeedsFrames,findOfficePath} from '../src/client/scene/model.js';
import {quietOfficeActorHit} from '../src/client/scene/quiet-office-people.js';
import {QUIET_BIKE_METRICS} from '../src/client/scene/quiet-office-bike.js';
const members=Array.from({length:12},(_,i)=>({id:'rest-'+i,live:true,state:i%2?'done':'idle'}));
function setup(count=12) {
 const team=members.slice(0,count),layout=createOfficeLayout(team);
 return {team,layout,actors:team.map((m,i)=>createOfficeActor(m,layout.seats[i]))};
}
function ride(actor,bike) {
 bike.owner=actor.id;actor.bikeId=bike.id;actor.phase='break';actor.breakKind='bike';actor.x=bike.x;actor.y=bike.y;actor.wait=7;
}
function invariant(layout,actors) {
 const owned=layout.bikes.filter(b=>b.owner!==null);
 assert.ok(owned.length<=2);assert.equal(new Set(owned.map(b=>b.owner)).size,owned.length);
 for(const bike of owned){const actor=actors.find(a=>a.id===bike.owner);assert.ok(actor);assert.equal(actor.bikeId,bike.id);assert.equal(actor.breakKind,'bike');assert.ok(['out','break','return'].includes(actor.phase));}
 for(const actor of actors){
  if(actor.bikeId)assert.equal(layout.bikes.find(b=>b.id===actor.bikeId).owner,actor.id);
  if(actor.phase==='break'&&actor.breakKind==='bike'){
   const bike=layout.bikes.find(b=>b.owner===actor.id);assert.ok(bike);assert.equal(actor.x,bike.x);assert.equal(actor.y,bike.y);
  }
 }
}

test('two independent bikes fit small and full offices with clear routes from every desk',()=>{
 for(const count of [1,2,3,6,9,12]){
  const {layout}=setup(count);assert.equal(layout.bikes.length,2);assert.equal(new Set(layout.bikes.map(b=>b.id)).size,2);
  const [first,second]=layout.bikes;
  assert.ok(first.y+14<second.y-82,'rider hit regions cannot overlap');
  for(const bike of layout.bikes){
   assert.ok(bike.x+QUIET_BIKE_METRICS.left>=16&&bike.x+QUIET_BIKE_METRICS.right<144);
   assert.ok(bike.y+QUIET_BIKE_METRICS.top>307&&bike.y+14<layout.height-28);
   for(const home of layout.seats)for(const [from,to] of [[home,bike],[bike,home]]){
    const path=findOfficePath(layout,from,to);assert.ok(path.length>0,`${count}: ${home.id} ↔ ${bike.id}`);
    for(const point of path){
     const key=Math.floor(point.x/16)+','+Math.floor(point.y/16);
     assert.ok(!layout.blocked.has(key),'no furniture crossings');
     if(point!==path.at(-1))assert.ok(!layout.occupied.has(key),'no other bicycle or seat crossings');
    }
   }
  }
 }
});

test('twelve agents can ride both bikes together, never sharing a reservation',()=>{
 const {layout,actors,team}=setup();let peak=0;const ridden=new Set();
 actors.forEach(a=>{a.wait=0;});
 for(let frame=0;frame<12000;frame++){
  // Alternate update order to exercise reservations independent of seat priority.
  const order=frame%2?actors:actors.slice().reverse();
  order.forEach(a=>stepOfficeActor(a,team.find(m=>m.id===a.id),layout,.04,'lively'));
  invariant(layout,actors);
  const cyclists=actors.filter(a=>a.phase==='break'&&a.breakKind==='bike');peak=Math.max(peak,cyclists.length);
  cyclists.forEach(a=>ridden.add(a.bikeId));
 }
 assert.equal(peak,2);assert.equal(ridden.size,2);
});

test('first two reservations are exclusive and a third eligible agent takes coffee instead',()=>{
 const {layout,actors,team}=setup(3);
 actors.forEach((a,i)=>{a.seed=2;a.wait=0;stepOfficeActor(a,team[i],layout,.04,'lively');});
 assert.deepEqual(actors.map(a=>a.bikeId),['bike-1','bike-2',null]);
 assert.deepEqual(actors.map(a=>a.breakKind),['bike','bike','coffee']);
 invariant(layout,actors);
});

test('work recalls either cyclist continuously and releases only their own bike after clearing it',()=>{
 for(const selected of [0,1]){
  const {layout,actors,team}=setup(2);actors.forEach((a,i)=>ride(a,layout.bikes[i]));
  const actor=actors[selected],other=actors[1-selected],bike=layout.bikes[selected],before={x:actor.x,y:actor.y};
  const working={...team[selected],state:'streaming'};
  stepOfficeActor(actor,working,layout,.04,'lively');
  assert.equal(actor.phase,'return');assert.equal(bike.owner,actor.id);
  assert.ok(Math.hypot(actor.x-before.x,actor.y-before.y)<=38*.04+.001);
  for(let frame=0;frame<2000&&bike.owner;frame++)stepOfficeActor(actor,working,layout,.04,'lively');
  assert.equal(bike.owner,null);assert.equal(actor.bikeId,null);assert.equal(layout.bikes[1-selected].owner,other.id);
  for(let frame=0;frame<2000&&actor.phase!=='desk';frame++)stepOfficeActor(actor,working,layout,.04,'lively');
  assert.equal(actor.phase,'desk');assert.equal(actor.breakKind,null);assert.equal(actor.x,actor.home.x);assert.equal(actor.y,actor.home.y);
 }
});

test('work and approval interrupt outbound trips and release that reservation without affecting the other',()=>{
 for(const state of ['streaming','thinking','tool-running','waiting-approval','blocked','provisioning']){
  const {layout,actors,team}=setup(2);
  actors.forEach((a,i)=>{a.seed=2;a.wait=0;stepOfficeActor(a,team[i],layout,.04,'lively');});
  const otherOwner=layout.bikes[1].owner;
  for(let frame=0;frame<10;frame++)stepOfficeActor(actors[0],{...team[0],state},layout,.04,'lively');
  assert.equal(layout.bikes[0].owner,null);assert.equal(layout.bikes[1].owner,otherOwner);
 }
});

test('offline transition retains each bicycle reservation and does not teleport its rider',()=>{
 for(const selected of [0,1])for(const phase of ['out','break','return']){
  const {layout,actors,team}=setup(2);actors.forEach((a,i)=>ride(a,layout.bikes[i]));actors[selected].phase=phase;
  stepOfficeActor(actors[selected],{...team[selected],live:false},layout,0,'lively');
  assert.equal(layout.bikes[selected].owner,actors[selected].id);assert.equal(layout.bikes[1-selected].owner,actors[1-selected].id);
  assert.equal(actors[selected].phase,phase);assert.equal(actors[selected].bikeId,layout.bikes[selected].id);assert.equal(actors[selected].breakKind,'bike');
  assert.equal(actors[selected].x,layout.bikes[selected].x);assert.equal(actors[selected].y,layout.bikes[selected].y);
 }
});

test('approval and work never reserve bikes; frozen or calm scenes do not start trips',()=>{
 for(const state of ['waiting-approval','blocked','error','provisioning','thinking','streaming','tool-running']){
  const {layout,actors,team}=setup(2);actors.forEach(a=>{a.wait=0;});
  for(let i=0;i<100;i++)actors.forEach((a,j)=>stepOfficeActor(a,{...team[j],state},layout,.1,'lively'));
  assert.ok(layout.bikes.every(b=>b.owner===null));assert.ok(actors.every(a=>a.phase==='desk'));
 }
 for(const [mode,dt] of [['calm',.04],['off',.04],['lively',0]]){
  const {layout,actors,team}=setup(2);actors.forEach(a=>{a.wait=0;});
  actors.forEach((a,i)=>stepOfficeActor(a,team[i],layout,dt,mode));
  assert.ok(layout.bikes.every(b=>b.owner===null));assert.ok(actors.every(a=>a.phase==='desk'));
 }
 assert.equal(officeNeedsFrames([{state:'done',live:true}],[{path:[]}],'lively',false),true);
 assert.equal(officeNeedsFrames([{state:'done',live:true}],[{path:[]}],'lively',true),false);
});

test('both cyclists keep independent accurate click targets at the head, torso, and bike',()=>{
 const {layout,actors}=setup(2);actors.forEach((a,i)=>ride(a,layout.bikes[i]));
 for(const actor of actors)for(const point of [{x:actor.x+9,y:actor.y-77},{x:actor.x,y:actor.y-40},{x:actor.x+32,y:actor.y-20}]){
  assert.deepEqual(actors.filter(a=>quietOfficeActorHit(a,point)).map(a=>a.id),[actor.id]);
 }
 assert.equal(actors.some(a=>quietOfficeActorHit(a,{x:88,y:414})),false);
});

test('mixed work, offline, and recovery over 480 seconds never leave a stale bike reservation',()=>{
 const {layout,actors,team}=setup();const states=['idle','done','streaming','waiting-approval','offline'];
 for(let frame=0;frame<12000;frame++){
  const liveTeam=team.map((m,i)=>({...m,state:states[(Math.floor(frame/500)+i)%states.length]}));
  actors.forEach((a,i)=>stepOfficeActor(a,liveTeam[i],layout,.04,'lively'));invariant(layout,actors);
 }
 for(let frame=0;frame<2000;frame++)actors.forEach((a,i)=>stepOfficeActor(a,{...team[i],state:'streaming'},layout,.04,'lively'));
 assert.ok(layout.bikes.every(b=>b.owner===null));assert.ok(actors.every(a=>a.bikeId===null));
});
