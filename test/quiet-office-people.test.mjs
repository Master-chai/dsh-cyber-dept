import test from 'node:test';
import assert from 'node:assert/strict';
import {drawQuietOfficePerson,drawQuietOfficeChair,QUIET_ACTOR_METRICS} from '../src/client/scene/quiet-office-people.js';
function render(options={},chair=false){const calls=[];const ctx={fillStyle:'',save(){calls.push(['save']);},restore(){calls.push(['restore']);},translate(...a){calls.push(['translate',...a]);},scale(...a){calls.push(['scale',...a]);},fillRect(...a){calls.push(['rect',...a,this.fillStyle]);}};(chair?drawQuietOfficeChair:drawQuietOfficePerson)(ctx,50,70,options);return calls;}
test('original pixel actors are grayscale, integer aligned and balanced',()=>{
 for(let palette=0;palette<6;palette++)for(let direction=0;direction<4;direction++)for(let frame=0;frame<7;frame++){
  const calls=render({palette,direction,frame,seated:direction===1});
  assert.equal(calls[0][0],'save');assert.equal(calls.at(-1)[0],'restore');
  for(const c of calls.filter(c=>c[0]==='rect')){assert.ok(c.slice(1,5).every(Number.isInteger));assert.ok(c[3]>0&&c[4]>0);assert.match(c[5],/^#([0-9a-f]{2})\1\1$/i);}
 }
});
test('six stable character identities and work and walk poses remain distinct',()=>{
 assert.equal(new Set(Array.from({length:6},(_,palette)=>JSON.stringify(render({palette,direction:1,seated:true})))).size,6);
 for(const [a,b] of [[0,1],[1,2],[3,4],[5,6]])assert.notDeepEqual(render({frame:a,seated:a>=3}),render({frame:b,seated:b>=3}));
 assert.deepEqual(render({palette:4,frame:3}),render({palette:4,frame:3}));
 assert.ok(render({direction:3}).some(c=>c[0]==='scale'&&c[1]===-1));
});
test('chair is an independent layer, never part of moving people',()=>{
 assert.equal(QUIET_ACTOR_METRICS.frames,7);assert.equal(QUIET_ACTOR_METRICS.palettes,6);
 const chair=render({},true),person=render({direction:1});
 assert.ok(chair.filter(c=>c[0]==='rect').some(c=>c[2]>=7));
 assert.ok(person.filter(c=>c[0]==='rect').every(c=>c[2]<7));
});

 test('moving actor hit region includes the head above the old sprite boundary', async()=>{
 const {quietOfficeActorHit}=await import('../src/client/scene/quiet-office-people.js');
 const actor={x:88,y:250,path:[{x:90,y:260}]};
 assert.equal(quietOfficeActorHit(actor,{x:88,y:198}),true);
 assert.equal(quietOfficeActorHit(actor,{x:88,y:195}),false);
 assert.equal(quietOfficeActorHit(actor,{x:108,y:220}),false);
 });
