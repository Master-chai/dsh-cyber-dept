import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Exercise real component event handlers with deterministic hook state; no DSH writes.
function harness() {
  const instances = new Map(), layouts = [], effects = [], timers = new Map();
  let client, current, cursor, nextTimer = 0;
  const slot = init => {
    const index = cursor++;
    if (!(index in current)) current[index] = init();
    return [current, index];
  };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    memo: fn => fn, useMemo: fn => fn(), useCallback: fn => fn,
    useSyncExternalStore: (_subscribe, get) => get(),
    useState(init) {
      const [values, index] = slot(() => typeof init === 'function' ? init() : init);
      return [values[index], value => { values[index] = typeof value === 'function' ? value(values[index]) : value; }];
    },
    useRef(value) { const [values,index] = slot(() => ({ current:value })); return values[index]; },
    useId() { const [values,index] = slot(() => `id-${cursor}`); return values[index]; },
    useEffect(fn, deps) {
      const [values,index] = slot(() => null), old=values[index];
      if (!old || deps.some((value,i) => value !== old.deps[i])) {
        const next={deps,cleanup:null}; values[index]=next;
        effects.push(() => { if(old?.cleanup)old.cleanup(); next.cleanup=fn(); });
      }
    },
    useLayoutEffect(fn, deps) {
      const [values,index] = slot(() => null), old = values[index];
      if (!old || deps.some((value,i) => value !== old[i])) layouts.push(fn);
      values[index] = deps;
    },
  };
  vm.runInNewContext(readFileSync(new URL('../.verify/client-test.js', import.meta.url), 'utf8'), {
    window: { matchMedia: () => ({matches:false}), __ModuleLoader__: { load: ({ factory }) => { client = factory(() => react); } } },
    setTimeout: fn => { timers.set(++nextTimer,fn); return nextTimer; }, clearTimeout: id => timers.delete(id),
  });
  return {
    api: client.__internals,
    render(component, props, key=component.name) {
      if (!instances.has(key)) instances.set(key, []);
      current=instances.get(key); cursor=0;
      return component(props);
    },
    layout() { layouts.splice(0).forEach(fn => fn()); },
    effects() { effects.splice(0).forEach(fn => fn()); },
    expire() { const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn()); },
    timerCount: () => timers.size,
    unmount(key) { instances.delete(key); },
  };
}
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(node => nodes(node,predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children,predicate)];
}
const byClass = (tree, name) => nodes(tree,n => n.props?.className===name)[0];
function sessions(id='a') {
  return { byId:{[id]:{displayTitle:'Current'}}, projectionsBySession:{[id]:{values:{agentTeam:{
    members:[{id,name:'lead',role:'lead'},{id:id+'-worker',name:'Worker',role:'teammate'}],
    tasks:[{id:'task-1',subject:'Owned task',status:'pending',ownerId:id+'-worker'},
      {id:'task-2',subject:'Done task',status:'completed'},
      {id:'task-3',subject:'Unassigned task',description:'Read-only task',status:'pending'}],
  }}}}};
}
function pageProps(id='a') { return {officeSessionId:id,active:true,useSessions: select => select(sessions(id))}; }
function floor(tree) { return byClass(tree,'cid-body').props.children[0]; }

test('task click links its owner and opens office/detail; person click clears task override', () => {
  const h=harness(); let tree=h.render(h.api.Page,pageProps());
  floor(tree).props.view.fold('detail',false); floor(tree).props.view.fold('office',false);
  tree=h.render(h.api.Page,pageProps());
  assert.equal(floor(tree).props.detail.props.expanded,false);
  floor(tree).props.onSelectTask(floor(tree).props.floor.tasks[0]);
  tree=h.render(h.api.Page,pageProps());
  assert.equal(floor(tree).props.selectedSeatId,'a-worker');
  assert.equal(floor(tree).props.detail.props.expanded,true);
  assert.equal(floor(tree).props.view.value.folds.office,true);
  assert.equal(floor(tree).props.detail.props.children[0].props.taskOverride.id,'task-1');
  floor(tree).props.onSelectSeat('a');
  tree=h.render(h.api.Page,pageProps());
  assert.equal(floor(tree).props.selectedSeatId,'a');
  assert.equal(floor(tree).props.selectedTaskId,null);
  assert.equal(floor(tree).props.detail.props.children[0].props.taskOverride,null);
});

test('unassigned task does not expose a different member or write controls', () => {
  const h=harness(); let tree=h.render(h.api.Page,pageProps());
  floor(tree).props.onSelectTask(floor(tree).props.floor.tasks[2]);
  tree=h.render(h.api.Page,pageProps());
  assert.equal(floor(tree).props.selectedSeatId,null);
  assert.equal(floor(tree).props.detail.props.meta,'未指派');
  assert.equal(nodes(floor(tree).props.detail,n => n.type===h.api.DetailPane).length,0);
  assert.equal(nodes(floor(tree).props.detail,n => n.type==='button').length,0);
});

