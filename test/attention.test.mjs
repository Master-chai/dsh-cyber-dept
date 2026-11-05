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
  const store=createReceiptStore();let renderer,selected,reveal;
  const current={...floor,tasks:[{...task,ownerName:''}]};
  act(()=>{renderer=TestRenderer.create(React.createElement(AttentionPanel,{floor:current,controller:store,verified:false,onSelectTask:(value,options)=>{selected=value;reveal=options?.reveal;}}));});
  const text=()=>JSON.stringify(renderer.toJSON());assert.match(text(),/过期状态/);
  act(()=>renderer.root.findAllByType('button').find(node=>node.children.includes('查看任务')).props.onClick());assert.equal(selected.id,'t');assert.equal(reveal,true);
  act(()=>store.record({}, {floorId:'other',kind:'start'},{phase:'error',error:{title:'OTHER'}}));assert.doesNotMatch(text(),/OTHER/);
  act(()=>store.record({}, {floorId:'floor',kind:'start'},{phase:'error',error:{title:'UNKNOWN',deliveryUnknown:true}}));assert.match(text(),/操作结果待核对/);
  act(()=>renderer.unmount());
});
test('attention panel is absent when healthy, including ordinary pending and successful receipts',()=>{
 const store=createReceiptStore();let renderer;
 act(()=>{renderer=TestRenderer.create(React.createElement(AttentionPanel,{floor,controller:store}));});
 assert.equal(renderer.toJSON(),null);
 const record={};act(()=>store.record(record,{floorId:'floor',kind:'message'}));assert.equal(renderer.toJSON(),null);
 act(()=>store.record(record,{floorId:'floor',kind:'message'},{phase:'done',value:{messageId:'m'}}));assert.equal(renderer.toJSON(),null);
 act(()=>renderer.unmount());
});
test('attention panel automatically appears for new issues and hides when snapshot resolves them',()=>{
 const store=createReceiptStore();let renderer;
 act(()=>{renderer=TestRenderer.create(React.createElement(AttentionPanel,{floor,controller:store}));});assert.equal(renderer.toJSON(),null);
 act(()=>renderer.update(React.createElement(AttentionPanel,{floor:{...floor,seats:[{...seat,state:'waiting-approval'}]},controller:store})));assert.match(JSON.stringify(renderer.toJSON()),/等待审批/);
 act(()=>renderer.root.findAllByType('button').find(n=>n.children.join('').startsWith('本页操作回执')).props.onClick());
 act(()=>renderer.update(React.createElement(AttentionPanel,{floor,controller:store})));assert.equal(renderer.toJSON(),null);
 act(()=>renderer.update(React.createElement(AttentionPanel,{floor:{...floor,seats:[{...seat,state:'error'}]},controller:store})));assert.equal(renderer.root.findAllByProps({className:'cid-receipts'}).length,0);
 act(()=>renderer.unmount());
});
test('partial and delivery-unknown receipts cannot be hidden as routine successes',()=>{
 assert.equal(attentionItems(floor,[{id:'unknown',phase:'done',unknown:true,summary:'verify'}]).length,1);
 const store=createReceiptStore();let renderer;
 act(()=>{renderer=TestRenderer.create(React.createElement(AttentionPanel,{floor,controller:store}));});
 act(()=>store.record({}, {floorId:'floor',kind:'start'},{phase:'error',error:{title:'unknown',deliveryUnknown:true}}));
 assert.match(JSON.stringify(renderer.toJSON()),/操作结果待核对/);
 act(()=>renderer.update(React.createElement(AttentionPanel,{floor:{...floor,id:'other'},controller:store})));assert.equal(renderer.toJSON(),null);
 act(()=>renderer.unmount());
});
test('successes in other floors never evict unresolved receipts; explicit acknowledgment releases them',()=>{
 const store=createReceiptStore({capacity:2,unresolvedCapacity:2}),id={};
 store.record(id,{floorId:'floor',kind:'start'},{phase:'error',error:{title:'Unknown',deliveryUnknown:true}});
 for(let i=0;i<70;i++)store.record({}, {floorId:'other',kind:'message'},{phase:'done'});
 assert.equal(attentionItems(floor,store.list('floor')).length,1);assert.equal(store.list('other').length,2);
 assert.equal(store.acknowledge(id,'other'),false);assert.equal(attentionItems(floor,store.list('floor')).length,1);
 assert.equal(store.acknowledge(id,'floor'),true);assert.equal(attentionItems(floor,store.list('floor')).length,0);
});
test('unresolved capacity blocks new network execution and remains bounded until checked',async()=>{
 const receipts=createReceiptStore({capacity:2,unresolvedCapacity:1});const id={};let calls=0;
 receipts.record(id,{floorId:'floor',kind:'start'},{phase:'error',error:{title:'Unknown',deliveryUnknown:true}});
 const controller=createCommandController({receipts,execute:()=>{calls++;return {phase:'done'};}});
 const result=await controller.run('new',{floorId:'other',kind:'message'});
 assert.equal(calls,0);assert.equal(result.error.code,'office/receipt-capacity');assert.equal(receipts.list('floor').length,1);assert.equal(receipts.list('other').length,0);
 receipts.acknowledge(id,'floor');await controller.run('again',{floorId:'other',kind:'message'});assert.equal(calls,1);
});
test('acknowledging an unknown outcome requires confirmation and does not resend',()=>{
 const store=createReceiptStore();store.record({}, {floorId:'floor',kind:'start'},{phase:'error',error:{title:'Unknown',deliveryUnknown:true}});let renderer;
 act(()=>{renderer=TestRenderer.create(React.createElement(AttentionPanel,{floor,controller:store}));});
 const btn=label=>renderer.root.findAllByType('button').find(n=>n.children.join('')===label);
 act(()=>btn('已核对，移出提醒').props.onClick());assert.equal(attentionItems(floor,store.list('floor')).length,1);
 act(()=>btn('取消').props.onClick());assert.equal(attentionItems(floor,store.list('floor')).length,1);
 act(()=>btn('已核对，移出提醒').props.onClick());act(()=>btn('确认已核对').props.onClick());assert.equal(renderer.toJSON(),null);
 act(()=>renderer.unmount());
});

