import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../src/client/office-scene.css',import.meta.url),'utf8');
const selector='\\.cid-employee-identity \\.cid-avatar\\[data-large=true\\]';

test('employee portrait dimensions are halved at every existing breakpoint',()=>{
  assert.match(css,new RegExp(selector+'\\{width:48px;height:48px;border-radius:7px;flex:none\\}'));
  assert.match(css,new RegExp('@container \\(max-width:340px\\)\\{[^\\n]*'+selector+'\\{width:40px;height:40px\\}'));
  assert.match(css,new RegExp('@container \\(min-width:560px\\)\\{'+selector+'\\{width:56px;height:56px\\}'));
  assert.doesNotMatch(css,new RegExp(selector+'\\{width:(?:80|96|112)px'));
});

test('portrait-only resize preserves pixel rendering, name typography and member thumbnails',()=>{
  assert.match(css,/\.cid-avatar-portrait\{image-rendering:pixelated;/);
  assert.match(css,/\.cid-employee-identity \.cid-detail-title\{font-size:20px;line-height:1\.3/);
  assert.match(css,/\.cid-seats-band \.cid-avatar\{width:30px;height:30px\}/);
  assert.doesNotMatch(css,/transform:scale\(\.5\)/);
});
