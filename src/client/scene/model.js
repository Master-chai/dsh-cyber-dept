import { quietOfficeCoffeePose, QUIET_COFFEE_TIMING } from './quiet-office-coffee.js';
import { quietOfficeBenchPose, QUIET_BENCH_TIMING } from './quiet-office-bench.js';

/** Pure scene model. DSH state is input; movement never writes task state. */
export function officeHash(value) {
  var hash = 2166136261;
  for (var i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}
export function sceneActivity(member) {
  if (member.live === false || member.state === 'offline' || member.state === 'inactive') return 'offline';
  if (member.state === 'waiting-approval') return 'approval';
  if (member.state === 'blocked' || member.state === 'error') return 'blocked';
  if (member.state === 'provisioning') return 'starting';
  if (member.state === 'thinking') return 'reading';
  if (member.state === 'streaming') return 'typing';
  if (member.state === 'tool-running') {
    return /read|search|find|list|query|browse|fetch/i.test(member.tool && member.tool.name || '') ? 'reading' : 'typing';
  }
  if (member.state === 'done') return 'done';
  return member.state === 'idle' ? 'idle' : 'offline';
}
/** Presentation never promotes offline/turn-end to a completed task. */
export function officeRestState(member) {
  var facts=member.stateFacts||{},activity=facts.activity||member.state;
  var urgent=['waiting-approval','blocked','error','provisioning','thinking','streaming','tool-running'];
  if((member.officeRuntimeFacts&&(member.officeRuntimeFacts.running||member.officeRuntimeFacts.waitingApproval))||member.approval||member.error||member.phase==='failed'||member.phase==='provisioning'||
    urgent.includes(member.state)||urgent.includes(activity))return 'none';
  var taskFacts=member.officeTaskFacts||{};
  var unfinished=taskFacts.unfinishedCount>0||(member.task&&member.task.status!=='completed'&&member.task.status!=='deleted');
  var offline=member.live===false||member.state==='offline'||member.state==='inactive';
  if(taskFacts.completed===true&&!unfinished)return 'completed';
  if(offline)return unfinished?'waiting':'offline';
  return member.state==='idle'||member.state==='done'?'idle':'none';
}
export function officeSceneSignal(member) {
  // Completion/assignment can change without a runtime state change. Wake the
  // same engine instead of rebuilding actors or keeping a stale paused frame.
  return [member.id,member.state,member.live,member.tool&&member.tool.name,officeRestState(member)].join(':');
}
export function officeNeedsFrames(members, actors, mode, reduced) {
  if (mode === 'off' || reduced) return false;
  return actors.some(function(actor){return actor.path.length > 0 || (actor.phase==='break'&&['bench','coffee'].includes(actor.breakKind));}) || members.some(function(member){
    var activity=sceneActivity(member);
    return activity==='typing'||activity==='reading'||(officeRestState(member)!=='none'&&mode==='lively');
  });
}
export function createOfficeLayout(members) {
  var rows = Math.max(2, Math.ceil(members.length / 3));
  var layout = { width: 640, height: Math.max(608, 128 * rows + 240), seats: [], occupied: new Set(), blocked: new Set() };
  members.forEach(function (member, index) {
    layout.seats.push({ id: member.id, x: 216 + (index % 3) * 160, y: 184 + Math.floor(index / 3) * 128, index: index });
  });
  layout.seats.forEach(function(seat){for(var dx=-1;dx<=1;dx++)layout.occupied.add((Math.floor(seat.x/16)+dx)+','+Math.floor(seat.y/16));});
  var rowCount = Math.ceil(layout.height / 16);
  for (var y = 0; y < rowCount; y++) for (var x = 0; x < 40; x++) {
    var px = x * 16 + 8, py = y * 16 + 8;
    var wall = x < 1 || x > 38 || py < 104 || py > layout.height - 20;
    var furniture = (px < 144 && py < 176) || (px < 88 && py > 220 && py < 304);
    var desk = layout.seats.some(function (seat) {
      var dx=Math.abs(px-seat.x);
      return dx < 64 && py >= seat.y-110 && py < seat.y-16;
    });
    if (wall || furniture || desk) layout.blocked.add(x + ',' + y);
  }
  layout.bikes = [
    { id:'bike-1', x:88, y:392, owner:null },
    { id:'bike-2', x:88, y:504, owner:null },
  ];
  // Separate mats and approach aisles keep both riders clear of desks and each other.
  layout.bikes.forEach(function(bike){
    var row = Math.floor(bike.y / 16);
    for(var bx=3;bx<=7;bx++)for(var by=row-1;by<=row;by++)layout.occupied.add(bx+','+by);
  });
  layout.coffee={id:'coffee-1',x:104,y:264,owner:null};
  layout.benches = [
    { id:'bench-1', x:280, y:layout.height-56, owner:null },
    { id:'bench-2', x:488, y:layout.height-56, owner:null },
  ];
  layout.benches.forEach(function(bench){
    bench.approach={x:bench.x+48,y:bench.y};
    var row=Math.floor(bench.y/16),column=Math.floor(bench.x/16);
    for(var bx=column-4;bx<=column+1;bx++)for(var by=row-1;by<=row;by++)layout.occupied.add(bx+','+by);
  });
  return layout;
}
export function findOfficePath(layout, from, to) {
  var sx = Math.floor(from.x / 16), sy = Math.floor(from.y / 16), tx = Math.floor(to.x / 16), ty = Math.floor(to.y / 16);
  var start = sx + ',' + sy, target = tx + ',' + ty;
  if (start === target) return [{ x: to.x, y: to.y }];
  var queue = [[sx, sy]], previous = new Map([[start, null]]), found = false;
  for (var i = 0; i < queue.length && !found; i++) {
    var cell = queue[i];
    [[1,0],[0,1],[-1,0],[0,-1]].forEach(function (delta) {
      var x = cell[0]+delta[0], y = cell[1]+delta[1], key = x+','+y;
      if (x < 0 || x >= 40 || y < 0 || y >= Math.ceil(layout.height/16) || previous.has(key) || layout.blocked.has(key) || (key !== target && layout.occupied.has(key))) return;
      previous.set(key, cell[0]+','+cell[1]); queue.push([x,y]); if (key === target) found = true;
    });
  }
  if (!found) return [];
  var path = [], current = target;
  while (current !== start) { var xy=current.split(',').map(Number); path.push({x:xy[0]*16+8,y:xy[1]*16+8}); current=previous.get(current); }
  path.reverse();
  // Complete the current cell before turning. Prevents diagonal cuts through furniture.
  var center = {x:sx*16+8,y:sy*16+8};
  if (Math.abs(from.x-center.x)+Math.abs(from.y-center.y)>0.1) path.unshift(center);
  return path;
}
export function createOfficeActor(member, home) {
  var seed = officeHash(member.id);
  return { id:member.id, x:home.x, y:home.y, home:home, palette:seed%6, direction:0, path:[], activity:sceneActivity(member), phase:'desk', time:seed%7, wait:9+seed%15, seed:seed,breakKind:null,bikeId:null,benchId:null,benchTime:0,benchExit:null,coffeeTime:0,coffeeExit:null,coffeeId:null,breakCount:0 };
}
export function releaseOfficeBike(actor, layout) {
  layout.bikes.forEach(function(bike){if(bike.owner===actor.id)bike.owner=null;});
  actor.bikeId=null;
}
export function releaseOfficeBench(actor, layout) {
  layout.benches.forEach(function(bench){if(bench.owner===actor.id)bench.owner=null;});
  actor.benchId=null;actor.benchExit=null;
}
export function releaseOfficeCoffee(actor, layout) {
  if(layout.coffee.owner===actor.id)layout.coffee.owner=null;
  actor.coffeeId=null;actor.coffeeExit=null;
}
export function releaseOfficeEquipment(actor, layout) {
  releaseOfficeBike(actor,layout);releaseOfficeBench(actor,layout);releaseOfficeCoffee(actor,layout);
}
export function stepOfficeActor(actor, member, layout, dt, mode) {
  var activity = sceneActivity(member), previousActivity=actor.activity;
  actor.activity=activity;
  var reservedBike=layout.bikes.find(function(bike){return bike.owner===actor.id;});
  // Keep ownership until the departing actor clears their own mat, not the other bike.
  if(reservedBike&&actor.phase==='return'&&Math.hypot(actor.x-reservedBike.x,actor.y-reservedBike.y)>54)releaseOfficeBike(actor,layout);

  var reservedBench=layout.benches.find(function(bench){return bench.owner===actor.id;});
  if(reservedBench&&actor.phase==='return'&&(Math.abs(actor.x-reservedBench.x)>94||Math.abs(actor.y-reservedBench.y)>40))releaseOfficeBench(actor,layout);

  if(layout.coffee.owner===actor.id&&actor.phase==='return'&&Math.hypot(actor.x-layout.coffee.x,actor.y-layout.coffee.y)>44)releaseOfficeCoffee(actor,layout);
  actor.time += dt;
  var rest=officeRestState(member),canBreak=rest!=='none';
  var away = Math.abs(actor.x-actor.home.x)+Math.abs(actor.y-actor.home.y)>0.2;
  var recall=!canBreak||mode==='calm'||(rest==='waiting'&&actor.breakKind!=='phone');
  if(actor.phase==='break'&&actor.breakKind==='coffee'&&actor.coffeeId){
    if(recall&&!actor.coffeeExit)actor.coffeeExit={time:0,from:quietOfficeCoffeePose({time:actor.coffeeTime})};
    if(actor.coffeeExit)actor.coffeeExit.time+=dt;else actor.coffeeTime+=dt;
    var coffeeFinished=actor.coffeeExit?actor.coffeeExit.time>=QUIET_COFFEE_TIMING.exitDuration:actor.coffeeTime>=QUIET_COFFEE_TIMING.duration;
    if(!coffeeFinished)return;
    actor.path=findOfficePath(layout,actor,actor.home);actor.phase='return';
  }
  if(actor.phase==='break'&&actor.breakKind==='bench'){
    if(recall&&!actor.benchExit)actor.benchExit={time:0,from:quietOfficeBenchPose({time:actor.benchTime})};
    if(actor.benchExit)actor.benchExit.time+=dt;else actor.benchTime+=dt;
    var finished=actor.benchExit?actor.benchExit.time>=(actor.benchExit.from.loaded?QUIET_BENCH_TIMING.exitDuration:1.2):actor.benchTime>=QUIET_BENCH_TIMING.duration;
    if(!finished)return;
    actor.path=findOfficePath(layout,actor,actor.home);actor.phase='return';
  }
  if ((!canBreak || mode === 'calm' || (rest==='waiting'&&actor.breakKind!=='phone')) && (actor.phase === 'break' || actor.phase === 'out')) {
    actor.path=findOfficePath(layout,actor,actor.home);actor.phase='return';
  }
  if (previousActivity !== activity && !away) actor.wait=9+actor.seed%15;
  if (actor.path.length) {
    var target=actor.path[0],dx=target.x-actor.x,dy=target.y-actor.y,d=Math.hypot(dx,dy),step=Math.min(d,dt*38);
    actor.direction=Math.abs(dx)>Math.abs(dy)?(dx<0?3:2):(dy<0?1:0);
    if (d<=step+0.001) {actor.x=target.x;actor.y=target.y;actor.path.shift();}
    else {actor.x+=dx/d*step;actor.y+=dy/d*step;}
    if (!actor.path.length) {actor.phase=actor.phase==='out'?'break':'desk';actor.wait=actor.phase==='break'?4+actor.seed%4:12+actor.seed%17;actor.direction=0;if(actor.phase==='break'&&actor.breakKind==='bench'){actor.benchTime=0;actor.benchExit=null;}if(actor.phase==='break'&&actor.breakKind==='coffee'){actor.coffeeTime=0;actor.coffeeExit=null;}if(actor.phase==='desk'){actor.breakKind=null;releaseOfficeEquipment(actor,layout);}}
  } else if (canBreak && mode === 'lively' && dt > 0) {
    actor.wait-=dt;
    if (actor.wait<=0 && actor.phase==='desk') {
      // Stable, staggered rotation gives every resting actor all five activities.
      // Unfinished offline work permits only desk standby, never a completion badge.
      var kind=rest==='waiting'?'phone':['bike','coffee','walk','phone','bench'][(actor.seed%2+actor.breakCount)%5];
      var bike=kind==='bike'?layout.bikes.find(function(spot){return spot.owner===null;}):null;
      var bench=kind==='bench'?layout.benches.find(function(spot){return spot.owner===null;}):null;
      if((kind==='bike'&&!bike)||(kind==='bench'&&!bench))kind='coffee';
      if(kind==='coffee'&&layout.coffee.owner!==null)kind='walk';
      actor.breakCount++;
      if(kind==='phone'){
        actor.breakKind='phone';actor.phase='break';actor.wait=7+actor.seed%5;
      }else{
        var target=bike||(bench&&bench.approach)||(kind==='walk'?{x:[168,312,472,600][actor.seed%4],y:layout.height-152}:layout.coffee);
        actor.path=findOfficePath(layout,actor,target);actor.phase=actor.path.length?'out':'desk';actor.wait=15;
        if(actor.path.length){actor.breakKind=kind;if(bike){bike.owner=actor.id;actor.bikeId=bike.id;}if(bench){bench.owner=actor.id;actor.benchId=bench.id;}if(kind==='coffee'){layout.coffee.owner=actor.id;actor.coffeeId=layout.coffee.id;}}
      }
    } else if (actor.wait<=0 && actor.phase==='break') {
      if(actor.breakKind==='phone'){actor.phase='desk';actor.breakKind=null;actor.wait=12+actor.seed%17;}
      else {actor.path=findOfficePath(layout,actor,actor.home);actor.phase='return';}
    }
  }
}
