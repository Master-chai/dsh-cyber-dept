import test from 'node:test';
import assert from 'node:assert/strict';
import {bindTaskRunTurn} from '../src/shared/task-run-binding.js';
const run={receiptState:'accepted',messageId:'m1',targetSessionId:'employee-a'};
function history(){return {sessionId:'employee-a',inheritedEventCount:0,events:[{seq:0,type:'turn/start',data:{turn:1}},{seq:1,type:'step/start',data:{turn:1,step:1}},{seq:2,type:'user/message',surfaceOp:'append',data:{id:'m1'}},{seq:3,type:'step/end',data:{turn:1,step:1}},{seq:4,type:'turn/end',data:{turn:1}}]};}
test('receipt binds one exact durable message and never asserts whole-task completeness',()=>{
 const h=history();assert.equal(bindTaskRunTurn(run,h).status,'bound');assert.equal(bindTaskRunTurn(run,h).taskTotalComplete,false);
 assert.deepEqual(bindTaskRunTurn(run,structuredClone(h)),bindTaskRunTurn(run,h));
});
test('missing receipts, mismatched sessions, inherited messages and incomplete turns fail closed',()=>{
 assert.equal(bindTaskRunTurn({...run,receiptState:'unknown'},history()).reason,'no-accepted-receipt');
 assert.equal(bindTaskRunTurn(run,{...history(),sessionId:'employee-b'}).reason,'unknown-history-owner');
 assert.equal(bindTaskRunTurn(run,{...history(),inheritedEventCount:3}).reason,'inherited-dispatch');
 const h=history();h.events.pop();assert.equal(bindTaskRunTurn(run,h).reason,'turn-not-ended');
 const gap=history();gap.events.splice(1,1);assert.equal(bindTaskRunTurn(run,gap).reason,'history-gap');
});
test('mixed, duplicate and rewritten inputs cannot be billed as one exclusive task',()=>{
 for(const id of ['other','m1']){const h=history();h.events[3]={seq:3,type:'user/message',surfaceOp:'append',data:{id}};assert.equal(bindTaskRunTurn(run,h).reason,id==='m1'?'duplicate-message':'mixed-input-turn');}
 const h=history();h.events[2].surfaceOp={op:'replace'};assert.equal(bindTaskRunTurn(run,h).reason,'rewritten-dispatch');
});
