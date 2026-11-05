import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {buildSync} from 'esbuild';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {renderToStaticMarkup} from 'react-dom/server';
import {isTaskBlocked} from '../src/client/common.js';
import {taskEvidence, attentionItems} from '../src/client/model/attention.js';
import {deriveSeatFacts} from '../src/client/model/state.js';
import {officeChanges} from '../src/client/office-interactions.js';
import {TaskBoard} from '../src/client/task-board.js';
import {WriteModal} from '../src/client/components/write-modal.js';
import {commandCapabilities} from '../src/client/commands/use-commands.js';
import {taskActionProblem} from '../src/client/commands/use-task-commands.js';
import {executeOfficeCommand} from '../src/host/command.js';
import {collectOffice} from '../src/host/office.js';

// Released DSH projectTaskView sets ready only for pending tasks with completed
// dependencies. in_progress + ready:false is the ordinary assigned-task shape.
// See docs/TASK_READY_FIX.md for the pinned release source and full audit.
const task = {id:'task-7', revision:4, subject:'安装这些插件', description:'根据每个成员搜索到的，安排他们完成配置', status:'in_progress', ownerId:'worker', ownerName:'Worker', ready:false, blockedBy:[]};
const seat = {id:'worker', name:'Worker', role:'teammate', phase:'active', state:'done'};
const floor = {id:'root', leadId:'root', seats:[seat], tasks:[task]};
const gate = {enabled:true};
const withTask = current => ({...floor, tasks:[current]});

// Bundle the real component so Node does not interpret its image imports.
function detailPane() {
  const code = buildSync({entryPoints:[fileURLToPath(new URL('../src/client/components/employee-card.js', import.meta.url))], bundle:true, write:false, platform:'node', format:'cjs', external:['react'], loader:{'.png':'dataurl', '.webp':'dataurl'}}).outputFiles[0].text;
  const module = {exports:{}};
  runInNewContext(code, {module, exports:module.exports, require:createRequire(import.meta.url), setTimeout, clearTimeout});
  return module.exports.DetailPane;
}

test('released in_progress ready=false is not a task warning or evidence of execution', () => {
  for (const state of ['idle', 'thinking', 'streaming', 'tool-running', 'done']) {
    const current = {...floor, seats:[{...seat, state}]};
    const evidence = taskEvidence(task, current);
    assert.deepEqual(evidence.issues, [], state);
    assert.deepEqual(attentionItems(current), [], state);
    assert.match(evidence.execution, /尚无本任务开始执行的独立回执/);
    assert.match(evidence.execution, /成员活动不等于本任务进度/);
  }
});

test('false readiness fallback applies only to pending, never nonpending or terminal tasks', () => {
  for (const status of ['pending', 'in_progress', 'completed', 'deleted']) {
    for (const ready of [true, false, undefined]) {
      const current = {...task, status, ready};
      const blocked = status === 'pending' && ready === false;
      assert.equal(taskEvidence(current, withTask(current)).issues.some(issue => issue.kind === 'dependency'), blocked, `${status}/${ready}`);
      assert.equal(isTaskBlocked(current), blocked);
      assert.equal(deriveSeatFacts({live:true, member:seat, task:current}).taskBlocked, blocked);
    }
  }
});

test('real incomplete or missing dependencies still warn independently of status readiness', () => {
  for (const status of ['pending', 'in_progress']) {
    for (const ready of [true, false, undefined]) {
      for (const dependencyStatus of ['pending', 'in_progress', 'deleted', undefined]) {
        const current = {...task, status, ready, blockedBy:['task-1']};
        const dependency = dependencyStatus ? [{id:'task-1', subject:'前置配置', status:dependencyStatus}] : [];
        const data = {...floor, tasks:[current, ...dependency]};
        const issues = taskEvidence(current, data).issues;
        assert.equal(issues.length, 1);
        assert.equal(issues[0].kind, 'dependency');
        assert.match(issues[0].reason, /前置任务未完成或明细不可用/);
        assert.match(issues[0].next, /前置任务/);
      }
    }
  }
  const current = {...task, blockedBy:['task-1']};
  assert.deepEqual(taskEvidence(current, {...floor, tasks:[current, {id:'task-1', status:'completed'}]}).issues, []);
});

test('removing the false warning preserves real owner, approval and error diagnostics', () => {
  for (const [patch, kind] of [
    [{state:'offline'}, 'offline'], [{phase:'provisioning'}, 'provisioning'],
    [{state:'waiting-approval'}, 'approval'], [{state:'error'}, 'error'],
  ]) assert.deepEqual(taskEvidence(task, {...floor, seats:[{...seat, ...patch}]}).issues.map(issue => issue.kind), [kind]);
  assert.deepEqual(taskEvidence(task, {...floor, seats:[]}).issues.map(issue => issue.kind), ['owner-missing']);
});

