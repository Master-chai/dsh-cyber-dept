import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {mergeFloor} from '../src/client/model/floor.js';
import {OfficeScene} from '../src/client/office-scene.js';
import {officeRestState,officeSceneSignal,sceneActivity,createOfficeLayout,createOfficeActor,stepOfficeActor,officeNeedsFrames} from '../src/client/scene/model.js';
import {drawQuietOfficePerson,quietOfficeActorHit} from '../src/client/scene/quiet-office-people.js';

const offline={id:'worker',name:'Worker',role:'teammate',state:'offline',phase:'active',live:true};
const task=(id,status,extra={})=>({id,subject:id,ownerId:'worker',status,...extra});
function floor(tasks=[],extra={},other=[]){return mergeFloor({id:'root',live:true,tasksAvailable:true,members:[{...offline,...extra},...other],tasks}, {byId:{}},new Map());}
function advance(actor,member,layout,seconds){for(let i=0;i<seconds*25;i++)stepOfficeActor(actor,member,layout,.04,'lively');}

test('native completed assignments enable offline rest without changing runtime state or tasks',()=>{
 const tasks=[task('one','completed'),task('two','completed')],before=JSON.stringify(tasks),f=floor(tasks),m=f.seats[0];
 assert.equal(m.state,'offline');assert.equal(m.stateFacts.availability,'offline');assert.equal(m.officeTaskFacts.completed,true);
 assert.equal(officeRestState(m),'completed');assert.equal(sceneActivity(m),'offline');assert.equal(JSON.stringify(tasks),before);
 const html=renderToStaticMarkup(React.createElement(OfficeScene,{floor:f}));
 assert.match(html,/任务完成 · 离线休息/);assert.match(html,/离线不代表任务完成/);
});

test('offline, ended turn, missing board, and historical completed counts alone never prove completion',()=>{
 for(const extra of [{},{stateFacts:{activity:'done'}},{completedCount:5},{completedTask:task('old','completed')},{task:task('ref-only','completed')}]){
  const member={...offline,...extra};assert.notEqual(officeRestState(member),'completed');
 }
 const m=floor([],{state:'done'}).seats[0];assert.equal(m.officeTaskFacts.completed,false);
});

test('every open owned assignment overrides a stale completed task reference',()=>{
 for(const status of ['pending','in_progress','unknown']){
  const m=floor([task('old','completed'),task('new',status)],{task:task('old','completed')}).seats[0];
  assert.equal(m.task.status,'completed');assert.equal(m.officeTaskFacts.unfinishedCount,1);assert.equal(m.officeTaskFacts.completed,false);
  assert.equal(officeRestState(m),'waiting');
 }
 const m=floor([task('old','completed')],{task:task('missing-from-board','pending')}).seats[0];
 assert.equal(officeRestState(m),'waiting');assert.equal(m.officeTaskFacts.completed,false);
});

test('completion excludes ambiguous owner names, foreign assignments, deleted tasks, errors and approvals',()=>{
 const duplicate=floor([{...task('done','completed'),ownerId:'',ownerName:'Worker'}],{},[{...offline,id:'other'}]);
 assert.ok(duplicate.seats.every(m=>!m.officeTaskFacts.completed));
 assert.equal(floor([task('other','completed',{ownerId:'other'})]).seats[0].officeTaskFacts.completed,false);
 assert.equal(floor([task('deleted','deleted')]).seats[0].officeTaskFacts.completed,false);
 for(const extra of [{error:'failed'},{approval:{id:'a'}},{phase:'failed'},{phase:'provisioning'},...['thinking','streaming','tool-running','waiting-approval','blocked','error','provisioning'].map(activity=>({stateFacts:{activity}}))]){
  assert.equal(officeRestState({...offline,officeTaskFacts:{completed:true},...extra}),'none');
 }
});

