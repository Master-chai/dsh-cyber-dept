/** React view of the pixel office. Markup and styles preserve the existing UI. */
import * as React from 'react';
import { labelOf } from './common.js';
import { officeHoverSummary } from './office-interactions.js';
import { createOfficeLayout, officeRestState, officeSceneSignal } from './scene/model.js';
import { officeTone } from './scene/drawing.js';
import { createOfficeEngine } from './scene/engine.js';
import { quietOfficeActorHit } from './scene/quiet-office-people.js';
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
    return actors.find(function(a){return quietOfficeActorHit(a,point);})||layout.seats.find(function(a){return Math.abs(point.x-a.x)<64&&point.y>a.y-110&&point.y<a.y+10;})||null;
  }
  var signature=members.map(function(m){return m.id;}).join('|');
  var sceneSignal=members.map(officeSceneSignal).join('|');
  var layout=React.useMemo(function(){return createOfficeLayout(members);},[signature]);
  React.useEffect(function(){showHover(null);},[signature,props.visible]);
  latest.current={members:members,selectedId:props.selectedSeatId,mode:mode,reduced:reducedState[0],active:props.active!==false,visible:props.visible!==false,scheme:props.scheme};
  React.useEffect(function(){
    var media=window.matchMedia('(prefers-reduced-motion: reduce)');var change=function(){reducedState[1](media.matches);};
    media.addEventListener('change',change);return function(){media.removeEventListener('change',change);};
  },[]);
  React.useEffect(function(){
    var canvas=canvasRef.current;if(!canvas)return;
    var engine=createOfficeEngine({canvas:canvas,layout:layout,getCurrent:function(){return latest.current;}});
    engineRef.current=engine;
    return function(){engine.dispose();engineRef.current=null;};
  },[layout]);
  React.useEffect(function(){if(engineRef.current)engineRef.current.wake();},[sceneSignal,props.selectedSeatId,props.scheme,mode,reducedState[0]]);
  React.useEffect(function(){if(engineRef.current)engineRef.current.wake(true);},[props.active,props.visible]);
  if(!members.length)return null;
  var hovered=hoverState[0]&&members.find(function(member){return member.id===hoverState[0].id;});
  var summary=hovered?officeHoverSummary(hovered):null;
  if(summary&&officeRestState(hovered)==='completed'){
    summary.state='任务完成 · '+(hovered.state==='offline'||hovered.live===false?'离线休息':'休息');
    summary.task=hovered.completedTask?hovered.completedTask.subject+' · 已完成':hovered.officeTaskFacts.completedCount+' 项任务已完成';
  }
  return h('section',{className:'cid-office','aria-label':'像素办公室'},
    h('div',{className:'cid-office-scroll'},h('div',{className:'cid-office-world',onPointerLeave:function(){showHover(null);},onKeyDown:function(event){if(event.key==='Escape')showHover(null);},style:{width:'100%',aspectRatio:layout.width+' / '+layout.height}},
      h('canvas',{ref:canvasRef,width:layout.width,height:layout.height,'aria-label':'像素办公室。点击卡座上的工牌选择成员。',role:'img',onPointerMove:function(event){if(event.pointerType!=='touch')showHover(hit(event));},onClick:function(event){var target=hit(event);if(target){showHover(null);props.onSelectSeat(target.id);}}}),
      layout.seats.map(function(seat,i){var member=members[i],completed=officeRestState(member)==='completed',status=completed?(member.state==='offline'||member.live===false?'任务完成 · 离线休息':'任务完成 · 休息'):(member.live===false?'休眠':labelOf(member.state));return h('button',{type:'button',key:member.id,className:'cid-desk-label','aria-pressed':member.id===props.selectedSeatId,'aria-describedby':hovered&&hovered.id===member.id?tooltipId:undefined,'aria-label':member.name+' · '+status+' · 查看员工介绍','data-state':member.state,'data-recent':props.recent&&props.recent.has('seat:'+member.id)?'1':'0',style:{left:seat.x/layout.width*100+'%',top:(seat.y-105)/layout.height*100+'%',height:18/layout.height*100+'%','--seat-tone':officeTone(completed?'done':member.state,props.scheme)},onPointerEnter:function(event){if(event.pointerType!=='touch')showHover(seat);},onFocus:function(){showHover(seat);},onBlur:function(){showHover(null);},onClick:function(){showHover(null);props.onSelectSeat(member.id);}},h('span',null,h('i',null),h('b',null,member.name)),h('small',null,status));}),
      summary?h('div',{id:tooltipId,role:'tooltip',className:'cid-office-tooltip',style:{left:'clamp(8px, '+(hoverState[0].x/layout.width*100)+'%, calc(100% - 228px))',top:'clamp(8px, '+((hoverState[0].y-60)/layout.height*100)+'%, calc(100% - 128px))'}},h('strong',null,summary.name+' · '+summary.state),h('span',null,summary.task),hoverState[0].phase==='break'?h('small',null,'模拟活动 · '+({bike:'骑行',coffee:'咖啡',walk:'散步',phone:'工位看手机'}[hoverState[0].breakKind]||'休息')):null,summary.tool?h('small',null,'工具：'+summary.tool):null):null)),
    h('div',{className:'cid-office-footer'},h('span',null,reducedState[0]?'已跟随系统减少动态效果':'咖啡 · 骑行 · 散步 · 工位看手机均为模拟活动；离线不代表任务完成'),h('span',null,'点击卡座工牌查看任务'),
      all.length>12?h('div',{className:'cid-scene-pages'},h('button',{type:'button',disabled:page===0,onClick:function(){pageState[1](page-1);}},'上一组'),h('span',null,(page+1)+' / '+Math.ceil(all.length/12)),h('button',{type:'button',disabled:(page+1)*12>=all.length,onClick:function(){pageState[1](page+1);}},'下一组')):null));
}
