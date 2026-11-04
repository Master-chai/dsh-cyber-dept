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

// Approved monochrome backdrop snapshots, recorded once after the palette change.
// Geometry and animation invariants are covered independently below.
const roomTraces = [
  ['light', 2, 'f36f690d9f747bc0eed7f4b7b682d863135d707d8e895b3e408c1d49836444d2'],
  ['light', 9, 'f839ea361ce49d113aed5843feec6be6e6040cc1306cef50f463dddaa4e61748'],
  ['light', 12, 'dbab175e019ac912bdc198165d82fe8a05886e61b502ca8f959fc92f40399d03'],
  ['dark', 2, '63ac7efbda5c38617de47fac4efcc9bd1d3599c170f057eb9a98db0b9426c761'],
  ['dark', 9, 'e5d17de2df2afed95ea541ee54179b490b6b96047343cc621cb608fbfc22176b'],
  ['dark', 12, '88ac35331f5e56c2917f4a82a4d55aed8a41caf12981505d4442cdeaad893f82'],
];
for (const [scheme, count, expected] of roomTraces) test(`room backdrop preserves baseline: ${scheme}, ${count} seats`, () => {
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

test('disposal ignores late sprite completion and releases observers/listeners/RAF', async () => {
  let resolve; const statuses = [];
  const h = harness({ images: () => new Promise(done => resolve = done), status: value => statuses.push(value) });
  h.engine.dispose(); resolve([]); await Promise.resolve(); await Promise.resolve();
  h.engine.wake();
  assert.equal(h.frames.size, 0); assert.equal(h.listeners.size, 0); assert.equal(h.observer.connected, false);
  assert.deepEqual(statuses, []);
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
