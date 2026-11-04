/** Browser-lifetime receipts only, not durable delivery or execution tracking. */
export function createReceiptStore({capacity=64}={}) {
  let receipts=[],version=0;
  const listeners=new Set();
  return {
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    getSnapshot(){return version;},
    list(floorId){return receipts.filter(item=>item.floorId===floorId);},
    record(id,intent,outcome=null){
      const receipt={id,floorId:intent.floorId,kind:intent.kind,executeNow:intent.executeNow===true,target:intent.seatName||'',
        taskId:outcome?.task?.id||intent.taskId||'',subject:outcome?.task?.subject||intent.taskSubject||intent.subject||'',
        phase:outcome?.phase||'running',at:Date.now(),
        messageId:outcome?.value?.messageId||'',commandId:outcome?.value?.commandId||outcome?.error?.commandId||'',
        summary:outcome?.doneMessage||outcome?.error?.title||'',hint:outcome?.error?.hint||'',
        unknown:outcome?.error?.deliveryUnknown===true};
      receipts=receipts.filter(item=>item.id!==id).concat(receipt);
      // Never silently drop unresolved requests; completed history is bounded.
      const settled=receipts.filter(item=>item.phase!=='running');
      const remove=new Set(settled.slice(0,Math.max(0,settled.length-capacity)).map(item=>item.id));
      receipts=receipts.filter(item=>!remove.has(item.id));
      version++;for(const listener of listeners)listener();
    },
  };
}
export const officeReceipts=createReceiptStore();
