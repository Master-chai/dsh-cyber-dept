import {labelOf} from '../common.js';

export function ownerOf(task,floor) {
  return (floor.seats||[]).find(seat=>task.ownerId?seat.id===task.ownerId:task.ownerName&&seat.name===task.ownerName)||null;
}
/** Evidence only: board assignment and member activity do not prove task execution. */
export function taskEvidence(task,floor) {
  const owner=ownerOf(task,floor),tasks=floor.tasks||[];
  const dependencies=(task.blockedBy||[]).filter(id=>tasks.find(item=>item.id===id)?.status!=='completed');
  const terminal=task.status==='completed'||task.status==='deleted';
  const issues=[];
  if(!terminal){
    if(dependencies.length)issues.push({kind:'dependency',reason:'前置任务未完成或明细不可用：'+dependencies.map(id=>tasks.find(item=>item.id===id)?.subject||id).join('、'),next:'先查看并处理前置任务，再安排当前任务。'});
    else if(task.ready===false)issues.push({kind:'dependency',reason:'宿主报告任务尚未就绪。',next:'在原生任务详情检查依赖与限制，再刷新。'});
    if(!task.ownerId&&!task.ownerName)issues.push({kind:'unassigned',reason:'任务尚未指派负责人。',next:'选择成员，在“派活”中选择这项已有任务，避免重复创建。'});
    else if(!owner)issues.push({kind:'owner-missing',reason:'当前快照找不到任务负责人。',next:'刷新成员表并在原生会话核对归属。'});
    else if(owner.phase==='failed'||owner.state==='error')issues.push({kind:'error',reason:owner.error||'负责人报告错误，但未提供具体原因。',next:'查看负责人原生会话的错误信息，再决定恢复方式。'});
    else if(owner.approval||owner.state==='waiting-approval')issues.push({kind:'approval',reason:'负责人正在等待审批；不能据此确定在处理本任务。',next:'打开负责人原生会话，核对并处理审批。'});
    else if(owner.state==='offline')issues.push({kind:'offline',reason:'负责人在当前快照中离线。',next:'打开负责人会话核对状态；离线不代表任务失败。'});
    else if(owner.phase==='provisioning')issues.push({kind:'provisioning',reason:'负责人仍在初始化。',next:'等待成员就绪并刷新；不要重复派活。'});
  }
  return {issues,owner,activity:owner?labelOf(owner.state):'无可用负责人',execution:terminal?'看板标记'+(task.status==='completed'?'完成':'删除')+'；不代表成员已停止。':'尚无本任务开始执行的独立回执。成员活动不等于本任务进度。'};
}
export function attentionItems(floor,receipts=[]) {
  const items=[];
  for(const seat of floor.seats||[]){
    if(seat.approval||seat.state==='waiting-approval')items.push({id:'approval:'+seat.id,seatId:seat.id,title:seat.name+' · 等待审批',reason:seat.approval?.reason||'宿主报告待审批。',next:'在原生会话核对审批内容后处理。'});
    else if(seat.state==='error'||seat.phase==='failed')items.push({id:'error:'+seat.id,seatId:seat.id,title:seat.name+' · 成员错误',reason:seat.error||'宿主未提供具体原因。',next:'打开原生会话查看错误，不自动重试。'});
  }
  for(const task of floor.tasks||[]){
    const evidence=taskEvidence(task,floor);
    // Member-level approvals/errors are already shown once above.
    const issues=evidence.issues.filter(issue=>!['approval','error'].includes(issue.kind));
    if(issues.length)items.push({id:'task:'+task.id,taskId:task.id,title:task.subject,reason:issues.map(issue=>issue.reason).join(' '),next:issues.map(issue=>issue.next).join(' ')});
  }
  for(const receipt of receipts){
    if(!['error','unowned','assigned'].includes(receipt.phase))continue;
    items.push({id:receipt.id,taskId:receipt.taskId,title:receipt.unknown?'操作结果待核对':'操作需要处理',reason:receipt.summary,next:receipt.hint||'查看成员会话及任务归属后再决定下一步；不要重复创建任务。',receipt:true});
  }
  return items;
}
export function receiptLabel(receipt) {
  if(receipt.phase==='running')return '请求处理中（不代表成员执行中）';
  if(receipt.unknown)return '结果未知 · 请先核对';
  if(receipt.phase==='unowned')return '任务已保留 · 指派未确认';
  if(receipt.phase==='assigned')return '已指派 · 执行指令未确认';
  if(receipt.phase==='error')return '请求失败';
  if(receipt.kind==='message'||receipt.kind==='start'||(receipt.kind==='assign'&&receipt.executeNow))return '宿主已接收 · 未确认已读或开始执行';
  return '宿主已确认操作';
}
