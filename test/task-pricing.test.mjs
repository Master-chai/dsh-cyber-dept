import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateAttemptCost,validateRateCard} from '../src/shared/task-pricing.js';
const rate=()=>({id:'v1',provider:'provider',model:'model',sourceUrl:'https://example.com/rates',currency:'CNY',effectiveFrom:100,effectiveTo:200,inputPerMillion:'2',cacheReadPerMillion:'0.2',cacheWritePerMillion:'3',outputPerMillion:'8'});
const attempt=()=>({complete:true,provider:'provider',model:'model',startedAt:110,endedAt:120,usage:{inputTokens:1000000,cacheReadTokens:1000000,cacheWriteTokens:1000000,outputTokens:1000000,reasoningTokens:400000}});
test('pricing uses four non-overlapping buckets without charging reasoning twice',()=>{
 const card=rate(),result=calculateAttemptCost(attempt(),[card]);assert.equal(result.amount,'13.2');assert.equal(result.actualCharge,null);card.inputPerMillion='99';assert.equal(result.rate.inputPerMillion,'2');
});
test('pricing preserves sub-cent decimal precision and rejects missing counters, routes and windows',()=>{
 const a=attempt();a.usage={inputTokens:1,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:0};assert.equal(calculateAttemptCost(a,[rate()]).amount,'0.000002');
 delete a.usage.cacheReadTokens;assert.equal(calculateAttemptCost(a,[rate()]).reason,'incomplete-usage');
 for(const patch of [{complete:false},{provider:''},{startedAt:99},{endedAt:200},{endedAt:NaN}])assert.equal(calculateAttemptCost({...attempt(),...patch},[rate()]).status,'unavailable');
});
test('pricing never chooses among overlapping rates or accepts unsafe rates/counts',()=>{
 assert.equal(calculateAttemptCost(attempt(),[rate(),{...rate(),id:'v2'}]).reason,'ambiguous-rate');
 for(const price of ['-1','1e3','NaN','1.1234567',1])assert.equal(validateRateCard({...rate(),inputPerMillion:price}),false);
 assert.equal(calculateAttemptCost({...attempt(),usage:{...attempt().usage,inputTokens:Number.MAX_SAFE_INTEGER+1}},[rate()]).status,'unavailable');
});
