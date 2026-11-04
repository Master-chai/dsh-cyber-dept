import React from 'react';
import {attentionItems,receiptLabel} from '../model/attention.js';
import {officeReceipts} from '../commands/receipts.js';
import {openNativeSession} from '../host/navigation.js';
const h=React.createElement;
export function AttentionPanel({floor,onSelectTask,onSelectSeat,controller=officeReceipts,verified=true}) {
  React.useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
  const receipts=controller.list(floor.id),items=attentionItems(floor,receipts);
  const [expanded,setExpanded]=React.useState(false);
  const [limit,setLimit]=React.useState(10);
  React.useEffect(()=>{setExpanded(false);setLimit(10);},[floor.id]);
  return h('section',{className:'cid-attention','aria-label':'需要你处理'},
    h('h3',null,'需要你处理',h('span',{className:'cid-muted'},' · '+items.length)),
    !verified?h('p',{className:'cid-office-warning'},'当前为预览或过期状态，请刷新后核对，以下不代表实时情况。'):null,
    h('p',{className:'cid-muted'},'依据当前快照与本页操作回执，不会按等待时长推断卡死。'),
    items.length?h('ul',{className:'cid-attention-list'},items.slice(0,limit).map((item,index)=>h('li',{key:typeof item.id==='string'?item.id:'receipt-'+index},
      h('strong',null,item.title),h('p',null,item.reason),h('p',{className:'cid-muted'},'下一步：'+item.next),
      item.seatId?h('button',{type:'button',className:'cid-btn',onClick:()=>{onSelectSeat?.(item.seatId);openNativeSession(item.seatId);}},'查看原生会话'):null,
      item.taskId&&floor.tasks.some(task=>task.id===item.taskId&&task.status!=='deleted')?h('button',{type:'button',className:'cid-btn',onClick:()=>onSelectTask?.(floor.tasks.find(task=>task.id===item.taskId))},'查看任务'):null))):h('p',{className:'cid-muted'},floor.tasksAvailable===false?'任务明细尚未同步，无法完整判断待处理事项。':'当前已知信息中没有待处理事项。'),
    items.length>limit?h('button',{type:'button',className:'cid-btn',onClick:()=>setLimit(limit+10)},'显示更多待处理事项'):null,
    h('button',{type:'button',className:'cid-btn','aria-expanded':expanded,onClick:()=>setExpanded(!expanded)},'本页操作回执（'+receipts.length+'）'),
    expanded?h('div',{className:'cid-receipts'},h('p',{className:'cid-muted'},'仅保存当前页面生命周期内最近 64 条已结束操作；刷新页面会清除。宿主接收不等于成员已读、开始或完成。'),
      receipts.length?h('ul',null,receipts.slice().reverse().map((receipt,index)=>h('li',{key:index},h('strong',null,receiptLabel(receipt)),h('p',null,[receipt.target,receipt.subject,receipt.summary].filter(Boolean).join(' · ')),
        receipt.commandId?h('small',null,'操作编号：'+receipt.commandId):null,
        receipt.messageId?h('small',null,' · 消息编号：'+receipt.messageId):null))):h('p',null,'本页尚无操作回执。')):null);
}
