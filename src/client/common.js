// Shared display vocabulary and pure value helpers. No host state or React.
export { PLUGIN_ID } from "../shared/contract.js";
export const PANEL_ID = "cyber-dept";

export const MAX_SEATS = 24;

export const EMPTY_SESSIONS = { ids: [], byId: {}, phase: "ready", projectionsBySession: {} };

export const EMPTY_FLOORS = [];

export const STATE_LABEL = {
	offline: "离线",
	provisioning: "启动中",
	idle: "空闲",
	thinking: "思考中",
	streaming: "输出中",
	"tool-running": "执行工具",
	"waiting-approval": "等待审批",
	blocked: "阻塞",
	done: "完成",
	error: "错误",
};

export const ACTIVE_STATES = {
	thinking: true,
	streaming: true,
	"tool-running": true,
	"waiting-approval": true,
	blocked: true,
};

export const ROLE_LABEL = { lead: "负责人", teammate: "成员", subagent: "子代理", session: "会话" };

export const TASK_STATUS_LABEL = {
	pending: "待办",
	in_progress: "进行中",
	completed: "完成",
	deleted: "已删除",
};

export const STATE_ALIAS = {
	offline: "offline",
	disconnected: "offline",
	cold: "offline",
	dormant: "offline",
	unavailable: "offline",
	provisioning: "provisioning",
	starting: "provisioning",
	spawning: "provisioning",
	idle: "idle",
	ready: "idle",
	inactive: "offline",
	thinking: "thinking",
	running: "thinking",
	working: "thinking",
	active: "thinking",
	busy: "thinking",
	streaming: "streaming",
	writing: "streaming",
	responding: "streaming",
	"tool-running": "tool-running",
	tool: "tool-running",
	tooling: "tool-running",
	"calling-tool": "tool-running",
	"waiting-approval": "waiting-approval",
	approval: "waiting-approval",
	"pending-approval": "waiting-approval",
	"waiting-for-approval": "waiting-approval",
	blocked: "blocked",
	done: "done",
	completed: "done",
	complete: "done",
	finished: "done",
	error: "error",
	failed: "error",
	failure: "error",
};

export function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function asArray(value) {
	return Array.isArray(value) ? value : [];
}

export function text(value) {
	return typeof value === "string" && value.length > 0 ? value : "";
}

export function numberOr(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function clampText(value, max) {
	var source = value === undefined || value === null ? "" : String(value);
	return source.length > max ? source.slice(0, max - 1) + "…" : source;
}

export function errorText(error) {
	if (error === undefined || error === null) return "未知错误";
	if (typeof error === "string") return error;
	if (typeof error.message === "string" && error.message) return error.message;
	return String(error);
}

export function formatClock(timestamp) {
	if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0) return "—";
	try {
		return new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false });
	} catch (error) {
		return "—";
	}
}

export function initialsOf(name) {
	var value = text(name) || "?";
	if (/^[A-Za-z0-9 ._-]+$/.test(value)) {
		var words = value.split(/[ ._-]+/).filter(Boolean);
		if (words.length >= 2) return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
		return value.slice(0, 2).toUpperCase();
	}
	var characters = Array.from(value);
	if (characters.length <= 1) return characters.join("").toUpperCase();
	return characters.slice(0, 2).join("");
}

export function labelOf(state) {
	return STATE_LABEL[state] || "未知";
}

export function roleLabelOf(role) {
	return ROLE_LABEL[role] || "成员";
}

export function taskStatusLabel(status) {
	return TASK_STATUS_LABEL[status] || "待办";
}

export function isTaskBlocked(task) { return !!task && task.status === "pending" && task.ready === false; }

export function isActiveState(state) {
	return ACTIVE_STATES[state] === true;
}

export function normalizeState(value) {
	if (typeof value !== "string") return null;
	var key = value.toLowerCase().replace(/[_\s]+/g, "-");
	return STATE_ALIAS[key] || null;
}
