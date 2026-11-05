/** Evidence-only binding of one persisted dispatch receipt to a durable turn.
 * This proves where an instruction entered the model history, not ownership of
 * all future turns or descendants. A bound dispatch is not a complete task bill.
 */
export function bindTaskRunTurn(run, history) {
  const fail = reason => ({status:'unavailable',reason});
  if (!run || run.receiptState !== 'accepted' || typeof run.messageId !== 'string' || !run.messageId || typeof run.targetSessionId !== 'string' || !run.targetSessionId) return fail('no-accepted-receipt');
  if (!history || history.sessionId !== run.targetSessionId || !Array.isArray(history.events) || !Number.isSafeInteger(history.inheritedEventCount) || history.inheritedEventCount < 0) return fail('unknown-history-owner');
  const events=history.events;
  if (!events.length || events.some((event,index)=>!event || !Number.isSafeInteger(event.seq) || event.seq<0 || (index>0 && event.seq!==events[index-1].seq+1))) return fail('history-gap');
  const matches=events.map((event,index)=>event.type==='user/message'&&event.data?.id===run.messageId?index:-1).filter(index=>index>=0);
  if(matches.length!==1)return fail(matches.length?'duplicate-message':'message-not-entered');
  const position=matches[0];
  if(events[position].seq<history.inheritedEventCount)return fail('inherited-dispatch');
  if(events[position].surfaceOp!=='append')return fail('rewritten-dispatch');
  let begin=position;
  while(begin>=0 && events[begin].type!=='turn/start')begin--;
  if(begin<0 || events[begin].seq<history.inheritedEventCount)return fail('missing-turn-start');
  const turn=events[begin].data?.turn;
  if(!Number.isSafeInteger(turn)||turn<0)return fail('invalid-turn');
  let end=position;
  while(end<events.length && events[end].type!=='turn/end')end++;
  if(end===events.length)return fail('turn-not-ended');
  const slice=events.slice(begin,end+1);
  if(events[end].data?.turn!==turn || slice.slice(1).some(event=>event.type==='turn/start') || slice.slice(0,-1).some(event=>event.type==='turn/end'))return fail('invalid-turn-boundaries');
  if(slice.filter(event=>event.type==='user/message').length!==1)return fail('mixed-input-turn');
  if(slice.some(event=>event.data && Object.hasOwn(event.data,'turn') && event.data.turn!==turn))return fail('cross-turn-evidence');
  return {status:'bound',scope:'dispatch-turn-only',sessionId:history.sessionId,turn,startSeq:events[begin].seq,endSeq:events[end].seq,taskTotalComplete:false,events:slice};
}