test('session return restores fold/filter/selection/search/task expansion and scroll without cross-session leakage', () => {
  const h=harness(); let tree=h.render(h.api.Page,pageProps('a'),'page-a');
  floor(tree).props.onSelectSeat('a-worker');
  floor(tree).props.view.fold('office',false);
  floor(tree).props.view.change({filter:'completed',search:'Done',expandedTaskId:'task-2'});
  const body=byClass(tree,'cid-body');
  const scrollElement={scrollTop:420}; body.props.onScroll({target:scrollElement,currentTarget:scrollElement});
  h.unmount('page-a');
  tree=h.render(h.api.Page,pageProps('b'),'page-b');
  assert.equal(floor(tree).props.view.value.filter,'all');
  assert.equal(floor(tree).props.view.value.folds.office,true);
  assert.equal(floor(tree).props.view.value.scrollTop,0);
  tree=h.render(h.api.Page,pageProps('a'),'page-a');
  assert.equal(floor(tree).props.selectedSeatId,'a-worker');
  assert.equal(floor(tree).props.view.value.filter,'completed');
  assert.equal(floor(tree).props.view.value.search,'Done');
  assert.equal(floor(tree).props.view.value.expandedTaskId,'task-2');
  assert.equal(floor(tree).props.view.value.folds.office,false);
  byClass(tree,'cid-body').props.ref.current=scrollElement; scrollElement.scrollTop=0; h.layout();
  assert.equal(scrollElement.scrollTop,420);
});

test('progress toggles completed/all and filters actual rows, preserving search', () => {
  const h=harness(), tasks=[{id:'one',subject:'first',status:'pending'},{id:'two',subject:'second',status:'completed'}];
  const props={floor:{tasks,seats:[]}};
  let tree=h.render(h.api.TaskBoard,props);
  byClass(tree,'cid-task-progress').props.onClick();
  tree=h.render(h.api.TaskBoard,props);
  assert.equal(byClass(tree,'cid-task-progress').props['aria-pressed'],true);
  assert.deepEqual(nodes(tree,n=>n.props?.['data-task-id']).map(n=>n.props['data-task-id']),['two']);
  nodes(tree,n=>n.type==='input')[0].props.onChange({target:{value:'second'}});
  tree=h.render(h.api.TaskBoard,props);
  byClass(tree,'cid-task-progress').props.onClick();
  tree=h.render(h.api.TaskBoard,props);
  assert.equal(byClass(tree,'cid-task-progress').props['aria-pressed'],false);
  assert.equal(nodes(tree,n=>n.type==='input')[0].props.value,'second');
});

test('hover cards work for a canvas actor and keyboard focus, and Escape dismisses them', () => {
  const h=harness(), selected=[];
  const props={floor:{seats:[{id:'a',name:'Worker',state:'tool-running',task:{subject:'Build UI'},tool:{name:'bash',summary:'npm test'}}]},onSelectSeat:id=>selected.push(id)};
  let tree=h.render(h.api.OfficeScene,props);
  byClass(tree,'cid-desk-label').props.onFocus();
  tree=h.render(h.api.OfficeScene,props);
  assert.ok(JSON.stringify(byClass(tree,'cid-office-tooltip')).includes('npm test'));
  byClass(tree,'cid-office-world').props.onKeyDown({key:'Escape'});
  tree=h.render(h.api.OfficeScene,props);
  assert.equal(byClass(tree,'cid-office-tooltip'),undefined);
  const layout=h.api.createOfficeLayout(props.floor.seats), seat=layout.seats[0];
  const event={clientX:seat.x,clientY:seat.y-20,pointerType:'mouse',currentTarget:{getBoundingClientRect:()=>({left:0,top:0,width:layout.width,height:layout.height})}};
  nodes(tree,n=>n.type==='canvas')[0].props.onPointerMove(event);
  tree=h.render(h.api.OfficeScene,props);
  assert.ok(JSON.stringify(byClass(tree,'cid-office-tooltip')).includes('Build UI'));
  nodes(tree,n=>n.type==='canvas')[0].props.onClick(event);
  assert.deepEqual(selected,['a']);
});

