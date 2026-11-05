import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {executeOfficeCommand,readCommandArgs,failFromError,registerCommandRoute,CommandLedger} from '../src/host/command.js';
import {executeCommandIntent,createCommandController} from '../src/client/commands/controller.js';
import {useTaskCommands,taskActionProblem} from '../src/client/commands/use-task-commands.js';
import {useOfficeCommands} from '../src/client/commands/use-commands.js';
import {TaskBoard} from '../src/client/task-board.js';

const task={id:'task-1',subject:'Implement feature',revision:3,status:'in_progress',ownerName:'Worker',blockedBy:[]};
const seat={id:'worker',name:'Worker',role:'teammate',phase:'active',state:'idle'};
const floor={id:'root',leadId:'root',seats:[seat],tasks:[task]};
const gate={enabled:true};
const payload=action=>({commandId:'4a7b9a89-7358-41ce-8de4-783f2548feea',sessionId:'root',action,args:{taskId:'task-1',expectedRevision:3}});
function host(current={...task}) {
  const calls=[],lead={id:'root'};
  const teams={
    getTask(_lead,id){return id===current.id?{...current}:null;},
    async updateTask(actor,args){calls.push(['update',actor,args]);return {...current,status:'deleted',revision:4};},
    async sendMessage(actor,args){calls.push(['message',actor,args]);return {messageId:'m1'};},
  };
  const ctx={get:name=>name==='agentTeams'?teams:name==='agents'?{get:()=>lead}:undefined};
  return {ctx,teams,calls,lead};
}
test('delete/start accept only task identity and revision, rejecting owner injection and invalid versions',()=>{
  for(const action of ['task.delete','task.start']){
    assert.equal(readCommandArgs(action,{taskId:'task-1',expectedRevision:3}).ok,true);
    for(const args of [{taskId:'task-1',expectedRevision:0},{taskId:'bad',expectedRevision:3},{taskId:'task-1',expectedRevision:3,owner:'attacker'}])assert.equal(readCommandArgs(action,args).ok,false);
  }
});
test('delete uses native CAS delete and does not interrupt or notify the member',async()=>{
  const h=host();const result=await executeOfficeCommand(h.ctx,payload('task.delete'));
  assert.equal(result.ok,true);assert.equal(result.value.task.status,'deleted');
  assert.deepEqual(h.calls,[['update',h.lead,{taskId:'task-1',expectedRevision:3,action:'delete'}]]);
  assert.equal(failFromError({code:'TEAM_TASK_HAS_DEPENDENTS',message:'dependency'},'task.delete').error.code,'office/task-has-dependents');
});
test('start resolves the live task owner, sends one bounded instruction and never changes task state',async()=>{
  const h=host();const result=await executeOfficeCommand(h.ctx,payload('task.start'));
  assert.equal(result.ok,true);assert.equal(result.value.target,'Worker');assert.equal(result.value.messageId,'m1');
  assert.equal(h.calls.length,1);const [method,lead,args]=h.calls[0];assert.equal(method,'message');assert.equal(lead,h.lead);
  assert.equal(args.target,'Worker');assert.match(args.content[0].text,/task-1/);assert.match(args.content[0].text,/确认任务仍由你负责且未删除/);assert.ok(args.signal instanceof AbortSignal);
});
test('start rejects stale, deleted, unassigned, completed and dependency-blocked tasks before sending',async()=>{
  for(const [patch,code] of [[{revision:4},'stale-revision'],[{status:'deleted'},'task-deleted'],[{ownerName:null},'invalid-transition'],[{status:'completed'},'invalid-transition'],[{blockedBy:['task-2']},'task-blocked']]){
    const h=host({...task,...patch});const result=await executeOfficeCommand(h.ctx,payload('task.start'));
    assert.equal(result.error.code,'office/'+code);assert.equal(h.calls.length,0);
  }
});
test('start permits completed dependencies but rejects a task that changes while dependencies are read',async()=>{
  const h=host({...task,blockedBy:['task-2']});let reads=0;
  h.teams.getTask=(_lead,id)=>id==='task-2'?{id,status:'completed'}:{...task,blockedBy:['task-2'],revision:++reads===1?3:4};
  assert.equal((await executeOfficeCommand(h.ctx,payload('task.start'))).error.code,'office/stale-revision');assert.equal(h.calls.length,0);
  h.teams.getTask=(_lead,id)=>id==='task-2'?{id,status:'completed'}:{...task,blockedBy:['task-2']};
  assert.equal((await executeOfficeCommand(h.ctx,payload('task.start'))).ok,true);assert.equal(h.calls.length,1);
});
test('an execution instruction timeout is delivery-unknown and same commandId replay never sends twice',async()=>{
  const h=host();let route;registerCommandRoute({...h.ctx,connection:{fetch:{register:value=>{route=value;return()=>{};}}}},new CommandLedger());
  const request=()=>new Request('http://mock/api/cyberOffice/command',{method:'POST',body:JSON.stringify({type:'client-request',rpcId:'rpc',method:'cyberOffice/command',payload:payload('task.start')})});
  assert.equal((await (await route.fetch(request())).json()).result.ok,true);
  assert.equal((await (await route.fetch(request())).json()).result.ok,true);assert.equal(h.calls.length,1);
  h.teams.sendMessage=async()=>{throw new DOMException('timeout','TimeoutError');};
  const result=await executeOfficeCommand(h.ctx,payload('task.start'));assert.equal(result.error.details.deliveryUnknown,true);
});
const assign={kind:'assign',floorId:'root',seatName:'Worker',subject:'New task',description:'Details',executeNow:true};
test('new assignment executes create then assign then start using the assigned revision',async()=>{
  const calls=[];
  const result=await executeCommandIntent(assign,async(_id,action,args)=>{
    calls.push([action,args]);return {ok:true,value:{task:{...task,revision:action==='task.create'?1:2}}};
  });
  assert.deepEqual(calls.map(c=>c[0]),['task.create','task.assign','task.start']);assert.equal(calls[2][1].expectedRevision,2);assert.equal(result.phase,'done');assert.match(result.doneMessage,/已发送立即执行指令/);
});
test('existing assignment with execute disabled retains the original assign-only behavior',async()=>{
  const calls=[];await executeCommandIntent({...assign,executeNow:false,taskId:task.id,taskRevision:3},async(_id,action)=>{calls.push(action);return {ok:true,value:{task}};});
  assert.deepEqual(calls,['task.assign']);
});
test('failed or uncertain execution keeps committed assignment and never retries or recreates',async()=>{
  for(const unknown of [false,true]){
    const calls=[];
    const result=await executeCommandIntent({...assign,taskId:task.id,taskRevision:3},async(_id,action)=>{
      calls.push(action);if(action==='task.start')throw {code:unknown?'office/network':'office/member-not-found',details:{deliveryUnknown:unknown}};
      return {ok:true,value:{task:{...task,revision:4}}};
    });
    assert.deepEqual(calls,['task.assign','task.start']);assert.equal(result.phase,'assigned');assert.equal(result.task.revision,4);assert.equal(result.error.deliveryUnknown,unknown);assert.match(result.doneMessage,/任务已指派/);
  }
});
test('failed assignment never dispatches an execution instruction',async()=>{
  const calls=[];const result=await executeCommandIntent({...assign,taskId:task.id,taskRevision:3},async(_id,action)=>{calls.push(action);return {ok:false,error:{code:'office/stale-revision'}};});
  assert.equal(result.phase,'unowned');assert.deepEqual(calls,['task.assign']);
});
test('board capability checks enforce dependents, readiness and preview gating, allowing lead execution',()=>{
  assert.equal(taskActionProblem(floor,task,gate,'delete'),'');assert.equal(taskActionProblem(floor,task,gate,'start'),'');
  assert.match(taskActionProblem({...floor,tasks:[task,{id:'task-2',subject:'Depends',status:'completed',blockedBy:[task.id]}]},task,gate,'delete'),/依赖/);
  assert.match(taskActionProblem(floor,task,{enabled:false,reason:'preview'},'delete'),/preview/);
  assert.equal(taskActionProblem({...floor,seats:[{...seat,role:'lead'}]},task,gate,'start'),'');
});
function hook(controller,initial={floor,writeGate:gate},which=useTaskCommands){
  let state,renderer;function Hook(props){state=which({...props,commandController:controller});return null;}
  act(()=>{renderer=TestRenderer.create(React.createElement(Hook,initial));});
  return {get state(){return state;},update:props=>act(()=>renderer.update(React.createElement(Hook,props))),close:()=>act(()=>renderer.unmount())};
}
test('delete confirmation rechecks revision, gate and newly introduced dependents',async()=>{
  let calls=0;const controller=createCommandController({execute:()=>{calls++;return {phase:'done'};}});
  for(const next of [{floor:{...floor,tasks:[{...task,revision:4}]},writeGate:gate},{floor,writeGate:{enabled:false,reason:'preview'}},{floor:{...floor,tasks:[task,{id:'task-2',status:'pending',blockedBy:[task.id]}]},writeGate:gate}]){
    const h=hook(controller);act(()=>h.state.open('delete',task));h.update(next);
    await act(async()=>{await h.state.confirm();});assert.ok(h.state.write.fieldError);assert.equal(calls,0);h.close();
  }
});
test('late delete completion and stale handlers cannot affect a different session',async()=>{
  let finish,calls=0,deletions=0;const pending=new Promise(resolve=>finish=resolve);
  const h=hook(createCommandController({execute:()=>{calls++;return pending;}}),{floor,writeGate:gate,onDeleted:()=>deletions++});
  act(()=>h.state.open('delete',task));const old=h.state.confirm;let operation;act(()=>{operation=old();});
  h.update({floor:{...floor,id:'other'},writeGate:gate,onDeleted:()=>deletions++});
  await act(async()=>{await old();finish({phase:'done',refreshNeeded:true});await operation;});
  assert.equal(calls,1);assert.equal(deletions,0);assert.equal(h.state.write,null);assert.equal(h.state.last,null);h.close();
});
test('successful deletion reports its exact task and refreshes once even when confirmation is double-clicked',async()=>{
  let calls=0,refreshes=0;const ids=[];
  const h=hook(createCommandController({execute:()=>{calls++;return {phase:'done',doneMessage:'deleted',refreshNeeded:true};}}),{floor,writeGate:gate,onDeleted:id=>ids.push(id),onRefresh:()=>refreshes++});
  act(()=>h.state.open('delete',task));const confirm=h.state.confirm;
  await act(async()=>{await Promise.all([confirm(),confirm()]);});
  assert.equal(calls,1);assert.deepEqual(ids,[task.id]);assert.equal(refreshes,1);assert.equal(h.state.write.phase,'done');h.close();
});
test('assignment to lead defaults to execution without enabling Team self-messaging',async()=>{
  let calls=0;const h=hook(createCommandController({execute:()=>{calls++;return {phase:'done',doneMessage:'accepted'};}}),{seat:{...seat,role:'lead',id:'root'},floor,writeGate:gate},useOfficeCommands);
  act(()=>h.state.openAssign());assert.equal(h.state.write.executeAllowed,true);assert.equal(h.state.write.executeNow,true);assert.equal(h.state.messageAllowed,false);
  act(()=>h.state.patchWrite({subject:'task',description:'details'}));
  await act(async()=>h.state.runWrite(h.state.write));assert.equal(calls,1);assert.equal(h.state.write.phase,'done');h.close();
});
test('task board exposes separate action buttons only in task details and respects readonly',()=>{
  const actions=[];let r;act(()=>{r=TestRenderer.create(React.createElement(TaskBoard,{floor,writeGate:gate,onTaskAction:(...args)=>actions.push(args)}));});
  assert.equal(r.root.findAllByProps({'data-task-action':'delete'}).length,0);
  act(()=>r.root.findByProps({className:'cid-task-row'}).props.onClick());
  const button=r.root.findByProps({'data-task-action':'delete'});assert.equal(button.props.disabled,false);act(()=>button.props.onClick());assert.equal(actions[0][0],'delete');assert.equal(actions[0][1].id,task.id);
  act(()=>r.update(React.createElement(TaskBoard,{floor,writeGate:{enabled:false},onTaskAction:()=>{}})));
  assert.equal(r.root.findByProps({'data-task-action':'delete'}).props.disabled,true);act(()=>r.unmount());
});
