import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {registerCommandRoute,CommandLedger} from '../src/host/command.js';
import {useOfficeCommands} from '../src/client/commands/use-commands.js';
import {useTaskCommands} from '../src/client/commands/use-task-commands.js';
import {createCommandController,executeCommandIntent} from '../src/client/commands/controller.js';
import {createReceiptStore} from '../src/client/commands/receipts.js';
import {AttentionPanel} from '../src/client/components/attention.js';
import {setRuntimeContext} from '../src/client/host/navigation.js';
import {taskRevealPatch} from '../src/client/task-board.js';

const button=(renderer,label)=>renderer.root.findAllByType('button').find(node=>node.children.join('')===label);
function fixture(owner){
 let task=null,route,refuse=true;
 const calls=[],native=[];
 const lead={id:'lead',status:'idle',steer(message){calls.push(['steer',message]);if(refuse)throw Error('driver failed after acceptance');}};
 const teams={
  membership:()=>({root:lead,role:'lead',name:'lead'}),
  getTask:(_lead,id)=>task?.id===id?{...task}:null,
  async createTask(_lead,args){calls.push(['create']);task={...args,id:'task-1',revision:1,status:'pending',blockedBy:[]};return {...task};},
  async updateTask(_lead,args){assert.equal(args.expectedRevision,task.revision);calls.push(['assign']);task={...task,revision:task.revision+1,status:'in_progress',ownerName:args.owner};return {...task};},
  async sendMessage(_lead,args){calls.push(['sendMessage',args]);if(refuse)throw Error('activity notification failed after enqueue');return {messageId:'member-receipt'};},
 };
 const ctx={get:name=>name==='agentTeams'?teams:name==='agents'?{get:()=>lead}:undefined,connection:{fetch:{register:value=>{route=value;}}}};
 registerCommandRoute(ctx,new CommandLedger());
 const receipts=createReceiptStore();
 const controller=createCommandController({receipts,execute:draft=>executeCommandIntent(draft,async(sessionId,action,args)=>{
  const response=await route.fetch(new Request('http://test/api/cyberOffice/command',{method:'POST',body:JSON.stringify({type:'client-request',rpcId:randomUUID(),method:'cyberOffice/command',payload:{commandId:randomUUID(),sessionId,action,args}})}));
  return (await response.json()).result;
 })});
 const seat={id:owner==='lead'?'lead':'worker-id',name:owner,role:owner==='lead'?'lead':'teammate',phase:'active',state:'idle'};
 const floor=()=>({id:'lead',leadId:'lead',seats:[seat],tasks:task?[{...task,ownerId:seat.id}]:[],tasksAvailable:true,live:true});
 return {calls,native,controller,receipts,seat,floor,allow:()=>{refuse=false;}};
}

for(const owner of ['lead','worker'])test(`assignment uncertainty stays inspectable without duplicate execution (${owner})`,async()=>{
 const h=fixture(owner);let renderer,commands,board,revealed;
 const dispose=setRuntimeContext({uiWorkspace:{openSession:target=>h.native.push(target)}});
 function Harness({floor}){
  commands=useOfficeCommands({floor,seat:h.seat,writeGate:{enabled:true},commandController:h.controller});
  board=useTaskCommands({floor,writeGate:{enabled:true},commandController:h.controller});
  return React.createElement(AttentionPanel,{floor,controller:h.receipts,onSelectTask:(task,options)=>{assert.equal(options.reveal,true);revealed=taskRevealPatch(floor,task);}});
 }
 try{
  act(()=>{renderer=TestRenderer.create(React.createElement(Harness,{floor:h.floor()}));});
  act(()=>commands.openAssign());
  assert.equal(commands.write.executeNow,true);
  act(()=>commands.patchWrite({subject:'One real task',description:'Verify the exact task'}));
  await act(async()=>{await commands.runWrite(commands.write);});
  assert.equal(commands.write.phase,'assigned');assert.equal(commands.write.error.deliveryUnknown,true);
  assert.deepEqual(h.calls.map(call=>call[0]),['create','assign',owner==='lead'?'steer':'sendMessage']);
  act(()=>renderer.update(React.createElement(Harness,{floor:h.floor()})));
  assert.match(JSON.stringify(renderer.toJSON()),/操作结果待核对/);
  act(()=>button(renderer,'查看任务').props.onClick());
  assert.equal(revealed.expandedTaskId,'task-1');assert.equal(revealed.search,undefined);assert.equal(revealed.filter,'all');
  // Viewing/acknowledging the uncertain receipt cannot dispatch or create again.
  act(()=>button(renderer,'已核对，移出提醒').props.onClick());
  act(()=>button(renderer,'取消').props.onClick());
  assert.equal(h.receipts.list('lead')[0].acknowledged,undefined);
  act(()=>button(renderer,'已核对，移出提醒').props.onClick());
  act(()=>button(renderer,'确认已核对').props.onClick());
  assert.equal(h.receipts.list('lead')[0].acknowledged,true);assert.equal(h.calls.length,3);
  h.allow();
  act(()=>board.open('start',h.floor().tasks[0]));assert.equal(board.write.phase,'compose');assert.equal(h.calls.length,3);
  await act(async()=>{await board.confirm();});
  assert.equal(board.write.phase,'done');assert.equal(board.write.value.execution,'accepted');
  assert.deepEqual(h.calls.map(call=>call[0]),['create','assign',owner==='lead'?'steer':'sendMessage',owner==='lead'?'steer':'sendMessage']);
  assert.equal(h.floor().tasks[0].revision,2,'explicit start never re-creates or reassigns the preserved task');
  assert.equal(h.seat.state,'idle','receipts never fabricate actual model activity');
 }finally{if(renderer)act(()=>renderer.unmount());dispose();}
});

test('attention native navigation is read-only and never answers an approval or executes a task',async()=>{
 const h=fixture('worker'),calls=[];let renderer;
 const floor={...h.floor(),seats:[{...h.seat,state:'waiting-approval',approval:{reason:'Check this command'}}]};
 const dispose=setRuntimeContext({uiWorkspace:{openSession:target=>calls.push(target)}});
 try{
  act(()=>{renderer=TestRenderer.create(React.createElement(AttentionPanel,{floor,controller:h.receipts}));});
  await act(async()=>{await button(renderer,'查看原生会话').props.onClick();});
  assert.deepEqual(calls,['worker-id']);assert.deepEqual(h.calls,[]);assert.equal(h.receipts.list('lead').length,0);
 }finally{if(renderer)act(()=>renderer.unmount());dispose();}
});
