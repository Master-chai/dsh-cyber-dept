import { COMMAND_ROUTE, COMMAND_METHOD as HOST_COMMAND_METHOD, COMMAND_ACTION, COMMAND_TIMEOUT_MS, MAX_MESSAGE_LENGTH, MAX_SUBJECT_LENGTH, MAX_DESCRIPTION_LENGTH } from '../../shared/contract.js';
import { isObject, asArray, text, errorText, clampText } from '../common.js';
import { fetchOfficeText, nextRpcId } from '../transport.js';

export const COMMAND_PATH = COMMAND_ROUTE;
export const COMMAND_METHOD = HOST_COMMAND_METHOD;
export const WRITE_ACTION = COMMAND_ACTION;
export const WRITE_LIMIT = {message:MAX_MESSAGE_LENGTH,subject:MAX_SUBJECT_LENGTH,description:MAX_DESCRIPTION_LENGTH};
export const WRITE_TITLE = { message: "发送消息", interrupt: "打断 Agent", complete: "完成任务", reopen: "重开任务", assign: "派活" };
export const WRITE_CONFIRM_LABEL = { message: "确认发送", interrupt: "确认打断", complete: "确认完成", reopen: "确认重开", assign: "确认创建并指派" };

/**
 * commandId 必须通过宿主的 UUID 校验（v4/v7/v8 均可）。crypto.randomUUID
 * 不可用时退回本地生成，仍然保持 version/variant 位，避免整条命令被 400。
 */
