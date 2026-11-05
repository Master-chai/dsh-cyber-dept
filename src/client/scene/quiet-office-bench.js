/** Original grayscale pixel bench. World anchor is the centre of its floor mat.
 * The lifter's feet stay grounded; both hands and the bar share one pose solution.
 * A set includes sitting, lying down, unracking, four controlled reps, reracking,
 * releasing the bar and standing up. This is scenery, never task execution state.
 */
import { QUIET_PERSON_PALETTES } from './quiet-office-people.js';
export const QUIET_BENCH_METRICS=Object.freeze({left:-74,right:71,top:-99,bottom:7,width:145,height:106,approach:48});
export const QUIET_BENCH_TIMING=Object.freeze({setup:3.2,rep:4.4,reps:4,rack:20.8,release:21.6,rise:22.2,duration:24,exitDuration:2.8});
const RACK={x:-26,y:-74},TOP={x:-21,y:-74},BOTTOM={x:-9,y:-47};
const clamp=n=>Math.max(0,Math.min(1,n));
const ease=n=>{const t=clamp(n);return t*t*(3-2*t);};
const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const STAND={hip:{x:48,y:-15},shoulder:{x:48,y:-31},head:{x:48,y:-44},nearKnee:{x:49,y:-8},farKnee:{x:40,y:-11}};
const SIT={hip:{x:12,y:-32},shoulder:{x:12,y:-58},head:{x:12,y:-73},nearKnee:{x:40,y:-23},farKnee:{x:32,y:-28}};
const LIE={hip:{x:12,y:-32},shoulder:{x:-20,y:-39},head:{x:-43,y:-42},nearKnee:{x:38,y:-23},farKnee:{x:30,y:-28}};
function bodyBetween(a,b,t){return Object.fromEntries(Object.keys(STAND).map(key=>[key,mix(a[key],b[key],ease(t))]));}
function elbow(shoulder,hand){
  const dx=hand.x-shoulder.x,dy=hand.y-shoulder.y,d=Math.max(.001,Math.hypot(dx,dy)),upper=18,fore=19;
  const along=(upper*upper-fore*fore+d*d)/(2*d),height=Math.sqrt(Math.max(0,upper*upper-along*along));
  return {x:shoulder.x+dx/d*along-dy/d*height,y:shoulder.y+dy/d*along+dx/d*height};
}
function finishPose(body,bar,grip,stage,loaded){
  const nearShoulder={x:body.shoulder.x+12,y:body.shoulder.y+4},farShoulder={x:body.shoulder.x-12,y:body.shoulder.y-4};
  const nearGrip={x:bar.x+14,y:bar.y+4},farGrip={x:bar.x-14,y:bar.y-4};
  const nearHand=grip===1?nearGrip:mix({x:body.hip.x+16,y:body.hip.y-3},nearGrip,grip),farHand=grip===1?farGrip:mix({x:body.hip.x-10,y:body.hip.y-9},farGrip,grip);
  return {...body,bar,grip,stage,loaded,nearShoulder,farShoulder,nearHand,farHand,nearGrip,farGrip,
    nearElbow:elbow(nearShoulder,nearHand),farElbow:elbow(farShoulder,farHand),nearFoot:{x:48,y:0},farFoot:{x:39,y:-7}};
}
export function quietOfficeBenchPose(options={}){
  // Reduced motion is a deterministic, supported resting position, not a partial rep.
  if(options.animate===false)return finishPose(LIE,RACK,1,'rest',false);
  const t=Math.max(0,Number.isFinite(options.time)?options.time:0),exit=options.exit;
  if(exit){
    const e=Math.max(0,exit.time||0),from=exit.from;
    if(!from.loaded){const body=bodyBetween(from,STAND,e/1.2);return finishPose(body,RACK,from.grip*(1-ease(e/.4)),'stand',false);}
    if(e<.8)return finishPose(from,mix(from.bar,RACK,ease(e/.8)),1,'rack',true);
    if(e<1.2)return finishPose(LIE,RACK,1-ease((e-.8)/.4),'release',false);
    if(e<2)return finishPose(bodyBetween(LIE,SIT,(e-1.2)/.8),RACK,0,'sit',false);
    return finishPose(bodyBetween(SIT,STAND,(e-2)/.8),RACK,0,'stand',false);
  }
  if(t<.8)return finishPose(bodyBetween(STAND,SIT,t/.8),RACK,0,'sit',false);
  if(t<1.8)return finishPose(bodyBetween(SIT,LIE,(t-.8)),RACK,0,'lie',false);
  if(t<2.4)return finishPose(LIE,RACK,ease((t-1.8)/.6),'grip',false);
  if(t<3.2)return finishPose(LIE,mix(RACK,TOP,ease((t-2.4)/.8)),1,'unrack',true);
  if(t<20.8){
    const r=(t-3.2)%4.4;
    // Two-second eccentric, chest pause, 1.5-second press, then stable lockout.
    const depth=r<2?ease(r/2):r<2.35?1:r<3.85?1-ease((r-2.35)/1.5):0;
    return finishPose(LIE,mix(TOP,BOTTOM,depth),1,r<2?'lower':r<2.35?'pause':r<3.85?'press':'lockout',true);
  }
  if(t<21.6)return finishPose(LIE,mix(TOP,RACK,ease((t-20.8)/.8)),1,'rack',true);
  if(t<22.2)return finishPose(LIE,RACK,1-ease((t-21.6)/.6),'release',false);
  if(t<23.2)return finishPose(bodyBetween(LIE,SIT,t-22.2),RACK,0,'sit',false);
  return finishPose(bodyBetween(SIT,STAND,(t-23.2)/.8),RACK,0,'stand',false);
}
function painter(ctx){
  const rect=(x,y,w,h,c)=>{ctx.fillStyle=c;ctx.fillRect(Math.round(x),Math.round(y),w,h);};
  const line=(a,b,w,c)=>{const n=Math.ceil(Math.max(Math.abs(b.x-a.x),Math.abs(b.y-a.y)));for(let i=0;i<=n;i++){const t=n?i/n:0;rect(a.x+(b.x-a.x)*t-Math.floor(w/2),a.y+(b.y-a.y)*t-Math.floor(w/2),w,w,c);}};
  return {rect,line};
}
function base(p,scheme){
  const {rect,line}=p;
  rect(-74,-9,145,16,scheme==='dark'?'#282828':'#b6b6b6');rect(-72,-9,141,1,scheme==='dark'?'#4a4a4a':'#dadada');
  // Paired rack uprights with height holes, safety arms and stable floor feet.
  line({x:-62,y:-17},{x:-62,y:-87},4,'#4c4c4c');rect(-63,-85,1,65,'#a8a8a8');
  for(let y=-81;y<-24;y+=8)rect(-62,y,1,2,'#282828');
  line({x:-62,y:-14},{x:20,y:-14},4,'#777777');rect(-70,-18,21,4,'#454545');
  line({x:-62,y:-40},{x:-4,y:-25},3,'#7c7c7c');rect(-63,-88,5,3,'#343434');rect(-59,-88,2,6,'#343434');
  // Long padded bench with visible head support, seam, steel frame and legs.
  line({x:-43,y:-23},{x:-43,y:-6},4,'#595959');line({x:24,y:-23},{x:24,y:1},4,'#595959');
  rect(-51,-7,20,4,'#404040');rect(16,-1,20,4,'#404040');
  rect(-55,-30,87,8,'#303030');rect(-53,-31,83,4,'#626262');rect(-51,-31,79,1,'#a2a2a2');rect(-28,-30,1,3,'#8a8a8a');
}
function rackFront(p){
  p.line({x:6,y:0},{x:6,y:-71},4,'#555555');p.rect(5,-69,1,65,'#b2b2b2');
  for(let y=-64;y<-6;y+=8)p.rect(6,y,1,2,'#292929');
  p.line({x:6,y:-24},{x:38,y:-17},3,'#969696');p.rect(2,-72,7,3,'#393939');p.rect(1,-74,2,6,'#393939');p.rect(-2,0,20,4,'#3b3b3b');
}
function barbell(p,bar){
  p.line({x:bar.x-38,y:bar.y-10},{x:bar.x+38,y:bar.y+10},3,'#343434');
  p.line({x:bar.x-38,y:bar.y-11},{x:bar.x+38,y:bar.y+9},1,'#d5d5d5');
  for(const side of [-1,1]){
    const x=bar.x+side*31,y=bar.y+side*8;
    p.rect(x-5,y-10,9,21,'#303030');p.rect(x-4,y-11,7,23,'#444444');p.rect(x-3,y-9,2,19,'#a2a2a2');p.rect(x+2,y-8,1,17,'#656565');
    p.rect(x+side*6-1,y-3,3,6,'#b4b4b4');p.rect(x-1,y-2,2,4,'#777777');
  }
}
function limb(p,start,joint,end,width,color){p.line(start,joint,width,color);p.line(joint,end,width-1,color);}
function lifter(p,pose,options){
  const index=((options.palette||0)%6+6)%6,c=QUIET_PERSON_PALETTES[index],{rect,line}=p;
  limb(p,{x:pose.hip.x-5,y:pose.hip.y-4},pose.farKnee,pose.farFoot,6,'#626262');rect(pose.farFoot.x-4,pose.farFoot.y-3,12,4,'#454545');
  limb(p,pose.farShoulder,pose.farElbow,pose.farHand,5,'#9b9b9b');
  // Shoulder blades and pelvis contact the pad, with a small natural lumbar arch.
  line(pose.hip,pose.shoulder,12,'#303030');line(pose.hip,pose.shoulder,9,c[3]);
  line({x:pose.hip.x,y:pose.hip.y-3},{x:pose.shoulder.x,y:pose.shoulder.y-3},3,c[4]);
  limb(p,pose.hip,pose.nearKnee,pose.nearFoot,7,'#3d3d3d');line(pose.hip,pose.nearKnee,1,'#8a8a8a');rect(pose.nearFoot.x-4,pose.nearFoot.y-3,13,5,'#292929');rect(pose.nearFoot.x-2,pose.nearFoot.y-3,8,1,'#bcbcbc');
  // Stepped head contour and six stable hair palettes match the office actors.
  const hx=pose.head.x,hy=pose.head.y;
  line(pose.shoulder,{x:hx+6,y:hy+5},5,'#bcbcbc');
  rect(hx-7,hy-9,14,2,'#292929');rect(hx-10,hy-7,20,14,'#292929');rect(hx-7,hy+7,14,2,'#292929');
  rect(hx-9,hy-6,12,12,c[0]);rect(hx-7,hy-8,10,14,c[1]);rect(hx+1,hy-6,8,12,'#c8c8c8');rect(hx+2,hy-6,6,9,'#dedede');
  rect(hx+5,hy-5,2,2,'#343434');rect(hx+8,hy-2,3,2,'#c8c8c8');rect(hx+7,hy+4,2,1,'#858585');
  for(let y=-6;y<5;y+=3)for(let x=-7;x<1;x+=3)if((x*7+y*3+index)%3===0)rect(hx+x,hy+y,2,2,c[2]);
  if(index===2)rect(hx-10,hy+1,3,8,c[0]);if(index===3)rect(hx-6,hy-7,7,2,c[2]);if(index===4)rect(hx-5,hy-10,3,2,c[1]);if(index===5)rect(hx-13,hy-2,5,6,c[0]);
  limb(p,pose.nearShoulder,pose.nearElbow,pose.nearHand,6,'#333333');
  limb(p,pose.nearShoulder,pose.nearElbow,pose.nearHand,4,'#c9c9c9');line(pose.nearShoulder,pose.nearElbow,3,c[4]);
}
export function drawQuietOfficeBench(ctx,x,y,options={}){
  ctx.save();ctx.translate(Math.round(x),Math.round(y));const p=painter(ctx);base(p,options.scheme);rackFront(p);if(!options.omitBar)barbell(p,RACK);ctx.restore();
}
export function drawQuietOfficeBenchPresser(ctx,x,y,options={}){
  ctx.save();ctx.translate(Math.round(x),Math.round(y));const p=painter(ctx),pose=quietOfficeBenchPose(options);
  if(!options.roomHasBench)base(p,options.scheme);lifter(p,pose,options);rackFront(p);barbell(p,pose.bar);
  // Hands overlap the same bar coordinates, preserving a closed, two-sided grip.
  if(pose.grip>.95){for(const hand of [pose.farHand,pose.nearHand]){p.rect(hand.x-2,hand.y-2,5,5,'#dedede');p.rect(hand.x-1,hand.y-2,3,1,'#9e9e9e');}}
  ctx.restore();
}

export function drawQuietOfficeRackedBar(ctx,x,y){
  ctx.save();ctx.translate(Math.round(x),Math.round(y));barbell(painter(ctx),RACK);ctx.restore();
}
