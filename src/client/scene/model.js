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
export function officeNeedsFrames(members, actors, mode, reduced) {
  if (mode === 'off' || reduced) return false;
  return actors.some(function(actor){return actor.path.length > 0;}) || members.some(function(member){
    var activity=sceneActivity(member);
    return activity==='typing'||activity==='reading'||(activity==='idle'&&mode==='lively');
  });
}
export function createOfficeLayout(members) {
  var rows = Math.max(2, Math.ceil(members.length / 3));
  var layout = { width: 640, height: Math.max(384, 128 * rows + 136), seats: [], occupied: new Set(), blocked: new Set() };
  members.forEach(function (member, index) {
    layout.seats.push({ id: member.id, x: 216 + (index % 3) * 144, y: 168 + Math.floor(index / 3) * 128, index: index });
  });
  layout.seats.forEach(function(seat){for(var dx=-1;dx<=1;dx++)layout.occupied.add((Math.floor(seat.x/16)+dx)+','+Math.floor(seat.y/16));});
  var rowCount = Math.ceil(layout.height / 16);
  for (var y = 0; y < rowCount; y++) for (var x = 0; x < 40; x++) {
    var px = x * 16 + 8, py = y * 16 + 8;
    var wall = x < 1 || x > 38 || py < 104 || py > layout.height - 20;
    var furniture = px < 144 && (py < 176 || (py > 220 && py < 304));
    var desk = layout.seats.some(function (seat) { return Math.abs(px-seat.x) < 48 && py >= seat.y-64 && py < seat.y-16; });
    if (wall || furniture || desk) layout.blocked.add(x + ',' + y);
  }
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
  return { id:member.id, x:home.x, y:home.y, home:home, palette:seed%6, direction:0, path:[], activity:sceneActivity(member), phase:'desk', time:seed%7, wait:9+seed%15, seed:seed };
}
export function stepOfficeActor(actor, member, layout, dt, mode) {
  var activity = sceneActivity(member), previousActivity=actor.activity;
  actor.activity=activity;
  if (activity === 'offline') { actor.x=actor.home.x;actor.y=actor.home.y;actor.path=[];actor.phase='desk';actor.time=0;return; }
  actor.time += dt;
  var canBreak = activity === 'idle';
  var away = Math.abs(actor.x-actor.home.x)+Math.abs(actor.y-actor.home.y)>0.2;
  if ((!canBreak || mode === 'calm') && (actor.phase === 'break' || actor.phase === 'out')) {
    actor.path=findOfficePath(layout,actor,actor.home);actor.phase='return';
  }
  if (previousActivity !== activity && !away) actor.wait=9+actor.seed%15;
  if (actor.path.length) {
    var target=actor.path[0],dx=target.x-actor.x,dy=target.y-actor.y,d=Math.hypot(dx,dy),step=Math.min(d,dt*38);
    actor.direction=Math.abs(dx)>Math.abs(dy)?(dx<0?3:2):(dy<0?1:0);
    if (d<=step+0.001) {actor.x=target.x;actor.y=target.y;actor.path.shift();}
    else {actor.x+=dx/d*step;actor.y+=dy/d*step;}
    if (!actor.path.length) {actor.phase=actor.phase==='out'?'break':'desk';actor.wait=actor.phase==='break'?4+actor.seed%4:12+actor.seed%17;actor.direction=0;}
  } else if (canBreak && mode === 'lively') {
    actor.wait-=dt;
    if (actor.wait<=0 && actor.phase==='desk') {
      // Stay in clear aisles. Separate resting spots avoid crowding the coffee counter.
      var target={x:56+(actor.seed%5)*16,y:200};
      actor.path=findOfficePath(layout,actor,target);actor.phase=actor.path.length?'out':'desk';actor.wait=15;
    } else if (actor.wait<=0 && actor.phase==='break') {actor.path=findOfficePath(layout,actor,actor.home);actor.phase='return';}
  }
}
