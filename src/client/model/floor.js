// Pure view derivation: native board membership, task revisions, then activity.
import { isObject, text, asArray, numberOr, MAX_SEATS } from "../common.js";
import { normalizeApproval, normalizeTasks, normalizeMembers, normalizeAgents, normalizeSingleAgent, mergeAgent } from "./normalize.js";
import { deriveSeatState, deriveSeatFacts } from "./state.js";
export { deriveSeatState, deriveSeatFacts } from "./state.js";

export function projectionValues(sessions, sessionId) {
	if (!sessions || !isObject(sessions.projectionsBySession)) return null;
	var block = sessions.projectionsBySession[sessionId];
	if (!isObject(block) || !isObject(block.values)) return null;
	return block.values;
}

export function projectionOf(sessions, sessionId, key) {
	var values = projectionValues(sessions, sessionId);
	return values ? values[key] : undefined;
}

export function memberIdentity(member, index) {
	return text(member.id) || text(member.sessionId) || text(member.agentId) || "seat-" + index;
}

/**
 * 收集一层可用的 cyberAgent 快照：本层投影（可能是 map/数组/单条）+ 每个成员会话自己的投影。
 */
export function collectCyberAgents(sessions, floor, members) {
	var collected = {};
	var absorb = function (value, fallbackId) {
		if (value === undefined || value === null) return;
		var map = normalizeAgents(value);
		var keys = Object.keys(map);
		for (var index = 0; index < keys.length; index += 1) {
			var key = keys[index];
			collected[key] = mergeAgent(collected[key], map[key]);
		}
		if (keys.length === 0) {
			var single = normalizeSingleAgent(value);
			if (single) {
				var id = single.id || fallbackId;
				if (id) {
					single.id = id;
					collected[id] = mergeAgent(collected[id], single);
				}
			}
		}
	};
	var floorValues = projectionValues(sessions, floor.id);
	if (floorValues) absorb(floorValues.cyberAgent, floor.id);
	absorb(floor.cyberAgent, floor.id);
	for (var index = 0; index < members.length; index += 1) {
		var member = members[index];
		var id = text(member.id) || text(member.sessionId);
		if (!id) continue;
		var values = projectionValues(sessions, id);
		if (!values) continue;
		absorb(values.cyberAgent, id);
	}
	return collected;
}

export function taskOwnedBy(task, member, memberId) {
	if (text(task.ownerId)) return text(task.ownerId) === memberId;
	if (text(task.ownerName) && text(task.ownerName) === text(member.name)) return true;
	return false;
}

export function pickTaskForMember(tasks, member, memberId) {
	var owned = [];
	for (var index = 0; index < tasks.length; index += 1) {
		var task = tasks[index];
		if (task.status === "completed" || task.status === "deleted") continue;
		if (taskOwnedBy(task, member, memberId)) owned.push(task);
	}
	for (var inProgress = 0; inProgress < owned.length; inProgress += 1) {
		if (owned[inProgress].status === "in_progress") return owned[inProgress];
	}
	for (var pending = 0; pending < owned.length; pending += 1) {
		if (owned[pending].status === "pending") return owned[pending];
	}
	return null;
}

/**
 * seat.task 可能来自投影里的精简任务（只有 id/subject/status）。写动作需要
 * task id + expectedRevision，所以用本层完整任务表回填 revision 等字段。
 */
export function enrichTaskRef(task, tasks, byId) {
	if (!task) return null;
	var board = Array.isArray(tasks) ? tasks : [];
	var taskId = text(task.id);
	var taskSubject = text(task.subject);
	var match = null;
	var index;
	if (taskId && byId) match = byId.get(taskId) || null;
	if (!byId) {
	for (index = 0; index < board.length; index += 1) {
		if (taskId && text(board[index].id) === taskId) {
			match = board[index];
			break;
		}
	}
	}
	if (!match && !taskId && taskSubject) {
		var sameSubject = board.filter(function (item) { return text(item.subject) === taskSubject; });
		if (sameSubject.length === 1) match = sameSubject[0];
	}
	var merged = Object.assign({}, task, match || {});
	merged.id = text(merged.id) || (match ? text(match.id) : "");
	merged.subject = text(merged.subject) || (match ? text(match.subject) : "");
	merged.status = text(merged.status) || (match ? text(match.status) : "pending");
	merged.revision = typeof merged.revision === "number" && merged.revision >= 1 ? merged.revision : match ? numberOr(match.revision, 0) : 0;
	merged.ready = typeof merged.ready === "boolean" ? merged.ready : match ? match.ready : undefined;
	merged.ownerName = text(merged.ownerName) || (match ? text(match.ownerName) : "");
	return merged;
}

