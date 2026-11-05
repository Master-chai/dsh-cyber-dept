import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {setRuntimeContext,openNativeSession,nativeSessionTarget} from '../src/client/host/navigation.js';
import {AttentionPanel} from '../src/client/components/attention.js';
import {useNativeSession} from '../src/client/host/use-native-session.js';
import {createReceiptStore} from '../src/client/commands/receipts.js';
const pending=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const seat={id:'worker',name:'Worker',phase:'active',state:'waiting-approval',approval:{toolName:'bash',reason:'Review the command'}};
const floor={id:'lead',seats:[seat],tasks:[]};
function button(renderer,label){return renderer.root.findAllByType('button').find(node=>node.children.join('')===label);}

test('native navigation uses the official openSession action without delayed panel changes',async()=>{
 const calls=[];const dispose=setRuntimeContext({uiWorkspace:{openSession:target=>calls.push(['open',target])},layout:{selectPanel:panel=>calls.push(['panel',panel])}});
 try{assert.deepEqual(await openNativeSession('worker'),{ok:true});await new Promise(resolve=>setTimeout(resolve,160));assert.deepEqual(calls,[['open','worker']]);}
 finally{dispose();}
});
test('native navigation reports missing services, invalid targets and synchronous host refusal',async()=>{
 setRuntimeContext(null);assert.match((await openNativeSession('worker')).error,/尚未就绪/);
 let dispose=setRuntimeContext({});assert.match((await openNativeSession('worker')).error,/未提供/);dispose();
 let calls=0;dispose=setRuntimeContext({uiWorkspace:{openSession(){calls++;throw Error('sessions.retain: unknown session worker');}}});
 try{
  assert.match((await openNativeSession(null)).error,/有效.*地址/);
  assert.match((await openNativeSession('worker')).error,/unknown session worker/);assert.equal(calls,1);
 }finally{dispose();}
});
test('exact subagent addresses work without a preloaded native catalog and without inventing a parent',async()=>{
 const calls=[],address={parentSessionId:'direct-parent',childSessionId:'worker',mode:'unknown'};
 const dispose=setRuntimeContext({uiWorkspace:{openSession:target=>calls.push(target)},sessions:{subagentAddress:()=>address,list:{getSnapshot:()=>({byId:{}})},refresh:()=>{throw Error('unexpected refresh');}}});
 try{
  assert.deepEqual(nativeSessionTarget({id:'worker'}),'worker');
  assert.deepEqual(nativeSessionTarget({id:'worker',parentSessionId:'direct-parent'}),address);
  assert.deepEqual(await openNativeSession('worker'),{ok:true});assert.deepEqual(calls,[address]);
  calls.length=0;assert.deepEqual(await openNativeSession(address),{ok:true});assert.deepEqual(calls,[address]);
 }finally{dispose();}
});
test('a one-time list refresh repairs office snapshot arriving before the native list',async()=>{
 const calls=[];let listed=false;
 const dispose=setRuntimeContext({uiWorkspace:{openSession:target=>{assert.equal(listed,true);calls.push(target);}},sessions:{list:{getSnapshot:()=>({byId:listed?{worker:{}}:{}})},refresh:async()=>{calls.push('refresh');listed=true;}}});
 try{assert.deepEqual(await openNativeSession('worker'),{ok:true});assert.deepEqual(calls,['refresh','worker']);}
 finally{dispose();}
});
test('refresh failures stay visible and never issue a speculative open',async()=>{
 let calls=0;const dispose=setRuntimeContext({uiWorkspace:{openSession:()=>calls++},sessions:{list:{getSnapshot:()=>({byId:{}})},refresh:()=>Promise.reject(Error('disconnected'))}});
 try{assert.match((await openNativeSession('worker')).error,/disconnected/);assert.equal(calls,0);}
 finally{dispose();}
});
test('navigation refresh cannot overwrite a newer session, panel or plugin lifetime',async()=>{
 for(const change of ['session','panel','lifetime','request']){
  const refresh=pending(),calls=[];let mounted='lead',panel=null;
  const ctx={uiWorkspace:{openSession:target=>calls.push(target)},sidebarRight:{mounted:{getSnapshot:()=>mounted}},layout:{panelInfo:{getSnapshot:()=>({activePanelId:panel})}},sessions:{list:{getSnapshot:()=>({byId:{other:{}}})},refresh:()=>refresh.promise}};
  const dispose=setRuntimeContext(ctx),opening=openNativeSession('worker');
  if(change==='session')mounted='other';
  if(change==='panel')panel='settings';
  if(change==='lifetime')dispose();
  if(change==='request')await openNativeSession('other');
  refresh.resolve();assert.equal((await opening).cancelled,true);assert.deepEqual(calls,change==='request'?['other']:[]);dispose();
 }
});
test('attention native-session click selects its member, surfaces async refusal and retries only on another click',async()=>{
 let renderer,selected,calls=0;const fail=pending();
 const dispose=setRuntimeContext({uiWorkspace:{openSession(){calls++;return calls===1?fail.promise:undefined;}}});
 try{
  act(()=>{renderer=TestRenderer.create(React.createElement(AttentionPanel,{floor,controller:createReceiptStore(),onSelectSeat:id=>selected=id}));});
  let first,second;act(()=>{first=button(renderer,'查看原生会话').props.onClick();second=button(renderer,'查看原生会话').props.onClick();});
  assert.equal(first,second);assert.equal(calls,1);assert.equal(selected,'worker');assert.match(JSON.stringify(renderer.toJSON()),/正在打开原生会话/);
  await act(async()=>{fail.reject(Error('permission denied'));await first;});
  assert.match(renderer.root.findByProps({role:'alert'}).children.join(''),/permission denied/);assert.equal(calls,1);
  await act(async()=>{await button(renderer,'查看原生会话').props.onClick();});
  assert.equal(calls,2);assert.equal(renderer.root.findAllByProps({role:'alert'}).length,0);
 }finally{if(renderer)act(()=>renderer.unmount());dispose();}
});
test('old attention failure cannot leak into a different floor after navigation changes',async()=>{
 let renderer;const response=pending(),store=createReceiptStore();const dispose=setRuntimeContext({uiWorkspace:{openSession:()=>response.promise}});
 try{
  act(()=>{renderer=TestRenderer.create(React.createElement(AttentionPanel,{floor,controller:store}));});
  let opening;act(()=>{opening=button(renderer,'查看原生会话').props.onClick();});
  act(()=>renderer.update(React.createElement(AttentionPanel,{floor:{...floor,id:'another'},controller:store})));
  await act(async()=>{response.reject(Error('old failure'));await opening;});
  assert.equal(renderer.root.findAllByProps({role:'alert'}).length,0);
 }finally{if(renderer)act(()=>renderer.unmount());dispose();}
});

