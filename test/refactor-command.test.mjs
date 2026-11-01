import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {createCommandController,commandScope,executeCommandIntent} from '../src/client/commands/controller.js';
import {useOfficeCommands} from '../src/client/commands/use-commands.js';
import {fetchOfficeText} from '../src/client/transport.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const draft={kind:'message',phase:'compose',floorId:'root',seatName:'Worker',text:'Mock only'};
const success={phase:'done',doneMessage:'done',refreshNeeded:true};

test('pending command survives subscriber removal; same scope never dispatches twice',async()=>{
  const pending=deferred();let calls=0,updates=0;
  const controller=createCommandController({execute:()=>{calls++;return pending.promise;}});
  const scope=commandScope('root','worker');const unsubscribe=controller.subscribe(scope,()=>updates++);
  const first=controller.run(scope,draft);const second=controller.run(scope,draft);
  assert.equal(first,second);assert.equal(updates,1);unsubscribe();controller.dismiss(scope);
  await Promise.resolve();assert.equal(calls,1);assert.equal(controller.get(scope).settledAt,null);
  pending.resolve(success);await first;
  assert.equal(controller.get(scope).view.phase,'done');assert.equal(updates,1);
});

test('separate sessions and explicit task selections have separate operation ownership',async()=>{
  const a=deferred(),b=deferred();
  const controller=createCommandController({execute:current=>current.floorId==='a'?a.promise:b.promise});
  const sa=commandScope('a','same-member','task-1'),sb=commandScope('b','same-member','task-1');
  assert.notEqual(sa,sb);assert.notEqual(sa,commandScope('a','same-member','task-2'));
  const first=controller.run(sa,{...draft,floorId:'a'}),second=controller.run(sb,{...draft,floorId:'b'});
  b.resolve({...success,doneMessage:'B'});await second;
  assert.equal(controller.get(sa).view.phase,'running');assert.equal(controller.get(sb).view.doneMessage,'B');
  a.resolve({...success,doneMessage:'A'});await first;assert.equal(controller.get(sa).view.doneMessage,'A');
});

test('bounded command cache evicts settled entries but retains pending work and rejects excess execution',async()=>{
  let now=0,calls=0;const pending=deferred();
  const controller=createCommandController({capacity:1,maxPending:1,ttlMs:10,now:()=>now,execute:current=>{calls++;return current.floorId==='pending'?pending.promise:success;}});
  const first=controller.run('pending',{...draft,floorId:'pending'});await Promise.resolve();
  const rejected=await controller.run('other',draft);assert.equal(rejected.error.code,'office/busy');assert.equal(calls,1);
  now=20;assert.equal(controller.get('other'),null);assert.equal(controller.get('pending').view.phase,'running');
  pending.resolve(success);await first;await controller.run('second',draft);
  assert.equal(controller.get('pending'),null);assert.equal(controller.get('second').view.phase,'done');
});

test('assignment keeps created task and uncertain error without creating or sending again',async()=>{
  const calls=[];
  const result=await executeCommandIntent({...draft,kind:'assign',subject:'Task',description:'Details'},async(session,action,args)=>{
    calls.push({session,action,args});
    if(action==='task.create')return {ok:true,value:{task:{id:'task-91',revision:1,subject:'Task'}}};
    throw {code:'office/network',message:'lost receipt',details:{deliveryUnknown:true,commandId:'receipt'}};
  });
  assert.deepEqual(calls.map(call=>call.action),['task.create','task.assign']);
  assert.equal(result.phase,'unowned');assert.equal(result.task.id,'task-91');assert.equal(result.error.commandId,'receipt');assert.equal(result.error.deliveryUnknown,true);
});

