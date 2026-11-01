let runtimeBinding = null;

/** Bind navigation to one host lifetime; an old disposer cannot clear a newer host. */
export function setRuntimeContext(ctx) {
	if (runtimeBinding) release(runtimeBinding);
	if (!ctx) return function () {};
	const binding = { ctx, active: true, timers: new Set() };
	runtimeBinding = binding;
	return function () { release(binding); };
}

function release(binding) {
	binding.active = false;
	for (const timer of binding.timers) clearTimeout(timer);
	binding.timers.clear();
	if (runtimeBinding === binding) runtimeBinding = null;
}

function schedule(binding, callback, delay) {
	if (!binding.active || runtimeBinding !== binding) return;
	const timer = setTimeout(function () {
		binding.timers.delete(timer);
		// Cancellation may race with an already queued callback.
		if (binding.active && runtimeBinding === binding) callback();
	}, delay);
	binding.timers.add(timer);
}

export function openRightOffice(sessionId) {
	const binding = runtimeBinding;
	if (!binding) return;
	const runtimeCtx = binding.ctx;
	if (sessionId) runtimeCtx.uiWorkspace.openSession(sessionId);
	runtimeCtx.layout.selectPanel(null);
	var sidebar = runtimeCtx.sidebarRight;
	var expected = sessionId || sidebar.mounted.getSnapshot();
	var attempts = 0;
	function open() {
		// Do not open into a different chat if the user navigates during mounting.
		if (!expected || sidebar.mounted.getSnapshot() !== expected) return;
		try { sidebar.openTab("cyberdept"); }
		catch (error) { if (++attempts < 10) schedule(binding, open, 50); else console.warn("Cyber IT sidebar could not open", error); }
	}
	schedule(binding, open, 0);
}

export function openNativeSession(sessionId) {
	try {
		const binding = runtimeBinding;
		if (!binding || !sessionId) return;
		const runtimeCtx = binding.ctx;
		var ui = runtimeCtx.uiWorkspace || (typeof runtimeCtx.get === "function" ? runtimeCtx.get("uiWorkspace") : null);
		var layout = runtimeCtx.layout || (typeof runtimeCtx.get === "function" ? runtimeCtx.get("layout") : null);
		if (ui && typeof ui.openSession === "function") ui.openSession(sessionId);
		if (layout && typeof layout.selectPanel === "function") {
			schedule(binding, function () { try { layout.selectPanel(null); } catch (e) {} }, 140);
		}
	} catch (e) {}
}
