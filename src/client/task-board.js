import React from 'react';
import {isTaskBlocked,taskStatusLabel} from './common.js';
import {taskEvidence} from './model/attention.js';
import {taskActionProblem} from './commands/use-task-commands.js';
const h=React.createElement;
export function taskOwnerSeat(task, seats) {
  if (task.ownerId) return seats.find(function(seat){return seat.id===task.ownerId;}) || null;
  return task.ownerName ? seats.find(function(seat){return seat.name===task.ownerName;}) || null : null;
}
/** Reveal one existing task through the existing board, including filtered/paged rows. */
export function taskRevealPatch(floor,task) {
  const rank={in_progress:0,pending:1,completed:2};
  const ordered=(floor.tasks||[]).filter(item=>item.status!=='deleted').slice().sort((a,b)=>rank[a.status]-rank[b.status]);
  const index=ordered.findIndex(item=>item.id===task.id);
  return {filter:'all',search:'',expandedTaskId:task.id,taskPage:{key:'all\n',count:Math.max(50,index+1)}};
}
export function TaskBoard(props) {
  var filterState=React.useState('all'),searchState=React.useState(''),expandedState=React.useState(null);
  var limitState=React.useState({key:'',count:50});
  var view=props.view?props.view.value:{filter:filterState[0],search:searchState[0],expandedTaskId:expandedState[0]};
  function change(patch){
    if(props.view){props.view.change(patch);return;}
    if(patch.filter!==undefined)filterState[1](patch.filter);
    if(patch.search!==undefined)searchState[1](patch.search);
    if(patch.expandedTaskId!==undefined)expandedState[1](patch.expandedTaskId);
  }
  var floor=props.floor,tasks=(floor.tasks||[]).filter(function(t){return t.status!=='deleted';});
  var filter=view.filter,query=view.search.trim().toLocaleLowerCase();
  var shown=tasks.filter(function(task){
    var matches=filter==='all'||(filter==='blocked'?isTaskBlocked(task):task.status===filter);
    return matches&&(!query||(task.subject+' '+task.ownerName+' '+task.id).toLocaleLowerCase().includes(query));
  });
  var rank={in_progress:0,pending:1,completed:2};shown.sort(function(a,b){return rank[a.status]-rank[b.status];});
  var completed=tasks.filter(function(t){return t.status==='completed';}).length;
  var page=props.view?props.view.value.taskPage||{key:'',count:50}:limitState[0];
  var listKey=filter+'\n'+query,limit=page.key===listKey?page.count:50;
  var tabs=[['all','全部'],['in_progress','进行中'],['pending','待办'],['blocked','受阻'],['completed','已完成']];
  return h('section',{className:'cid-task-board','aria-label':'任务看板'},
    h('p',{className:'cid-muted'},'“进行中”是任务看板状态，指派即可进入；不代表成员已开始执行。'),
    props.taskActionStatus?h('p',{className:'cid-write-status',role:'status','data-tone':props.taskActionStatus.tone},props.taskActionStatus.text):null,
    h('div',{className:'cid-board-controls'},
      h('div',{className:'cid-task-filter-row'},
        h('div',{className:'cid-task-tabs','aria-label':'筛选任务'},tabs.map(function(tab){var count=tasks.filter(function(t){return tab[0]==='all'||(tab[0]==='blocked'?isTaskBlocked(t):t.status===tab[0]);}).length;return h('button',{key:tab[0],type:'button','aria-pressed':filter===tab[0],onClick:function(){change({filter:tab[0]});}},tab[1],h('span',null,count));})),
        h('button',{type:'button',className:'cid-task-progress','aria-pressed':filter==='completed',title:filter==='completed'?'显示全部任务':'只看已完成任务',onClick:function(){change({filter:filter==='completed'?'all':'completed'});}},h('span',null,completed+' / '+tasks.length+' 已完成'),h('progress',{value:completed,max:tasks.length||1,'aria-label':'已完成任务'}))),
      h('input',{type:'search',value:view.search,placeholder:'搜索任务或负责人','aria-label':'搜索任务或负责人',onChange:function(e){change({search:e.target.value});}})),
    shown.length?h('ul',{className:'cid-task-list'},shown.slice(0,limit).map(function(task){
      var evidence=taskEvidence(task,floor);
      var owner=taskOwnerSeat(task,floor.seats||[]),blocked=isTaskBlocked(task),expanded=view.expandedTaskId===task.id;
      return h('li',{key:task.id,'data-task-id':task.id,'data-selected':props.selectedTaskId===task.id?'1':'0','data-recent':props.recent&&props.recent.has('task:'+task.id)?'1':'0'},
        h('button',{type:'button',className:'cid-task-row','aria-expanded':expanded,onClick:function(){change({expandedTaskId:expanded?null:task.id});if(props.onSelectTask)props.onSelectTask(task);}},
          h('span',{className:'cid-task-mark','data-status':task.status,'data-blocked':blocked?'1':'0'},task.status==='completed'?'✓':blocked?'!':task.status==='in_progress'?'›':'·'),
          h('span',{className:'cid-task-copy'},h('span',{className:'cid-task-heading'},h('strong',{title:task.subject},task.subject),h('small',{className:'cid-task-id',title:task.id},task.id)),blocked?h('small',null,'等待依赖完成'):null),
          h('span',{className:'cid-task-owner'},owner?owner.name:task.ownerName||'未指派'),
          h('span',{className:'cid-task-state','data-status':blocked?'blocked':task.status},blocked?'受阻':taskStatusLabel(task.status)),h('span',{className:'cid-task-chevron'},expanded?'−':'+')),
        expanded?h('div',{className:'cid-task-expanded'},h('p',null,task.description||'暂无任务说明。'),
          h('p',{className:'cid-muted'},'成员活动：'+evidence.activity+'。'+evidence.execution),
          evidence.issues.length?h('ul',{className:'cid-task-diagnostics'},evidence.issues.map(function(issue){return h('li',{key:issue.kind},h('strong',null,issue.reason),h('p',null,'下一步：'+issue.next));})):null,
          task.blockedBy&&task.blockedBy.length?h('div',null,h('b',null,'前置任务'),h('ul',null,task.blockedBy.map(function(id){var dependency=tasks.find(function(t){return t.id===id;});return h('li',{key:id},(dependency?dependency.subject:id)+' · '+(dependency?taskStatusLabel(dependency.status):'未找到'));}))):null,
          task.writeScopes&&task.writeScopes.length?h('p',null,'工作范围：'+task.writeScopes.join('、')):null,
          task.writeScopeWarnings&&task.writeScopeWarnings.length?h('p',{className:'cid-office-warning'},task.writeScopeWarnings.join('；')):null,
          h('p',{className:'cid-muted'},owner?'已联动负责人详情，可查看或操作这项任务。':'此任务尚未关联到可用成员。'),
          props.onTaskAction?h('div',{className:'cid-task-actions'},['start','delete'].map(function(kind){
            var problem=taskActionProblem(floor,task,props.writeGate,kind);
            return h('button',{key:kind,type:'button',className:'cid-task-action','data-task-action':kind,'data-tone':kind==='delete'?'danger':'primary',disabled:!!problem,title:problem||undefined,'aria-label':(kind==='delete'?'删除任务：':'立即执行：')+task.subject,onClick:function(){props.onTaskAction(kind,task);}},kind==='delete'?'删除任务':'立即执行');
          })):null):null);
    })):h('div',{className:'cid-board-empty'},floor.tasksAvailable===false?'任务明细尚未同步，请稍后刷新。':tasks.length?'没有符合条件的任务':'该部门尚未创建任务。选择成员后可使用“派活”。'),
    shown.length>limit?h('button',{type:'button',className:'cid-btn',onClick:function(){if(props.view)props.view.change({taskPage:{key:listKey,count:limit+50}});else limitState[1]({key:listKey,count:limit+50});}},'显示更多（剩余 '+(shown.length-limit)+' 项）'):null);
}
