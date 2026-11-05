import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createOfficeLayout, createOfficeActor, stepOfficeActor, officeNeedsFrames, findOfficePath } from '../src/client/scene/model.js';
import { drawOfficeRoom } from '../src/client/scene/drawing.js';
import { createOfficeEngine } from '../src/client/scene/engine.js';

function recordingContext(trace = []) {
  return new Proxy({}, {
    set(target, key, value) { trace.push(['set', key, value]); target[key] = value; return true; },
    get(target, key) { return target[key] ?? ((...args) => trace.push([key, ...args])); },
  });
}

// Monochrome backdrop snapshots after adding two independently occupied bicycles.
// Geometry and animation invariants are covered independently below.
const roomTraces = [
  ['light', 2, 'aebe5da3657fb12a492e8581e565fca436e80dc3714f23f5413f5ad900bc27ee'],
  ['light', 9, 'aebe5da3657fb12a492e8581e565fca436e80dc3714f23f5413f5ad900bc27ee'],
  ['light', 12, '4e95a01b7ea4908b1484b77fcc7b38b9c4b38e5bbd9cc57535a962c24d0a5148'],
  ['dark', 2, 'bb50c3a1a0c61d159af183c992a01e1e0ece86bb8065eeabfe7ec070b423746d'],
  ['dark', 9, 'bb50c3a1a0c61d159af183c992a01e1e0ece86bb8065eeabfe7ec070b423746d'],
  ['dark', 12, '855092f494f3e32287aa6a7901a34a89ddb1dd4adc3f43aa918c1a69386b81ff'],
];
for (const [scheme, count, expected] of roomTraces) test(`room backdrop includes bicycle lounge: ${scheme}, ${count} seats`, () => {
  const trace = [];
  const members = Array.from({ length: count }, (_, i) => ({ id: 'agent-' + i }));
  drawOfficeRoom(recordingContext(trace), { ...createOfficeLayout(members), seats: [] }, scheme);
  assert.equal(createHash('sha256').update(JSON.stringify(trace)).digest('hex'), expected);
});

function harness({ images = () => new Promise(() => {}), status = () => {}, members = [{ id: 'worker', state: 'thinking', live: true }] } = {}) {
  let now = 100, serial = 0, requested = 0, cancelled = 0, observer;
  const frames = new Map(), listeners = new Map();
  const canvas = { dataset: {}, getContext: () => recordingContext() };
  let current = { members, selectedId: 'worker', mode: 'lively', reduced: false, active: true, visible: true, scheme: 'light' };
  const doc = {
    hidden: false,
    createElement: () => ({ getContext: () => recordingContext() }),
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
  };
  const environment = {
    document: doc,
    now: () => now,
    requestFrame: fn => { const id = ++serial; frames.set(id, fn); requested++; return id; },
    cancelFrame: id => { if (frames.delete(id)) cancelled++; },
    Observer: class {
      constructor(fn) { this.fn = fn; observer = this; }
      observe() { this.connected = true; }
      disconnect() { this.connected = false; }
    },
  };
  const layout = createOfficeLayout(current.members);
  const engine = createOfficeEngine({ canvas, layout, getCurrent: () => current, loadImages: images, onImageStatus: status, environment });
  return {
    engine, canvas, frames, listeners, doc, layout,
    get observer() { return observer; },
    get requested() { return requested; },
    get cancelled() { return cancelled; },
    update(patch, time = now) { current = { ...current, ...patch }; now = time; },
    frame(time) { now = time; const [id, fn] = frames.entries().next().value; frames.delete(id); fn(time); },
  };
}

test('data updates preserve actor identity, elapsed clock and the outstanding RAF', () => {
  const h = harness(), actor = h.engine.actors[0], initial = actor.time;
  h.frame(140);
  const outstanding = [...h.frames.keys()], requested = h.requested;
  h.update({ members: [{ id: 'worker', state: 'thinking', live: true, task: { subject: 'Changed title' } }] }, 160);
  h.engine.wake();
  assert.equal(h.engine.actors[0], actor);
  assert.ok(Math.abs(actor.time - initial - .06) < 1e-9);
  assert.deepEqual([...h.frames.keys()], outstanding);
  assert.equal(h.requested, requested);
  assert.equal(h.cancelled, 0);
  h.engine.dispose();
});

