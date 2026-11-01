import test from 'node:test';
import assert from 'node:assert/strict';
import {collectOffice,createOfficeHistoryCache,invalidateOfficeHistory} from '../src/host/office.js';
import {CommandLedger,executeOfficeCommand,registerCommandRoute,readCommandArgs} from '../src/host/command.js';
function context(extra={}) {
  const team={members:[{id:'root',name:'lead',role:'lead'},{id:'worker',name:'Worker',role:'teammate'}],tasks:[{id:'task-1',revision:3,subject:'Task',description:'Details',status:'pending',blockedBy:[],writeScopes:[]}]};
  const services={agents:{list:()=>[]},agentTeams:{},sessionQuery:{listSessions:async()=>[{header:{id:'root'},live:false}]},sessionProjectionCache:{cachedSnapshot:()=>({values:{agentTeam:team}})},...extra};
  return {get:name=>services[name]};
}
test('snapshot includes complete usable task data when the native client projection is absent',async()=>{
  const snap=await collectOffice(context(),{sessionId:'root',currentOnly:true});const task=snap.floors[0].tasks[0];
  assert.equal(task.id,'task-1');assert.equal(task.revision,3);assert.equal(task.description,'Details');assert.equal(task.ready,true);
});
test('cache and live fold errors produce degraded snapshots, not successful empty teams',async()=>{
  for(const extra of [
    {sessionProjectionCache:{cachedSnapshot(){throw new Error('read failed');}}},
    {sessions:{get:()=>({header:{id:'root'}})},sessionProjections:{stateOf(){throw new Error('fold failed');}}},
  ]){const snap=await collectOffice(context(extra),{sessionId:'root',currentOnly:true});assert.equal(snap.state,'degraded');assert.equal(snap.floors.length,0);}
});
test('cold requests reuse headers until invalidated, while reading fresh task projections each time',async()=>{
  let lists=0,reads=0;
  const ctx=context({sessionQuery:{listSessions:async()=>{lists++;return [{header:{id:'root'}}];}},sessionProjectionCache:{cachedSnapshot:()=>{reads++;return {values:{agentTeam:{members:[{id:'root',role:'lead'},{id:'worker'}],tasks:[]}}};}}});
  await collectOffice(ctx,{sessionId:'root',currentOnly:true});await collectOffice(ctx,{sessionId:'root',currentOnly:true});
  assert.equal(lists,1);assert.equal(reads,2);
  invalidateOfficeHistory(ctx);await collectOffice(ctx,{sessionId:'root',currentOnly:true});assert.equal(lists,2);
});
test('history cache expiry, capacity and shared-read cancellation preserve independent callers',async()=>{
  let now=0,calls=0,resolve;
  const cache=createOfficeHistoryCache({ttlMs:10,capacity:1,now:()=>now});
  const query={listSessions:()=>{calls++;return new Promise(done=>resolve=done);}};
  const abort=new AbortController(),a=cache.read(query,abort.signal),b=cache.read(query);
  const rejected=assert.rejects(a,{name:'AbortError'});abort.abort();await Promise.resolve();resolve([{header:{id:'a'}}]);await rejected;await b;
  assert.equal(calls,1);await cache.read(query);assert.equal(calls,1);
  now=11;const next=cache.read(query);await Promise.resolve();resolve([{header:{id:'a'}},{header:{id:'b'}}]);await next;
  const overCapacity=cache.read(query);await Promise.resolve();resolve([]);await overCapacity;assert.equal(calls,3);
});
test('prototype action names are rejected as arguments rather than throwing',()=>{
  for(const action of ['constructor','toString','__proto__'])assert.deepEqual(readCommandArgs(action,{}),{ok:false,reason:'unknown-action'});
});

test('an uncooperative history reader expires and does not poison later reads',async()=>{
  const cache=createOfficeHistoryCache({timeoutMs:5});let aborted=false;
  await assert.rejects(cache.read({listSessions:signal=>{signal.addEventListener('abort',()=>aborted=true);return new Promise(()=>{});}}),{name:'TimeoutError'});
  assert.equal(aborted,true);
  assert.deepEqual(await cache.read({listSessions:async()=>[]}),[]);
});
test('timed-out task creation remains in flight until settlement, then replays the actual result',async()=>{
  let fetchRoute,complete,calls=0;
  const ledger=new CommandLedger();
  const services={agents:{get:()=>({id:'root'})},agentTeams:{createTask:()=>{calls++;return new Promise(resolve=>complete=resolve);}}};
  const ctx={get:name=>services[name],connection:{fetch:{register:route=>{fetchRoute=route.fetch;}}}};
  registerCommandRoute(ctx,ledger,{timeoutMs:5});
  const payload={commandId:'11111111-1111-4111-8111-111111111111',sessionId:'root',action:'task.create',args:{subject:'Mock',description:'Mock'}};
  const request=()=>new Request('http://mock/api/cyberOffice/command',{method:'POST',body:JSON.stringify({type:'client-request',rpcId:'rpc',method:'cyberOffice/command',payload})});
  const first=await (await fetchRoute(request())).json();assert.equal(first.result.error.code,'office/timeout');assert.equal(first.result.error.details.deliveryUnknown,true);
  assert.equal(ledger.isInflight(payload.commandId),true);
  const repeated=await (await fetchRoute(request())).json();assert.equal(repeated.result.error.code,'office/busy');assert.equal(calls,1);
  complete({id:'task-1',subject:'Mock',revision:1,status:'pending'});for(let i=0;i<8;i++)await Promise.resolve();
  assert.equal(ledger.isInflight(payload.commandId),false);
  const replay=await (await fetchRoute(request())).json();assert.equal(replay.result.ok,true);assert.equal(calls,1);
});
test('already-cancelled commands do not reach the Team service',async()=>{
  let calls=0;const abort=new AbortController();abort.abort();
  const ctx={get:name=>name==='agents'?{get:()=>({id:'root'})}:{createTask:()=>{calls++;}}};
  await executeOfficeCommand(ctx,{sessionId:'root',action:'task.create',args:{}},{signal:abort.signal,timeoutMs:5});assert.equal(calls,0);
});
