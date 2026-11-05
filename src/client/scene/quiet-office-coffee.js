/** One coffee machine, one cup, one explicit prepare/brew/take/sip sequence. */
import {drawQuietOfficePerson,QUIET_PERSON_PALETTES} from './quiet-office-people.js';
export const QUIET_COFFEE_TIMING=Object.freeze({duration:14.5,exitDuration:1});
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=x=>{const t=clamp(x);return t*t*(3-2*t);};
const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const REST={x:91,y:250},TRAY={x:59,y:232},BUTTON={x:65,y:215},MOUTH={x:95,y:229},HOLD={x:90,y:246};
export function quietOfficeCoffeePose(options={}){
  if(options.animate===false)return {stage:'rest',hand:REST,cup:TRAY,cupInTray:true,brewing:false,fill:0,steam:false};
  const t=Math.max(0,Number.isFinite(options.time)?options.time:0);
  if(options.exit){
    const from=options.exit.from,p=smooth(options.exit.time||0),cup=mix(from.cup,TRAY,p);
    return {stage:'put-back',hand:mix(from.hand,TRAY,p),cup,cupInTray:p===1,brewing:false,fill:from.fill,steam:false};
  }
  if(t<1)return {stage:'place-cup',hand:mix(REST,TRAY,smooth(t)),cup:TRAY,cupInTray:true,brewing:false,fill:0};
  if(t<1.8)return {stage:'press-button',hand:mix(TRAY,BUTTON,smooth((t-1)/.8)),cup:TRAY,cupInTray:true,brewing:false,fill:0};
  if(t<5.8)return {stage:'brew',hand:mix(BUTTON,REST,smooth((t-1.8)/.7)),cup:TRAY,cupInTray:true,brewing:true,fill:(t-1.8)/4};
  if(t<6.8){const p=smooth(t-5.8);return {stage:'take-cup',hand:mix(REST,TRAY,smooth(p*2)),cup:TRAY,cupInTray:true,brewing:false,fill:1};}
  if(t<12.8){
    const p=(t-6.8)%2,q=p<.55?smooth(p/.55):p<1.1?1:1-smooth((p-1.1)/.9),cup=mix(TRAY,mix(HOLD,MOUTH,q),smooth((t-6.8)/.5));
    return {stage:'sip',hand:cup,cup,cupInTray:false,brewing:false,fill:1-(t-6.8)/9,steam:true};
  }
  if(t<13.8){const cup=mix(HOLD,TRAY,smooth(t-12.8));return {stage:'put-back',hand:cup,cup,cupInTray:false,brewing:false,fill:.3};}
  return {stage:'release',hand:mix(TRAY,REST,smooth((t-13.8)/.7)),cup:TRAY,cupInTray:true,brewing:false,fill:.3};
}
function pen(ctx){
  const rect=(x,y,w,h,c)=>{ctx.fillStyle=c;ctx.fillRect(Math.round(x),Math.round(y),w,h);};
  const line=(a,b,w,c)=>{const steps=Math.ceil(Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y)));for(let i=0;i<=steps;i++){const t=steps?i/steps:0;rect(a.x+(b.x-a.x)*t-Math.floor(w/2),a.y+(b.y-a.y)*t-Math.floor(w/2),w,w,c);}};
  return {rect,line};
}
function cup(p,position,fill){p.rect(position.x-3,position.y-4,7,7,'#dedede');p.rect(position.x+4,position.y-3,3,5,'#d0d0d0');p.rect(position.x+5,position.y-2,1,3,'#777777');p.rect(position.x-2,position.y-5,5,2,fill>0?'#5c5c5c':'#a1a1a1');}
export function drawQuietOfficeCoffeeStation(ctx,options={}){
  const p=pen(ctx),pose=options.pose||quietOfficeCoffeePose({animate:false});
  // The narrowed counter leaves the operator's real standing and approach space.
  p.rect(28,238,54,44,'#a9a9a9');p.rect(24,230,62,9,'#c8c8c8');p.rect(26,230,58,1,'#eeeeee');p.rect(30,278,3,10,'#777777');p.rect(76,278,3,10,'#777777');
  p.rect(38,201,38,29,'#303030');p.rect(40,203,34,25,'#474747');p.rect(43,205,28,12,'#777777');p.rect(45,206,16,8,'#3b3b3b');p.rect(47,208,12,2,pose.brewing?'#eeeeee':'#b2b2b2');
  p.rect(64,211,4,5,pose.stage==='press-button'?'#eeeeee':'#a0a0a0');p.rect(52,218,15,5,'#313131');p.rect(55,221,7,3,'#a4a4a4');
  p.rect(45,224,26,10,'#363636');p.rect(44,234,29,3,'#8a8a8a');p.rect(47,235,24,1,'#535353');
  if(pose.brewing){p.rect(57,224,2,5,'#858585');p.rect(60,224,1,5,'#b2b2b2');}
  if(pose.cupInTray)cup(p,TRAY,pose.fill);
}
export function drawQuietOfficeCoffeeMaker(ctx,x,y,options={}){
  const pose=quietOfficeCoffeePose(options),p=pen(ctx),colors=QUIET_PERSON_PALETTES[(options.palette||0)%6];
  drawQuietOfficeCoffeeStation(ctx,{pose});
  drawQuietOfficePerson(ctx,x,y,{palette:options.palette,direction:3,frame:1,hideArms:true,scheme:options.scheme});
  // The shoulder, elbow and wrist form a two-link arm, never a floating cup.
  const shoulder={x:x-12,y:y-30},hand=pose.hand,dx=hand.x-shoulder.x,dy=hand.y-shoulder.y,d=Math.max(.001,Math.hypot(dx,dy));
  const a=(18*18-19*19+d*d)/(2*d),h=Math.sqrt(Math.max(0,18*18-a*a));
  const elbow={x:shoulder.x+dx/d*a-dy/d*h,y:shoulder.y+dy/d*a+dx/d*h};
  p.line(shoulder,elbow,5,colors[4]);p.line(elbow,hand,4,'#c8c8c8');p.rect(hand.x-2,hand.y-2,5,4,'#dedede');
  p.line({x:x+12,y:y-29},{x:x+11,y:y-14},4,colors[3]);p.rect(x+9,y-16,4,4,'#c8c8c8');
  if(!pose.cupInTray)cup(p,pose.cup,pose.fill);
  if(pose.steam&&options.animate!==false){const rise=Math.floor((options.time||0)*3)%3;p.rect(pose.cup.x-1,pose.cup.y-9-rise,1,3,'#b2b2b2');}
}
