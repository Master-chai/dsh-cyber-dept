import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
const code=readFileSync(new URL('../.verify/client-test.js',import.meta.url),'utf8');
function load(fetchImpl) {
  let plugin;
  vm.runInNewContext(code,{
    window:{__ModuleLoader__:{load:({factory})=>plugin=factory(()=>React)},matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})},
    document:{activeElement:null,addEventListener(){},removeEventListener(){}},
    AbortController,AbortSignal,setTimeout,clearTimeout,fetch:fetchImpl||(()=>{throw new Error('Unexpected request');}),
  });
  return plugin.__internals;
}
const seat={id:'worker',name:'Worker',role:'teammate',phase:'active',state:'thinking'};
const task={id:'task-7',revision:4,subject:'Exact task',status:'completed',ownerName:'Worker',ready:false};
const props={seat,floor:{id:'root',leadId:'root',tasks:[task]},writeGate:{enabled:true}};
const button=(r,action)=>r.root.findByProps({'data-cyber-write':action});
const text=r=>JSON.stringify(r.toJSON());
function response(body,value) {return {ok:true,status:200,text:async()=>JSON.stringify({type:'server-response',rpcId:body.rpcId,result:{ok:true,value}})};}
function render(api,extra={}){let r;act(()=>{r=TestRenderer.create(React.createElement(api.DetailPane,{...props,...extra}));});return r;}
function close(r){act(()=>r.unmount());}

