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

// Monochrome backdrop snapshots after adding the requested bicycle lounge.
// Geometry and animation invariants are covered independently below.
const roomTraces = [
  ['light', 2, 'ed0a2125ec22489c2f11edc6adecb7a666be39bb7addf1f97ead3a619decd1c0'],
  ['light', 9, '159715c18a436815c1dc572777e59c3f808fb46647885b7fd367948c2c55607e'],
  ['light', 12, 'eb8bb1870c4c04f4defb01a9b5f0d51f64b98e37669c98ae8a016230abcdf492'],
  ['dark', 2, 'dcfeea2c3f403c1a8094c2e18e1dbc7c209f31c79b3b62e8a5b643843bf422a9'],
  ['dark', 9, '61d6367f82b1f7f186f2f29811ca44c72100f0b0966006c042ad0c8461bf7a64'],
  ['dark', 12, '590cd89b24a40b19f708bd6f44ff53a20abd30dc36bad9e464ee1a8204ad4b8a'],
];
for (const [scheme, count, expected] of roomTraces) test(`room backdrop includes bicycle lounge: ${scheme}, ${count} seats`, () => {
  const trace = [];
  const members = Array.from({ length: count }, (_, i) => ({ id: 'agent-' + i }));
  drawOfficeRoom(recordingContext(trace), { ...createOfficeLayout(members), seats: [] }, scheme);
  assert.equal(createHash('sha256').update(JSON.stringify(trace)).digest('hex'), expected);
});

function harness({ images = () => new Promise(() => {}), status = () => {} } = {}) {
  let now = 100, serial = 0, requested = 0, cancelled = 0, observer;
  const frames = new Map(), listeners = new Map();
  const canvas = { dataset: {}, getContext: () => recordingContext() };
  let current = { members: [{ id: 'worker', state: 'thinking', live: true }], selectedId: 'worker', mode: 'lively', reduced: false, active: true, visible: true, scheme: 'light' };
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