export function makeSeat(floor, member, index, context) {
	var id = memberIdentity(member, index);
	var role = member.role === "lead" || (!member.role && index === 0) ? "lead" : member.role === "subagent" ? "subagent" : "teammate";
	var summary = context.byId ? context.byId[id] : undefined;
	var status = context.statusMap && typeof context.statusMap.get === "function" ? context.statusMap.get(id) : undefined;
	var agent = context.agents[id] || null;
	var nativeApproval = status && status.pendingInteraction && status.pendingInteraction.kind === "approval" ? status.pendingInteraction : null;
	var approval = agent && agent.approval ? agent.approval : nativeApproval ? normalizeApproval(nativeApproval) : member.approval;
	var running = summary && typeof summary.running === "boolean" ? summary.running : typeof member.running === "boolean" ? member.running : undefined;
	var stateInput = { approval: approval, agent: agent, member: member, live: context.live, summary: summary, running: running };
	var state = deriveSeatState(stateInput);
	var owned = context.taskIndex ? (context.taskIndex.get("id:"+id)||[]).concat(context.taskIndex.get("name:"+member.name)||[]) : context.tasks;
	var task = enrichTaskRef((agent && agent.task) || member.task || pickTaskForMember(owned, member, id), context.tasks, context.taskById);
	var completedTask = null, completedCount = 0;
	if (Array.isArray(owned)) {
		for (var ci = 0; ci < owned.length; ci += 1) {
			var ct = owned[ci];
			if (ct && ct.status === "completed" && taskOwnedBy(ct, member, id)) { completedTask = ct; completedCount++; }
		}
	}
	var roleText =
		member.description ||
		(agent && agent.roleText) ||
		(role === "lead" ? text(context.floor.roleText) || text(floor.title) : "") ||
		(summary && text(summary.displayTitle)) ||
		"";
	return {
		id: id,
		floorId: floor.id,
		name: text(member.name) || text(summary && summary.displayTitle) || id,
		role: role,
		roleText: roleText,
		phase: text(member.phase) || (agent && agent.phase) || "",
		state: state,
		stateFacts: deriveSeatFacts(Object.assign({}, stateInput, { task: task })),
		stateSource: nativeApproval ? "native-approval" : agent && agent.state ? "cyberAgent" : member.state ? "snapshot" : "derived",
		since: state === "offline" ? 0 : (agent && agent.since) || member.since || 0,
		tool: state === "offline" ? null : (agent && agent.tool) || member.tool || null,
		approval: state === "offline" ? null : approval || null,
		task: task || null,
		completedTask: completedCount === 1 ? completedTask : null,
                completedCount: completedCount,
		model: (agent && agent.model) || member.model || (summary && summary.projectionValues && summary.projectionValues.modelSelection && summary.projectionValues.modelSelection.next ? summary.projectionValues.modelSelection.next.model : "") || "",
		provider: (agent && agent.provider) || member.provider || "",
		error: (agent && agent.error) || member.error || "",
		updatedAt: (agent && agent.updatedAt) || member.updatedAt || floor.updatedAt || 0,
		live: context.live === true,
		orphan: !summary && context.live !== false,
	};
}

export function countTasks(tasks) {
	var counts = { pending: 0, in_progress: 0, completed: 0 };
	for (var index = 0; index < tasks.length; index += 1) {
		var status = tasks[index].status;
		if (counts[status] !== undefined) counts[status] += 1;
	}
	return counts;
}

/**
 * 把一层宿主摘要与本地 agentTeam / cyberAgent 投影合并成可渲染的楼层。
 * 宿主给结构，投影给实时状态；任何一边缺失都不抛错。
 */
export function mergeMemberRecords(hostMember, teamMember) {
	var merged = Object.assign({}, hostMember, teamMember);
	if (!merged.description) merged.description = hostMember.description || "";
	if (!merged.state) merged.state = hostMember.state || "";
	if (!merged.tool) merged.tool = hostMember.tool || null;
	if (!merged.approval) merged.approval = hostMember.approval || null;
	if (!merged.task) merged.task = hostMember.task || null;
	if (!merged.model) merged.model = hostMember.model || "";
	if (!merged.provider) merged.provider = hostMember.provider || "";
	if (!merged.error) merged.error = hostMember.error || "";
	if (!merged.since) merged.since = hostMember.since || 0;
	if (!merged.updatedAt) merged.updatedAt = hostMember.updatedAt || 0;
	if (!merged.name || merged.name === merged.id) merged.name = hostMember.name || merged.name;
	return merged;
}

