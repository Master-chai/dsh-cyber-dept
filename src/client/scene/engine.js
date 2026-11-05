/**
 * A canvas owns one clock and one RAF subscription. React supplies current
 * presentation data without replacing actor identity or resetting elapsed time.
 * The environment seam permits deterministic clock/visibility lifecycle tests.
 */
import { createOfficeActor, stepOfficeActor, officeNeedsFrames } from './model.js';
import { drawOfficeRoom, paintOffice } from './drawing.js';

export function createOfficeEngine({ canvas, layout, getCurrent, environment }) {
  const env = environment || {
    document,
    now: () => performance.now(),
    requestFrame: callback => requestAnimationFrame(callback),
    cancelFrame: id => cancelAnimationFrame(id),
    Observer: typeof IntersectionObserver === 'function' ? IntersectionObserver : null,
  };
  const ctx = canvas.getContext('2d');
  const room = env.document.createElement('canvas');
  room.width = layout.width;
  room.height = layout.height;
  let roomScheme = getCurrent().scheme;
  drawOfficeRoom(room.getContext('2d'), layout, roomScheme);
  const actors = getCurrent().members.map((member, index) => createOfficeActor(member, layout.seats[index]));
  let disposed = false, raf = 0, last = 0, visible = true, lastPaint = 0;

  function render(now) {
    if (disposed) return;
    const current = getCurrent();
    const byId = new Map(current.members.map(member => [member.id, member]));
    const animate = current.active && current.mode !== 'off' && !current.reduced;
    const dt = last ? Math.min((now - last) / 1000, .08) : 0;
    last = now;
    actors.forEach(actor => {
      const member = byId.get(actor.id);
      if (member) stepOfficeActor(actor, member, layout, animate ? dt : 0, current.mode);
    });
    paintOffice(ctx, layout, room, actors, byId, [], current.selectedId, animate, current.scheme);
    canvas.dataset.actorCount = String(actors.length);
    canvas.dataset.motion = current.active && officeNeedsFrames(current.members, actors, current.mode, current.reduced) ? 'running' : 'paused';
  }

  function tick(now) {
    raf = 0;
    if (disposed || env.document.hidden || !visible || !getCurrent().active) return;
    const current = getCurrent();
    if (now - lastPaint >= 1000 / 30) { render(now); lastPaint = now; }
    if (officeNeedsFrames(current.members, actors, current.mode, current.reduced)) raf = env.requestFrame(tick);
  }

  function wake(resetClock) {
    if (disposed) return;
    if (resetClock === true) last = 0;
    if (env.document.hidden || !visible || !getCurrent().visible) {
      env.cancelFrame(raf); raf = 0; last = 0; return;
    }
    if (roomScheme !== getCurrent().scheme) {
      roomScheme = getCurrent().scheme;
      drawOfficeRoom(room.getContext('2d'), layout, roomScheme);
    }
    render(env.now());
    const current = getCurrent();
    if (current.active && officeNeedsFrames(current.members, actors, current.mode, current.reduced)) {
      if (!raf) raf = env.requestFrame(tick);
    } else { env.cancelFrame(raf); raf = 0; }
  }

  function visibilityChanged() { wake(true); }
  const observer = env.Observer ? new env.Observer(entries => {
    visible = entries[0].isIntersecting;
    wake(true);
  }) : null;
  if (observer) observer.observe(canvas);
  env.document.addEventListener('visibilitychange', visibilityChanged);
  wake();

  return {
    actors, render, wake,
    dispose() {
      disposed = true;
      env.cancelFrame(raf); raf = 0;
      if (observer) observer.disconnect();
      env.document.removeEventListener('visibilitychange', visibilityChanged);
    },
  };
}
