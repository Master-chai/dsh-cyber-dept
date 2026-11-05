import test from 'node:test';
import assert from 'node:assert/strict';
import {setRuntimeContext,openRightOffice,openNativeSession} from '../src/client/host/navigation.js';

function timers() {
  const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout;
  const queued=new Map(),cancelled=new Set();let id=0;
  globalThis.setTimeout=callback=>{queued.set(++id,callback);return id;};
  globalThis.clearTimeout=timer=>cancelled.add(timer);
  return {queued,cancelled,restore(){setRuntimeContext(null);globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}};
}

function host(name,calls) {
  return {
    uiWorkspace:{openSession:session=>calls.push([name,'session',session])},
    layout:{selectPanel:panel=>calls.push([name,'panel',panel])},
    sidebarRight:{mounted:{getSnapshot:()=> 'session-A'},openTab:tab=>calls.push([name,'tab',tab])},
  };
}

test('replacing host cancels navigation timers and invalidates already queued callbacks',()=>{
  const clock=timers(),calls=[];
  try {
    setRuntimeContext(host('old',calls));openRightOffice();openNativeSession('session-B');
    const oldCallbacks=[...clock.queued.values()];assert.equal(oldCallbacks.length,1);
    setRuntimeContext(host('new',calls));assert.equal(clock.cancelled.size,1);calls.length=0;
    // Invoke even cancelled callbacks to model a callback already queued by the host.
    oldCallbacks.forEach(callback=>callback());assert.deepEqual(calls,[]);
  } finally {clock.restore();}
});

test('disposing old lifetime leaves new navigation active and current disposal stops it',()=>{
  const clock=timers(),calls=[];
  try {
    const disposeOld=setRuntimeContext(host('old',calls));
    const disposeNew=setRuntimeContext(host('new',calls));
    disposeOld();openRightOffice();const timer=[...clock.queued.keys()].at(-1);
    assert.equal(clock.cancelled.has(timer),false);clock.queued.get(timer)();
    assert.deepEqual(calls,[['new','panel',null],['new','tab','cyberdept']]);
    calls.length=0;disposeNew();disposeOld();openRightOffice();openNativeSession('session-C');
    assert.deepEqual(calls,[]);
  } finally {clock.restore();}
});

test('unloading during sidebar mount retry cancels retry and prevents further host calls',()=>{
  const clock=timers(),calls=[];let attempts=0;
  try {
    const ctx=host('active',calls);ctx.sidebarRight.openTab=()=>{attempts++;throw Error('mounting');};
    const dispose=setRuntimeContext(ctx);openRightOffice();clock.queued.get(1)();
    assert.equal(attempts,1);assert.equal(clock.queued.size,2);
    dispose();assert.equal(clock.cancelled.has(2),true);
    clock.queued.get(2)();assert.equal(attempts,1);assert.equal(clock.queued.size,2);
  } finally {clock.restore();}
});
