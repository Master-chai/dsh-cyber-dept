/** React view of the pixel office. Markup and styles preserve the existing UI. */
import * as React from 'react';
import { labelOf } from './common.js';
import { officeHoverSummary } from './office-interactions.js';
import { createOfficeLayout } from './scene/model.js';
import { officeTone } from './scene/drawing.js';
import { loadOfficeImages } from './scene/images.js';
import { createOfficeEngine } from './scene/engine.js';
const h = React.createElement;

export { officeHash, sceneActivity, createOfficeLayout, findOfficePath, stepOfficeActor, createOfficeActor, officeNeedsFrames } from './scene/model.js';
export { drawOfficeRoom } from './scene/drawing.js';
export { createOfficeEngine } from './scene/engine.js';

export function OfficeScene(props) {
  var floor=props.floor,all=floor&&Array.isArray(floor.seats)?floor.seats:[];
  var pageState=React.useState(0),page=Math.min(pageState[0],Math.max(0,Math.ceil(all.length/12)-1));
  var members=all.slice(page*12,page*12+12);
  React.useEffect(function(){var index=all.findIndex(function(member){return member.id===props.selectedSeatId;});if(index>=0)pageState[1](Math.floor(index/12));},[props.selectedSeatId,all.map(function(m){return m.id;}).join('|')]);
  var mode='lively';
  var errorState=React.useState(false);
  var reducedState=React.useState(function(){return typeof window!=='undefined'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;});
  var canvasRef=React.useRef(null),latest=React.useRef(null),engineRef=React.useRef(null);
  var hoverState=React.useState(null),hoverRef=React.useRef(null),tooltipId=React.useId();
  function showHover(anchor){
    if((hoverRef.current&&hoverRef.current.id)===(anchor&&anchor.id))return;
    hoverRef.current=anchor;hoverState[1](anchor);
  }
  function hit(event){
    var box=event.currentTarget.getBoundingClientRect();if(!box.width||!box.height)return null;
    var point={x:(event.clientX-box.left)*layout.width/box.width,y:(event.clientY-box.top)*layout.height/box.height};
    var actors=engineRef.current?engineRef.current.actors:[];
    return actors.find(function(a){return Math.abs(point.x-a.x)<18&&point.y>a.y-42&&point.y<a.y+8;})||layout.seats.find(function(a){return Math.abs(point.x-a.x)<48&&point.y>a.y-88&&point.y<a.y+10;})||null;
  }
  var signature=members.map(function(m){return m.id;}).join('|');
  var sceneSignal=members.map(function(m){return [m.id,m.state,m.live,m.tool&&m.tool.name].join(':');}).join('|');
  var layout=React.useMemo(function(){return createOfficeLayout(members);},[signature]);
  React.useEffect(function(){showHover(null);},[signature,props.visible]);
  latest.current={members:members,selectedId:props.selectedSeatId,mode:mode,reduced:reducedState[0],active:props.active!==false,visible:props.visible!==false,scheme:props.scheme};
  React.useEffect(function(){
    var media=window.matchMedia('(prefers-reduced-motion: reduce)');var change=function(){reducedState[1](media.matches);};
    media.addEventListener('change',change);return function(){media.removeEventListener('change',change);};
  },[]);
  React.useEffect(function(){
    var canvas=canvasRef.current;if(!canvas)return;
    var engine=createOfficeEngine({canvas:canvas,layout:layout,getCurrent:function(){return latest.current;},loadImages:loadOfficeImages,onImageStatus:function(failed){errorState[1](failed);}});
    engineRef.current=engine;
    return function(){engine.dispose();engineRef.current=null;};
  },[layout]);
  React.useEffect(function(){if(engineRef.current)engineRef.current.wake();},[sceneSignal,props.selectedSeatId,props.scheme,mode,reducedState[0]]);
  React.useEffect(function(){if(engineRef.current)engineRef.current.wake(true);},[props.active,props.visible]);
  if(!members.length)return null;
  var hovered=hoverState[0]&&members.find(function(member){return member.id===hoverState[0].id;});
  var summary=hovered?officeHoverSummary(hovered):null;
  return h('section',{className:'cid-office','aria-label':'像素办公室'},
    h('div',{className:'cid-office-scroll'},h('div',{className:'cid-office-world',onPointerLeave:function(){showHover(null);},onKeyDown:function(event){if(event.key==='Escape')showHover(null);},style:{width:'100%',aspectRatio:layout.width+' / '+layout.height}},
      h('canvas',{ref:canvasRef,width:layout.width,height:layout.height,'aria-label':'像素办公室。使用下方工位按钮选择成员。',role:'img',onPointerMove:function(event){if(event.pointerType!=='touch')showHover(hit(event));},onClick:function(event){var target=hit(event);if(target){showHover(null);props.onSelectSeat(target.id);}}}),
      layout.seats.map(function(seat,i){var member=members[i];return h('button',{type:'button',key:member.id,className:'cid-desk-label','aria-pressed':member.id===props.selectedSeatId,'aria-describedby':hovered&&hovered.id===member.id?tooltipId:undefined,'data-state':member.state,'data-recent':props.recent&&props.recent.has('seat:'+member.id)?'1':'0',style:{left:seat.x/layout.width*100+'%',top:(seat.y+13)/layout.height*100+'%','--seat-tone':officeTone(member.state,props.scheme)},onPointerEnter:function(event){if(event.pointerType!=='touch')showHover(seat);},onFocus:function(){showHover(seat);},onBlur:function(){showHover(null);},onClick:function(){showHover(null);props.onSelectSeat(member.id);}},h('span',null,h('i',null),h('b',null,member.name)),h('small',null,member.live===false?'休眠':member.state==='tool-running'&&member.tool?member.tool.name:labelOf(member.state)));}),
      summary?h('div',{id:tooltipId,role:'tooltip',className:'cid-office-tooltip',style:{left:'clamp(8px, '+(hoverState[0].x/layout.width*100)+'%, calc(100% - 228px))',top:'clamp(8px, '+((hoverState[0].y-60)/layout.height*100)+'%, calc(100% - 128px))'}},h('strong',null,summary.name+' · '+summary.state),h('span',null,summary.task),summary.tool?h('small',null,'工具：'+summary.tool):null):null)),
    errorState[0]?h('p',{className:'cid-office-warning',role:'alert'},'人物素材加载失败，仍可通过工位标签和成员列表查看任务。'):null,
    h('div',{className:'cid-office-footer'},h('span',null,reducedState[0]?'已跟随系统减少动态效果':floor.live?'动作随工作状态变化 · 仅空闲成员会短暂休息':'冷会话保留工位，人物与屏幕静止'),h('span',null,'点击工位查看任务'),
      all.length>12?h('div',{className:'cid-scene-pages'},h('button',{type:'button',disabled:page===0,onClick:function(){pageState[1](page-1);}},'上一组'),h('span',null,(page+1)+' / '+Math.ceil(all.length/12)),h('button',{type:'button',disabled:(page+1)*12>=all.length,onClick:function(){pageState[1](page+1);}},'下一组')):null));
}
