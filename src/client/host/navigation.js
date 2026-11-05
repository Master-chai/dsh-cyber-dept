let runtimeBinding = null;

/** Bind navigation to one host lifetime; an old disposer cannot clear a newer host. */
export function setRuntimeContext(ctx) {
	if (runtimeBinding) release(runtimeBinding);
	if (!ctx) return function () {};
	const binding = { ctx, active: true, timers: new Set(), navigation: 0 };
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
	binding.navigation++;
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

function service(ctx, name) {
	return ctx[name] || (typeof ctx.get === 'function' ? ctx.get(name) : null);
}

/** Return the explicit host address when available, without inventing parentage. */
export function nativeSessionTarget(seat) {
	if (!seat) return null;
	if (seat.nativeTarget) return seat.nativeTarget;
	if (seat.parentSessionId && seat.id && seat.parentSessionId !== seat.id) {
		return {parentSessionId:seat.parentSessionId,childSessionId:seat.id,mode:seat.mode || 'unknown'};
	}
	return seat.id || null;
}

function validTarget(target) {
	if (typeof target === 'string') return target.length > 0;
	return !!target && typeof target.parentSessionId === 'string' && !!target.parentSessionId &&
		typeof target.childSessionId === 'string' && !!target.childSessionId &&
		['continuable','one-shot','unknown'].includes(target.mode);
}

/**
 * DSH uiWorkspace owns Session retention and Conversation selection. Do not
 * selectPanel later: that used to override a newer user navigation. Report
 * refused navigation to the caller instead of silently discarding it.
 */
export async function openNativeSession(target,{signal}={}) {
	if (signal?.aborted) return {ok:false,cancelled:true};
	const binding = runtimeBinding;
	if (!binding || !binding.active) return {ok:false,error:'原生会话导航尚未就绪，请刷新插件后重试。'};
	if (!validTarget(target)) return {ok:false,error:'缺少有效的原生会话地址，请刷新团队状态后重试。'};
	const attempt = ++binding.navigation;
	try {
		const ui = service(binding.ctx, 'uiWorkspace');
		if (!ui || typeof ui.openSession !== 'function') throw new Error('当前 DSH 未提供 uiWorkspace.openSession');
		const sessions = service(binding.ctx, 'sessions');
		const origin = binding.ctx.sidebarRight?.mounted?.getSnapshot?.();
		const panel = binding.ctx.layout?.panelInfo?.getSnapshot?.().activePanelId;
		let resolved = typeof target === 'string' ? sessions?.subagentAddress?.(target) || target : target;
		// The office snapshot can arrive before the native Session list. A single
		// read-only refresh repairs that race; never retry a failed open itself.
		const list = sessions?.list?.getSnapshot?.();
		if (typeof resolved === 'string' && list && !list.byId?.[resolved] && typeof sessions.refresh === 'function') {
			await sessions.refresh();
			if (origin !== binding.ctx.sidebarRight?.mounted?.getSnapshot?.() || panel !== binding.ctx.layout?.panelInfo?.getSnapshot?.().activePanelId) return {ok:false,cancelled:true};
			resolved = sessions.subagentAddress?.(resolved) || resolved;
		}
		if (signal?.aborted || !binding.active || runtimeBinding !== binding || attempt !== binding.navigation) return {ok:false,cancelled:true};
		await ui.openSession(resolved);
		return {ok:true};
	} catch (error) {
		if (signal?.aborted || !binding.active || runtimeBinding !== binding || attempt !== binding.navigation) return {ok:false,cancelled:true};
		const reason = error instanceof Error ? error.message : String(error);
		return {ok:false,error:'无法打开原生会话：'+reason+'。请在 DSH 原生会话列表或子代理目录中核对该成员后重试。'};
	}
}
