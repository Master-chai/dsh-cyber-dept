import React from 'react';
import {commandScope,officeCommandController} from './controller.js';
import {validateWrite} from './protocol.js';

/** Board controls and confirmation share these checks; the host remains authoritative. */
export function taskActionProblem(floor,task,gate,kind) {
  if (!gate?.enabled) return gate?.reason || '当前为只读模式。';
  if (!task || task.status === 'deleted') return '任务已删除或不可用，请刷新。';
  if (!task.id || !Number.isSafeInteger(task.revision) || task.revision < 1) return '任务版本不可用，请刷新。';
  if (kind === 'delete') {
    const dependent = floor?.tasks?.find(item => item.status !== 'deleted' && item.id !== task.id && item.blockedBy?.includes(task.id));
    return dependent ? '任务“' + dependent.subject + '”仍依赖此任务，请先处理依赖。' : '';
  }
  if (kind !== 'start') return '不支持的任务操作。';
  const owner = floor?.seats?.find(seat => task.ownerId ? seat.id === task.ownerId : seat.name === task.ownerName);
  if (task.status !== 'in_progress' || !owner) return '请先将未完成的任务指派给成员。';
  if (owner.role === 'lead' || owner.id === floor.id || owner.id === floor.leadId) return '负责人请在原生会话中安排执行。';
  if (owner.phase === 'failed' || owner.phase === 'provisioning') return '成员尚未就绪。';
  if (task.blockedBy?.some(id => floor.tasks.find(item => item.id === id)?.status !== 'completed')) return '前置任务尚未完成。';
  return '';
}

/** Mounted above the lazy board: folding does not interrupt a task command. */
export function useTaskCommands(props) {
  const controller = props.commandController || officeCommandController;
  const [write,setWrite] = React.useState(null), [last,setLast] = React.useState(null);
  const current = React.useRef({props,write,mounted:true}), handled = React.useRef(null);
  current.current.props=props; current.current.write=write;
  const floorId=props.floor?.id||'', visible=write?.floorId===floorId?write:null;
  const scope=visible?commandScope(floorId,'@task-board',visible.taskId):'';
  React.useEffect(()=>{current.current.mounted=true;return()=>{current.current.mounted=false;};},[]);
  React.useEffect(()=>{setWrite(null);setLast(null);},[floorId]);
  function accept(record) {
    const latest=current.current;
    if (!record || !latest.mounted || latest.props.floor?.id!==record.intent.floorId || latest.write?.taskId!==record.intent.taskId) return;
    setWrite(record.view);
    if(record.settledAt!==null && handled.current!==record){
      handled.current=record;
      setLast({tone:record.view.phase==='done'?'ok':'error',text:record.view.doneMessage||record.view.error?.title||'操作失败'});
      if(record.view.phase==='done' && record.intent.kind==='delete')latest.props.onDeleted?.(record.intent.taskId);
      if(record.view.refreshNeeded)latest.props.onRefresh?.();
    }
  }
  React.useEffect(()=>{
    if(!scope)return undefined;
    const unsubscribe=controller.subscribe(scope,accept);accept(controller.get(scope));return unsubscribe;
  },[scope,controller]);
  function close(){
    if(current.current.write?.phase==='running')return;
    setWrite(null);if(scope)controller.dismiss(scope);
  }
  React.useEffect(()=>{
    if(!visible || visible.phase==='running' || typeof document==='undefined')return undefined;
    const escape=event=>{if(event.key==='Escape')close();};
    document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);
  },[scope,visible?.phase]);
  function open(kind,task){
    if(current.current.props.floor?.id!==floorId || current.current.write?.phase==='running')return;
    const latest=current.current.props, fresh=latest.floor?.tasks?.find(item=>item.id===task.id);
    const problem=taskActionProblem(latest.floor,fresh,latest.writeGate,kind);
    if(problem){setLast({tone:'error',text:problem});return;}
    const key=commandScope(floorId,'@task-board',task.id),record=controller.get(key);
    if(record?.settledAt!==null)controller.dismiss(key);
    handled.current=null;
    setWrite(record?.settledAt===null?record.view:{kind,phase:'compose',floorId,taskId:fresh.id,taskRevision:fresh.revision,taskSubject:fresh.subject,seatName:fresh.ownerName||'',fieldError:''});
    setLast(null);
  }
  async function confirm(){
    const latest=current.current,draft=latest.write;
    if(!latest.mounted || !visible || draft!==visible || draft.phase!=='compose' || latest.props.floor?.id!==floorId)return;
    const task=latest.props.floor.tasks.find(item=>item.id===draft.taskId);
    const problem=taskActionProblem(latest.props.floor,task,latest.props.writeGate,draft.kind)||validateWrite(draft)||
      (task.revision!==draft.taskRevision?'任务已变化，请关闭后重新确认。':'');
    if(problem){setWrite({...draft,fieldError:problem});return;}
    const pending=controller.run(scope,draft);accept(controller.get(scope));await pending;accept(controller.get(scope));
  }
  return {write:visible,last,open,confirm,close,onBackdrop:event=>{if(event.target===event.currentTarget)close();},refreshAndClose:()=>{props.onRefresh?.();close();}};
}
