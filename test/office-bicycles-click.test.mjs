import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {createOfficeLayout,createOfficeActor,stepOfficeActor} from '../src/client/scene/model.js';

// Mount the real OfficeScene, run its real RAF/engine, and invoke its actual canvas events.
test('both cyclists can be selected through the real scaled and offset canvas click handler',()=>{
 const team=Array.from({length:12},(_,i)=>({id:'rest-'+i,name:'Member '+i,state:i%2?'done':'idle',live:true}));
 const expectedLayout=createOfficeLayout(team),expected=team.map((m,i)=>createOfficeActor(m,expectedLayout.seats[i]));
 let now=100,serial=0,api;const frames=new Map(),selected=[],translations=[];
 const context=new Proxy({},{set(t,k,v){t[k]=v;return true;},get(t,k){return t[k]??((...args)=>{if(k==='clearRect')translations.length=0;if(k==='translate')translations.push(args);});}});
 const canvas={dataset:{},getContext:()=>context};
 vm.runInNewContext(readFileSync(new URL('../.verify/client-test.js',import.meta.url),'utf8'),{
  window:{__ModuleLoader__:{load:({factory})=>{api=factory(()=>React).__internals;}},matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})},
  document:{hidden:false,createElement:()=>({getContext:()=>context}),addEventListener(){},removeEventListener(){}},
  performance:{now:()=>now},requestAnimationFrame:fn=>{frames.set(++serial,fn);return serial;},cancelAnimationFrame:id=>frames.delete(id),
 });
 let tree;act(()=>{tree=TestRenderer.create(React.createElement(api.OfficeScene,{floor:{seats:team,live:true},scheme:'light',onSelectSeat:id=>selected.push(id)}),{createNodeMock:element=>element.type==='canvas'?canvas:null});});
 for(let frame=0;frame<12000;frame++){
  now+=40;const [id,callback]=frames.entries().next().value;frames.delete(id);callback(now);
  expected.forEach((a,i)=>stepOfficeActor(a,team[i],expectedLayout,.04,'lively'));
  if(expected.filter(a=>a.phase==='break'&&a.breakKind==='bike').length===2)break;
 }
 const cyclists=expected.filter(a=>a.phase==='break'&&a.breakKind==='bike');assert.equal(cyclists.length,2);
 for(const actor of cyclists){
  assert.ok(translations.some(([x,y])=>x===actor.x&&y===actor.y),'actual renderer put a cyclist on this bike');
  for(const scale of [.5,1,1.5])for(const offset of [{left:120,top:80},{left:-30,top:-220}])for(const y of [actor.y-77,actor.y-40,actor.y-20]){
   const box={...offset,width:expectedLayout.width*scale,height:expectedLayout.height*scale};
   act(()=>tree.root.findByType('canvas').props.onClick({clientX:box.left+actor.x*scale,clientY:box.top+y*scale,currentTarget:{getBoundingClientRect:()=>box}}));
   assert.equal(selected.at(-1),actor.id);
  }
 }
 assert.equal(selected.length,36);act(()=>tree.unmount());assert.equal(frames.size,0);
});