test('a rejected create stops assignment; existing assignment skips create',async()=>{
  const calls=[];
  const post=async(_session,action)=>{calls.push(action);return {ok:false,error:{code:'office/task-limit',message:'full'}};};
  const creation=await executeCommandIntent({...draft,kind:'assign',subject:'Task',description:'Details'},post);
  assert.equal(creation.phase,'error');assert.deepEqual(calls,['task.create']);calls.length=0;
  const assignment=await executeCommandIntent({...draft,kind:'assign',taskId:'task-3',taskRevision:4},post);
  assert.equal(assignment.phase,'unowned');assert.deepEqual(calls,['task.assign']);
});

test('caller cancellation settles the shared transport even when fetch ignores the signal',async()=>{
  const oldFetch=globalThis.fetch;let child;
  globalThis.fetch=(_url,options)=>{child=options.signal;return new Promise(()=>{});};
  try {
    const abort=new AbortController();const request=fetchOfficeText('/mock',{signal:abort.signal},10000);
    const rejected=assert.rejects(request,{name:'AbortError'});abort.abort();await rejected;assert.equal(child.aborted,true);
  } finally {globalThis.fetch=oldFetch;}
});

function harness(controller,props) {
  let state,renderer;
  function Hook(next){state=useOfficeCommands({...next,commandController:controller});return null;}
  act(()=>{renderer=TestRenderer.create(React.createElement(Hook,props));});
  return {get state(){return state;},update(next){act(()=>renderer.update(React.createElement(Hook,next)));},close(){act(()=>renderer.unmount());}};
}
const seat={id:'worker',name:'Worker',role:'teammate',phase:'active',state:'thinking'};
const props={seat,floor:{id:'root'},writeGate:{enabled:true}};

test('switching target cannot receive a previous target result or dispatch through a stale handler',async()=>{
  const pending=deferred();let calls=0,refreshes=0;
  const controller=createCommandController({execute:()=>{calls++;return pending.promise;}});
  const mounted=harness(controller,{...props,onRefresh:()=>refreshes++});
  act(()=>mounted.state.openMessage());act(()=>mounted.state.patchWrite({text:'Mock only'}));
  const oldHandler=mounted.state.runWrite,oldDraft=mounted.state.write;let operation;
  act(()=>{operation=oldHandler(oldDraft);});
  mounted.update({...props,seat:{...seat,id:'other',name:'Other'},onRefresh:()=>refreshes++});
  await act(async()=>{await oldHandler(oldDraft);});assert.equal(calls,1);
  await act(async()=>{pending.resolve(success);await operation;});
  assert.equal(mounted.state.write,null);assert.equal(mounted.state.last,null);assert.equal(refreshes,0);
  mounted.update({...props,onRefresh:()=>refreshes++});
  assert.equal(mounted.state.write,null);assert.equal(mounted.state.last.text,'done');mounted.close();
});

test('remount resumes a pending command and completion refreshes only once',async()=>{
  const pending=deferred();let calls=0,refreshes=0;
  const controller=createCommandController({execute:()=>{calls++;return pending.promise;}});
  const first=harness(controller,props);act(()=>first.state.openMessage());act(()=>first.state.patchWrite({text:'Mock'}));let operation;
  act(()=>{operation=first.state.runWrite(first.state.write);});first.close();
  const second=harness(controller,{...props,onRefresh:()=>refreshes++});assert.equal(second.state.write.phase,'running');
  await act(async()=>{pending.resolve(success);await operation;});assert.equal(second.state.write.phase,'done');assert.equal(calls,1);assert.equal(refreshes,1);second.close();
});

test('confirmation rechecks the latest write gate before dispatch',async()=>{
  let calls=0;const controller=createCommandController({execute:()=>{calls++;return success;}});
  const mounted=harness(controller,props);act(()=>mounted.state.openMessage());act(()=>mounted.state.patchWrite({text:'Mock'}));
  mounted.update({...props,writeGate:{enabled:false,reason:'preview'}});
  await act(async()=>{await mounted.state.runWrite(mounted.state.write);});
  assert.equal(calls,0);assert.match(mounted.state.write.fieldError,/preview/);mounted.close();
});
