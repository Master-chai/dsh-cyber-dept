import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSeatFacts, deriveSeatState } from '../src/client/model/state.js';
import { normalizeSnapshot } from '../src/client/model/normalize.js';
import { mergeFloor } from '../src/client/model/floor.js';
import { createSnapshotSync } from '../src/client/sync/snapshot-sync.js';
import { createSnapshotClient } from '../src/client/sync/snapshot-client.js';
import { createOfficeViewCache } from '../src/client/sync/view-cache.js';

function clock() {
  let id=0;
  const jobs=new Map();
  return {
    jobs,
    schedule(fn,delay){const key=++id;jobs.set(key,{fn,delay});return key;},
    unschedule(key){jobs.delete(key);},
    async next(){const [key,job]=jobs.entries().next().value;jobs.delete(key);return job.fn();},
  };
}
const liveSnapshot=id=>({state:'live',sampledAt:1,current:{sessionId:id,floorId:id},floors:[{id,members:[],tasks:[]}]});

test('state facts keep task status independent from offline availability and active execution',()=>{
  const facts=deriveSeatFacts({live:false,agent:{state:'tool-running'},member:{phase:'active'},task:{status:'in_progress',ready:false}});
  assert.equal(facts.availability,'offline');assert.equal(facts.activity,'tool-running');
  assert.equal(facts.taskStatus,'in_progress');assert.equal(facts.taskBlocked,false);assert.equal(facts.displayState,'offline');
  assert.equal(deriveSeatState({live:true,member:{phase:'provisioning',state:'offline'}}),'provisioning');
  assert.equal(deriveSeatState({live:true,member:{phase:'failed',state:'offline'}}),'error');
  assert.equal(deriveSeatState({live:true,summary:{},running:false,member:{phase:'active'}}),'idle');
});

test('floor derivation records separate facts without changing task revision or deletion authority',()=>{
  const normalized=normalizeSnapshot({floors:[{id:'root',live:true,members:[{id:'root',name:'lead',role:'lead'},{id:'worker',name:'Worker',status:'inactive',phase:'active'}],tasks:[{id:'task',revision:3,status:'completed',ownerName:'Worker'}]}]});
  const floor=mergeFloor(normalized.floors[0],{},null);
  assert.equal(floor.seats[1].state,'offline');
  assert.equal(floor.seats[1].stateFacts.availability,'offline');
  assert.equal(floor.seats[1].completedTask.id,'task');
  const deleted=mergeFloor(normalized.floors[0],{projectionsBySession:{root:{values:{agentTeam:{tasks:[]}}}}},null);
  assert.equal(deleted.tasks.length,0);assert.equal(deleted.taskCounts.completed,0);
});

test('disposing snapshot sync cancels transport and ignores a late result from the old session',async()=>{
  const c=clock(),delivered=[];let resolve,signal;
  const sync=createSnapshotSync({sessionId:'old',load:s=>{signal=s;return new Promise(done=>resolve=done);},onSnapshot:value=>delivered.push(value),onError:assert.fail,...c});
  sync.start();const pending=c.next();assert.equal(signal.aborted,false);
  sync.dispose();assert.equal(signal.aborted,true);resolve(liveSnapshot('old'));await pending;
  assert.deepEqual(delivered,[]);assert.equal(c.jobs.size,0);
});

test('separate session synchronizers never deliver results to each other',async()=>{
  const a=clock(),b=clock(),results=[];let finishA;
  const old=createSnapshotSync({sessionId:'a',load:()=>new Promise(resolve=>finishA=resolve),onSnapshot:()=>assert.fail('old delivered'),onError:assert.fail,...a});
  const current=createSnapshotSync({sessionId:'b',load:async(_,id)=>liveSnapshot(id),onSnapshot:value=>results.push(value.current.sessionId),onError:assert.fail,...b});
  old.start();const waiting=a.next();old.dispose();current.start();await b.next();finishA(liveSnapshot('a'));await waiting;
  assert.deepEqual(results,['b']);current.dispose();
});

test('unavailable refresh reports an error without publishing an empty verified view',async()=>{
  const c=clock(),snapshots=[],errors=[];let attempt=0;
  const sync=createSnapshotSync({sessionId:'root',load:async()=>++attempt===1?liveSnapshot('root'):{state:'degraded',floors:[]},onSnapshot:value=>snapshots.push(value),onError:error=>errors.push(error),...c});
  sync.start();await c.next();await c.next();
  assert.equal(snapshots.length,1);assert.equal(errors.length,1);
  assert.equal([...c.jobs.values()][0].delay,2000);sync.dispose();
});

test('hidden documents skip reads and visibility recovery starts one request',async()=>{
  const c=clock();let reads=0,listener;
  const visibility={hidden:true,addEventListener:(_,fn)=>listener=fn,removeEventListener:()=>listener=null};
  const sync=createSnapshotSync({sessionId:'root',load:async()=>{reads++;return liveSnapshot('root');},onSnapshot(){},onError:assert.fail,visibility,...c});
  sync.start();await c.next();assert.equal(reads,0);assert.equal([...c.jobs.values()][0].delay,15000);
  visibility.hidden=false;listener();await Promise.resolve();await Promise.resolve();
  assert.equal(reads,1);sync.dispose();assert.equal(listener,null);
});

test('snapshot adapter negotiates old host support once and still checks RPC identity',async()=>{
  const requests=[];
  const load=createSnapshotClient({rpcId:()=> 'rpc',request:async(_url,options)=>{
    const request=JSON.parse(options.body);requests.push(request);
    if(requests.length===1)return {response:{status:400,ok:false},raw:'unexpected-payload-key:currentOnly'};
    return {response:{status:200,ok:true},raw:JSON.stringify({type:'server-response',rpcId:'rpc',result:{ok:true,value:liveSnapshot(request.payload.sessionId)}})};
  }});
  await load(undefined,'a');await load(undefined,'b');
  assert.equal(requests[0].payload.currentOnly,true);assert.equal(requests[1].payload.currentOnly,undefined);assert.equal(requests[2].payload.currentOnly,undefined);
  const wrong=createSnapshotClient({rpcId:()=> 'rpc',request:async()=>({response:{ok:true,status:200},raw:JSON.stringify({type:'server-response',rpcId:'wrong',result:{ok:true,value:liveSnapshot('a')}})})});
  await assert.rejects(wrong(undefined,'a'),/rpcId/);
});

test('preview cache retains session identity, honors expiration and bounds memory',()=>{
  let now=0;const cache=createOfficeViewCache(2,10,()=>now);
  cache.set('a',{floor:{id:'a'}});cache.set('b',{floor:{id:'b'}});assert.equal(cache.get('a').floor.id,'a');
  cache.set('c',{floor:{id:'c'}});assert.equal(cache.get('b'),null);assert.equal(cache.get('missing'),null);
  now=11;assert.equal(cache.get('a'),null);assert.equal(cache.get('c'),null);
});