export function nextCommandId() {
	try {
		if (typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
	} catch (error) {}
	var bytes = [];
	var index;
	try {
		if (typeof crypto !== "undefined" && crypto && typeof crypto.getRandomValues === "function") {
			var buffer = new Uint8Array(16);
			crypto.getRandomValues(buffer);
			for (index = 0; index < 16; index += 1) bytes.push(buffer[index]);
		}
	} catch (error) {}
	if (bytes.length !== 16) {
		bytes = [];
		for (index = 0; index < 16; index += 1) bytes.push(Math.floor(Math.random() * 256));
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	var hex = "";
	for (index = 0; index < 16; index += 1) hex += (bytes[index] + 0x100).toString(16).slice(1);
	return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
}

/**
 * 宿主 /api/cyberOffice/command 的完整信封。字段与 command 路由的校验一一对应：
 * type/rpcId/method + payload{commandId, sessionId, action, args}。
 */
export function buildCommandEnvelope(sessionId, action, args) {
	return {
		type: "client-request",
		rpcId: nextRpcId(),
		method: COMMAND_METHOD,
		payload: {
			commandId: nextCommandId(),
			sessionId: sessionId,
			action: action,
			args: args,
		},
	};
}

export function writeTransportError(code, message) {
	return { code: code, message: message, details: { deliveryUnknown: code !== "office/rejected-envelope" }, transport: true };
}

/**
 * POST 一个写命令。成功返回宿主的 result（{ok:true,value} 或 {ok:false,error}）；
 * 只有信封/传输层失败才抛错——域错误留给 UI 按 code 展示，绝不在这里重试。
 */
export async function postOfficeCommand(sessionId, action, args, options) {
	options = options || {};
	var envelope = options.envelope || buildCommandEnvelope(sessionId, action, args);
	var response;
	var raw = "";
	function failure(code,message){var error=writeTransportError(code,message);error.details.commandId=envelope.payload.commandId;error.details.action=action;error.details.sessionId=sessionId;return error;}
	try {
		var received = await fetchOfficeText(COMMAND_PATH, {
			method: "POST",
			credentials: "same-origin",
			cache: "no-store",
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify(envelope),
		}, options.timeoutMs || COMMAND_TIMEOUT_MS + 3000);
		response=received.response;raw=received.raw;
	} catch (error) {
		throw failure(error && error.name === "TimeoutError" ? "office/timeout" : "office/network", "未能确认操作结果：" + errorText(error));
	}
	var body = null;
	if (raw) {
		try {
			body = JSON.parse(raw);
		} catch (error) {
			throw failure("office/bad-response", "宿主返回了非 JSON 响应（HTTP " + response.status + "）");
		}
	}
	if (!response.ok) {
		var reason = isObject(body) && typeof body.reason === "string" ? body.reason : "";
		throw failure(response.status === 400 && reason ? "office/rejected-envelope" : "office/bad-response", "宿主响应 HTTP " + response.status + (reason ? "：reason=" + reason : ""));
	}
	if (!isObject(body) || body.type !== "server-response") throw failure("office/bad-response", "宿主响应不是 server-response 信封");
	if (body.rpcId !== envelope.rpcId) throw failure("office/bad-response", "rpcId 不匹配");
	if (!isObject(body.result) || typeof body.result.ok !== "boolean") throw failure("office/bad-response", "宿主响应缺少有效 result");
	if (!body.result.ok && body.result.error) body.result.error.details=Object.assign({},body.result.error.details,{commandId:envelope.payload.commandId});
	return body.result;
}

export var WRITE_ERROR_COPY = {
	"office/stale-revision": { title: "任务版本已过期", hint: "快照里的 task revision 落后于任务板，宿主已拒绝这次写入。先刷新快照，等拿到最新 revision 再操作。" },
	"office/busy": { title: "同一命令正在处理", hint: "宿主检测到重复提交（同一 commandId 仍在执行）。不会自动重发；等它结束后刷新快照再试。" },
	"office/session-not-live": { title: "会话不在线", hint: "宿主拿不到 Lead 的实时 Agent，写动作已停止。回到会话确认它仍然打开。" },
	"office/team-unavailable": { title: "Agent Teams 不可用", hint: "当前 profile 没有挂载 Agent Teams 服务，写动作已禁用。" },
	"office/not-member": { title: "目标不是团队成员", hint: "成员表可能已变化；刷新快照后重新选择。" },
	"office/member-not-found": { title: "找不到目标成员", hint: "成员可能已离线或改名；刷新快照后重新选择。" },
	"office/self-message": { title: "不能给自己发消息", hint: "选择另一位成员作为消息目标。" },
	"office/invalid-target": { title: "目标不合法", hint: "目标成员名不合法。" },
	"office/task-not-found": { title: "任务不存在", hint: "任务可能已被删除；刷新快照后重新选择。" },
	"office/task-deleted": { title: "任务已删除", hint: "任务已被删除；刷新快照。" },
	"office/task-blocked": { title: "任务被依赖阻塞", hint: "先处理 blockedBy 依赖，再完成或重开。" },
	"office/task-limit": { title: "达到任务上限", hint: "任务板已满或成员数达到上限。" },
	"office/invalid-transition": { title: "状态转换不合法", hint: "任务当前状态不允许这个动作；刷新快照后再试。" },
	"office/unauthorized": { title: "没有权限", hint: "Team 服务拒绝了这次操作；可能不是 Lead 动作。" },
	"office/message-too-large": { title: "消息太长", hint: "缩短消息到 16384 字符以内。" },
	"office/invalid-write-scope": { title: "写入范围不合法", hint: "writeScopes 必须是相对路径。" },
	"office/invalid-argument": { title: "参数不合法", hint: "宿主拒绝了参数形状；检查输入长度。" },
	"office/lead-required": { title: "需要 Lead 身份", hint: "只有 Lead 会话能执行 Team 写动作。" },
	"office/internal": { title: "宿主内部错误", hint: "Team 服务抛出了未分类错误；不会自动重试。" },
	"office/network": { title: "操作结果未知", hint: "操作可能已经执行。请先刷新任务或检查目标会话，确认后再决定是否重新提交。" },
	"office/bad-response": { title: "操作结果未知", hint: "未收到有效回执，操作可能已经执行。请先核对目标状态。" },
	"office/rejected-envelope": { title: "命令被宿主拒绝", hint: "信封/参数没有通过宿主校验；这是客户端 bug，请报告 reason。" },
	"office/create-unassigned": { title: "任务未指派", hint: "task.create 成功但没有返回可用 revision，任务会留在任务板。不会自动重试。" },
};

/** 把宿主/传输错误变成可渲染的文案；stale/busy/timeout 有专门提示。 */
export function describeWriteError(error) {
	var code = text(error && error.code) || "office/internal";
	var message = typeof error === "string" ? error : text(error && error.message) || "宿主未返回错误说明";
	var details = isObject(error && error.details) ? error.details : {};
	var copy = WRITE_ERROR_COPY[code] || { title: "写入失败", hint: "宿主返回了未分类的错误；不会自动重试。" };
	var view = {
		code: code,
		message: message,
		title: copy.title,
		hint: copy.hint,
		refreshHint: code === "office/stale-revision",
		deliveryUnknown: details.deliveryUnknown === true,
		commandId: text(details.commandId),
		busy: code === "office/busy",
	};
	if (code === "office/timeout") {
		view.title = view.deliveryUnknown ? "发送结果未知" : "请求超时";
		view.hint = view.deliveryUnknown
			? "宿主没有在时限内确认，操作可能已经送达；请先检查目标状态，不要直接重发。"
			: "Team 服务没有在时限内回应；宿主不会自动重试。";
	}
	return view;
}

export function describeWriteSuccess(kind, value, seatName) {
	var target = text(value && value.target) || text(seatName);
	var task = value && isObject(value.task) ? value.task : null;
	var taskLabel = task ? text(task.subject) || text(task.id) : "";
	if (kind === "message") {
		var messageId = text(value && value.messageId);
		return "已发送给 " + target + (messageId ? "（messageId " + clampText(messageId, 32) + "）" : "");
	}
	if (kind === "interrupt") {
		var previous = text(value && value.previousStatus);
		if (previous === "inactive") return "目标当时不在运行（inactive），没有可打断的回合。";
		return "已打断 " + target + " 的当前回合（此前 " + (previous || "running") + "）；已产生的输出保留。";
	}
	if (kind === "complete") return "任务已标记完成" + (taskLabel ? "：" + taskLabel : "") + (task && task.revision ? "（rev " + String(task.revision) + "）" : "");
	if (kind === "reopen") return "任务已重开为待办（原负责人已取消）" + (taskLabel ? "：" + taskLabel : "") + (task && task.revision ? "（rev " + String(task.revision) + "）" : "");
	if (kind === "assign") return "已派活给 " + target + (taskLabel ? "：" + taskLabel : "");
	return "操作成功";
}

/** seat.task 的写动作视图：只有宿主任务 id + revision 才能做 CAS 动作。 */
export function taskRefOf(seat) {
	var task = seat && seat.task ? seat.task : null;
	if (!task) return null;
	var id = text(task.id);
	var revision = typeof task.revision === "number" && Number.isSafeInteger(task.revision) && task.revision >= 1 ? task.revision : 0;
	return {
		id: id,
		revision: revision,
		subject: text(task.subject) || id,
		status: text(task.status) || "pending",
		ready: task.ready,
	};
}

export function taskRefOfValue(task) {
	if (!task) return null;
	var id = text(task.id);
	var revision = typeof task.revision === "number" && Number.isSafeInteger(task.revision) && task.revision >= 1 ? task.revision : 0;
	return {
		id: id,
		revision: revision,
		subject: text(task.subject) || id,
		status: text(task.status) || "pending",
		ready: task.ready,
	};
}

export function validateWrite(write) {
	if (write.kind === "message") {
		var messageText = typeof write.text === "string" ? write.text.trim() : "";
		if (!messageText) return "消息不能为空。";
		if (messageText.length > WRITE_LIMIT.message) return "消息超过 " + String(WRITE_LIMIT.message) + " 字符。";
		return "";
	}
	if (write.kind === "assign") {
		if (write.taskId) return write.taskRevision ? "" : "任务版本不可用，请刷新后重新选择。";
		var subject = typeof write.subject === "string" ? write.subject.trim() : "";
		var description = typeof write.description === "string" ? write.description.trim() : "";
		if (!subject) return "任务标题不能为空。";
		if (subject.length > WRITE_LIMIT.subject) return "任务标题超过 " + String(WRITE_LIMIT.subject) + " 字符。";
		if (!description) return "任务描述不能为空。";
		if (description.length > WRITE_LIMIT.description) return "任务描述超过 " + String(WRITE_LIMIT.description) + " 字符。";
		return "";
	}
	if (write.kind === "complete" || write.kind === "reopen") {
		if (!write.taskId) return "缺少 task id，无法定位任务。";
		if (!write.taskRevision) return "缺少 expectedRevision：先刷新快照拿到任务版本。";
		return "";
	}
	return "";
}

export function actionOfWrite(write) {
	if (write.kind === "message") return WRITE_ACTION.messageSend;
	if (write.kind === "interrupt") return WRITE_ACTION.agentInterrupt;
	if (write.kind === "complete") return WRITE_ACTION.taskComplete;
	if (write.kind === "reopen") return WRITE_ACTION.taskReopen;
	return "";
}

export function argsOfWrite(write) {
	if (write.kind === "message") return { target: write.seatName, text: write.text.trim() };
	if (write.kind === "interrupt") return { target: write.seatName };
	if (write.kind === "complete" || write.kind === "reopen") return { taskId: write.taskId, expectedRevision: write.taskRevision };
	return {};
}

/**
 * 写通道可用性。预览、快照不可用、单人会话、冷楼层一律只读：
 * 宿主需要一个 live 的 Lead Agent 才能执行 Team 动作。
 */
export function writeGateOf(source, snapshot, floor) {
	if (source === "preview") return { enabled: false, reason: "当前显示会话预览，正在更新状态；同步完成后恢复操作。" };
	if (source !== "host") return { enabled: false, reason: "当前为只读预览，等待宿主快照验证后才能操作。" };
	if (snapshot && snapshot.state === "unavailable") return { enabled: false, reason: "宿主快照不可用，写通道已禁用。" };
	if (snapshot && asArray(snapshot.reasons).indexOf("agent-teams-unavailable") >= 0) return { enabled: false, reason: "当前团队服务不可用。" };
	if (!floor) return { enabled: false, reason: "没有选中的楼层。" };
	if (floor.kind !== "team" || floor.hasTeam !== true) return { enabled: false, reason: "单人会话没有 Team 写动作。" };
	if (floor.live !== true) return { enabled: false, reason: "楼层休眠 / 冷会话：Lead 不在线，宿主无法执行 Team 写动作。" };
	if (floor.agentAvailable === false) return { enabled: false, reason: "负责人尚未启动，请先在 DSH 会话中启动负责人。" };
	return { enabled: true, reason: "" };
}