test('expanded task board removes the screenshot warning without asserting execution or disabling start', () => {
  let renderer;
  const actions = [];
  act(() => { renderer = TestRenderer.create(React.createElement(TaskBoard, {floor, writeGate:gate, onTaskAction:(...args) => actions.push(args)})); });
  act(() => renderer.root.findByProps({className:'cid-task-row'}).props.onClick());
  const text = JSON.stringify(renderer.toJSON());
  assert.doesNotMatch(text, /宿主报告任务尚未就绪/);
  assert.equal(renderer.root.findAllByProps({className:'cid-task-diagnostics'}).length, 0);
  assert.match(text, /尚无本任务开始执行的独立回执/);
  assert.equal(renderer.root.findByProps({className:'cid-task-state'}).props['data-status'], 'in_progress');
  const start = renderer.root.findByProps({'data-task-action':'start'});
  assert.equal(start.props.disabled, false);
  act(() => start.props.onClick());
  assert.deepEqual(actions, [['start', task]]);
  const blocked = {...task, blockedBy:['task-1']};
  act(() => renderer.update(React.createElement(TaskBoard, {floor:withTask(blocked), writeGate:gate, onTaskAction:() => {}})));
  assert.match(JSON.stringify(renderer.toJSON()), /前置任务未完成或明细不可用/);
  assert.equal(renderer.root.findByProps({'data-task-action':'start'}).props.disabled, true);
  act(() => renderer.unmount());
});

test('other displays and actions do not turn assignment into a readiness failure', () => {
  const assigned = {...seat, task};
  assert.equal(commandCapabilities({seat:assigned, floor, writeGate:gate}).taskAllowed, true);
  assert.equal(taskActionProblem(floor, task, gate, 'start'), '');
  assert.deepEqual(officeChanges(withTask({...task, status:'pending', ready:true}), floor), []);
  assert.equal(deriveSeatFacts({live:true, member:seat, task}).displayState, 'done');
  const detail = renderToStaticMarkup(React.createElement(detailPane(), {seat:assigned, floor, writeGate:gate}));
  assert.doesNotMatch(detail, /依赖未就绪/);
  const modal = renderToStaticMarkup(React.createElement(WriteModal, {write:{kind:'assign', phase:'compose', subject:'', description:'', seatName:'Worker'}, tasks:[task]}));
  assert.doesNotMatch(modal, /依赖未完成/);
  assert.doesNotMatch(modal, /<option[^>]*disabled/);
});

test('host start checks actual dependencies, not false readiness or member activity', async () => {
  for (const dependencyStatus of ['completed', 'pending', 'in_progress', 'deleted', undefined]) {
    const current = {...task, blockedBy:['task-1']}, messages = [], lead = {id:'root', status:'idle'};
    const teams = {
      getTask:(_lead, id) => id === current.id ? {...current} : dependencyStatus ? {id, status:dependencyStatus} : null,
      sendMessage:async (_lead, message) => { messages.push(message); return {messageId:'accepted-only'}; },
    };
    const ctx = {get:name => name === 'agentTeams' ? teams : name === 'agents' ? {get:() => lead} : undefined};
    const result = await executeOfficeCommand(ctx, {commandId:'5c2b30d4-9af0-4d8c-9f7e-448d51d944ef', sessionId:'root', action:'task.start', args:{taskId:task.id, expectedRevision:task.revision}});
    assert.equal(result.ok, dependencyStatus === 'completed');
    assert.equal(messages.length, dependencyStatus === 'completed' ? 1 : 0);
    if (!result.ok) assert.equal(result.error.code, 'office/task-blocked');
    assert.equal(lead.status, 'idle');
    assert.equal(current.status, 'in_progress');
  }
});

test('host snapshot retains native false readiness but counts only pending readiness as blocked', async () => {
  const waiting = {...task, id:'task-8', status:'pending', blockedBy:[task.id]};
  const done = {...task, id:'task-1', status:'completed'};
  const team = {id:'root', members:[seat], tasks:[task, waiting, done]};
  const services = {
    agentTeams:{},
    agents:{list:() => [{id:'root', status:'idle'}, {id:'worker', status:'idle'}]},
    sessions:{get:id => id === 'root' ? {header:{id, createdAt:1, isSeeded:false}} : undefined},
    sessionProjections:{stateOf:() => team, cachedSnapshot:() => ({values:{title:'Department'}})},
  };
  const snapshot = await collectOffice({get:name => services[name]}, {sessionId:'root', currentOnly:true});
  assert.deepEqual(snapshot.floors[0].taskCounts, {pending:1, inProgress:1, completed:1, blocked:1, total:3});
  const assigned = snapshot.floors[0].tasks.find(item => item.id === task.id);
  assert.equal(assigned.ready, false);
  assert.equal(assigned.status, 'in_progress');
});