test('status hints only report real transitions, not initial data, repeat polls, deletion or other sessions', () => {
  const {api}=harness();
  const old={id:'a',tasks:[{id:'one',subject:'Build',status:'in_progress',ready:true}],seats:[{id:'worker',name:'Worker',state:'thinking'}]};
  const next={id:'a',tasks:[{id:'one',subject:'Build',status:'completed',ready:true}],seats:[{id:'worker',name:'Worker',state:'waiting-approval'}]};
  assert.equal(api.officeChanges(null,next).length,0);
  assert.equal(api.officeChanges({...old,id:'b'},next).length,0);
  assert.equal(api.officeChanges(old,next).length,2);
  assert.equal(api.officeChanges(next,next).length,0);
  assert.equal(api.officeChanges(old,{...next,tasks:[{...next.tasks[0],status:'deleted'}],seats:old.seats}).length,0);
  assert.match(api.officeChanges(old,{...old,tasks:[{...old.tasks[0],status:'pending',ready:false}]})[0].text,/受阻/);
});

test('view cache stays bounded and fresh defaults never share mutable fold state', () => {
  const cache=harness().api.createOfficeUiCache(2);
  const a=cache.get('a'),b=cache.get('b'); a.folds.office=false;
  assert.equal(b.folds.office,true);
  cache.set('a',a);cache.set('b',b);cache.get('a');cache.set('c',cache.get('c'));
  assert.equal(cache.get('a').folds.office,false);
  assert.notEqual(cache.get('b'),b);
});

test('background notices expire once and re-entering a hidden session establishes a quiet baseline', () => {
  const h=harness();
  function Notices(props) { return h.api.useOfficeNotices(props.floor,props.enabled); }
  const old={id:'a',tasks:[{id:'one',subject:'Build',status:'pending'}],seats:[]};
  const next={...old,tasks:[{...old.tasks[0],status:'completed'}]};
  h.render(Notices,{floor:old,enabled:true});h.effects();
  assert.equal(h.timerCount(),0);
  h.render(Notices,{floor:next,enabled:true});h.effects();
  assert.equal(h.render(Notices,{floor:next,enabled:true}).length,1);
  assert.equal(h.timerCount(),1);
  h.render(Notices,{floor:{...next},enabled:true});h.effects();
  assert.equal(h.timerCount(),1);
  h.expire();
  assert.equal(h.render(Notices,{floor:next,enabled:true}).length,0);
  h.render(Notices,{floor:old,enabled:false});h.effects();
  h.render(Notices,{floor:next,enabled:true});h.effects();
  assert.equal(h.render(Notices,{floor:next,enabled:true}).length,0);
  assert.equal(h.timerCount(),0);
});

test('attention task reveal expands the board and exact row, clears hidden filters, scrolls and focuses on repeated clicks',()=>{
 const h=harness();let tree=h.render(h.api.Page,pageProps('attention-reveal'));
 const props=floor(tree).props,target=props.floor.tasks[0],calls=[];
 props.view.fold('tasks',false);props.view.change({filter:'completed',search:'unrelated',expandedTaskId:null});
 // Host ids may contain selector syntax; matching attributes avoids interpolating them.
 const row={getAttribute:()=>target.id,scrollIntoView:options=>calls.push(['scroll',options]),querySelector:()=>({focus:options=>calls.push(['focus',options])})};
 byClass(tree,'cid-body').props.ref.current={querySelectorAll:()=>[row],scrollTop:0};
 for(let i=0;i<2;i++){
  floor(tree).props.onSelectTask(target,{reveal:true});tree=h.render(h.api.Page,pageProps('attention-reveal'));h.layout();
  const state=floor(tree).props.view.value;
  assert.equal(state.folds.tasks,true);assert.equal(state.filter,'all');assert.equal(state.search,'');assert.equal(state.expandedTaskId,target.id);
  assert.equal(floor(tree).props.selectedTaskId,target.id);
 }
 assert.equal(calls.filter(c=>c[0]==='scroll').length,2);assert.equal(calls.filter(c=>c[0]==='focus').length,2);
});

test('attention reveal includes tasks past page 50 and does not change ordinary task-row toggle behavior',()=>{
 const h=harness(),tasks=Array.from({length:75},(_,i)=>({id:'task-'+i,subject:'Task '+i,status:'pending'})),target=tasks[74];
 const patch=h.api.taskRevealPatch({tasks},target);assert.equal(patch.taskPage.count,75);
 const props={floor:{tasks,seats:[]},view:{value:patch,change:value=>Object.assign(patch,value)}};
 let tree=h.render(h.api.TaskBoard,props);
 assert.equal(nodes(tree,n=>n.props?.['data-task-id']).length,75);
 const selected=nodes(tree,n=>n.props?.['data-task-id']==='task-74')[0];assert.ok(byClass(selected,'cid-task-expanded'));
 byClass(selected,'cid-task-row').props.onClick();tree=h.render(h.api.TaskBoard,props);
 assert.equal(nodes(tree,n=>n.props?.className==='cid-task-expanded').length,0);
});
