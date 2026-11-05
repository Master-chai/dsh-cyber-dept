import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {buildSync} from 'esbuild';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

const css=readFileSync(new URL('../src/client/office-scene.css',import.meta.url),'utf8');
const code=buildSync({entryPoints:[fileURLToPath(new URL('../src/client/components/employee-card.js',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',external:['react'],loader:{'.png':'dataurl','.webp':'dataurl'}}).outputFiles[0].text;
const module={exports:{}};
runInNewContext(code,{module,exports:module.exports,require:createRequire(import.meta.url),setTimeout,clearTimeout,document:{activeElement:null,addEventListener(){},removeEventListener(){}}});
const {DetailPane}=module.exports;
const task={id:'task-1',revision:3,subject:'核验界面',status:'in_progress',blockedBy:[]};
const seat={id:'worker',name:'spec-review',role:'teammate',phase:'active',state:'thinking',task};
function props(current=seat,enabled=true){return {seat:current,floor:{id:'lead',seats:[current],tasks:[task]},writeGate:{enabled,reason:enabled?'':'快照只读'}};}
function actionButtons(renderer){return renderer.root.findByProps({className:'cid-write-grid'}).findAllByType('button');}

test('employee communication switches directly between two and four columns using its own available width',()=>{
  assert.match(css,/\.cid-write\{container:cid-communication \/ inline-size\}/);
  assert.match(css,/\.cid-write-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(css,/@container cid-communication \(min-width:360px\)\{\.cid-write-grid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}\}/);
  assert.match(css,/\.cid-write-grid>\.cid-write-btn\[data-cyber-write=approval\]\{grid-column:1 \/ -1\}/);
});

test('only the four employee actions are visually half-height, with separate non-overlapping hit areas',()=>{
  assert.match(css,/\.cid-root\{[^}]*container-name:cid-panel/);
  // The approval entry keeps its original sizing; specific action rules override these defaults.
  assert.match(css,/@container cid-panel \(max-width:700px\)\{\.cid-write-btn\{min-height:44px\}\}/);
  assert.match(css,/\.cid-write-btn\{min-height:32px;border-radius:5px\}/);
  const compact=css.slice(css.indexOf('/* Halve only'),css.indexOf('/* The current-session'));
  assert.match(compact,/--cid-employee-action-height:16px;--cid-employee-action-target:24px/);
  assert.match(compact,/@container cid-panel \(max-width:700px\)\{\.cid-write-grid\{--cid-employee-action-height:22px\}\}/);
  assert.match(compact,/\.cid-write-grid>\.cid-write-btn:not\(\[data-cyber-write=approval\]\)\{position:relative;min-height:0;height:var\(--cid-employee-action-height\);line-height:1;padding:0 8px;white-space:nowrap\}/);
  assert.match(compact,/::after\{content:"";position:absolute;top:50%;left:-1px;right:-1px;height:var\(--cid-employee-action-target\);transform:translateY\(-50%\)\}/);
  assert.match(compact,/@media\(any-pointer:coarse\)\{\.cid-write-grid\{--cid-employee-action-target:44px\}\}/);
  assert.match(compact,/row-gap:max\(6px,calc\(var\(--cid-employee-action-target\) - var\(--cid-employee-action-height\)\)\)/);
  assert.match(compact,/padding-block:calc\(\(var\(--cid-employee-action-target\) - var\(--cid-employee-action-height\)\) \/ 2\)/);
  for(const [old,height] of [[32,16],[44,22]])for(const target of [24,44]){
    assert.equal(height,old/2);
    assert.ok(height+Math.max(6,target-height)>=target,'adjacent rows have separate hit areas');
  }
  assert.doesNotMatch(compact,/\.cid-modal|font-size|background|color:|border-radius|order:|outline:/);
});

test('employee controls omit the visible heading and availability badge while preserving accessible name and read-only reason',()=>{
  let renderer;
  act(()=>{renderer=TestRenderer.create(React.createElement(DetailPane,props()));});
  try{
    for(const enabled of [true,false]){
      act(()=>renderer.update(React.createElement(DetailPane,props(seat,enabled))));
      const section=renderer.root.findByProps({className:'cid-write'});
      assert.equal(section.props['aria-label'],'沟通');
      assert.equal(section.props['data-cyber-write-state'],enabled?'enabled':'disabled');
      assert.equal(section.props['data-cyber-write-enabled'],enabled?'1':'0');
      assert.equal(section.findAllByType('h4').length,0);
      assert.equal(section.findAllByProps({className:'cid-chip'}).length,0);
      assert.equal(section.findAllByProps({className:'cid-write-head'}).length,0);
      assert.equal(section.findAllByProps({'data-cyber-write-blocked':'快照只读'}).length,enabled?0:1);
    }
  }finally{act(()=>renderer.unmount());}
});

test('all four communication actions keep order, labels and their confirmation dialogs after repeated open/cancel',()=>{
  let renderer;
  act(()=>{renderer=TestRenderer.create(React.createElement(DetailPane,props()));});
  try{
    assert.deepEqual(actionButtons(renderer).map(button=>button.children.join('')),['发消息','打断','完成任务','派活']);
    for(let pass=0;pass<2;pass++)for(const kind of ['message','interrupt','complete','assign']){
      const button=actionButtons(renderer).find(button=>button.props['data-cyber-write']===kind);
      assert.equal(button.props.disabled,false);
      act(()=>button.props.onClick());
      const modal=renderer.root.findByProps({'data-cyber-modal':'write'});
      assert.equal(modal.props['data-cyber-kind'],kind);
      assert.equal(modal.props['data-cyber-phase'],'compose');
      assert.equal(modal.props['aria-modal'],'true');
      assert.ok(renderer.root.findByProps({'data-cyber-confirm':'1'}));
      act(()=>renderer.root.findByProps({'data-cyber-cancel':'1'}).props.onClick());
      assert.equal(renderer.root.findAllByProps({'data-cyber-modal':'write'}).length,0);
    }
    act(()=>renderer.update(React.createElement(DetailPane,props({...seat,task:{...task,status:'completed'}}))));
    const reopen=actionButtons(renderer)[2];
    assert.equal(reopen.children.join(''),'重开任务');
    act(()=>reopen.props.onClick());
    assert.equal(renderer.root.findByProps({'data-cyber-modal':'write'}).props['data-cyber-kind'],'reopen');
  }finally{act(()=>renderer.unmount());}
});

test('offline, read-only and approval cases retain their existing enabled states and safe handlers',()=>{
  let renderer;
  act(()=>{renderer=TestRenderer.create(React.createElement(DetailPane,props({...seat,state:'offline',task:null})));});
  try{
    assert.deepEqual(actionButtons(renderer).map(button=>button.props.disabled),[false,true,true,false]);
    for(const button of actionButtons(renderer).filter(button=>button.props.disabled))assert.equal(button.props.onClick,undefined);
    act(()=>renderer.update(React.createElement(DetailPane,props(seat,false))));
    assert.ok(actionButtons(renderer).every(button=>button.props.disabled&&button.props.onClick===undefined));
    act(()=>renderer.update(React.createElement(DetailPane,props({...seat,state:'waiting-approval',approval:{toolName:'bash',reason:'等待批准'}}))));
    assert.deepEqual(actionButtons(renderer).map(button=>button.props['data-cyber-write']),['message','interrupt','complete','assign','approval']);
    assert.equal(actionButtons(renderer)[4].props.disabled,false);
  }finally{act(()=>renderer.unmount());}
});
