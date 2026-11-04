import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {taskEvidence,attentionItems,receiptLabel} from '../src/client/model/attention.js';
import {createReceiptStore} from '../src/client/commands/receipts.js';
import {createCommandController} from '../src/client/commands/controller.js';
import {AttentionPanel} from '../src/client/components/attention.js';
const task={id:'t',subject:'Task',ownerName:'Worker',status:'in_progress',blockedBy:[]};
const seat={id:'worker',name:'Worker',state:'thinking',phase:'active'};
const floor={id:'floor',seats:[seat],tasks:[task]};
test('assignment and busy member never prove task execution or timeout',()=>{
  const evidence=taskEvidence(task,{...floor,seats:[{...seat,since:1}]});
  assert.equal(evidence.issues.length,0);assert.match(evidence.execution,/尚无.*独立回执/);
  assert.match(evidence.execution,/成员活动不等于/);
});
test('dependencies include missing details and disappear only on completed evidence',()=>{
  const current={...task,blockedBy:['d']};
  assert.equal(taskEvidence(current,floor).issues[0].kind,'dependency');
  assert.equal(taskEvidence(current,{...floor,tasks:[current,{id:'d',status:'completed'}]}).issues.length,0);
});
test('terminal tasks do not become attention items because owner is missing or offline',()=>{
  for(const status of ['completed','deleted'])assert.equal(taskEvidence({...task,status,ownerName:''},floor).issues.length,0);
});
test('unassigned, missing owner, offline and initialization have specific next steps',()=>{
  assert.equal(taskEvidence({...task,ownerName:''},floor).issues[0].kind,'unassigned');
  assert.equal(taskEvidence(task,{...floor,seats:[]}).issues[0].kind,'owner-missing');
  for(const [patch,kind] of [[{state:'offline'},'offline'],[{phase:'provisioning'},'provisioning']]){
    const issue=taskEvidence(task,{...floor,seats:[{...seat,...patch}]}).issues[0];assert.equal(issue.kind,kind);assert.ok(issue.next);
  }
});
test('approval and failure are deduplicated per member, not multiplied by assigned tasks',()=>{
  for(const patch of [{approval:{reason:'permission'}},{state:'error',error:'actual error'}]){
    const items=attentionItems({...floor,seats:[{...seat,...patch}],tasks:[task,{...task,id:'t2'}]});assert.equal(items.length,1);assert.equal(items[0].seatId,seat.id);
  }
});
test('receipt store isolates floors, omits message text and bounds settled history while keeping pending',()=>{
  const store=createReceiptStore({capacity:2});const pending={};
  store.record(pending,{floorId:'a',kind:'message',text:'private message'});
  for(let i=0;i<4;i++)store.record({}, {floorId:'b',kind:'start'},{phase:'done'});
  assert.equal(store.list('a').length,1);assert.equal(store.list('b').length,2);assert.equal(store.list('a')[0].text,undefined);
  store.record(pending,{floorId:'a',kind:'message'},{phase:'done',value:{messageId:'m',commandId:'c'}});
  assert.equal(store.list('a')[0].commandId,'c');assert.match(receiptLabel(store.list('a')[0]),/未确认已读/);
});
test('controller double-click sends once and receipt survives modal dismissal',async()=>{
  const receipts=createReceiptStore();let calls=0,finish;
  const controller=createCommandController({receipts,execute:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});
  const draft={floorId:'floor',kind:'start',taskId:'t',seatName:'Worker'};
  const first=controller.run('scope',draft),second=controller.run('scope',draft);await Promise.resolve();
  assert.equal(first,second);assert.equal(calls,1);assert.equal(receipts.list('floor')[0].phase,'running');
  finish({phase:'error',error:{deliveryUnknown:true,title:'Unknown',hint:'Check before resending',commandId:'c'}});await first;
  controller.dismiss('scope');assert.equal(receipts.list('floor').length,1);assert.equal(attentionItems(floor,receipts.list('floor')).length,1);assert.match(receiptLabel(receipts.list('floor')[0]),/结果未知/);
});
test('execute-now assignment receipt distinguishes acceptance even without messageId',()=>{
  assert.match(receiptLabel({phase:'done',kind:'assign',executeNow:true}),/未确认已读/);
  assert.equal(receiptLabel({phase:'done',kind:'assign',executeNow:false}),'宿主已确认操作');
});
test('attention panel observes receipts, excludes other floors, preserves unknown warning and invokes read-only selection',()=>{
  const store=createReceiptStore();let renderer,selected;
  const current={...floor,tasks:[{...task,ownerName:''}]};
  act(()=>{renderer=TestRenderer.create(React.createElement(AttentionPanel,{floor:current,controller:store,verified:false,onSelectTask:value=>{selected=value;}}));});
  const text=()=>JSON.stringify(renderer.toJSON());assert.match(text(),/过期状态/);
  act(()=>renderer.root.findAllByType('button').find(node=>node.children.includes('查看任务')).props.onClick());assert.equal(selected.id,'t');
  act(()=>store.record({}, {floorId:'other',kind:'start'},{phase:'error',error:{title:'OTHER'}}));assert.doesNotMatch(text(),/OTHER/);
  act(()=>store.record({}, {floorId:'floor',kind:'start'},{phase:'error',error:{title:'UNKNOWN',deliveryUnknown:true}}));assert.match(text(),/操作结果待核对/);
  act(()=>renderer.unmount());
});
