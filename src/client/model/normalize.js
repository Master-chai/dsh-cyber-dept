// Host/version compatibility is contained at this input boundary.
import { isObject, text, asArray, numberOr, normalizeState, TASK_STATUS_LABEL, errorText } from "../common.js";

export function normalizeTool(value) {
	if (typeof value === "string") return { name: value, summary: "" };
	if (!isObject(value)) return null;
	var name = text(value.name) || text(value.toolName) || text(value.tool);
	if (!name) return null;
	return {
		name: name,
		summary: text(value.summary) || text(value.detail) || text(value.argumentSummary) || "",
		callId: text(value.callId) || "",
	};
}

export function normalizeApproval(value) {
	if (!isObject(value)) return null;
	var toolName = text(value.toolName) || text(value.name) || text(value.tool);
	if (!toolName) return null;
	return {
		id: text(value.id) || text(value.key) || "",
		toolName: toolName,
		reason: text(value.reason) || text(value.displayReason) || "",
		answerable: value.answerable !== false,
	};
}

export function normalizeTaskRef(value) {
	if (!isObject(value)) return null;
	var id = text(value.id);
	var subject = text(value.subject) || text(value.title);
	if (!id && !subject) return null;
	var status = text(value.status);
	return {
		id: id,
		revision: numberOr(value.revision, 0),
		subject: subject || id,
		status: TASK_STATUS_LABEL[status] ? status : "pending",
		ready: typeof value.ready === "boolean" ? value.ready : undefined,
		ownerName: text(value.ownerName) || "",
	};
}

export function normalizeTask(value) {
	if (!isObject(value)) return null;
	var id = text(value.id);
	if (!id) return null;
	var status = text(value.status);
	return {
		id: id,
		revision: numberOr(value.revision, 0),
		subject: text(value.subject) || text(value.title) || id,
		description: text(value.description) || "",
		status: TASK_STATUS_LABEL[status] ? status : "pending",
		ownerId: text(value.ownerId) || "",
		ownerName: text(value.ownerName) || "",
		blockedBy: asArray(value.blockedBy).map(String),
		writeScopes: asArray(value.writeScopes).map(String),
		ready: typeof value.ready === "boolean" ? value.ready : undefined,
		writeScopeWarnings: asArray(value.writeScopeWarnings).map(String),
	};
}

export function normalizeTasks(value) {
	return asArray(value).map(normalizeTask).filter(Boolean);
}

export function normalizeMember(value) {
	if (!isObject(value)) return null;
	var id = text(value.id) || text(value.sessionId) || text(value.agentId) || text(value.ownerId);
	var name = text(value.name) || text(value.displayName) || text(value.label) || id;
	if (!id && !name) return null;
	var memberStatus = text(value.status);
	var statusState = memberStatus === "running" ? "thinking" : memberStatus === "idle" ? "idle" : memberStatus === "inactive" ? "offline" : "";
	// OfficeMember.phase is the roster phase (active/provisioning/failed); only cyberAgent uses a phase as the office state.
	var state = normalizeState(value.state) || statusState;
	var phase = text(value.phase);
	return {
		id: id || name,
		name: name || id,
		role: value.role === "lead" || value.role === "teammate" || value.role === "subagent" ? value.role : "",
		phase: phase,
		description: text(value.description) || text(value.roleText) || text(value.duty) || text(value.text) || "",
		state: state || "",
		tool: normalizeTool(value.tool || value.currentTool || (typeof value.toolName === "string" ? { name: value.toolName, summary: value.toolSummary } : null)),
		approval: normalizeApproval(value.approval || value.pendingApproval || (typeof value.approvalTool === "string" ? { toolName: value.approvalTool, reason: value.approvalReason } : null)),
		task: normalizeTaskRef(value.task),
		model: text(value.model) || "",
		provider: text(value.provider) || "",
		error: text(value.error) || (isObject(value.error) ? text(value.error.message) : ""),
		since: numberOr(value.since, 0),
		updatedAt: numberOr(value.updatedAt || value.at || value.time, 0),
	};
}

export function normalizeMembers(value) {
	return asArray(value).map(normalizeMember).filter(Boolean);
}