test('all local attention controls respond without host writes: pagination, receipts, cancel and acknowledgement',()=>{
 const store=createReceiptStore(),tasks=Array.from({length:21},(_,i)=>({...task,id:'unassigned-'+i,ownerName:''}));
 const id={};store.record(id,{floorId:'floor',kind:'start'},{phase:'error',error:{title:'Check delivery',deliveryUnknown:true}});
 let renderer;act(()=>{renderer=TestRenderer.create(React.createElement(AttentionPanel,{floor:{...floor,tasks},controller:store}));});
 const button=label=>renderer.root.findAllByType('button').find(n=>n.children.join('')===label);
 const list=()=>renderer.root.findByProps({className:'cid-attention-list'}).children;
 assert.equal(list().length,10);
 act(()=>button('显示更多待处理事项').props.onClick());assert.equal(list().length,20);
 act(()=>button('显示更多待处理事项').props.onClick());assert.equal(list().length,22);assert.equal(button('显示更多待处理事项'),undefined);
 act(()=>button('本页操作回执（1）').props.onClick());assert.equal(renderer.root.findAllByProps({className:'cid-receipts'}).length,1);
 act(()=>button('本页操作回执（1）').props.onClick());assert.equal(renderer.root.findAllByProps({className:'cid-receipts'}).length,0);
 act(()=>button('已核对，移出提醒').props.onClick());act(()=>button('取消').props.onClick());assert.equal(store.list('floor')[0].acknowledged,undefined);
 act(()=>button('已核对，移出提醒').props.onClick());act(()=>button('确认已核对').props.onClick());assert.equal(store.list('floor')[0].acknowledged,true);assert.equal(list().length,21);
 act(()=>renderer.unmount());
});
