import test from 'node:test';
import assert from 'node:assert/strict';
import {quietOfficePedalPose,drawQuietOfficeBike,drawQuietOfficeCyclist,QUIET_BIKE_METRICS} from '../src/client/scene/quiet-office-bike.js';
function render(options={},empty=false){const calls=[];const ctx={fillStyle:'',save(){calls.push(['save']);},restore(){calls.push(['restore']);},translate(...args){calls.push(['translate',...args]);},fillRect(...args){calls.push(['rect',...args,this.fillStyle]);}};(empty?drawQuietOfficeBike:drawQuietOfficeCyclist)(ctx,88,392,options);return calls;}
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
test('opposed pedals and fixed-length limbs give a continuous physical pedal cycle',()=>{
 for(let i=0;i<=128;i++){
  const p=quietOfficePedalPose({pedalPhase:i*Math.PI/64});
  for(const [foot,knee] of [[p.near,p.nearKnee],[p.far,p.farKnee]]){
   assert.ok(Math.abs(dist(foot,p.crank)-8)<1e-9);
   assert.ok(Math.abs(dist(knee,p.hip)-23)<1e-9);
   assert.ok(Math.abs(dist(knee,foot)-23)<1e-9);
  }
  assert.ok(Math.abs(p.near.x+p.far.x-2*p.crank.x)<1e-9);
  assert.ok(Math.abs(p.near.y+p.far.y-2*p.crank.y)<1e-9);
 }
});
test('reduced motion freezes all bike and rider motion independently of elapsed time',()=>{
 assert.deepEqual(render({animate:false,time:1}),render({animate:false,time:100}));
 assert.notDeepEqual(render({time:0}),render({time:.3}));
 assert.deepEqual(render({pedalPhase:.3}),render({pedalPhase:.3}));
});
test('all six cyclists fit the advertised bounds and use integer grayscale pixels',()=>{
 const identities=new Set();
 for(let palette=0;palette<6;palette++){
  identities.add(JSON.stringify(render({palette})));
  for(let i=0;i<12;i++)for(const call of render({palette,pedalPhase:i*Math.PI/6}).filter(c=>c[0]==='rect')){
   const [,x,y,w,h,color]=call;assert.ok([x,y,w,h].every(Number.isInteger));assert.ok(w>0&&h>0);assert.match(color,/^#([0-9a-f]{2})\1\1$/i);
   assert.ok(x>=QUIET_BIKE_METRICS.left&&x+w<=QUIET_BIKE_METRICS.right);
   assert.ok(y>=QUIET_BIKE_METRICS.top&&y+h<=QUIET_BIKE_METRICS.bottom);
  }
 }
 assert.equal(identities.size,6);
 assert.notDeepEqual(render({},true),render({}));
});