export function normalizeAgent(value) {
	if (!isObject(value)) return null;
	var snapshot = isObject(value.snapshot) ? value.snapshot : value;
	return {
		id: text(snapshot.id) || "",
		name: text(snapshot.name) || "",
		roleText: text(snapshot.roleText) || text(snapshot.description) || text(snapshot.duty) || "",
		phase: text(snapshot.phase) || "",
		state: normalizeState(snapshot.state) || normalizeState(snapshot.phase) || normalizeState(typeof snapshot.status === "string" ? snapshot.status : "") || (snapshot.running === true ? "thinking" : snapshot.running === false ? "idle" : ""),
		since: numberOr(snapshot.since, 0),
		turn: typeof snapshot.turn === "number" ? snapshot.turn : undefined,
		step: typeof snapshot.step === "number" ? snapshot.step : undefined,
		tool: normalizeTool(snapshot.tool || snapshot.currentTool || (typeof snapshot.toolName === "string" ? { name: snapshot.toolName, summary: snapshot.toolSummary } : null)),
		approval: normalizeApproval(snapshot.approval || snapshot.pendingApproval || (typeof snapshot.approvalTool === "string" ? { toolName: snapshot.approvalTool, reason: snapshot.approvalReason } : null)),
		task: normalizeTaskRef(snapshot.task),
		model: text(snapshot.model) || "",
		provider: text(snapshot.provider) || "",
		error: text(snapshot.error) || (isObject(snapshot.error) ? text(snapshot.error.message) : ""),
		updatedAt: numberOr(snapshot.updatedAt || snapshot.at || snapshot.time, 0),
	};
}

var AGENT_COLLECTION_KEYS = ["agents", "members", "seats", "sessions", "byId", "states", "items"];

export function looksLikeAgentCollection(value) {
	if (!isObject(value)) return false;
	for (var index = 0; index < AGENT_COLLECTION_KEYS.length; index += 1) {
		var key = AGENT_COLLECTION_KEYS[index];
		if (isObject(value[key]) || Array.isArray(value[key])) return true;
	}
	return false;
}

export function normalizeSingleAgent(value) {
	if (!isObject(value) || looksLikeAgentCollection(value)) return null;
	var hasIdentity = typeof value.id === "string" || typeof value.name === "string";
	var hasState = value.state !== undefined || value.phase !== undefined || value.tool !== undefined || value.approval !== undefined || value.running !== undefined || value.toolName !== undefined;
	if (!hasIdentity && !hasState) return null;
	return normalizeAgent(value);
}

/**
 * 把 cyberAgent 的任意形状摊平成 id -> AgentSnapshot。
 * 兼容 { agents: [...] }、{ [sessionId]: {...} }、数组、单个 snapshot。
 */
export function normalizeAgents(value) {
	var result = {};
	var visit = function (candidate, fallbackId, depth) {
		if (depth > 5) return;
		if (Array.isArray(candidate)) {
			for (var index = 0; index < candidate.length; index += 1) visit(candidate[index], "", depth + 1);
			return;
		}
		if (!isObject(candidate)) return;
		var single = normalizeSingleAgent(candidate);
		if (single) {
			if (!single.id) single.id = fallbackId || "";
			if (single.id) result[single.id] = mergeAgent(result[single.id], single);
			return;
		}
		var keys = Object.keys(candidate);
		for (var keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
			var key = keys[keyIndex];
			var child = candidate[key];
			if (!isObject(child) && !Array.isArray(child)) continue;
			visit(child, key, depth + 1);
		}
	};
	visit(value, "", 0);
	return result;
}

export function mergeAgent(previous, next) {
	if (!previous) return next;
	var merged = {};
	var keys = Object.keys(previous).concat(Object.keys(next));
	for (var index = 0; index < keys.length; index += 1) {
		var key = keys[index];
		if (merged[key] !== undefined) continue;
		var nextValue = next[key];
		var previousValue = previous[key];
		merged[key] = nextValue !== undefined && nextValue !== "" && nextValue !== null ? nextValue : previousValue;
	}
	return merged;
}

export function normalizeCounts(value) {
	if (!isObject(value)) return null;
	return {
		pending: numberOr(value.pending, 0),
		in_progress: numberOr(value.inProgress, numberOr(value.in_progress, 0)),
		completed: numberOr(value.completed, 0),
		blocked: numberOr(value.blocked, 0),
		total: numberOr(value.total, 0),
	};
}

