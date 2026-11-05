import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

let plugin;
vm.runInNewContext(readFileSync(new URL('../.verify/client-test.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: ({ factory }) => { plugin = factory(() => ({ createElement() {}, memo: fn => fn })); } } },
});
const api = plugin.__internals;

test('office follows the resolved DSH color scheme, including system and custom preferences', () => {
  assert.equal(api.resolveOfficeScheme({ preference: 'system', active: { colorScheme: 'dark' } }), 'dark');
  assert.equal(api.resolveOfficeScheme({ preference: 'custom-night', active: { colorScheme: 'light' } }), 'light');
  assert.equal(api.resolveOfficeScheme({ preference: 'dark', active: { colorScheme: 'dark' } }), 'dark');
});

test('theme store notifies only on scheme changes and releases subscriptions', () => {
  const store = api.createOfficeThemeStore();
  let renders = 0;
  const dispose = store.subscribe(() => renders++);
  store.update({ active: { colorScheme: 'dark' } });
  assert.equal(store.getSnapshot(), 'dark');
  store.update({ active: { colorScheme: 'dark' } });
  assert.equal(renders, 1);
  store.update({ active: { colorScheme: 'light' } });
  assert.equal(renders, 2);
  dispose();
  store.update({ active: { colorScheme: 'dark' } });
  assert.equal(renders, 2);
});

test('office room draws daylight and night palettes without changing layout', () => {
  const layout = api.createOfficeLayout([{ id: 'a' }]);
  function paint(scheme) {
    const colors = [];
    api.drawOfficeRoom({ save() {}, restore() {}, translate() {}, fillRect() {}, fillText() {}, set fillStyle(value) { colors.push(value); } }, layout, scheme);
    return colors;
  }
  const light = paint('light'), dark = paint('dark');
  assert.equal(light.length, dark.length);
  assert.equal(light[0], '#d3d3d3');
  assert.equal(dark[0], '#1a1a1a');
  assert.ok(light.every(color => /^#([0-9a-f]{2})\1\1$/i.test(color)));
  assert.ok(dark.every(color => /^#([0-9a-f]{2})\1\1$/i.test(color)));
  assert.equal(layout.seats[0].x, 216);
});

test('office preview cache is isolated by session and bounded by least recent use', () => {
  const cache = api.createOfficeViewCache(2, 100, () => 0);
  const a = { floor: { id: 'a' } }, b = { floor: { id: 'b' } }, c = { floor: { id: 'c' } };
  cache.set('a', a); cache.set('b', b);
  assert.equal(cache.get('missing'), null);
  assert.equal(cache.get('a'), a);
  cache.set('c', c);
  assert.equal(cache.get('b'), null);
  assert.equal(cache.get('a'), a);
  assert.equal(cache.get('c'), c);
});

test('preview expires without extending freshness on reads and empty team clears cache', () => {
  let now = 0;
  const cache = api.createOfficeViewCache(8, 100, () => now), view = { floor: { id: 'a' } };
  cache.set('a', view);
  now = 99; assert.equal(cache.get('a'), view);
  now = 100; assert.equal(cache.get('a'), null);
  cache.set('a', view); cache.set('a', null);
  assert.equal(cache.get('a'), null);
});

test('preview is read-only even when the remembered floor used to be live', () => {
  const gate = api.writeGateOf('preview', { state: 'live' }, { kind: 'team', hasTeam: true, live: true });
  assert.equal(gate.enabled, false);
  assert.match(gate.reason, /正在更新/);
});

test('local preview only uses the current session native team projection', () => {
  const sessions = { byId: { a: { displayTitle: 'Current' } }, projectionsBySession: { a: { values: { agentTeam: { members: [{ id: 'a', name: 'lead', role: 'lead' }, { id: 'worker', name: 'worker' }], tasks: [{ id: 'task-1', subject: 'Current task', status: 'pending' }] } } } } };
  assert.equal(api.localOfficePreview('missing', sessions, null), null);
  const preview = api.localOfficePreview('a', sessions, null);
  assert.equal(preview.id, 'a');
  assert.equal(preview.title, 'Current');
  assert.equal(preview.tasks[0].subject, 'Current task');
});

test('first render can show native team preview before any snapshot request returns', () => {
  let client, fetches = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    memo: fn => fn, useMemo: fn => fn(), useCallback: fn => fn,
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    useState: init => [typeof init === 'function' ? init() : init, () => {}], useEffect() {},
    useRef: value => ({ current: value }), useLayoutEffect() {},
  };
  vm.runInNewContext(readFileSync(new URL('../.verify/client-test.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: ({ factory }) => { client = factory(() => react); } } },
    fetch: () => { fetches++; throw new Error('first render must not wait for RPC'); },
  });
  const sessions = { byId: { current: { displayTitle: 'Complex session' } }, projectionsBySession: { current: { values: { agentTeam: { members: [{ id: 'current', role: 'lead', name: 'lead' }, { id: 'worker', name: 'worker' }], tasks: [{ id: 'task-1', subject: 'Current work', status: 'pending' }] } } } } };
  const tree = client.__internals.Page({ officeSessionId: 'current', active: true, useSessions: selector => selector(sessions) });
  assert.equal(fetches, 0);
  assert.equal(tree.props['data-source'], 'preview');
  const body = tree.props.children.find(child => child?.props?.className === 'cid-body');
  const floorNode = body.props.children[0];
  assert.equal(floorNode.props.floor.title, 'Complex session');
  assert.equal(floorNode.props.active, false, 'do not animate an unvalidated preview');
});

test('unrelated conversations do not invalidate the selected office slice', () => {
  const select = api.createOfficeSelector('sessions');
  const own = { displayTitle: 'Current' }, ownBlock = { values: { agentTeam: { members: [{ id: 'worker' }] } } };
  const initial = { byId: { root: own, worker: {} }, projectionsBySession: { root: ownBlock, worker: {} } };
  const first = select(initial, ['root'], true);
  for (let i = 0; i < 1000; i++) {
    const unrelated = { byId: { ...initial.byId, other: { token: i } }, projectionsBySession: { ...initial.projectionsBySession, other: {} } };
    assert.equal(select(unrelated, ['root'], true), first);
  }
  const changedWorker = { ...initial, projectionsBySession: { ...initial.projectionsBySession, worker: { values: { cyberAgent: { state: 'thinking' } } } } };
  assert.notEqual(select(changedWorker, ['root'], true), first);
});

test('hidden offices freeze subscriptions and catch up when shown again', () => {
  const select = api.createOfficeSelector('sessions');
  const first = select({ byId: { root: {} } }, ['root'], true);
  const next = { byId: { root: { running: true } } };
  assert.equal(select(next, ['root'], false), first);
  assert.notEqual(select(next, ['root'], true), first);
});

test('status selector ignores unrelated updates but retains current approval changes', () => {
  const select = api.createOfficeSelector('status'), own = { running: true };
  const first = select(new Map([['root', own]]), ['root'], true);
  assert.equal(select(new Map([['root', own], ['other', {}]]), ['root'], true), first);
  const approval = { pendingInteraction: { kind: 'approval' } };
  const next = select(new Map([['root', approval]]), ['root'], true);
  assert.notEqual(next, first);
  assert.equal(next.get('root'), approval);
});
const member = (state, extra = {}) => ({ id: 'worker-a', name: 'Worker', state, live: true, ...extra });

test('approval and unavailable offices stop scheduling animation frames', () => {
  for (const state of ['waiting-approval', 'blocked', 'offline', 'provisioning']) {
    assert.equal(api.officeNeedsFrames([member(state)], [{ path: [] }], 'lively', false), false);
  }
  assert.equal(api.officeNeedsFrames([member('thinking')], [{ path: [] }], 'lively', false), true);
  assert.equal(api.officeNeedsFrames([member('idle')], [{ path: [] }], 'calm', false), false);
  assert.equal(api.officeNeedsFrames([member('idle')], [{ path: [] }], 'lively', false), true);
});

test('actors finish returning to their desks but static and reduced motion schedule no frames', () => {
  const returning = [{ path: [{ x: 20, y: 20 }] }];
  assert.equal(api.officeNeedsFrames([member('done')], returning, 'lively', false), true);
  assert.equal(api.officeNeedsFrames([member('done')], returning, 'off', false), false);
  assert.equal(api.officeNeedsFrames([member('streaming')], returning, 'lively', true), false);
});

test('current office never substitutes a historical team for an empty or unknown session', () => {
  const history = [{ id: 'old-team', members: [{ id: 'old-worker' }] }];
  assert.equal(api.currentOfficeFloor(history, 'new-session'), null);
  assert.equal(api.currentOfficeFloor(history, null), null);
  assert.equal(api.currentOfficeFloor(null, 'new-session'), null);
});

test('current office follows the exact session regardless of history ordering', () => {
  const current = { id: 'current', members: [] };
  const older = { id: 'older', members: [{ id: 'current' }] };
  assert.equal(api.currentOfficeFloor([older, current], 'current'), current);
  assert.equal(api.currentOfficeFloor([current, older], 'older'), older);
});

test('a team member session resolves only to its own department', () => {
  const other = { id: 'other', members: [{ id: 'someone-else' }] };
  const own = { id: 'team', members: [{ id: 'member-session' }] };
  assert.equal(api.currentOfficeFloor([other, own], 'member-session'), own);
});

test('cold snapshot overrides an old running projection and approval', () => {
  assert.equal(api.deriveSeatState({ live: false, approval: {}, agent: { state: 'tool-running' } }), 'offline');
  const snapshot = api.normalizeSnapshot({floors:[{id:"test-root",members:[{id:"test-root",state:"thinking"},{id:"worker",state:"tool-running",tool:{name:"bash"},approval:{toolName:"bash"}}]}]});
  const floor = snapshot.floors[0];
  floor.live = false;
  const merged = api.mergeFloor(floor, {}, null);
  assert.equal(merged.runningCount, 0);
  assert.ok(merged.seats.every(seat => seat.state === 'offline' && seat.tool === null && seat.approval === null));
});
test('inactive member in a live floor overrides stale cyberAgent activity', () => {
  assert.equal(api.deriveSeatState({ live: true, member: { state: 'offline' }, agent: { state: 'tool-running' } }), 'offline');
});
test('inactive never aliases to idle', () => assert.equal(api.normalizeState('inactive'), 'offline'));
test('reading tools, writing tools and streaming use distinct activity poses', () => {
  assert.equal(api.sceneActivity(member('thinking')), 'reading');
  assert.equal(api.sceneActivity(member('tool-running', { tool: { name: 'read_file' } })), 'reading');
  assert.equal(api.sceneActivity(member('tool-running', { tool: { name: 'run_code' } })), 'typing');
  assert.equal(api.sceneActivity(member('streaming')), 'typing');
});
test('approval, blocked, error, completed and offline retain distinct state labels', () => {
  for (const [state, activity] of [['waiting-approval', 'approval'], ['blocked', 'blocked'], ['error', 'blocked'], ['done', 'done'], ['offline', 'offline'], ['provisioning', 'starting']]) {
    assert.equal(api.sceneActivity(member(state)), activity);
  }
  assert.equal(api.sceneActivity(member('streaming', { live: false })), 'offline');
});
test('task board revision and status supersede stale projection task data', () => {
  const task = api.enrichTaskRef({ id: 'task-1', revision: 2, subject: 'Old', status: 'in_progress' }, [{ id: 'task-1', revision: 7, subject: 'New', status: 'completed' }]);
  assert.equal(task.revision, 7);
  assert.equal(task.status, 'completed');
  assert.equal(task.subject, 'New');
});
test('an explicit missing task id cannot inherit another same-titled task revision', () => {
  const task = api.enrichTaskRef({ id: 'task-1', subject: 'Shared title' }, [{ id: 'task-2', subject: 'Shared title', revision: 9 }]);
  assert.equal(task.id, 'task-1');
  assert.equal(task.revision, 0);
});
test('ambiguous task titles do not bind a write target', () => {
  const task = api.enrichTaskRef({ subject: 'Same' }, [{ id: 'task-1', subject: 'Same', revision: 2 }, { id: 'task-2', subject: 'Same', revision: 4 }]);
  assert.equal(task.id, '');
  assert.equal(task.revision, 0);
});
test('owner id takes precedence over a stale owner display name', () => {
  const seats = [{ id: 'a', name: 'Same' }, { id: 'b', name: 'Other' }];
  assert.equal(api.taskOwnerSeat({ ownerId: 'b', ownerName: 'Same' }, seats).id, 'b');
  assert.equal(api.taskOwnerSeat({ ownerId: 'missing', ownerName: 'Same' }, seats), null);
});
test('paths from all twelve desks to break area avoid furniture and walls', () => {
  const members = Array.from({ length: 12 }, (_, i) => member('idle', { id: 'worker-' + i }));
  const layout = api.createOfficeLayout(members);
  for (const home of layout.seats) {
    const path = api.findOfficePath(layout, home, { x: 88, y: 200 });
    assert.ok(path.length > 0);
    for (const step of path) {
      const key = Math.floor(step.x / 16) + ',' + Math.floor(step.y / 16);
      assert.ok(!layout.blocked.has(key));
      assert.ok(!layout.occupied.has(key), 'must not walk through another seated member');
    }
    assert.equal(path.at(-1).x, 88);
    assert.equal(path.at(-1).y, 200);
  }
});
test('unreachable targets produce no path', () => {
  const layout = api.createOfficeLayout([member('idle')]);
  assert.equal(api.findOfficePath(layout, layout.seats[0], { x: 8, y: 8 }).length, 0);
});
test('idle actor walks out and returns without discontinuities when work arrives', () => {
  const idle = member('idle');
  const layout = api.createOfficeLayout([idle]);
  const actor = api.createOfficeActor(idle, layout.seats[0]);
  actor.wait = 0;
  for (let i = 0; i < 120; i++) api.stepOfficeActor(actor, idle, layout, 1 / 30, 'lively');
  assert.ok(Math.hypot(actor.x - actor.home.x, actor.y - actor.home.y) > 20);
  for (let i = 0; i < 600; i++) {
    const before = { x: actor.x, y: actor.y };
    api.stepOfficeActor(actor, member('streaming'), layout, 1 / 30, 'lively');
    assert.ok(Math.hypot(actor.x - before.x, actor.y - before.y) <= 38 / 30 + 0.001);
  }
  assert.equal(actor.x, actor.home.x);
  assert.equal(actor.y, actor.home.y);
  assert.equal(actor.phase, 'desk');
});
test('focus mode and paused time keep idle actors at their desks', () => {
  for (const mode of ['calm', 'off']) {
    const idle = member('idle'), layout = api.createOfficeLayout([idle]);
    const actor = api.createOfficeActor(idle, layout.seats[0]);
    for (let i = 0; i < 1800; i++) api.stepOfficeActor(actor, idle, layout, mode === 'off' ? 0 : 1 / 30, mode);
    assert.equal(actor.x, actor.home.x);
    assert.equal(actor.y, actor.home.y);
  }
});
test('offline actor resets to its reserved desk and stops', () => {
  const idle = member('idle'), layout = api.createOfficeLayout([idle]);
  const actor = api.createOfficeActor(idle, layout.seats[0]);
  actor.x = 88; actor.y = 200; actor.phase = 'break';
  api.stepOfficeActor(actor, member('offline'), layout, 1, 'lively');
  assert.equal(actor.x, actor.home.x);
  assert.equal(actor.y, actor.home.y);
  assert.equal(actor.path.length, 0);
});
