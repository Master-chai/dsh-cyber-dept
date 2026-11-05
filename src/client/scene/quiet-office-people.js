/** Original, code-native pixel actors. Integer coordinates preserve crisp silhouettes.
 * Frames: 0/1/2 walk, 3/4 type, 5/6 read. Directions: 0 front, 1 back, 2 right, 3 left.
 * Anchor is feet at (x,y). Seated actors must be followed by the independent chair layer.
 */
export const QUIET_ACTOR_METRICS = Object.freeze({ width: 38, height: 54, palettes: 6, frames: 7, directions: 4 });
/** Hit region includes the head and chair feet; it follows the actor while walking. */
export function quietOfficeActorHit(actor, point) {
  if(actor.phase==='break'&&actor.breakKind==='bench')return point.x>=actor.x-122&&point.x<=actor.x+23&&point.y>=actor.y-99&&point.y<=actor.y+7;
  if(actor.phase==='break'&&actor.breakKind==='bike')return Math.abs(point.x-actor.x)<=38&&point.y>=actor.y-82&&point.y<=actor.y+14;
  if(actor.phase==='break'&&actor.breakKind==='phone')return Math.abs(point.x-actor.x)<=24&&point.y>=actor.y-54&&point.y<=actor.y+14;
  return Math.abs(point.x-actor.x)<=QUIET_ACTOR_METRICS.width/2 && point.y>=actor.y-QUIET_ACTOR_METRICS.height && point.y<=actor.y+14;
}
export const QUIET_PERSON_PALETTES = [
  ['#282828','#414141','#606060','#bcbcbc','#e2e2e2'],
  ['#393939','#555555','#767676','#969696','#c9c9c9'],
  ['#202020','#373737','#515151','#d4d4d4','#f0f0f0'],
  ['#a3a3a3','#c9c9c9','#ededed','#a6a6a6','#d6d6d6'],
  ['#4a4a4a','#686868','#8d8d8d','#b9b9b9','#e3e3e3'],
  ['#303030','#4c4c4c','#717171','#888888','#b6b6b6'],
];
function pixelPen(ctx) { return function(x,y,w,h,c){ctx.fillStyle=c;ctx.fillRect(x,y,w,h);}; }

export function drawQuietOfficeChair(ctx,x,y,options={}) {
  ctx.save();ctx.translate(Math.round(x),Math.round(y));
  const p=pixelPen(ctx),edge=options.scheme==='dark'?'#171717':'#323232';
  // Five-spoke steel base, separate wheels, and adjustable gas lift.
  p(-2,-4,4,12,edge);p(-1,-2,1,9,'#9c9c9c');p(-12,6,24,2,edge);
  p(-9,4,3,2,'#777777');p(7,4,3,2,'#777777');p(-1,7,3,5,edge);
  p(-15,7,6,3,'#292929');p(10,7,6,3,'#292929');p(-2,11,5,3,'#292929');
  p(-14,7,3,1,'#8c8c8c');p(11,7,3,1,'#8c8c8c');p(-1,11,2,1,'#8c8c8c');
  // Arms bracket the shoulders; upholstery is a restrained woven checker.
  p(-18,-22,3,13,edge);p(16,-22,3,13,edge);p(-19,-23,6,3,'#595959');p(14,-23,6,3,'#595959');
  p(-14,-10,29,5,edge);p(-12,-9,25,2,'#858585');
  p(-13,-26,26,2,edge);p(-15,-24,30,2,edge);p(-16,-22,32,11,edge);p(-14,-11,28,4,edge);p(-11,-7,22,1,edge);
  p(-13,-23,26,13,'#6b6b6b');p(-11,-21,22,9,'#484848');
  for(let yy=-20;yy<-12;yy+=2)for(let xx=-10;xx<11;xx+=2)if((xx+yy)%4===0)p(xx,yy,1,1,'#5b5b5b');
  p(-12,-23,24,1,'#a1a1a1');p(-14,-21,1,9,'#858585');p(13,-21,1,9,'#444444');
  p(-8,-8,16,1,'#8b8b8b');ctx.restore();
}