test('real React renders writable details; self-message and self-interrupt are disabled',()=>{
  const api=load();const r=render(api,{seat:{...seat,id:'root',name:'lead',role:'lead'}});
  assert.equal(button(r,'message').props.disabled,true);assert.equal(button(r,'interrupt').props.disabled,true);
  assert.equal(button(r,'assign').props.disabled,false);close(r);
});
test('offline active members can receive messages; idle/failed/provisioning members cannot be interrupted',()=>{
  const api=load();
  for(const state of ['offline','idle','done']){const r=render(api,{seat:{...seat,state}});assert.equal(button(r,'message').props.disabled,false);assert.equal(button(r,'interrupt').props.disabled,true);close(r);}
  for(const phase of ['failed','provisioning']){const r=render(api,{seat:{...seat,phase}});assert.equal(button(r,'message').props.disabled,true);assert.equal(button(r,'assign').props.disabled,true);close(r);}
});
test('reopen confirms owner removal and sends the exact selected task revision',async()=>{
  const calls=[];const api=load(async(_url,options)=>{const body=JSON.parse(options.body);calls.push(body.payload);return response(body,{task:{...task,status:'pending',revision:5}});});
  const r=render(api,{taskOverride:task});act(()=>button(r,'reopen').props.onClick());
  assert.ok(text(r).includes('取消原负责人'));
  await act(async()=>{await r.root.findByProps({'data-cyber-confirm':'1'}).props.onClick();});
  assert.equal(calls.length,1);assert.equal(calls[0].action,'task.reopen');assert.deepEqual(calls[0].args,{taskId:'task-7',expectedRevision:4});close(r);
});
test('pending tasks cannot be completed; ambiguous completed tasks require explicit board selection',()=>{
  const api=load();const r=render(api,{taskOverride:{...task,status:'pending',ready:true}});
  assert.equal(button(r,'complete').props.disabled,true);close(r);
  const snap=api.normalizeSnapshot({floors:[{id:'root',live:true,members:[{id:'worker',name:'Worker',status:'idle'}],tasks:[task,{...task,id:'task-8'}]}]});
  const floor=api.mergeFloor(snap.floors[0],{},null);assert.equal(floor.seats[0].completedTask,null);
});
test('existing-task assignment with execution unchecked sends only task.assign, without creating a duplicate',async()=>{
  const calls=[];const api=load(async(_url,options)=>{const body=JSON.parse(options.body);calls.push(body.payload);return response(body,{task:{...task,status:'in_progress'}});});
  const r=render(api,{floor:{...props.floor,tasks:[{...task,status:'pending',ownerName:'',ready:true}]}});
  act(()=>button(r,'assign').props.onClick());act(()=>r.root.findByType('select').props.onChange({target:{value:task.id}}));
  act(()=>r.root.findByProps({'data-cyber-field':'assign-execute-now'}).props.onChange({target:{checked:false}}));
  await act(async()=>{await r.root.findByProps({'data-cyber-confirm':'1'}).props.onClick();});
  assert.equal(calls.length,1);assert.equal(calls[0].action,'task.assign');assert.deepEqual(calls[0].args,{taskId:'task-7',expectedRevision:4,owner:'Worker'});close(r);
});
test('create success followed by lost assign response preserves the task and refreshes without retrying',async()=>{
  let requests=0,refreshes=0;
  const api=load(async(_url,options)=>{requests++;const body=JSON.parse(options.body);if(requests===2)throw new Error('lost response');return response(body,{task:{...task,id:'task-99',status:'pending',revision:1}});});
  const r=render(api,{onRefresh:()=>refreshes++});act(()=>button(r,'assign').props.onClick());
  act(()=>r.root.findByProps({'data-cyber-field':'assign-subject'}).props.onChange({target:{value:'New task'}}));
  act(()=>r.root.findByProps({'data-cyber-field':'assign-description'}).props.onChange({target:{value:'Description'}}));
  await act(async()=>{await r.root.findByProps({'data-cyber-confirm':'1'}).props.onClick();});
  assert.equal(requests,2);assert.equal(refreshes,1);assert.equal(r.root.findByProps({'data-cyber-modal':'write'}).props['data-cyber-phase'],'unowned');
  assert.ok(text(r).includes('task-99'));assert.ok(text(r).includes('指派结果待确认'));close(r);
});
test('lost response and client deadline keep an operation identity and unknown delivery state',async()=>{
  const api=load(async()=>({ok:true,status:200,text:async()=>{throw new Error('accepted but disconnected');}}));
  await assert.rejects(api.postOfficeCommand('root','message.send',{target:'Worker',text:'mock'}),error=>error.details.deliveryUnknown&&!!error.details.commandId);
  const stalled=load(()=>new Promise(()=>{}));
  await assert.rejects(stalled.postOfficeCommand('root','message.send',{target:'Worker',text:'mock'},{timeoutMs:5}),error=>error.code==='office/timeout'&&error.details.deliveryUnknown);
});
test('snapshot fetch deadline aborts the transport rather than waiting indefinitely',async()=>{
  let signal;const api=load((_url,options)=>{signal=options.signal;return new Promise(()=>{});});
  await assert.rejects(api.fetchOfficeText('/mock',{},5),{name:'TimeoutError'});assert.equal(signal.aborted,true);
});
test('readiness means pending readiness, never a blocked running/completed task',()=>{
  const api=load();for(const status of ['in_progress','completed','deleted'])assert.equal(api.isTaskBlocked({...task,status,ready:false}),false);
  assert.equal(api.isTaskBlocked({...task,status:'pending',ready:false}),true);
  assert.equal(api.officeChanges({id:'root',tasks:[{...task,status:'pending',ready:true}]},{id:'root',tasks:[{...task,status:'in_progress',ready:false}]}).length,0);
});
test('live member provisioning and failure win over inactive availability',()=>{
  const api=load();assert.equal(api.deriveSeatState({live:true,member:{phase:'provisioning',state:'offline'}}),'provisioning');
  assert.equal(api.deriveSeatState({live:true,member:{phase:'failed',state:'offline'}}),'error');
  assert.equal(api.deriveSeatState({live:false,member:{phase:'provisioning',state:'offline'}}),'offline');
});
test('host tasks backfill missing native projections; newer native revisions and explicit deletions remain authoritative',()=>{
  const api=load();const snap=api.normalizeSnapshot({floors:[{id:'root',members:[{id:'root'},{id:'worker'}],tasks:[task]}]});
  assert.equal(api.mergeFloor(snap.floors[0],{},null).tasks[0].id,task.id);
  const native=tasks=>({projectionsBySession:{root:{values:{agentTeam:{members:[{id:'root'},{id:'worker'}],tasks}}}}});
  assert.equal(api.mergeFloor(snap.floors[0],native([{...task,revision:6}]),null).tasks[0].revision,6);
  const emptied=api.mergeFloor({...snap.floors[0],taskCounts:{completed:1}},native([]),null);
  assert.equal(emptied.tasks.length,0);assert.equal(emptied.taskCounts.completed,0);
});
test('irrelevant current-session projections preserve the office selector reference',()=>{
  const api=load(),select=api.createOfficeSelector('sessions'),team={members:[{id:'root'},{id:'worker'}]};
  const first=select({byId:{root:{displayTitle:'x',running:true}},projectionsBySession:{root:{values:{agentTeam:team,usage:1}}}},['root'],true);
  const next=select({byId:{root:{displayTitle:'x',running:true,tokenCount:9}},projectionsBySession:{root:{values:{agentTeam:team,usage:99}}}},['root'],true);
  assert.equal(first,next);
});
test('collapsed lazy sections do not mount expensive content; opening mounts it',()=>{
  const api=load();let mounts=0;function Content(){mounts++;return React.createElement('p',null,'large list');}
  let r;act(()=>{r=TestRenderer.create(React.createElement(api.CollapsibleSection,{sectionKey:'tasks',title:'Tasks',lazy:true,expanded:false},React.createElement(Content)));});
  assert.equal(mounts,0);act(()=>{r.update(React.createElement(api.CollapsibleSection,{sectionKey:'tasks',title:'Tasks',lazy:true,expanded:true},React.createElement(Content)));});assert.equal(mounts,1);close(r);
});
test('large task boards mount 50 rows initially and reveal subsequent rows on demand',()=>{
  const api=load(),tasks=Array.from({length:150},(_,i)=>({...task,id:'task-'+i}));let r;
  act(()=>{r=TestRenderer.create(React.createElement(api.TaskBoard,{floor:{tasks,seats:[]}}));});
  assert.equal(r.root.findAll(n=>n.type==='li'&&n.props['data-task-id']).length,50);
  act(()=>r.root.findAllByType('button').find(b=>typeof b.props.children==='string'&&b.props.children.includes('显示更多')).props.onClick());
  assert.equal(r.root.findAll(n=>n.type==='li'&&n.props['data-task-id']).length,100);close(r);
});


test('approval button opens the native Session and displays refusal without answering the approval',async()=>{
 const api=load();let calls=0;const dispose=api.setRuntimeContext({uiWorkspace:{openSession(){calls++;throw Error('native navigation refused');}}});
 const r=render(api,{seat:{...seat,approval:{toolName:'bash',reason:'Review command'}}});
 try{
  await act(async()=>{await button(r,'approval').props.onClick();});
  assert.equal(calls,1);assert.match(r.root.findByProps({role:'alert'}).children.join(''),/native navigation refused/);
 }finally{close(r);dispose();}
});
