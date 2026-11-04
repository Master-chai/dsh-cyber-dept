/** Pixel room with oak cubicles; DOM name badges attach to the rear partitions. */
import { officeSceneColor } from '../office-theme.js';

export function officeTone(state, scheme) {
  var color = state === 'waiting-approval' ? '#a56718' : state === 'error' || state === 'blocked' ? '#be4c46' : state === 'done' ? '#4c8256' : ['thinking','streaming','tool-running','provisioning'].indexOf(state) >= 0 ? '#2c896b' : '#758477';
  return officeSceneColor(color, scheme);
}
export function drawOfficeRoom(ctx, layout, scheme) {
  var w=layout.width,hg=layout.height;
  function rect(x,y,w,h,c){ctx.fillStyle=officeSceneColor(c,scheme);ctx.fillRect(x,y,w,h);}
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
  layout.seats.forEach(function(s){
    var x=s.x,y=s.y;
    // Low upholstered rear wall and side returns make each desk a cubicle.
    rect(x-64,y-110,128,88,'#9fb49b');rect(x-61,y-107,122,80,'#bacab3');
    line(x-63,y-110,126,'#e8eee0');line(x-59,y-84,118,'#a6bdb5');
    rect(x-64,y-80,4,64,'#9fb49b');rect(x+60,y-80,4,64,'#9fb49b');
    rect(x-60,y-52,120,40,'#b6c3a9');rect(x-60,y-58,120,29,'#e2cba4');
    line(x-59,y-58,118,'#f7e7c9');rect(x-60,y-29,120,6,'#bda680');
    rect(x-57,y-23,4,14,'#aa9677');rect(x+53,y-23,4,14,'#aa9677');
    rect(x-24,y-83,43,27,'#15222b');rect(x-21,y-80,37,21,'#2c444d');rect(x-4,y-56,4,5,'#23313a');rect(x-10,y-51,17,3,'#344650');
    rect(x-22,y-44,31,9,'#5d6b69');for(var k=0;k<6;k++)rect(x-20+k*5,y-42,3,2,'#a9b3a8');rect(x+15,y-42,5,7,'#c1c4b1');
    rect(x+29,y-52,7,8,'#e0c69b');rect(x+35,y-50,3,4,'#e0c69b');rect(x-34,y-51,8,9,'#809c95');
    rect(x-11,y-20,23,26,'#18252e');rect(x-13,y-18,27,9,'#88a899');line(x-11,y-17,23,'#b7c9b5');rect(x-9,y-7,19,10,'#6e9585');rect(x-1,y+4,3,5,'#15232c');rect(x-11,y+8,23,2,'#15232c');
  });
}
export function paintOffice(ctx, layout, room, actors, membersById, images, selectedId, animate, scheme) {
  ctx.clearRect(0,0,layout.width,layout.height);ctx.drawImage(room,0,0);ctx.imageSmoothingEnabled=false;
  actors.slice().sort(function(a,b){return a.y-b.y;}).forEach(function(actor){
    var member=membersById.get(actor.id);if(!member)return;
    var x=Math.round(actor.x),y=Math.round(actor.y),home=actor.home,activity=actor.activity,walking=actor.path.length>0;
    var color=officeTone(member.state,scheme),active=activity==='typing'||activity==='reading',t=animate?actor.time:0;
    ctx.fillStyle=activity==='offline'?'#24343d':'#244b4d';ctx.fillRect(home.x-20,home.y-79,35,19);
    if(activity!=='offline') {ctx.fillStyle=color;for(var j=0;j<4;j++){ctx.globalAlpha=j===0?.85:.45;ctx.fillRect(home.x-17,home.y-76+j*4,8+((j*7+Math.floor((active?t:0)*2))%19),1);}ctx.globalAlpha=1;}
    if(actor.id===selectedId){ctx.strokeStyle=officeSceneColor('#3c8a68',scheme);ctx.lineWidth=1;ctx.strokeRect(home.x-65,home.y-111,130,96);}
    ctx.globalAlpha=.28;ctx.fillStyle=officeSceneColor('#586a4f',scheme);ctx.fillRect(x-10,y-1,20,4);ctx.globalAlpha=activity==='offline'?.55:1;
    var frame=walking?[0,1,2,1][Math.floor(t/.15)%4]:active?(activity==='reading'?5:3)+Math.floor(t/(activity==='reading'?.65:.23))%2:1;
    var atDesk = Math.abs(actor.x - home.x) < 1 && Math.abs(actor.y - home.y) < 1;
    var dir=walking?actor.direction:atDesk?1:actor.direction,row=dir===3?2:dir;
    ctx.save();ctx.translate(x,y);if(dir===3)ctx.scale(-1,1);
    if(images[actor.palette])ctx.drawImage(images[actor.palette],frame*16,row*32,16,32,-12,-42,24,48);
    ctx.restore();ctx.globalAlpha=1;
    if(activity==='approval'||activity==='blocked'||activity==='done'||activity==='starting'||activity==='reading'){
      var bx=x+9,by=y-48+(animate&&activity==='reading'?Math.round(Math.sin(t*1.6)):0);
      ctx.fillStyle='#13242e';ctx.fillRect(bx-1,by-10,23,15);ctx.fillStyle=color;ctx.fillRect(bx,by-9,21,13);ctx.fillRect(bx+3,by+4,4,3);
      ctx.fillStyle=scheme==='dark'?'#192c32':'#ffffff';ctx.font='bold 9px Consolas,monospace';ctx.textAlign='center';ctx.fillText(activity==='approval'?'?':activity==='blocked'?'!':activity==='done'?'OK':activity==='starting'?'+':'···',bx+10,by+1);ctx.textAlign='left';
    }
    if(actor.phase==='break') {ctx.fillStyle='#e0c69b';ctx.fillRect(x+9,y-21,5,6);ctx.fillRect(x+14,y-20,2,3);}
  });
}