test('visibility pause cancels frames and resuming does not advance through hidden time', () => {
  const h = harness(); h.frame(140);
  const before = h.engine.actors[0].time;
  h.doc.hidden = true; h.listeners.get('visibilitychange')();
  assert.equal(h.frames.size, 0);
  h.update({}, 10000); h.doc.hidden = false; h.listeners.get('visibilitychange')();
  assert.equal(h.engine.actors[0].time, before);
  assert.equal(h.frames.size, 1);
  h.observer.fn([{ isIntersecting: false }]); assert.equal(h.frames.size, 0);
  h.observer.fn([{ isIntersecting: true }]); assert.equal(h.frames.size, 1);
  h.engine.dispose();
});

test('theme changes repaint without moving actor home or creating another animation loop', () => {
  const h = harness(), actor = h.engine.actors[0];
  h.frame(140); const before = { x: actor.x, y: actor.y, phase: actor.phase };
  const requested = h.requested;
  h.update({ scheme: 'dark' }); h.engine.wake();
  assert.deepEqual({ x: actor.x, y: actor.y, phase: actor.phase }, before);
  assert.equal(h.requested, requested); assert.equal(h.frames.size, 1);
  h.engine.dispose();
});

test('reduced motion and readonly previews render once without advancing actors', () => {
  const h = harness(); h.frame(140); const before = h.engine.actors[0].time;
  h.update({ active: false }, 500); h.engine.wake(true);
  assert.equal(h.frames.size, 0); assert.equal(h.engine.actors[0].time, before);
  assert.equal(h.canvas.dataset.motion, 'paused');
  h.update({ active: true, reduced: true }, 900); h.engine.wake();
  assert.equal(h.frames.size, 0); assert.equal(h.engine.actors[0].time, before);
  h.engine.dispose();
});

test('code-native actors do not load sprites; disposal releases observers/listeners/RAF', () => {
  let loads=0; const statuses=[];
  const h=harness({images:()=>{loads++;throw new Error('unused legacy asset');},status:value=>statuses.push(value)});
  assert.equal(loads,0);
  h.engine.dispose();h.engine.wake();
  assert.equal(h.frames.size,0);assert.equal(h.listeners.size,0);assert.equal(h.observer.connected,false);
  assert.deepEqual(statuses,[]);
});

test('working during a break returns continuously rather than teleporting, offline settles at home', () => {
  const member = { id: 'worker', live: true, state: 'idle' }, layout = createOfficeLayout([member]);
  const actor = createOfficeActor(member, layout.seats[0]);
  actor.wait = 0; stepOfficeActor(actor, member, layout, .01, 'lively');
  for (let i = 0; i < 50; i++) stepOfficeActor(actor, member, layout, .04, 'lively');
  const before = { x: actor.x, y: actor.y };
  assert.notDeepEqual(before, { x: actor.home.x, y: actor.home.y });
  stepOfficeActor(actor, { ...member, state: 'streaming' }, layout, .04, 'lively');
  assert.equal(actor.phase, 'return'); assert.ok(Math.hypot(actor.x - before.x, actor.y - before.y) <= .04 * 38 + 1e-9);
  stepOfficeActor(actor, { ...member, live: false }, layout, .04, 'lively');
  assert.equal(actor.x, actor.home.x); assert.equal(actor.y, actor.home.y); assert.equal(actor.path.length, 0);
  assert.equal(officeNeedsFrames([{ ...member, live: false }], [actor], 'lively', false), false);
});