test('clicking another member during a pending open does not reuse the first member target',async()=>{
 const responses=[pending(),pending()],calls=[];let renderer;
 const dispose=setRuntimeContext({uiWorkspace:{openSession:target=>{calls.push(target);return responses[calls.length-1].promise;}}});
 try{
  act(()=>{renderer=TestRenderer.create(React.createElement(AttentionPanel,{floor:{...floor,seats:[seat,{...seat,id:'other',name:'Other'}]},controller:createReceiptStore()}));});
  const buttons=renderer.root.findAllByType('button').filter(node=>node.children.join('')==='查看原生会话');
  let first,second;act(()=>{first=buttons[0].props.onClick();second=buttons[1].props.onClick();});assert.deepEqual(calls,['worker','other']);
  await act(async()=>{responses[0].reject(Error('old worker failure'));await first;});assert.equal(renderer.root.findAllByProps({role:'alert'}).length,0);
  await act(async()=>{responses[1].reject(Error('current member failure'));await second;});assert.match(renderer.root.findByProps({role:'alert'}).children.join(''),/current member failure/);
 }finally{if(renderer)act(()=>renderer.unmount());dispose();}
});


test('caller cancellation prevents native dispatch without unloading the host plugin',async()=>{
 const refresh=pending(),controller=new AbortController(),calls=[];
 const dispose=setRuntimeContext({uiWorkspace:{openSession:target=>calls.push(target)},sessions:{list:{getSnapshot:()=>({byId:{}})},refresh:()=>refresh.promise}});
 try{
  const opening=openNativeSession('worker',{signal:controller.signal});controller.abort();refresh.resolve();
  assert.equal((await opening).cancelled,true);assert.deepEqual(calls,[]);
  assert.equal((await openNativeSession('worker',{signal:controller.signal})).cancelled,true);assert.deepEqual(calls,[]);
 }finally{dispose();}
});
test('real navigation hook cancels a pending refresh when its selected seat changes or its component unmounts',async()=>{
 for(const change of ['seat','unmount']){
  const refresh=pending(),calls=[];let renderer,latest;
  const dispose=setRuntimeContext({uiWorkspace:{openSession:target=>calls.push(target)},sessions:{list:{getSnapshot:()=>({byId:{}})},refresh:()=>refresh.promise}});
  function Component({scope}){latest=useNativeSession(scope);return null;}
  try{
   act(()=>{renderer=TestRenderer.create(React.createElement(Component,{scope:'same-floor:worker'}));});
   let opening;act(()=>{opening=latest.open({id:'worker'});});assert.equal(latest.opening,true);
   if(change==='seat')act(()=>renderer.update(React.createElement(Component,{scope:'same-floor:other-worker'})));
   else{act(()=>renderer.unmount());renderer=null;}
   await act(async()=>{refresh.resolve();assert.equal((await opening).cancelled,true);});
   assert.deepEqual(calls,[]);
   if(change==='seat'){assert.equal(latest.error,'');assert.equal(latest.opening,false);}
  }finally{if(renderer)act(()=>renderer.unmount());dispose();}
 }
});
