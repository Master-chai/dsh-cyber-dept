import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
let plugin;
vm.runInNewContext(readFileSync(new URL('../.verify/client-test.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:({factory})=>{plugin=factory(()=>React);}}},console,setTimeout,clearTimeout,AbortController,AbortSignal});
const api=plugin.__internals;

test('employee details omit member ID from the DOM while keeping identity and other facts',()=>{
 const seat={id:'private-member-id-73b6',name:'工程师',role:'teammate',phase:'active',state:'idle',model:'DeepSeek',provider:'Provider',roleText:'实现与验证'};
 let renderer;
 act(()=>{renderer=TestRenderer.create(React.createElement(api.DetailPane,{seat,floor:{id:'lead',seats:[seat],tasks:[]},writeGate:{enabled:true}}));});
 try{
  const dom=JSON.stringify(renderer.toJSON());
  assert.ok(!dom.includes(seat.id));assert.ok(!dom.includes('成员 ID'));
  const labels=renderer.root.findAllByType('dt').map(node=>node.children.join(''));
  assert.deepEqual(labels,['模型']);
  assert.ok(dom.includes('Provider / DeepSeek'));assert.ok(dom.includes('实现与验证'));
  assert.equal(renderer.root.findByProps({className:'cid-detail-title'}).children.join(''),'工程师');
  // Identity still drives the avatar; it is not written to a DOM attribute.
  const avatar=renderer.root.findAll(node=>typeof node.type==='function'&&node.props.id===seat.id);
  assert.equal(avatar.length,1);
  assert.equal(seat.id,'private-member-id-73b6');
 }finally{act(()=>renderer.unmount());}
});

test('hidden member ID still resolves the exact native session for approval navigation',async()=>{
 const seat={id:'private-approval-target-91a4',name:'工程师',role:'teammate',phase:'active',state:'waiting-approval',approval:{toolName:'bash',reason:'核对操作'}};
 const calls=[];let renderer;
 const dispose=api.setRuntimeContext({uiWorkspace:{openSession:target=>calls.push(target)}});
 try{
  act(()=>{renderer=TestRenderer.create(React.createElement(api.DetailPane,{seat,floor:{id:'lead',seats:[seat],tasks:[]},writeGate:{enabled:true}}));});
  assert.ok(!JSON.stringify(renderer.toJSON()).includes(seat.id));
  const approval=renderer.root.findAllByType('button').find(node=>node.props['data-cyber-write']==='approval');
  assert.ok(approval,'native approval button is retained');
  await act(async()=>{await approval.props.onClick();});
  assert.deepEqual(calls,[seat.id]);
  assert.ok(!JSON.stringify(renderer.toJSON()).includes(seat.id));
 }finally{if(renderer)act(()=>renderer.unmount());dispose();}
});