test('completion, assignment and approval changes wake the scene even when member state stays offline',()=>{
 const unknown=officeSceneSignal(offline),done=officeSceneSignal(floor([task('done','completed')]).seats[0]);
 const waiting=officeSceneSignal(floor([task('new','pending')]).seats[0]);
 const approval=officeSceneSignal({...offline,stateFacts:{activity:'waiting-approval'}});
 assert.equal(new Set([unknown,done,waiting,approval]).size,4);
});

test('completed and unknown offline actors cycle coffee, cycling, walking and desk phone with no task writes',()=>{
 for(const completed of [false,true]){
  const member={...offline,officeTaskFacts:{completed}},before=JSON.stringify(member),layout=createOfficeLayout([member]);
  const actor=createOfficeActor(member,layout.seats[0]),activities=new Set();actor.wait=0;
  for(let i=0;i<12000;i++){
   stepOfficeActor(actor,member,layout,.04,'lively');
   if(actor.phase==='break')activities.add(actor.breakKind);
   if(actor.breakKind==='phone'&&actor.phase==='break'){assert.equal(actor.x,actor.home.x);assert.equal(actor.y,actor.home.y);}
   assert.ok(!layout.blocked.has(Math.floor(actor.x/16)+','+Math.floor(actor.y/16)));
  }
  assert.deepEqual([...activities].sort(),['bench','bike','coffee','phone','walk']);assert.equal(JSON.stringify(member),before);
 }
});

test('offline unfinished assignments stay at the desk and animate phone standby without an OK badge',()=>{
 const member=floor([task('new','in_progress')]).seats[0],layout=createOfficeLayout([member]),actor=createOfficeActor(member,layout.seats[0]);
 let phone=false;for(let i=0;i<4000;i++){stepOfficeActor(actor,member,layout,.04,'lively');phone||=actor.breakKind==='phone';assert.equal(actor.x,actor.home.x);assert.equal(actor.y,actor.home.y);}
 assert.equal(phone,true);assert.ok(layout.bikes.every(b=>b.owner===null));assert.equal(officeRestState(member),'waiting');
 const html=renderToStaticMarkup(React.createElement(OfficeScene,{floor:{seats:[member]}}));assert.doesNotMatch(html,/任务完成 ·/);
});

test('new real work recalls every rest activity and releases both bicycles continuously',()=>{
 for(const kind of ['bike','coffee','walk','phone'])for(const state of ['thinking','streaming','tool-running','waiting-approval','blocked','error','provisioning']){
  const member={...offline,officeTaskFacts:{completed:true}},layout=createOfficeLayout([member]),actor=createOfficeActor(member,layout.seats[0]);
  actor.phase='break';actor.breakKind=kind;actor.wait=10;
  if(kind==='bike'){const bike=layout.bikes[1];actor.x=bike.x;actor.y=bike.y;actor.bikeId=bike.id;bike.owner=actor.id;}
  if(kind==='coffee'){actor.x=88;actor.y=200;}
  if(kind==='walk'){actor.x=312;actor.y=layout.height-40;}
  const before={x:actor.x,y:actor.y},working={...member,state};stepOfficeActor(actor,working,layout,.04,'lively');
  assert.ok(Math.hypot(actor.x-before.x,actor.y-before.y)<=.04*38+1e-9);
  advance(actor,working,layout,40);assert.equal(actor.phase,'desk');assert.equal(actor.breakKind,null);
  assert.equal(actor.x,actor.home.x);assert.equal(actor.y,actor.home.y);assert.ok(layout.bikes.every(b=>b.owner===null));
 }
});

test('offline animation honors calm, off and reduced motion',()=>{
 for(const mode of ['off','calm']){
  const layout=createOfficeLayout([offline]),actor=createOfficeActor(offline,layout.seats[0]);actor.wait=0;
  for(let i=0;i<100;i++)stepOfficeActor(actor,offline,layout,.04,mode);
  assert.equal(actor.phase,'desk');assert.equal(actor.breakKind,null);
  assert.equal(officeNeedsFrames([offline],[actor],mode,false),false);
 }
 assert.equal(officeNeedsFrames([offline],[{path:[]}],'lively',true),false);
 assert.equal(officeNeedsFrames([offline],[{path:[]}],'lively',false),true);
});

