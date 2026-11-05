import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
let plugin;
const react={createElement:(type,props,...children)=>({type,props:props||{},children}),memo:fn=>fn};
vm.runInNewContext(readFileSync(new URL('../.verify/client-test.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:({factory})=>{plugin=factory(()=>react);}}}});
const api=plugin.__internals;
function pane(folds={office:true,tasks:true}){
 return api.FloorPane({floor:{id:'demo',seats:[{id:'a'}],tasks:[]},view:{value:{folds},fold(){}},active:true,visible:true,detail:{marker:'employee'},trailing:{marker:'members'}});
}
test('task board leads; employee and members precede the office at the bottom',()=>{
 const tree=pane();assert.equal(tree.children[0].props.sectionKey,'tasks');
 assert.equal(tree.children[1].marker,'employee');assert.equal(tree.children[2].marker,'members');
 assert.equal(tree.children.at(-1).props.sectionKey,'office');assert.equal(tree.children.length,4);
});
test('moving the office keeps fold visibility and animation activity gating',()=>{
 const expanded=pane().children.at(-1);assert.equal(expanded.props.key,'scene-demo');assert.equal(expanded.children[0].props.active,true);
 const collapsed=pane({office:false,tasks:true}).children.at(-1);assert.equal(collapsed.children[0].props.visible,false);assert.equal(collapsed.children[0].props.active,false);
 assert.equal(collapsed.props.expanded,false);
});
test('removed attention region preserves the command safety mechanisms',()=>{
 const production=readFileSync(new URL('../client.js',import.meta.url),'utf8');
 assert.doesNotMatch(production,/需要你处理/);
 assert.doesNotMatch(readFileSync(new URL('../src/client/components/sections.js',import.meta.url),'utf8'),/AttentionPanel|cid-attention/);
 assert.match(production,/送达结果未知|送达情况未知|送达未知/);
 assert.match(production,/确认立即执行/);
 const source=readFileSync(new URL('../src/client/commands/controller.js',import.meta.url),'utf8');assert.match(source,/officeReceipts/);
});
test('compact task controls preserve normal text, focus styles, and coarse pointer hit targets',()=>{
 const css=api.officeCss;assert.match(css,/min-height:22px;height:auto;line-height:16px/);
 assert.match(css,/@media\(any-pointer:coarse\)/);assert.match(css,/min-height:44px;padding:6px 8px/);
 assert.doesNotMatch(css,/transform:scale\(\.5\)/);
 assert.match(css,/:focus-visible/);
});

test('task ID shares the title line while status remains a separate grid cell',()=>{
 const source=readFileSync(new URL('../src/client/task-board.js',import.meta.url),'utf8');
 assert.match(source,/className:'cid-task-heading'.*task.subject.*className:'cid-task-id'.*task.id/);
 assert.match(api.officeCss,/cid-task-heading \.cid-task-id\{flex:0 0 auto;min-width:0;max-width:35%/);
 assert.match(api.officeCss,/grid-template-columns:24px minmax\(0,1fr\) 90px 52px 12px/);
});

test('removed planning panels and destructive controls are absent from shipped client',()=>{
 const production=readFileSync(new URL('../client.js',import.meta.url),'utf8');
 assert.doesNotMatch(production,/消耗与预算|可复用员工档案|清空本部门|确认清空|dsh-cyber-dept:planning/);
 const page=readFileSync(new URL('../src/client/components/page.js',import.meta.url),'utf8');
 assert.doesNotMatch(page,/PlanningPane|planning/);
});
test('removal adds no storage cleanup or migration code',()=>{
 const page=readFileSync(new URL('../src/client/components/page.js',import.meta.url),'utf8');
 assert.doesNotMatch(page,/localStorage|removeItem|clear\(|migration|migrate/);
});

test('task rows fit text with centered content, wrapping titles and retained touch targets',()=>{
 const css=api.officeCss;
 assert.match(css,/\.cid-current \.cid-task-row\{min-height:32px;padding:5px 7px;align-items:center\}/);
 assert.match(css,/\.cid-current \.cid-task-heading\{align-items:center\}/);
 assert.match(css,/line-height:18px;white-space:normal;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2/);
 assert.match(css,/@media\(any-pointer:coarse\)\{\.cid-current \.cid-task-row\{min-height:44px;padding:7px\}\}/);
});

test('module titles have no shaded bar or outline without changing layout or focus affordances',()=>{
 const css=api.officeCss;
 assert.match(css,/\.cid-current \.cid-fold\{border-color:transparent\}/);
 assert.match(css,/\.cid-current \.cid-fold-content\{border-top-color:transparent\}/);
 assert.match(css,/\.cid-current \.cid-fold-toggle,\.cid-current \.cid-fold-toggle:hover\{background:transparent\}/);
 assert.match(css,/\.cid-fold-toggle\{[^}]*min-height:44px;padding:10px 12px/);
 assert.match(css,/\.cid-fold-toggle:focus-visible\{outline-offset:-3px\}/);
});
