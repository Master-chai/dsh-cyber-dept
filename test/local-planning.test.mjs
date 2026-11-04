import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { PlanningPane } from '../src/client/components/planning.js';
import { emptyPlanning, planningKey, readPlanning, savePlanning, profileFields, parseBudget, exportProfile, importProfile } from '../src/client/model/local-planning.js';
function storage() { const items = new Map(); return { getItem: key => items.get(key) ?? null, setItem: (key,value) => items.set(key,value) }; }
test('planning persists only allowlisted fields and isolates exact floor IDs', () => {
  const store = storage();
  const data = emptyPlanning();
  data.profiles.push({ name:'Dev', role:'Engineer', skills:'Testing', model:'m', provider:'p', memory:'private', apiKey:'secret', tasks:[1] });
  savePlanning(store, 'one', data);
  assert.deepEqual(readPlanning(store,'two').data, emptyPlanning());
  assert.deepEqual(Object.keys(readPlanning(store,'one').data.profiles[0]), ['name','role','skills','model','provider']);
  assert.equal(store.getItem(planningKey('one')).includes('secret'), false);
  assert.notEqual(planningKey('one/a'), planningKey('one%2Fa'));
  assert.throws(() => planningKey(''));
});
test('budget rejects invalid amounts and preserves unknown versus explicit zero', () => {
  assert.equal(parseBudget(''), null);
  assert.equal(parseBudget(0), 0);
  assert.equal(parseBudget('23',true),23);
  for (const value of [-1, Infinity, NaN, 'no', {}, true, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => parseBudget(value));
  assert.throws(() => parseBudget(1.2,true));
  assert.equal(parseBudget(1.2),1.2);
});
test('storage failures and corrupt rows are explicit, never reported as saved', () => {
  const store = storage();
  store.setItem(planningKey('one'), 'broken');
  assert.match(readPlanning(store,'one').error,/禁止保存/);
  assert.match(readPlanning(null,'one').error,/无法读取/);
  assert.throws(() => savePlanning(null,'one',emptyPlanning()));
  store.setItem(planningKey('one'), JSON.stringify({v:2,profiles:[]}));
  assert.ok(readPlanning(store,'one').error);
});
test('manual export/import transfers template fields only, with bounds and validation', () => {
  const profile = {name:'Developer',role:'Engineer',skills:'Tests',model:'m',provider:'p'};
  assert.deepEqual(importProfile(exportProfile({...profile,memory:'project-specific',task:'secret'})), profile);
  assert.equal(profileFields({name:'x'.repeat(300)}).name.length,100);
  assert.throws(() => importProfile('not-json'));
  assert.throws(() => importProfile(JSON.stringify({v:1,profile:{name:''}})));
  assert.throws(() => importProfile('x'.repeat(32001)));
  assert.throws(() => savePlanning(storage(),'one',{...emptyPlanning(),profiles:Array.from({length:31},()=>profile)}));
});
function button(root, text) { return root.findAllByType('button').find(node=>node.children.join('')===text); }
function input(root, label) { return root.findAllByType('label').find(node=>node.children[0]===label).findAll(node=>node.type==='input'||node.type==='textarea')[0]; }
const floor = {id:'one',seats:[{id:'dev',name:'Dev'}]};
test('planning UI saves budgets and profiles without host commands; reset requires confirmation', () => {
  const previous = globalThis.window;
  const store = storage(); globalThis.window = {localStorage:store};
  let render;
  try {
    act(()=>{render=TestRenderer.create(React.createElement(PlanningPane,{floor,seat:{name:'Dev',roleText:'private project duty',model:'m'}}));});
    assert.match(JSON.stringify(render.toJSON()),/不可用不代表零消耗/);
    act(()=>button(render.root,'从选中员工预填').props.onClick());
    assert.equal(input(render.root,'通用岗位').props.value,'');
    act(()=>render.root.findAllByType('form')[1].props.onSubmit({preventDefault(){}}));
    assert.equal(readPlanning(store,'one').data.profiles.length,1);
    act(()=>input(render.root,'部门 Token 预算（留空表示未设置）').props.onChange({target:{value:'100'}}));
    act(()=>render.root.findAllByType('form')[0].props.onSubmit({preventDefault(){}}));
    assert.equal(readPlanning(store,'one').data.budget.tokens,100);
    act(()=>button(render.root,'清空本部门本地数据').props.onClick());
    assert.equal(readPlanning(store,'one').data.profiles.length,1);
    act(()=>button(render.root,'取消').props.onClick());
    assert.equal(readPlanning(store,'one').data.profiles.length,1);
    act(()=>button(render.root,'清空本部门本地数据').props.onClick());
    act(()=>button(render.root,'确认清空').props.onClick());
    assert.deepEqual(readPlanning(store,'one').data,emptyPlanning());
  } finally { if(render)act(()=>render.unmount()); globalThis.window = previous; }
});
test('stale panel cannot overwrite another panel data, and floor remount clears drafts', () => {
  const previous = globalThis.window;
  const store=storage(); globalThis.window={localStorage:store};
  let render;
  try {
    act(()=>{render=TestRenderer.create(React.createElement(PlanningPane,{key:'one',floor}));});
    act(()=>input(render.root,'档案名称').props.onChange({target:{value:'unsaved'}}));
    savePlanning(store,'one',{...emptyPlanning(),profiles:[profileFields({name:'Other panel'})]});
    act(()=>render.root.findAllByType('form')[1].props.onSubmit({preventDefault(){}}));
    assert.match(JSON.stringify(render.toJSON()),/其他面板修改/);
    assert.equal(readPlanning(store,'one').data.profiles[0].name,'Other panel');
    act(()=>render.update(React.createElement(PlanningPane,{key:'two',floor:{...floor,id:'two'}})));
    assert.equal(input(render.root,'档案名称').props.value,'');
  } finally { if(render)act(()=>render.unmount()); globalThis.window=previous; }
});

test('maximum legal escaped profiles save and reopen without self-locking', () => {
  const store=storage(), profile=profileFields({name:'x'.repeat(100),role:'\u0000'.repeat(2000),skills:'\u0000'.repeat(2000),model:'x'.repeat(200),provider:'x'.repeat(200)});
  const data={...emptyPlanning(),profiles:Array.from({length:30},()=>profile)};
  savePlanning(store,'one',data);
  assert.ok(store.getItem(planningKey('one')).length>150000);
  assert.equal(readPlanning(store,'one').error,'');
  assert.deepEqual(readPlanning(store,'one').data,data);
  assert.deepEqual(importProfile(exportProfile(profile)),profile);
});
test('previously saved oversized valid records recover without data loss',()=>{
 const store=storage();const profile=profileFields({name:'Legacy',role:'a\n'.repeat(1000),skills:'a\n'.repeat(1000)});
 const data={...emptyPlanning(),profiles:Array.from({length:30},()=>profile)};
 store.setItem(planningKey('one'),JSON.stringify(data));
 assert.equal(readPlanning(store,'one').error,'');assert.deepEqual(readPlanning(store,'one').data,data);
});
test('unreadable data requires explicit confirmation to reset and detects concurrent changes',()=>{
 const previous=globalThis.window,store=storage();store.setItem(planningKey('one'),'x'.repeat(1000001));globalThis.window={localStorage:store};let render;
 try{
  act(()=>{render=TestRenderer.create(React.createElement(PlanningPane,{floor}));});
  assert.equal(button(render.root,'保存预算').props.disabled,true);
  act(()=>button(render.root,'清空本部门本地数据').props.onClick());
  assert.ok(store.getItem(planningKey('one')).length>1000000);
  act(()=>button(render.root,'确认清空').props.onClick());
  assert.deepEqual(readPlanning(store,'one').data,emptyPlanning());assert.equal(button(render.root,'保存预算').props.disabled,false);
  act(()=>render.unmount());store.setItem(planningKey('one'),'broken');
  act(()=>{render=TestRenderer.create(React.createElement(PlanningPane,{floor}));});
  act(()=>button(render.root,'清空本部门本地数据').props.onClick());
  savePlanning(store,'one',{...emptyPlanning(),budget:{tokens:45,amount:null,currency:'CNY'}});
  act(()=>button(render.root,'确认清空').props.onClick());
  assert.equal(readPlanning(store,'one').data.budget.tokens,45);assert.match(JSON.stringify(render.toJSON()),/本地数据已变化/);
 }finally{if(render)act(()=>render.unmount());globalThis.window=previous;}
});