test('phone frames remain crisp grayscale, differ from typing, and retain a selectable screen',()=>{
 function draw(phone,frame){const calls=[];const ctx={save(){},restore(){},translate(){},fillRect(...p){calls.push([...p,this.fillStyle]);}};drawQuietOfficePerson(ctx,50,70,{seated:true,direction:1,phone,frame});return calls;}
 const a=draw(true,5),b=draw(true,6);assert.notDeepEqual(a,b);assert.notDeepEqual(a,draw(false,5));
 for(const p of a){assert.ok(p.slice(0,4).every(Number.isInteger));assert.match(p[4],/^#([0-9a-f]{2})\1\1$/i);}
 assert.equal(quietOfficeActorHit({x:50,y:70,phase:'break',breakKind:'phone'},{x:70,y:30}),true);
});


test('raw session and native runtime signals override stale offline completion and recall the actor',()=>{
 for(const [sessions,status,memberRunning] of [[{byId:{worker:{running:true}}},new Map(),false],[{byId:{worker:{running:false}}},new Map([['worker',{running:true}]]),false],[{byId:{worker:{running:false}}},new Map(),true]]){
  const source={id:'root',live:true,members:[{...offline,running:memberRunning}],tasks:[task('old','completed')]};
  const initial=floor(source.tasks).seats[0],layout=createOfficeLayout([initial]),actor=createOfficeActor(initial,layout.seats[0]);
  actor.phase='break';actor.breakKind='bike';actor.x=layout.bikes[0].x;actor.y=layout.bikes[0].y;actor.bikeId=layout.bikes[0].id;layout.bikes[0].owner=actor.id;
  const member=mergeFloor(source,sessions,status).seats[0];
  assert.equal(member.state,'offline');assert.equal(member.officeRuntimeFacts.running,true);assert.equal(officeRestState(member),'none');
  assert.notEqual(officeSceneSignal(initial),officeSceneSignal(member));
  stepOfficeActor(actor,member,layout,.04,'lively');assert.equal(actor.phase,'return');
  advance(actor,member,layout,40);assert.equal(actor.phase,'desk');assert.equal(actor.breakKind,null);assert.ok(layout.bikes.every(b=>b.owner===null));
  const html=renderToStaticMarkup(React.createElement(OfficeScene,{floor:{seats:[member]}}));assert.doesNotMatch(html,/任务完成 ·/);
 }
});


test('native pending approval without a tool label still vetoes offline completion',()=>{
 const member=mergeFloor({id:'root',live:true,members:[offline],tasks:[task('old','completed')]},{byId:{}},new Map([['worker',{pendingInteraction:{kind:'approval',id:'confirm'}}]])).seats[0];
 assert.equal(member.officeRuntimeFacts.waitingApproval,true);assert.equal(officeRestState(member),'none');
 const html=renderToStaticMarkup(React.createElement(OfficeScene,{floor:{seats:[member]}}));assert.doesNotMatch(html,/任务完成 ·/);
 const layout=createOfficeLayout([member]),actor=createOfficeActor(member,layout.seats[0]),bike=layout.bikes[0];
 actor.phase='break';actor.breakKind='bike';actor.x=bike.x;actor.y=bike.y;actor.bikeId=bike.id;bike.owner=actor.id;
 const before={x:actor.x,y:actor.y};stepOfficeActor(actor,member,layout,.04,'lively');
 assert.equal(actor.phase,'return');assert.ok(Math.hypot(actor.x-before.x,actor.y-before.y)<=.04*38+1e-9);
 advance(actor,member,layout,40);assert.equal(actor.phase,'desk');assert.equal(bike.owner,null);
});