export function drawQuietOfficePerson(ctx,x,y,options={}) {
  const palette=((options.palette||0)%6+6)%6,colors=QUIET_PERSON_PALETTES[palette];
  const frame=options.frame||0,seated=!!options.seated,dir=options.direction??1;
  const back=dir===1,side=dir===2||dir===3,walking=!seated&&frame<3;
  const stride=walking?(frame===0?-2:frame===2?2:0):0;
  const bob=walking&&frame!==1?1:0;
  ctx.save();ctx.translate(Math.round(x),Math.round(y));if(dir===3)ctx.scale(-1,1);
  const p=pixelPen(ctx),outline=options.scheme==='dark'?'#151515':'#292929';
  const shirt=colors[3],light=colors[4],skin='#c8c8c8',skinLight='#e0e0e0';
  // Shoes and trousers remain visible below the seat, but the chair is never baked into an actor.
  p(-8,-15+stride,7,14-stride,'#3c3c3c');p(2,-15-stride,7,14+stride,'#505050');
  p(-9,-3+stride,9,4,outline);p(2,-3-stride,10,4,outline);
  p(-7,-13+stride,2,10,'#686868');p(3,-12-stride,2,9,'#737373');
  // Rounded shoulders, collar, shirt seams and a narrow shadow at the waist.
  const torso=seated?-31:-30+bob;
  p(-8,torso-2,16,3,outline);p(-12,torso+1,24,17,outline);p(-10,torso,20,16,shirt);
  p(-8,torso,5,13,light);p(8,torso+3,2,12,'#858585');p(-9,torso+15,18,2,'#686868');
  p(-2,torso+2,1,12,'#a2a2a2');p(-4,torso-1,8,3,'#7a7a7a');p(-3,torso-2,6,3,skin);
  if(!back&&!side){p(-2,torso+3,4,7,'#505050');p(-1,torso+3,1,5,'#878787');}
  // Alternating one-pixel wrist movement: meaningful work animation without whole-body jitter.
  if(seated){
    const typing=frame===3||frame===4,read=frame>=5;
    const left=typing&&frame===4?1:0,right=typing&&frame===3?1:0;
    p(-15,-30,5,10,outline);p(11,-30,5,10,outline);p(-14,-29,4,7,light);p(11,-29,4,7,shirt);
    p(-17,-33-left,5,7,outline);p(13,-33-right,5,7,outline);
    p(-16,-33-left,3,5,skinLight);p(14,-33-right,3,5,skin);
    if(read){p(12,-37+(frame===6?1:0),4,8,skin);p(11,-37,3,2,skinLight);}
    if(options.phone){
      // A small bright screen and alternating thumb make desk standby distinct
      // from typing, without changing the existing actor silhouette or palette.
      p(10,-35,5,9,shirt);p(11,-39,4,7,skin);
      p(13,-44,9,15,outline);p(14,-42,7,10,'#dedede');
      p(15,-41,5,2,'#8e8e8e');p(15,-37,4,1,'#b2b2b2');
      p(17,-31,2,1,'#a0a0a0');p(12,-35-(frame%2),4,3,skinLight);
    }
  }else if(!options.hideArms){
    p(-15,torso+3+stride,5,12,outline);p(-14,torso+3+stride,3,8,light);p(-14,torso+11+stride,3,4,skinLight);
    p(11,torso+3-stride,5,12,outline);p(12,torso+3-stride,3,8,shirt);p(12,torso+11-stride,3,4,skin);
  }
  // Head silhouette: stepped contour, ear/nape, and clustered hair, never random per frame.
  const hy=-52+bob+(seated?0:1),hw=side?18:24,hx=side?-8:-12;
  p(hx+7,hy,hw-14,1,outline);p(hx+4,hy+1,hw-8,2,outline);p(hx+2,hy+3,hw-4,3,outline);p(hx,hy+6,hw,10,outline);p(hx+1,hy+16,hw-2,3,outline);p(hx+3,hy+19,hw-6,2,outline);p(hx+6,hy+21,hw-12,2,outline);
  p(hx+2,hy+6,hw-4,11,colors[0]);p(hx+4,hy+4,hw-8,15,colors[1]);p(hx+7,hy+2,hw-14,2,colors[1]);
  if(!back){
    const fx=side?4:-8;
    p(fx,hy+11,side?7:16,9,skin);p(fx+1,hy+12,side?6:13,6,skinLight);
    p(side?9:-5,hy+14,2,2,outline);if(!side)p(4,hy+14,2,2,outline);
    p(side?11:0,hy+18,2,1,'#929292');
  }else{p(-5,hy+21,10,3,skin);p(-12,hy+13,2,6,skin);p(10,hy+13,2,6,skin);}
  const hairBottom=back?hy+19:hy+10;
  for(let yy=hy+4;yy<hairBottom;yy+=3){
    for(let xx=hx+3;xx<hx+hw-3;xx+=3){
      const seed=Math.abs(((xx+19)*73)^((yy-hy)*151)^(palette*47))%17;
      if(seed<6)p(xx,yy,2,2,colors[2]);else if(seed>13)p(xx,yy,2,2,colors[0]);
    }
  }
  // Six stable silhouettes: neat crop, side part, bob, silver sweep, curls, tied-back hair.
  if(palette===0){p(-7,hy+2,10,1,colors[2]);p(-9,hy+5,2,5,colors[2]);}
  if(palette===1){p(1,hy+3,1,8,colors[0]);p(-7,hy+5,7,2,colors[2]);}
  if(palette===2){p(-12,hy+10,3,13,colors[0]);p(9,hy+10,3,13,colors[0]);p(-10,hy+21,4,2,colors[1]);}
  if(palette===3){p(-6,hy+3,11,2,colors[2]);p(-8,hy+6,12,1,colors[2]);p(-10,hy+10,3,5,colors[2]);}
  if(palette===4){for(let i=0;i<5;i++){p(-10+i*4,hy+1+(i%2),3,3,colors[1]);p(-9+i*4,hy+2+(i%2),1,1,colors[2]);}}
  if(palette===5&&back){p(-5,hy+16,10,8,outline);p(-4,hy+16,8,6,colors[1]);p(-2,hy+17,4,2,colors[2]);p(-4,hy+23,8,1,'#999999');}
  ctx.restore();
}
