import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transform} from 'esbuild';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {TaskBoard} from '../src/client/task-board.js';

const css=readFileSync(new URL('../src/client/office-scene.css',import.meta.url),'utf8');
const start=css.indexOf('/* Requested visual sizes:');
const end=css.indexOf('\n.cid-seats-band .cid-avatar',start);
const compact=css.slice(start,end);
const selectors=['.cid-current .cid-task-board .cid-task-tabs button','.cid-current .cid-task-board .cid-task-action'];

test('five status filters are 30px; detail actions are 22px, not a shared size',()=>{
  assert.ok(start>=0&&end>start);
  assert.ok(compact.includes(selectors[0]+'{--cid-task-control-height:30px}'));
  assert.ok(compact.includes(selectors[1]+'{--cid-task-control-height:22px}'));
  assert.match(compact,/min-height:var\(--cid-task-control-height\);height:var\(--cid-task-control-height\);min-block-size:var\(--cid-task-control-height\);block-size:var\(--cid-task-control-height\)/);
  assert.match(compact,/display:inline-flex;align-items:center;justify-content:center/);
  assert.match(compact,/line-height:16px;padding:0 8px;font-size:11px;white-space:nowrap/);
  assert.doesNotMatch(compact,/font-size:[0-9]px|scale\(/);
});

test('coarse pointers extend transparent hit areas to 44px without inflating visible controls',()=>{
  const touch=compact.slice(compact.indexOf('@media(any-pointer:coarse)'));
  for(const selector of selectors){
    assert.ok(touch.includes(selector+'::after'));
    assert.ok(!touch.includes(selector+'{'),'no 44px override on the visible button');
  }
  assert.match(touch,/content:"";position:absolute;top:50%;left:-1px;right:-1px;height:44px;transform:translateY\(-50%\)/);
  assert.match(compact,/min-width:44px/);
  const filters=30,actions=22,target=44;
  assert.ok(18>=target-filters,'wrapped filter hit areas do not overlap');
  assert.ok(24>=target-actions,'wrapped action hit areas do not overlap');
  assert.match(touch,/\.cid-task-tabs\{row-gap:18px\}/);
  assert.match(touch,/\.cid-task-actions\{row-gap:24px\}/);
  assert.match(css,/\.cid-task-action:disabled\{opacity:\.5;cursor:not-allowed\}/);
});

test('compact controls leave progress, pagination, focus, row and modal sizing independent',()=>{
  assert.match(compact,/\.cid-task-board>\.cid-btn,\n\.cid-current \.cid-task-board \.cid-task-progress\{min-height:22px;height:auto;line-height:16px;padding:2px 8px;font-size:11px\}/);
  assert.match(compact,/\.cid-task-board>\.cid-btn,\.cid-current \.cid-task-board \.cid-task-progress\{min-height:44px;padding:6px 8px\}/);
  assert.doesNotMatch(compact,/\.cid-modal|\.cid-task-row|outline:none|outline:0|pointer-events:none/);
  assert.match(css,/:focus-visible\{outline:2px solid var\(--cid-accent\)/);
});

test('full stylesheet parses without CSS warnings',async()=>{
  const result=await transform(css,{loader:'css',target:'chrome120'});
  assert.deepEqual(result.warnings,[]);
});

test('compact-board filters, native labels and dependency-disabled actions retain their behavior',()=>{
  const calls=[],changes=[];
  const task={id:'task-7',subject:'安装这些插件',description:'配置插件',status:'in_progress',revision:1,ownerName:'worker',blockedBy:['task-1']};
  const floor={id:'lead',seats:[{id:'worker',name:'worker',role:'teammate',phase:'active'}],tasks:[{id:'task-1',subject:'前置检查',status:'pending',revision:1,blockedBy:[]},task]};
  let renderer;
  act(()=>{renderer=TestRenderer.create(React.createElement(TaskBoard,{floor,view:{value:{filter:'all',search:'',expandedTaskId:'task-7'},change:patch=>changes.push(patch)},writeGate:{enabled:true},onTaskAction:(kind,task)=>calls.push([kind,task.id])}));});
  try{
    const tabs=renderer.root.findByProps({className:'cid-task-tabs'}).findAllByType('button');
    assert.deepEqual(tabs.map(button=>button.children[0]),['全部','进行中','待办','受阻','已完成']);
    act(()=>tabs[3].props.onClick());assert.deepEqual(changes,[{filter:'blocked'}]);
    const startButton=renderer.root.findByProps({'data-task-action':'start'});
    assert.equal(startButton.props.disabled,true);assert.match(startButton.props.title,/前置任务尚未完成/);
    assert.equal(startButton.props['aria-label'],'立即执行：安装这些插件');
    const deleteButton=renderer.root.findByProps({'data-task-action':'delete'});
    assert.equal(deleteButton.props.disabled,false);
    act(()=>deleteButton.props.onClick());assert.deepEqual(calls,[['delete','task-7']]);
  }finally{act(()=>renderer.unmount());}
});