export function normalizeFloor(value, inheritedBuildingId) {
	if (!isObject(value)) return null;
	var session = isObject(value.session) ? value.session : null;
	var id = text(value.id) || text(value.sessionId) || text(value.floorId) || (session ? text(session.id) : "");
	if (!id) return null;
	var members = normalizeMembers(value.members || value.seats || value.agents);
	var tasks = normalizeTasks(value.tasks);
	var kind = value.kind === "team" || value.kind === "session" ? value.kind : "session";
	return {
		id: id,
		buildingId: text(value.buildingId) || text(value.building) || text(inheritedBuildingId) || "",
		title: text(value.title) || text(value.name) || text(value.displayTitle) || (session ? text(session.title) : "") || id,
		titleSource: text(value.titleSource) || "host",
		kind: kind,
		live: typeof value.live === "boolean" ? value.live : typeof value.agentAvailable === "boolean" ? value.agentAvailable : undefined,
		running: typeof value.running === "boolean" ? value.running : undefined,
		blank: value.blank === true,
		archived: value.archived === true,
		archivedLineage: value.archivedLineage === true,
		pinned: value.pinned === true,
		parentId: text(value.parentId) || text(value.parentSessionId) || "",
		origin: text(value.origin) || "",
		depth: numberOr(value.depth, 0),
		updatedAt: numberOr(value.updatedAt, 0),
		lastPromptAt: numberOr(value.lastPromptAt, 0),
		roleText: text(value.roleText) || text(value.description) || "",
		leadId: text(value.leadId) || text(value.leadSessionId) || "",
		model: text(value.model) || "",
		provider: text(value.provider) || "",
		workspaceId: text(value.workspaceId) || "",
		path: text(value.path) || text(value.cwd) || "",
		cwd: text(value.cwd) || text(value.path) || "",
		members: members,
		tasks: tasks,
		tasksAvailable: Array.isArray(value.tasks),
		agentAvailable: typeof value.agentAvailable === "boolean" ? value.agentAvailable : undefined,
		taskCounts: normalizeCounts(value.taskCounts),
		failure: text(value.failure) || "",
	};
}

export function normalizeReasons(value) {
	if (value === undefined || value === null) return [];
	if (typeof value === "string") return value ? [value] : [];
	if (Array.isArray(value)) return value.map((entry) => (typeof entry === "string" ? entry : errorText(entry))).filter(Boolean);
	if (isObject(value)) {
		var reasons = normalizeReasons(value.reasons);
		if (reasons.length > 0) return reasons;
		var keys = Object.keys(value);
		var out = [];
		for (var index = 0; index < keys.length; index += 1) {
			if (value[keys[index]] === true) out.push(keys[index]);
		}
		return out;
	}
	return [];
}

export function normalizeSnapshot(raw) {
	if (!isObject(raw)) throw new Error("快照为空或不是对象");
	var root = isObject(raw.office) ? raw.office : isObject(raw.snapshot) ? raw.snapshot : isObject(raw.data) ? raw.data : raw;
	var floors = [];
	var byId = {};
	var buildingsRaw = asArray(root.buildings).filter(isObject);
	for (var buildingIndex = 0; buildingIndex < buildingsRaw.length; buildingIndex += 1) {
		var building = buildingsRaw[buildingIndex];
		var buildingId = text(building.id) || text(building.workspaceId) || "building-" + buildingIndex;
		var nested = asArray(building.floors);
		for (var nestedIndex = 0; nestedIndex < nested.length; nestedIndex += 1) {
			var nestedFloor = normalizeFloor(nested[nestedIndex], buildingId);
			if (nestedFloor && !byId[nestedFloor.id]) {
				byId[nestedFloor.id] = nestedFloor;
				floors.push(nestedFloor);
			}
		}
	}
	var flatFloors = asArray(root.floors);
	for (var floorIndex = 0; floorIndex < flatFloors.length; floorIndex += 1) {
		var floor = normalizeFloor(flatFloors[floorIndex], "");
		if (!floor) continue;
		var existing = byId[floor.id];
		if (existing) {
			Object.assign(existing, floor);
			existing.members = floor.members.length > 0 ? floor.members : existing.members;
			existing.tasks = floor.tasks.length > 0 ? floor.tasks : existing.tasks;
		} else {
			byId[floor.id] = floor;
			floors.push(floor);
		}
	}
	var state = text(root.state);
	if (state !== "live" && state !== "degraded" && state !== "unavailable") state = "live";
	var degradedSource = root.degraded;
	var reasons = normalizeReasons(degradedSource);
	if (state === "degraded" && reasons.length === 0 && isObject(degradedSource)) reasons = normalizeReasons(degradedSource);
	return {
		v: numberOr(root.v, 1),
		sampledAt: numberOr(root.sampledAt, Date.now()),
		state: state,
		buildings: buildingsRaw.map(function (building, index) {
			return {
				id: text(building.id) || text(building.workspaceId) || "building-" + index,
				title: text(building.title) || text(building.name) || text(building.path) || "未命名楼栋",
				path: text(building.path) || "",
				workspaceId: text(building.workspaceId) || "",
				floorIds: asArray(building.floorIds).map(String),
				vacant: building.vacant === true,
			};
		}),
		floors: floors,
		current: isObject(root.current) ? root.current : null,
		reasons: reasons,
	};
}
