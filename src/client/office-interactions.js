import React from 'react';
import {isTaskBlocked,labelOf} from './common.js';
// Small session-scoped view cache. Never store transcripts or trigger host work.
export function createOfficeUiCache(capacity) {
  var entries = new Map();
  return {
    get: function(id) {
      var value = entries.get(id);
      if (value) { entries.delete(id); entries.set(id, value); }
      return value || { folds: { office: true, detail: true, tasks: true, members: true }, seatId: null, taskId: null, filter: 'all', search: '', expandedTaskId: null, scrollTop: 0 };
    },
    set: function(id, value) {
      if (!id) return;
      entries.delete(id); entries.set(id, value);
      while (entries.size > capacity) entries.delete(entries.keys().next().value);
    }
  };
}
var officeUiCache = createOfficeUiCache(40);
export function useOfficeView(sessionId, active, hasFloor) {
  var state = React.useState(function(){ return officeUiCache.get(sessionId); });
  var current = React.useRef(state[0]), body = React.useRef(null);
  function change(patch) {
    current.current = Object.assign({}, current.current, patch);
    officeUiCache.set(sessionId, current.current);
    state[1](current.current);
  }
  function fold(key, expanded) {
    var folds = Object.assign({}, current.current.folds); folds[key] = expanded;
    change({ folds: folds });
  }
  React.useLayoutEffect(function(){
    if (active && hasFloor && body.current) body.current.scrollTop = current.current.scrollTop;
  }, [active, hasFloor]);
  function scroll(event) {
    if (!active || !hasFloor || event.target !== event.currentTarget) return;
    current.current = Object.assign({}, current.current, { scrollTop: event.currentTarget.scrollTop });
    officeUiCache.set(sessionId, current.current);
  }
  return { value: state[0], change: change, fold: fold, body: body, scroll: scroll };
}
export function officeChanges(previous, next) {
  if (!previous || !next || previous.id !== next.id) return [];
  var events = [], tasks = new Map((previous.tasks || []).map(function(t){return [t.id,t];}));
  (next.tasks || []).forEach(function(task){
    var old = tasks.get(task.id); if (!old || task.status === 'deleted') return;
    if (task.status === 'completed' && old.status !== 'completed') events.push({ key: 'task:' + task.id, text: task.subject + ' · 已完成' });
    else if (isTaskBlocked(task) && !isTaskBlocked(old)) events.push({ key: 'task:' + task.id, text: task.subject + ' · 受阻' });
  });
  var seats = new Map((previous.seats || []).map(function(s){return [s.id,s];}));
  (next.seats || []).forEach(function(seat){
    var old = seats.get(seat.id);
    if (old && old.state !== seat.state && (seat.state === 'waiting-approval' || seat.state === 'blocked')) events.push({ key: 'seat:' + seat.id, text: seat.name + ' · ' + labelOf(seat.state) });
  });
  return events;
}
export function useOfficeNotices(floor, enabled) {
  var previous = React.useRef(null), timer = React.useRef(null), state = React.useState([]);
  React.useEffect(function(){
    if (!enabled) { previous.current = null; clearTimeout(timer.current); state[1]([]); return; }
    var changes = officeChanges(previous.current, floor); previous.current = floor;
    if (!changes.length) return;
    clearTimeout(timer.current); state[1](changes);
    timer.current = setTimeout(function(){state[1]([]);}, 5000);
  }, [floor, enabled]);
  React.useEffect(function(){return function(){clearTimeout(timer.current);};}, []);
  return state[0];
}
export function officeHoverSummary(member) {
  return {
    name: member.name,
    state: labelOf(member.state),
    task: member.task && member.task.subject || '暂无当前任务',
    tool: member.state === 'tool-running' && member.tool ? member.tool.name + (member.tool.summary ? ' · ' + member.tool.summary : '') : ''
  };
}
