import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useOfficeSession } from '../src/client/sync/use-office-session.js';

const nextTick=()=>new Promise(resolve=>setTimeout(resolve,0));
function harness() {
  let latest,renderer;
  const requests=[];
  const original=globalThis.fetch;
  globalThis.fetch=(_url,options)=>new Promise(resolve=>requests.push({body:JSON.parse(options.body),signal:options.signal,resolve}));
  function Component(props){latest=useOfficeSession(props);return null;}
  const props=id=>({officeSessionId:id,active:true});
  return {
    requests,
    latest:()=>latest,
    async mount(id){act(()=>{renderer=TestRenderer.create(React.createElement(Component,props(id)));});await act(nextTick);},
    async switchTo(id){act(()=>{renderer.update(React.createElement(Component,props(id)));});await act(nextTick);},
    async refresh(){act(()=>{latest.refresh();});await act(nextTick);},
    async reply(index,value){const request=requests[index];await act(async()=>request.resolve({ok:true,status:200,text:async()=>JSON.stringify({type:'server-response',rpcId:request.body.rpcId,result:{ok:true,value}})}));},
    close(){if(renderer)act(()=>renderer.unmount());globalThis.fetch=original;},
  };
}
const snap=id=>({state:'live',sampledAt:1,current:{sessionId:id,floorId:id},floors:[{id,live:true,members:[{id,name:'lead',role:'lead'},{id:id+'-worker',name:'Worker',role:'teammate'}],tasks:[]}]});

test('real sync hook switches session immediately and cannot accept an earlier late response',async()=>{
  const h=harness();
  try {
    await h.mount('hook-a');assert.equal(h.requests.length,1);
    await h.switchTo('hook-b');assert.equal(h.requests.length,2);assert.equal(h.requests[0].signal.aborted,true);
    assert.equal(h.latest().activeFloor,null);
    await h.reply(1,snap('hook-b'));assert.equal(h.latest().activeFloor.id,'hook-b');assert.equal(h.latest().source,'host');
    await h.reply(0,snap('hook-a'));assert.equal(h.latest().activeFloor.id,'hook-b');
  } finally {h.close();}
});

test('real sync hook retains the last view read-only when a refresh cannot read its team',async()=>{
  const h=harness();
  try {
    await h.mount('hook-failure');await h.reply(0,snap('hook-failure'));
    assert.equal(h.latest().source,'host');
    await h.refresh();assert.equal(h.latest().source,'preview');
    await h.reply(1,{state:'degraded',floors:[],degraded:{reasons:['cache-read-failed']}});
    assert.equal(h.latest().activeFloor.id,'hook-failure');assert.equal(h.latest().source,'preview');
    assert.equal(h.latest().validated,false);assert.ok(h.latest().fetchError);
  } finally {h.close();}
});
