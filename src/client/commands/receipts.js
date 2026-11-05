/** Browser-lifetime receipts only, not durable delivery or execution tracking. */
export function createReceiptStore({capacity=64,unresolvedCapacity=256}={}) {
  let receipts=[],version=0;
  const listeners=new Set();
  const unresolved=item=>item.phase==='running'||(!item.acknowledged&&(item.unknown||['error','unowned','assigned'].includes(item.phase)));
  function publish(){version++;for(const listener of listeners)listener();}
  function prune(){
    const history=receipts.filter(item=>!unresolved(item));
    const remove=new Set(history.slice(0,Math.max(0,history.length-capacity)).map(item=>item.id));
    receipts=receipts.filter(item=>!remove.has(item.id));
  }
  return {
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    getSnapshot(){return version;},
    list(floorId){return receipts.filter(item=>item.floorId===floorId);},
    acknowledge(id,floorId){
      const receipt=receipts.find(item=>item.id===id&&item.floorId===floorId);
      if(!receipt||receipt.phase==='running')return false;
      receipt.acknowledged=true;prune();publish();return true;
    },
    record(id,intent,outcome=null){
      if(!receipts.some(item=>item.id===id)&&receipts.filter(unresolved).length>=unresolvedCapacity)return false;
      const receipt={id,floorId:intent.floorId,kind:intent.kind,executeNow:intent.executeNow===true,target:intent.seatName||'',
        taskId:outcome?.task?.id||intent.taskId||'',subject:outcome?.task?.subject||intent.taskSubject||intent.subject||'',
        phase:outcome?.phase||'running',at:Date.now(),
        messageId:outcome?.value?.messageId||'',commandId:outcome?.value?.commandId||outcome?.error?.commandId||'',
        summary:outcome?.doneMessage||outcome?.error?.title||'',hint:outcome?.error?.hint||'',
        unknown:outcome?.error?.deliveryUnknown===true};
      receipts=receipts.filter(item=>item.id!==id).concat(receipt);
      // Only routine or explicitly acknowledged history may be evicted.
      prune();publish();return true;
    },
  };
}
export const officeReceipts=createReceiptStore();
