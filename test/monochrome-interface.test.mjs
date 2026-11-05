import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {officeSceneColor} from '../src/client/office-theme.js';
import {officeActorPose} from '../src/client/scene/drawing.js';
import {createOfficeLayout,createOfficeActor} from '../src/client/scene/model.js';
const source = file => readFileSync(new URL('../src/client/'+file,import.meta.url),'utf8');
test('theme adapter reads host tokens without shadowing them or creating cycles',()=>{
 const css=source('office-theme.css')+source('office-scene.css')+source('styles/base.css');
 assert.doesNotMatch(css,/--dsw-alias-[\w-]+\s*:/);
 assert.match(css,/--cid-surface-page:\s*var\(--dsw-alias-bg-base,/);
 assert.match(css,/\.cid-office-world canvas\s*\{\s*filter:\s*grayscale\(1\)/);
 assert.match(css,/--cid-fallback-text-primary: #eeeeee/);
});
test('every known room color including unmapped plants becomes neutral in both themes',()=>{
 const colors=source('scene/drawing.js').match(/#[0-9a-f]{6}/g);
 for(const scheme of ['light','dark'])for(const color of colors)assert.match(officeSceneColor(color,scheme),/^#([0-9a-f]{2})\1\1$/);
 assert.equal(officeSceneColor('transparent','light'),'transparent');
});
test('stationary worker faces north toward screen; walking retains direction and standing pose',()=>{
 const member={id:'a',state:'streaming',live:true};const layout=createOfficeLayout([member]);const actor=createOfficeActor(member,layout.seats[0]);
 assert.deepEqual(officeActorPose(actor),{direction:1,seated:true});
 for(const direction of [0,1,2,3])assert.deepEqual(officeActorPose({...actor,path:[{x:1,y:2}],direction}),{direction,seated:false});
 assert.deepEqual(officeActorPose({...actor,x:88,y:200,direction:0}),{direction:0,seated:false});
 assert.match(source('scene/drawing.js'),/drawQuietOfficePerson[\s\S]*if\(pose.seated\)drawQuietOfficeChair/);
});
test('existing animation policy remains lively with the same frame cadence and reduced motion support',()=>{
 assert.match(source('office-scene.js'),/var mode='lively'/);
 assert.match(source('scene/engine.js'),/1000 \/ 30/);
 assert.match(source('office-scene.js'),/prefers-reduced-motion: reduce/);
});
test('portraits are local and use stable member identity; primary task is real seat data',()=>{
 assert.match(source('assets.js'),/\.\/assets\/employee-portraits.webp/);
 assert.match(source('components/primitives.js'),/officeHash\(props.id \|\| props.name/);
 assert.match(source('components/employee-card.js'),/seat.task \? seat.task.subject : "暂无关联任务"/);
 assert.match(source('components/employee-card.js'),/key:"member-id"/);
});