export function mergeFloor(floor, sessions, statusMap) {
	var byId = sessions && isObject(sessions.byId) ? sessions.byId : {};
	var own = byId[floor.id];
	var team = projectionOf(sessions, floor.id, "agentTeam");
	var teamMembers = isObject(team) ? normalizeMembers(team.members) : [];
	var hostMembers = asArray(floor.members);
	// PLAN §2：members.length > 1 才算部门，部门编制以 agentTeam 投影为准；
	// 普通会话 / 空队回退到宿主快照的成员（可能含子代理）。
	var useTeamRoster = teamMembers.length > 1;
	var members = [];
	if (useTeamRoster) {
		var hostById = {};
		for (var hostIndex = 0; hostIndex < hostMembers.length; hostIndex += 1) {
			if (hostMembers[hostIndex].id) hostById[hostMembers[hostIndex].id] = hostMembers[hostIndex];
		}
		for (var teamIndex = 0; teamIndex < teamMembers.length; teamIndex += 1) {
			var teamMember = teamMembers[teamIndex];
			var hostMember = hostById[teamMember.id];
			members.push(hostMember ? mergeMemberRecords(hostMember, teamMember) : teamMember);
		}
	} else {
		members = hostMembers.length > 0 ? hostMembers : teamMembers;
	}
	var teamTasks = isObject(team) ? normalizeTasks(team.tasks) : [];
	var hasTeamTasks = isObject(team) && Array.isArray(team.tasks);
	var hostTasks = new Map(asArray(floor.tasks).map(function(task){return [task.id, task];}));
	// A loaded native board owns membership (including deletions); use higher
	// revisions from the snapshot only for tasks still present in that board.
	var tasks = hasTeamTasks ? teamTasks.map(function(task){var host=hostTasks.get(task.id);return host && host.revision > task.revision ? host : task;}) : asArray(floor.tasks);
	var live = typeof floor.live === "boolean" ? floor.live : own !== undefined && floor.archived !== true;
	var running = typeof floor.running === "boolean" ? floor.running : !!(own && own.running);
	var agents = collectCyberAgents(sessions, floor, members);
	var taskIndex = new Map(), taskById = new Map();
	tasks.forEach(function(task){taskById.set(task.id,task);var key=task.ownerId?"id:"+task.ownerId:"name:"+task.ownerName;if(!taskIndex.has(key))taskIndex.set(key,[]);taskIndex.get(key).push(task);});
	var context = { byId: byId, statusMap: statusMap, agents: agents, tasks: tasks, taskIndex:taskIndex, taskById:taskById, live: live, floor: floor };
	var seats = [];
	for (var index = 0; index < members.length; index += 1) {
		seats.push(makeSeat(floor, members[index], index, context));
	}
	if (seats.length === 0) {
		var fallbackMember = { id: floor.id, name: floor.title, role: "lead", description: floor.roleText, phase: "active", state: "", error: "" };
		seats.push(makeSeat(floor, fallbackMember, 0, context));
	}
	var overflow = Math.max(0, seats.length - MAX_SEATS);
	var runningCount = 0;
	var waitingCount = 0;
	for (var seatIndex = 0; seatIndex < seats.length; seatIndex += 1) {
		if (["thinking", "streaming", "tool-running", "provisioning"].indexOf(seats[seatIndex].state) >= 0) runningCount += 1;
		if (seats[seatIndex].state === "waiting-approval") waitingCount += 1;
	}
	var taskCounts = hasTeamTasks || floor.tasksAvailable === true || tasks.length > 0 ? countTasks(tasks) : floor.taskCounts || countTasks([]);
	var leadSeat = null;
	for (var leadIndex = 0; leadIndex < seats.length; leadIndex += 1) {
		if (seats[leadIndex].role === "lead") {
			leadSeat = seats[leadIndex];
			break;
		}
	}
	return Object.assign({}, floor, {
		live: live,
		running: running || runningCount > 0,
		seats: seats,
		overflow: overflow,
		tasks: tasks,
		tasksAvailable: hasTeamTasks || floor.tasksAvailable === true || tasks.length > 0,
		taskCounts: taskCounts,
		runningCount: runningCount,
		waitingCount: waitingCount,
		leadId: floor.leadId || (leadSeat ? leadSeat.id : floor.id),
		hasTeam: seats.length > 1,
		projectionSource: isObject(team) || Object.keys(agents).length > 0 ? "projection" : "host",
	});
}