test('all twelve cubicles keep a clear route to the lounge and back without crossing partitions', () => {
  const layout = createOfficeLayout(Array.from({length:12}, (_,i)=>({id:'worker-'+i})));
  for (const seat of layout.seats) {
    const lounge={x:88,y:200};
    for (const [from,to] of [[seat,lounge],[lounge,seat]]) {
      const path=findOfficePath(layout,from,to);
      assert.ok(path.length, 'unreachable cubicle '+seat.id);
      for (const point of path) {
        assert.ok(!layout.blocked.has(Math.floor(point.x/16)+','+Math.floor(point.y/16)));
        for (const other of layout.seats) assert.ok(!(Math.abs(point.x-other.x)<64 && point.y>=other.y-110 && point.y<other.y-16), 'path crosses cubicle');
      }
    }
  }
});

test('reduced motion at an expired break timer neither reserves a bike nor schedules frames',()=>{
 const h=harness(),actor=h.engine.actors[0];
 h.update({members:[{id:'worker',state:'idle',live:true}],reduced:true});
 h.engine.wake();actor.wait=0;h.engine.wake();
 assert.equal(actor.phase,'desk');assert.equal(actor.bikeId,null);assert.equal(h.frames.size,0);
 assert.ok(h.layout.bikes.every(b=>b.owner===null));h.engine.dispose();
});

test('removed actors and disposed engines release their bicycle reservations',()=>{
 for(const bikeIndex of [0,1]){
  const h=harness(),actor=h.engine.actors[0],bike=h.layout.bikes[bikeIndex];
  bike.owner=actor.id;actor.bikeId=bike.id;actor.breakKind='bike';actor.phase='break';actor.x=bike.x;actor.y=bike.y;
  h.update({members:[]});h.engine.wake();
  assert.equal(bike.owner,null);assert.equal(actor.bikeId,null);h.engine.dispose();
 }
 const h=harness(),actor=h.engine.actors[0],bike=h.layout.bikes[1];
 bike.owner=actor.id;actor.bikeId=bike.id;h.engine.dispose();h.engine.dispose();
 assert.equal(bike.owner,null);assert.equal(actor.bikeId,null);assert.equal(h.frames.size,0);
});

test('both bike reservations survive pause and resume during outbound, riding, and return phases',()=>{
 for(const phase of ['out','break','return'])for(const pause of ['inactive','reduced','hidden','offscreen']){
  const members=[{id:'one',state:'idle',live:true},{id:'two',state:'done',live:true}],h=harness({members});
  h.engine.actors.forEach((actor,i)=>{
   const bike=h.layout.bikes[i];bike.owner=actor.id;actor.bikeId=bike.id;actor.breakKind='bike';actor.phase=phase;actor.wait=7;
   if(phase!=='out'){actor.x=bike.x;actor.y=bike.y;}
   actor.path=phase==='break'?[]:findOfficePath(h.layout,actor,phase==='out'?bike:actor.home);
  });
  const state=()=>JSON.stringify(h.engine.actors.map(a=>({x:a.x,y:a.y,time:a.time,phase:a.phase,path:a.path,bikeId:a.bikeId})));
  const before=state(),owners=h.layout.bikes.map(b=>b.owner);
  if(pause==='inactive'){h.update({active:false});h.engine.wake(true);}
  if(pause==='reduced'){h.update({reduced:true});h.engine.wake(true);}
  if(pause==='hidden'){h.doc.hidden=true;h.listeners.get('visibilitychange')();}
  if(pause==='offscreen')h.observer.fn([{isIntersecting:false}]);
  h.update({},10000);h.engine.wake(true);
  assert.equal(h.frames.size,0);assert.equal(state(),before);assert.deepEqual(h.layout.bikes.map(b=>b.owner),owners);
  if(pause==='inactive')h.update({active:true});
  if(pause==='reduced')h.update({reduced:false});
  if(pause==='hidden')h.doc.hidden=false;
  if(pause==='offscreen')h.observer.fn([{isIntersecting:true}]);
  h.engine.wake(true);assert.equal(state(),before);assert.equal(h.frames.size,1);
  h.frame(10040);assert.equal(h.frames.size,1);assert.notEqual(state(),before);
  assert.deepEqual(h.layout.bikes.map(b=>b.owner),owners);h.engine.dispose();
 }
});
