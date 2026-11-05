/** Monochrome pixel room; DOM name badges attach to the rear partitions. */
import { officeSceneColor } from '../office-theme.js';
import { drawQuietOfficePerson, drawQuietOfficeChair } from './quiet-office-people.js';
import { drawQuietOfficeBike, drawQuietOfficeCyclist } from './quiet-office-bike.js';

export function officeTone(state, scheme) {
  var color = state === 'waiting-approval' ? '#a56718' : state === 'error' || state === 'blocked' ? '#be4c46' : state === 'done' ? '#4c8256' : ['thinking','streaming','tool-running','provisioning'].indexOf(state) >= 0 ? '#2c896b' : '#758477';
  return officeSceneColor(color, scheme);
}
export function drawOfficeRoom(ctx, layout, scheme) {
  var w=layout.width,hg=layout.height,deskMode=false;
  function rect(x,y,w,h,c){
    if(deskMode && scheme==='dark' && /^#([0-9a-f]{2})\1\1$/i.test(c)){var g=Math.round(parseInt(c.slice(1,3),16)*.52).toString(16).padStart(2,'0');c='#'+g+g+g;}
    ctx.fillStyle=officeSceneColor(c,scheme);ctx.fillRect(x,y,w,h);
  }
  function line(x,y,w,c){rect(x,y,w,1,c);}
  function plant(x,y){rect(x-6,y-2,12,9,'#a57d60');rect(x-7,y-3,14,3,'#c69f76');rect(x-1,y-23,2,21,'#477a68');rect(x-10,y-20,9,8,'#548f75');rect(x+1,y-27,8,11,'#7fb08d');rect(x-7,y-30,7,9,'#6b9e80');rect(x+2,y-13,10,7,'#457b68');rect(x-5,y+7,10,2,'#a2b69a');}
  function windowAt(x){rect(x-3,25,115,48,'#a6bdb5');rect(x,28,109,39,'#bee3e5');rect(x+3,31,103,32,'#d4edf0');for(var i=0;i<8;i++){var bx=x+i*14;rect(bx,47-(i%3)*5,11,16+(i%3)*5,'#98bfc7');rect(bx+3,49-(i%3)*5,2,2,'#f2f4d5');}rect(x+53,28,3,39,'#f7faf0');rect(x,45,109,2,'#f7faf0');rect(x-5,68,119,5,'#ffffff');line(x-4,73,117,'#a8bdb4');}
  rect(0,0,w,hg,'#cbd6c7');rect(12,82,w-24,hg-94,'#e5e4d4');
  for(var y=86;y<hg-12;y+=16) for(var x=16;x<w-16;x+=32){rect(x,y,31,15,(Math.floor(y/16)+Math.floor(x/32))%2?'#ecebdc':'#e7e6d6');line(x+3,y+12,18,'#dbddca');}
  rect(12,12,w-24,72,'#e8eee0');rect(12,12,w-24,4,'#f8faef');rect(12,78,w-24,6,'#bacab3');line(12,84,w-24,'#9fb49b');
  windowAt(173);windowAt(333);windowAt(493);
  rect(24,27,110,35,'#f5f8eb');line(25,27,108,'#b0c6a2');
  ctx.fillStyle=officeSceneColor('#37694f',scheme);ctx.font='bold 11px Consolas, monospace';ctx.fillText('CYBER / IT',32,43);ctx.font='6px Consolas, monospace';ctx.fillStyle=officeSceneColor('#75846a',scheme);ctx.fillText('A SMALL PLACE TO BUILD',32,55);
  rect(156,96,466,hg-116,'#d4dfcb');for(var yy=99;yy<hg-22;yy+=4)line(159,yy,460,'#cedbc5');
  rect(24,102,110,62,'#c5cdbb');rect(24,102,110,5,'#d5bb91');rect(26,108,106,43,'#c1ad8d');
  for(var b=0;b<12;b++){var bx=30+b*8;rect(bx,113+(b%3)*2,6,31-(b%3)*2,['#7e9b8d','#c5a67a','#7894a9','#a97e6f'][b%4]);line(bx,122,6,'#cfbca0');}rect(24,148,110,4,'#dbc5a0');
  rect(28,238,106,44,'#c6ae8c');rect(24,230,114,18,'#dec6a0');line(26,230,110,'#f6e4c1');rect(30,248,3,40,'#a28e72');rect(126,248,3,40,'#a28e72');
  rect(40,204,28,29,'#17242b');rect(43,207,22,13,'#40515a');rect(48,210,10,4,'#98c5ad');rect(50,224,8,8,'#d8cfb2');rect(67,226,8,5,'#d8cfb2');
  rect(92,217,16,13,'#c4bda2');rect(94,219,12,2,'#544739');rect(108,219,4,7,'#c4bda2');
  ctx.fillStyle=officeSceneColor('#71876b',scheme);ctx.font='7px Consolas, monospace';ctx.fillText('COFFEE / RECHARGE',28,307);
  plant(39,hg-40);plant(130,188);plant(606,hg-36);
  rect(24,hg-28,112,4,'#b4c7a6');ctx.fillStyle=officeSceneColor('#778e71',scheme);ctx.font='6px Consolas, monospace';ctx.fillText('TAKE A BREATH.',42,hg-15);
  layout.bikes.forEach(function(bike){drawQuietOfficeBike(ctx,bike.x,bike.y,{scheme:scheme});});
  deskMode=true;
  layout.seats.forEach(function(s){
    var x=s.x,y=s.y;
    // Layered partition, recessed nameplate and steel side returns.
    rect(x-66,y-110,132,86,'#747474');rect(x-64,y-109,128,84,'#b9b9b9');
    rect(x-61,y-106,122,78,'#d4d4d4');line(x-64,y-109,128,'#f6f6f6');
    rect(x-59,y-103,118,18,'#888888');rect(x-58,y-102,116,16,'#eeeeee');
    rect(x-65,y-79,5,60,'#858585');rect(x-64,y-78,2,57,'#e2e2e2');
    rect(x+60,y-79,5,60,'#858585');rect(x+61,y-78,2,57,'#e2e2e2');
    // Desk top perspective, front fascia, steel legs and grounded shadow.
    rect(x-61,y-21,123,16,'#c5c5c5');rect(x-59,y-53,118,29,'#a2a2a2');
    for(var d=0;d<10;d++)rect(x-60+Math.floor(d/3),y-56+d*2,120-Math.floor(d/3)*2,2,'#e8e8e8');
    for(var grain=0;grain<9;grain++)line(x-58,y-54+grain*3,116,'#dedede');
    rect(x-61,y-28,122,4,'#666666');line(x-60,y-28,120,'#f8f8f8');
    rect(x-58,y-24,5,23,'#626262');rect(x+53,y-24,5,23,'#626262');
    rect(x-57,y-23,2,20,'#d7d7d7');rect(x+54,y-23,2,20,'#d7d7d7');
    line(x-59,y-1,7,'#454545');line(x+52,y-1,7,'#454545');
    // Monitor bevel, stand, keyboard keys and mouse, aligned with seated wrists.
    rect(x-27,y-83,54,30,'#333333');rect(x-25,y-81,50,26,'#777777');
    rect(x-23,y-79,46,23,'#292929');line(x-25,y-82,50,'#bcbcbc');
    rect(x-3,y-53,6,7,'#555555');rect(x-10,y-47,20,3,'#787878');
    rect(x-22,y-38,44,9,'#666666');rect(x-21,y-37,42,6,'#dddddd');
    for(var ky=0;ky<2;ky++)for(var k=0;k<10;k++)rect(x-20+k*4,y-36+ky*3,3,2,'#858585');
    rect(x+26,y-36,5,7,'#868686');rect(x+27,y-35,3,4,'#dddddd');
    // Mug at left and stacked notebooks at right, with visible paper edges.
    rect(x-43,y-47,8,10,'#777777');rect(x-42,y-47,6,8,'#f4f4f4');line(x-42,y-48,6,'#686868');
    rect(x-35,y-45,3,5,'#777777');rect(x-35,y-44,2,3,'#eeeeee');
    rect(x+38,y-42,14,3,'#6e6e6e');rect(x+37,y-44,14,2,'#efefef');
    rect(x+36,y-47,14,3,'#858585');rect(x+37,y-46,12,1,'#cccccc');
    drawQuietOfficeChair(ctx,x,y,{scheme:scheme});
  });
}
export function officeActorPose(actor) {
  var walking=actor.path.length>0;
  var atDesk=Math.abs(actor.x-actor.home.x)<1&&Math.abs(actor.y-actor.home.y)<1;
  return {direction:walking?actor.direction:atDesk?1:actor.direction,seated:atDesk&&!walking};
}
export function paintOffice(ctx, layout, room, actors, membersById, images, selectedId, animate, scheme) {
  ctx.clearRect(0,0,layout.width,layout.height);ctx.drawImage(room,0,0);ctx.imageSmoothingEnabled=false;
  actors.slice().sort(function(a,b){return a.y-b.y;}).forEach(function(actor){
    var member=membersById.get(actor.id);if(!member)return;
    var x=Math.round(actor.x),y=Math.round(actor.y),home=actor.home,activity=actor.activity,walking=actor.path.length>0;
    var color=officeTone(member.state,scheme),active=activity==='typing'||activity==='reading',t=animate?actor.time:0;
    ctx.fillStyle=activity==='offline'?'#333333':'#414141';ctx.fillRect(home.x-23,home.y-79,46,23);
    if(activity!=='offline') {ctx.fillStyle=color;for(var j=0;j<4;j++){ctx.globalAlpha=j===0?.85:.45;ctx.fillRect(home.x-17,home.y-76+j*4,8+((j*7+Math.floor((active?t:0)*2))%19),1);}ctx.globalAlpha=1;}
    if(actor.id===selectedId){ctx.strokeStyle=officeSceneColor('#3c8a68',scheme);ctx.lineWidth=1;ctx.strokeRect(home.x-65,home.y-111,130,96);}
    ctx.globalAlpha=.28;ctx.fillStyle=officeSceneColor('#586a4f',scheme);ctx.fillRect(x-10,y-1,20,4);ctx.globalAlpha=activity==='offline'?.55:1;
    var frame=walking?[0,1,2,1][Math.floor(t/.15)%4]:active?(activity==='reading'?5:3)+Math.floor(t/(activity==='reading'?.65:.23))%2:1;
    var pose=officeActorPose(actor);
    var cycling=actor.phase==='break'&&actor.breakKind==='bike';
    if(cycling)drawQuietOfficeCyclist(ctx,x,y,{palette:actor.palette,time:t,animate:animate,scheme:scheme});
    else {drawQuietOfficePerson(ctx,x,y,{palette:actor.palette,direction:pose.direction,frame:frame,seated:pose.seated,scheme:scheme});
      if(pose.seated)drawQuietOfficeChair(ctx,x,y,{scheme:scheme});}
    ctx.globalAlpha=1;
    if(!cycling&&(activity==='approval'||activity==='blocked'||activity==='done'||activity==='starting'||activity==='reading')){
      var bx=x+9,by=y-48+(animate&&activity==='reading'?Math.round(Math.sin(t*1.6)):0);
      ctx.fillStyle='#13242e';ctx.fillRect(bx-1,by-10,23,15);ctx.fillStyle=color;ctx.fillRect(bx,by-9,21,13);ctx.fillRect(bx+3,by+4,4,3);
      ctx.fillStyle=scheme==='dark'?'#192c32':'#ffffff';ctx.font='bold 9px Consolas,monospace';ctx.textAlign='center';ctx.fillText(activity==='approval'?'?':activity==='blocked'?'!':activity==='done'?'OK':activity==='starting'?'+':'···',bx+10,by+1);ctx.textAlign='left';
    }
    if(actor.phase==='break'&&actor.breakKind!=='bike') {ctx.fillStyle='#e0c69b';ctx.fillRect(x+9,y-21,5,6);ctx.fillRect(x+14,y-20,2,3);}
  });
}
