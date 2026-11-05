/** Original stationary-bike pixel asset. Feet/pedals share one crank solution.
 * Anchor: centre of floor mat. Cyclist includes the bicycle for correct depth layering.
 * Cadence is 50 rpm, with no leg shortening: a two-link knee solution each frame.
 */
import { QUIET_PERSON_PALETTES } from './quiet-office-people.js';
export const QUIET_BIKE_METRICS=Object.freeze({left:-36,right:37,top:-80,bottom:3,width:73,height:83});
const HIP={x:-15,y:-39},CRANK={x:0,y:-17},RADIUS=8;
function limbKnee(foot){
  const dx=foot.x-HIP.x,dy=foot.y-HIP.y,d=Math.hypot(dx,dy),length=23;
  const h=Math.sqrt(Math.max(0,length*length-d*d/4));
  return {x:(HIP.x+foot.x)/2+dy/d*h,y:(HIP.y+foot.y)/2-dx/d*h};
}
export function quietOfficePedalPose(options={}){
  const phase=options.animate===false?Math.PI/4:Number.isFinite(options.pedalPhase)?options.pedalPhase:(Number.isFinite(options.time)?options.time:0)*Math.PI*5/3;
  const near={x:CRANK.x+Math.cos(phase)*RADIUS,y:CRANK.y+Math.sin(phase)*RADIUS};
  const far={x:CRANK.x-Math.cos(phase)*RADIUS,y:CRANK.y-Math.sin(phase)*RADIUS};
  return {phase,hip:{...HIP},crank:{...CRANK},near,far,nearKnee:limbKnee(near),farKnee:limbKnee(far)};
}
function painter(ctx){
  const rect=(x,y,w,h,c)=>{ctx.fillStyle=c;ctx.fillRect(Math.round(x),Math.round(y),w,h);};
  // Bresenham-like square strokes keep every diagonal on the same pixel grid.
  const line=(x1,y1,x2,y2,width,c)=>{const steps=Math.ceil(Math.max(Math.abs(x2-x1),Math.abs(y2-y1)));for(let i=0;i<=steps;i++){const t=steps?i/steps:0;rect(x1+(x2-x1)*t-Math.floor(width/2),y1+(y2-y1)*t-Math.floor(width/2),width,width,c);}};
  const disc=(x,y,r,c)=>{for(let dy=-r;dy<=r;dy++){const half=Math.floor(Math.sqrt(r*r-dy*dy));rect(x-half,y+dy,half*2+1,1,c);}};
  return {rect,line,disc};
}
function bikeBase(p,options,pose){
  const {rect,line,disc}=p,dark=options.scheme==='dark';
  rect(-36,-1,73,4,dark?'#242424':'#b8b8b8');rect(-34,-1,69,1,dark?'#454545':'#d4d4d4');
  // Front flywheel, machined edge and a belt housing behind the frame.
  disc(18,-19,14,'#303030');disc(18,-19,12,'#8a8a8a');disc(18,-19,10,'#d0d0d0');disc(18,-19,8,'#a1a1a1');
  const a=pose?.phase||0;
  for(let i=0;i<4;i++){const angle=a*2+i*Math.PI/2;line(18+Math.cos(angle)*5,-19+Math.sin(angle)*5,18+Math.cos(angle)*9,-19+Math.sin(angle)*9,1,'#727272');}
  disc(18,-19,3,'#535353');rect(-2,-23,21,8,'#646464');line(0,-23,18,-26,1,'#adadad');
  // Triangulated frame: seat tube, down tube and low stabilisers.
  line(-22,-4,0,-17,5,'#383838');line(0,-17,23,-41,5,'#393939');line(-13,-34,0,-17,5,'#444444');
  line(-22,-4,-13,-34,4,'#555555');line(-13,-34,23,-41,4,'#666666');line(23,-41,28,-4,4,'#4b4b4b');
  line(-21,-5,0,-18,1,'#ababab');line(1,-18,24,-41,1,'#b9b9b9');line(-12,-33,22,-40,1,'#b3b3b3');
  rect(-30,-5,18,4,'#454545');rect(20,-5,17,4,'#454545');rect(-30,-2,4,3,'#252525');rect(-16,-2,4,3,'#252525');rect(20,-2,4,3,'#252525');rect(33,-2,4,3,'#252525');
  // Adjustable seat post, small adjustment pin, padded saddle.
  line(-13,-32,-15,-40,3,'#b0b0b0');rect(-21,-42,15,3,'#303030');rect(-23,-41,17,2,'#414141');rect(-21,-43,11,1,'#898989');rect(-10,-33,3,2,'#282828');
  // Bent upright, horizontal grips and an angled cadence display.
  line(23,-40,22,-49,3,'#a5a5a5');line(22,-49,30,-53,3,'#444444');line(26,-53,34,-53,3,'#303030');
  rect(25,-59,9,5,'#333333');rect(26,-58,7,3,'#989898');rect(27,-57,2,1,'#e4e4e4');rect(30,-57,2,1,'#d0d0d0');
  // Resistance knob and water bottle mount, both fixed to the frame.
  rect(6,-35,4,5,'#343434');rect(5,-37,6,2,'#454545');rect(11,-37,4,9,'#d2d2d2');rect(12,-39,2,2,'#737373');rect(10,-31,6,2,'#606060');
  disc(0,-17,5,'#343434');disc(0,-17,3,'#888888');disc(0,-17,1,'#d0d0d0');
}
function leg(p,pose,near){
  const foot=near?pose.near:pose.far,knee=near?pose.nearKnee:pose.farKnee;
  p.line(HIP.x,HIP.y,knee.x,knee.y,6,near?'#353535':'#555555');p.line(knee.x,knee.y,foot.x,foot.y,5,near?'#414141':'#666666');
  p.line(HIP.x-1,HIP.y,knee.x-1,knee.y,1,near?'#929292':'#858585');
  p.rect(foot.x-4,foot.y-3,11,4,near?'#252525':'#484848');p.rect(foot.x-3,foot.y-3,7,1,'#b6b6b6');
}
function pedal(p,foot,near){p.line(0,-17,foot.x,foot.y,2,near?'#bbbbbb':'#696969');p.rect(foot.x-5,foot.y+1,12,2,near?'#292929':'#555555');}
export function drawQuietOfficeBike(ctx,x,y,options={}){
  ctx.save();ctx.translate(Math.round(x),Math.round(y));const p=painter(ctx),pose=quietOfficePedalPose({animate:false});bikeBase(p,options,pose);pedal(p,pose.far,false);pedal(p,pose.near,true);ctx.restore();
}
export function drawQuietOfficeCyclist(ctx,x,y,options={}){
  ctx.save();ctx.translate(Math.round(x),Math.round(y));
  const p=painter(ctx),pose=quietOfficePedalPose(options),index=((options.palette||0)%6+6)%6,c=QUIET_PERSON_PALETTES[index];
  leg(p,pose,false);pedal(p,pose.far,false);bikeBase(p,options,pose);
  // Pelvis stays on the saddle, shoulders lean forward, wrists remain on grips.
  p.line(-15,-40,3,-59,13,'#292929');p.line(-15,-41,3,-59,10,c[3]);p.line(-17,-43,0,-61,3,c[4]);
  p.line(2,-57,13,-48,6,'#323232');p.line(2,-57,13,-48,4,c[4]);p.line(13,-48,28,-52,4,'#c8c8c8');p.rect(26,-54,5,4,'#dedede');
  p.line(4,-59,9,-63,5,'#bcbcbc');
  // Same stepped side-facing head and stable hair shades as the walking actors.
  p.rect(1,-78,10,2,'#292929');p.rect(-2,-76,16,4,'#292929');p.rect(-3,-72,18,11,'#292929');p.rect(0,-61,13,3,'#292929');
  p.rect(-1,-75,13,14,c[0]);p.rect(1,-76,9,14,c[1]);p.rect(8,-69,8,10,'#c9c9c9');p.rect(10,-68,6,7,'#dedede');p.rect(13,-68,2,2,'#303030');p.rect(15,-64,3,2,'#c9c9c9');p.rect(11,-60,4,1,'#949494');
  for(let yy=-75;yy<-65;yy+=3)for(let xx=0;xx<9;xx+=3)if(((xx*11+yy*7+index*5)%5+5)%5<2)p.rect(xx,yy,2,2,c[2]);
  if(index===2)p.rect(-3,-68,4,10,c[0]);
  if(index===3){p.rect(1,-76,9,2,c[2]);p.rect(-1,-72,5,2,c[2]);}
  if(index===4){p.rect(-1,-78,3,2,c[1]);p.rect(4,-79,3,2,c[1]);p.rect(9,-78,3,2,c[1]);}
  if(index===5){p.rect(-7,-70,5,6,'#292929');p.rect(-6,-69,4,4,c[1]);}
  leg(p,pose,true);pedal(p,pose.near,true);
  ctx.restore();
}
