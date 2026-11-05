import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfficeActor,createOfficeLayout,stepOfficeActor,officeNeedsFrames,findOfficePath} from '../src/client/scene/model.js';
const members=Array.from({length:12},(_,i)=>({id:'rest-'+i,live:true,state:i%2?'done':'idle'}));
test('bike is exclusive, every desk can reach it, and new work returns continuously',()=>{
 const layout=createOfficeLayout(members),actors=members.map((m,i)=>createOfficeActor(m,layout.seats[i]));let rides=0;
 for(const home of layout.seats)assert.ok(findOfficePath(layout,home,layout.bike).length>0);
 for(const a of actors)a.wait=0;
 for(let frame=0;frame<12000;frame++){
  actors.forEach((a,i)=>stepOfficeActor(a,members[i],layout,.04,'lively'));
  const cyclists=actors.filter(a=>a.phase==='break'&&a.breakKind==='bike');assert.ok(cyclists.length<=1);
  for(const a of cyclists){rides++;assert.equal(layout.bike.owner,a.id);}
  if(cyclists.length){const a=cyclists[0],i=actors.indexOf(a),before={x:a.x,y:a.y};stepOfficeActor(a,{...members[i],state:'streaming'},layout,.04,'lively');assert.equal(a.phase,'return');assert.ok(Math.hypot(a.x-before.x,a.y-before.y)<=38*.04+.001);break;}
 }
 assert.ok(rides>0);
});
test('done may simulate a break; approval and offline cannot reserve the bike',()=>{
 for(const state of ['waiting-approval','blocked','offline','provisioning']){
  const m={id:'rest-a',live:true,state},l=createOfficeLayout([m]),a=createOfficeActor(m,l.seats[0]);a.wait=0;
  for(let i=0;i<100;i++)stepOfficeActor(a,m,l,.1,'lively');assert.equal(l.bike.owner,null);assert.equal(a.phase,'desk');
 }
 assert.equal(officeNeedsFrames([{state:'done',live:true}],[{path:[]}],'lively',false),true);
 assert.equal(officeNeedsFrames([{state:'done',live:true}],[{path:[]}],'lively',true),false);
});
test('offline releases bicycle; reduced or calm mode does not start a leisure trip',()=>{
 const m={id:'rider',live:true,state:'idle'},l=createOfficeLayout([m]),a=createOfficeActor(m,l.seats[0]);
 l.bike.owner=a.id;a.phase='break';a.breakKind='bike';a.x=l.bike.x;a.y=l.bike.y;
 stepOfficeActor(a,{...m,live:false},l,0,'lively');assert.equal(l.bike.owner,null);assert.equal(a.phase,'desk');
 a.wait=0;stepOfficeActor(a,m,l,0,'calm');assert.equal(a.phase,'desk');
});
