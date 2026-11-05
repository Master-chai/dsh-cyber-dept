import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {TaskBoard,taskRevealPatch} from '../src/client/task-board.js';

const tasks=[
  {id:'active',subject:'Active work',status:'in_progress',ownerName:'Worker'},
  {id:'todo',subject:'Next work',status:'pending',ready:true},
  {id:'blocked',subject:'Blocked work',status:'pending',ready:false,blockedBy:['todo']},
  {id:'done',subject:'Finished work',status:'completed'},
  {id:'deleted',subject:'Deleted work',status:'deleted'},
];
const floor={id:'lead',tasks,seats:[{id:'worker',name:'Worker',state:'idle'}]};
const rows=renderer=>renderer.root.findAll(node=>node.type==='li'&&node.props['data-task-id']).map(node=>node.props['data-task-id']);
function renderBoard(props,run){
  let renderer;
  act(()=>{renderer=TestRenderer.create(React.createElement(TaskBoard,props));});
  try{run(renderer);}finally{act(()=>renderer.unmount());}
}

test('task board starts with controls and has no explanatory banner or search field',()=>{
  renderBoard({floor},renderer=>{
    assert.equal(renderer.toJSON().children[0].props.className,'cid-board-controls');
    assert.equal(renderer.root.findAllByType('input').length,0);
    assert.doesNotMatch(JSON.stringify(renderer.toJSON()),/指派即可进入|不代表成员已开始执行|搜索任务或负责人/);
    assert.equal(renderer.root.findByProps({className:'cid-board-controls'}).children.length,1);
    assert.equal(renderer.root.findByProps({className:'cid-task-tabs'}).findAllByType('button').length,5);
  });
});

test('old cached searches cannot hide task rows or affect status filters and progress',()=>{
  for(const search of ['no matching title or owner',null,undefined]){
    const view={value:{filter:'all',search,expandedTaskId:null},change:patch=>Object.assign(view.value,patch)};
    renderBoard({floor,view},renderer=>{
      const update=()=>act(()=>renderer.update(React.createElement(TaskBoard,{floor,view})));
      assert.deepEqual(rows(renderer),['active','todo','blocked','done']);
      const tabs=renderer.root.findByProps({className:'cid-task-tabs'}).findAllByType('button');
      const expected=[['active','todo','blocked','done'],['active'],['todo','blocked'],['blocked'],['done']];
      tabs.forEach((tab,index)=>{act(()=>tab.props.onClick());update();assert.deepEqual(rows(renderer),expected[index]);});
      act(()=>renderer.root.findByProps({className:'cid-task-progress'}).props.onClick());update();
      assert.deepEqual(rows(renderer),expected[0]);
      act(()=>renderer.root.findByProps({className:'cid-task-progress'}).props.onClick());update();
      assert.deepEqual(rows(renderer),['done']);
    });
  }
});

test('pagination remains usable across status changes with obsolete cached query keys',()=>{
  const many={...floor,tasks:Array.from({length:125},(_,i)=>({id:'task-'+i,subject:'Task '+i,status:i<123?'pending':'completed'}))};
  const view={value:{filter:'all',search:'old query',taskPage:{key:'all\nold query',count:100}},change:patch=>Object.assign(view.value,patch)};
  renderBoard({floor:many,view},renderer=>{
    const update=()=>act(()=>renderer.update(React.createElement(TaskBoard,{floor:many,view})));
    assert.equal(rows(renderer).length,50);
    act(()=>renderer.root.findByProps({className:'cid-btn'}).props.onClick());update();
    assert.equal(rows(renderer).length,100);assert.deepEqual(view.value.taskPage,{key:'all',count:100});
    act(()=>renderer.root.findByProps({className:'cid-btn'}).props.onClick());update();
    assert.equal(rows(renderer).length,125);assert.equal(renderer.root.findAllByProps({className:'cid-btn'}).length,0);
    act(()=>renderer.root.findByProps({className:'cid-task-progress'}).props.onClick());update();assert.equal(rows(renderer).length,2);
    act(()=>renderer.root.findByProps({className:'cid-task-progress'}).props.onClick());update();assert.equal(rows(renderer).length,125);
  });
});

test('revealing a task beyond page 50 works with legacy cached search and still toggles details',()=>{
  const many={...floor,tasks:Array.from({length:75},(_,i)=>({id:'task-'+i,subject:'Task '+i,status:'pending'}))};
  const target=many.tasks[74],value={search:'legacy query',...taskRevealPatch(many,target)};
  const view={value,change:patch=>Object.assign(value,patch)};
  assert.equal(value.taskPage.key,'all');
  renderBoard({floor:many,view},renderer=>{
    assert.equal(rows(renderer).length,75);
    const row=renderer.root.findByProps({'data-task-id':target.id});
    assert.equal(row.findByProps({className:'cid-task-row'}).props['aria-expanded'],true);
    act(()=>row.findByProps({className:'cid-task-row'}).props.onClick());
    act(()=>renderer.update(React.createElement(TaskBoard,{floor:many,view})));
    assert.equal(renderer.root.findAllByProps({className:'cid-task-expanded'}).length,0);
  });
});

test('task action feedback and expanded dependency and activity details remain visible',()=>{
  renderBoard({floor,view:{value:{filter:'all',expandedTaskId:'blocked'},change(){}},taskActionStatus:{tone:'success',text:'任务操作结果'}},renderer=>{
    assert.equal(renderer.toJSON().children[0].props.className,'cid-write-status');
    assert.match(JSON.stringify(renderer.toJSON()),/任务操作结果/);
    assert.match(JSON.stringify(renderer.toJSON()),/成员活动/);
    const details=renderer.root.findByProps({className:'cid-task-expanded'});
    assert.equal(details.findByType('b').children.join(''),'前置任务');
    assert.ok(details.findAllByType('li').some(node=>node.children.join('').includes('Next work')));
  });
});
