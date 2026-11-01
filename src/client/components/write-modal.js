import React from 'react';
import {labelOf,text,asArray,isObject,isTaskBlocked,taskStatusLabel} from '../common.js';
import {WRITE_TITLE,WRITE_CONFIRM_LABEL,WRITE_LIMIT,COMMAND_PATH,describeWriteError} from '../commands/protocol.js';
const h=React.createElement;
export function writeRow(label, value) {
	return h("div", { className: "cid-modal-row", key: label }, h("span", null, label), h("span", null, value));
}

export function writeErrorCard(view) {
	return h(
		"div",
		{ key: "write-error", className: "cid-modal-error", role: "alert", "data-cyber-error": view.code },
		h("strong", null, view.title),
		h("p", null, view.hint),
		h("code", null, view.code + " · " + view.message), view.commandId ? h("small", null, "操作编号：" + view.commandId) : null
	);
}

export function WriteButton(props) {
	return h(
		"button",
		{
			type: "button",
			className: "cid-write-btn",
			"data-tone": props.tone || "default",
			"data-cyber-write": props.action,
			disabled: props.disabled === true,
			title: props.title || undefined,
			onClick: props.disabled === true ? undefined : props.onClick,
		},
		props.label
	);
}

export function WriteModal(props) {
	var write = props.write;
            var modalRef = React.useRef(null);
            React.useEffect(function () {
                var previousFocus = document.activeElement;
                return function () { if (previousFocus && previousFocus.isConnected && previousFocus.focus) previousFocus.focus(); };
            }, []);
            React.useEffect(function () {
                var node = modalRef.current;
                if (!node) return;
                var first = node.querySelector('input:not(:disabled),textarea:not(:disabled),select:not(:disabled),button:not(:disabled)');
                (first || node).focus();
            }, [write.phase]);
            function trapFocus(event) {
                if (event.key !== 'Tab' || !modalRef.current) return;
                var nodes = Array.from(modalRef.current.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)'));
                if (!nodes.length) { event.preventDefault(); return; }
                var first = nodes[0], last = nodes[nodes.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
	var phase = write.phase;
	var kind = write.kind || "";
	var title = WRITE_TITLE[kind] || "写操作";
	var subtitle = "";
	var body = [];
	var fieldError = text(write.fieldError);
	if (phase === "compose") {
		if (kind === "message") {
			subtitle = "目标 " + text(write.seatName) + " · 需要确认";
			body.push(
				h(
					"label",
					{ className: "cid-field", key: "text" },
					h("span", { className: "cid-field-label" }, "消息内容"),
					h("textarea", {
						className: "cid-textarea",
						"data-cyber-field": "message-text",
						value: typeof write.text === "string" ? write.text : "",
						rows: 5,
						maxLength: WRITE_LIMIT.message,
						placeholder: "发给 " + text(write.seatName) + " 的内容",
						onChange: function (event) {
							props.onPatch({ text: event.target.value, fieldError: "" });
						},
					})
				)
			);
			body.push(h("p", { className: "cid-modal-note", key: "note" }, "消息将以团队负责人身份发送给 " + text(write.seatName) + "。"));
		} else if (kind === "assign") {
			subtitle = (write.taskId ? "指派现有任务给 " : "创建任务并指派给 ") + text(write.seatName);
                    body.push(h("label", {className:"cid-field",key:"existing"}, h("span",{className:"cid-field-label"},"任务"),
                        h("select",{className:"cid-input",value:write.taskId||"",onChange:function(event){var task=asArray(props.tasks).find(function(item){return item.id===event.target.value;});props.onPatch({taskId:task?task.id:"",taskRevision:task?task.revision:0,taskSubject:task?task.subject:"",fieldError:""});}},
                            h("option",{value:""},"创建新任务"),asArray(props.tasks).filter(function(task){return task.status!=="deleted"&&task.status!=="completed";}).map(function(task){return h("option",{key:task.id,value:task.id,disabled:isTaskBlocked(task)},task.subject+" · "+(task.ownerName||"未指派")+(isTaskBlocked(task)?" · 依赖未完成":""));}))));
                    if (!write.taskId) {
			body.push(
				h(
					"label",
					{ className: "cid-field", key: "subject" },
					h("span", { className: "cid-field-label" }, "任务标题"),
					h("input", {
						className: "cid-input",
						type: "text",
						"data-cyber-field": "assign-subject",
						value: typeof write.subject === "string" ? write.subject : "",
						maxLength: WRITE_LIMIT.subject,
						placeholder: "这次要做什么",
						onChange: function (event) {
							props.onPatch({ subject: event.target.value, fieldError: "" });
						},
					})
				)
			);
			body.push(
				h(
					"label",
					{ className: "cid-field", key: "description" },
					h("span", { className: "cid-field-label" }, "任务描述"),
					h("textarea", {
						className: "cid-textarea",
						"data-cyber-field": "assign-description",
						value: typeof write.description === "string" ? write.description : "",
						rows: 4,
						maxLength: WRITE_LIMIT.description,
						placeholder: "背景、验收标准、约束",
						onChange: function (event) {
							props.onPatch({ description: event.target.value, fieldError: "" });
						},
					})
				)
			);
			}
      body.push(h("label", { className: "cid-execute-option", key: "execute" },
        h("input", { type: "checkbox", "data-cyber-field": "assign-execute-now", checked: write.executeNow === true, disabled: write.executeAllowed === false,
          onChange: event => props.onPatch({ executeNow: event.target.checked, fieldError: "" }) }),
        h("span", null, "指派后立即执行")));
      body.push(h("p", { className: "cid-modal-note", key: "note" }, write.executeAllowed === false
        ? "该成员不能接收团队执行指令。可以先指派，再在原生会话中安排执行。"
        : write.executeNow ? "指派成功后自动发送执行指令；若成员正在工作，会收到追加指令。实际进度以成员状态和回复为准。" : "仅指派任务。之后也可在任务看板点击“立即执行”。"));
		} else if (kind === "interrupt") {
			subtitle = "目标 " + text(write.seatName) + " · 不可撤销";
			body.push(
				h(
					"div",
					{ className: "cid-modal-list", key: "summary" },
					writeRow("目标", text(write.seatName)),
					writeRow("当前状态", labelOf(write.seatState)),
					writeRow("动作", "agent.interrupt"),
					writeRow("会话", h("code", { className: "cid-code" }, text(write.floorId)))
				)
			);
			body.push(h("p", { className: "cid-modal-warn", key: "warn" }, "打断会终止目标当前回合；已产生的输出保留。确认后只发送一次。"));
		} else {
			subtitle = "任务 " + text(write.taskId) + " · rev " + String(write.taskRevision || 0);
			body.push(
				h(
					"div",
					{ className: "cid-modal-list", key: "summary" },
					writeRow("任务", text(write.taskId)),
					writeRow("标题", text(write.taskSubject) || "—"),
					writeRow("版本", "rev " + String(write.taskRevision || 0)),
					writeRow("动作", { reopen: "重开为待办", complete: "标记完成", delete: "删除任务", start: "通知当前负责人立即执行" }[kind])
				)
			);
      const taskWarning = { reopen: "重开会恢复为待办，并取消原负责人。需要继续执行时，请重新派活。", complete: "只将这项任务标记完成，不会打断成员当前回合。",
        delete: "确认后从任务看板移除，插件不提供恢复入口。有其他任务依赖它时不能删除。删除不会打断成员当前回合，如需停止工作请另行打断。",
        start: "向当前负责人发送立即执行指令。若成员正在工作，会收到追加指令，不会强制打断；实际进度以成员状态和回复为准。" };
      body.push(h("p", { className: "cid-modal-warn", key: "warn" }, taskWarning[kind]));
		}
		if (fieldError) body.push(h("p", { className: "cid-write-error", role: "alert", key: "field-error", "data-cyber-field-error": "1" }, fieldError));
	} else if (phase === "running") {
		subtitle = "提交中 · 不会自动重试";
		body.push(h("p", { className: "cid-modal-note", key: "running" }, kind === "assign" ? (write.executeNow ? "正在指派任务并发送执行指令…" : "正在指派任务…") : "正在提交到 " + COMMAND_PATH + "…"));
		body.push(h("p", { className: "cid-modal-note", key: "no-retry" }, "不会自动重试；结果返回后请按提示处理。"));
	} else if (phase === "done") {
		subtitle = "已提交 · 正在同步最新状态";
		body.push(h("p", { className: "cid-write-status", "data-tone": "ok", role: "status", key: "done" }, text(write.doneMessage) || "操作成功。"));
  } else if (phase === "assigned") {
    title = write.error && write.error.deliveryUnknown ? "已指派，执行指令结果待确认" : "已指派，执行指令未送达";
    subtitle = "保留指派结果 · 不会重复创建或自动重发";
    body.push(h("p", { className: "cid-modal-warn", key: "assigned" }, write.doneMessage));
    if (write.error) body.push(writeErrorCard(write.error));
	} else if (phase === "unowned") {
		title = write.error && write.error.deliveryUnknown ? "任务已创建，指派结果待确认" : "任务保留在看板，指派未完成";
		subtitle = "先刷新核对，再通过派活选择现有任务";
		body.push(h("p", { className: "cid-modal-warn", key: "warn" }, "请勿重复创建任务。刷新后选择目标成员，点击“派活”，在“任务”中选择这项现有任务。"));
		if (write.task && isObject(write.task)) {
			body.push(
				h(
					"div",
					{ className: "cid-modal-list", key: "task" },
					writeRow("任务", text(write.task.id) || "—"),
					writeRow("标题", text(write.task.subject) || "—"),
					writeRow("状态", taskStatusLabel(text(write.task.status)) || "—")
				)
			);
		}
		if (write.error) body.push(writeErrorCard(write.error));
	} else if (phase === "error") {
		var view = write.error || describeWriteError(null);
		title = view.title;
		subtitle = "已停止 · 不会自动重试";
		body.push(writeErrorCard(view));
		if (view.refreshHint) body.push(h("p", { className: "cid-modal-note", key: "refresh" }, "刷新快照会更新任务 revision；确认后再重新操作。"));
		if (view.busy) body.push(h("p", { className: "cid-modal-note", key: "busy" }, "同一命令仍在宿主执行；不会重发，请稍后刷新快照。"));
		if (view.deliveryUnknown) body.push(h("p", { className: "cid-modal-warn", key: "delivered" }, kind === "message" ? "消息可能已经投递：先去目标会话确认，不要直接重发。" : "命令可能已经送达：先刷新快照确认目标状态，不要直接重发。"));
	}

	var actions = [];
	if (phase === "compose") {
		actions.push(h("button", { key: "cancel", type: "button", className: "cid-modal-btn", "data-cyber-cancel": "1", onClick: props.onCancel }, "取消"));
		actions.push(
			h(
				"button",
				{
					key: "confirm",
					type: "button",
					className: "cid-modal-btn",
					"data-tone": ["interrupt", "complete", "delete"].includes(kind) ? "danger" : "primary",
					"data-cyber-confirm": "1",
					onClick: props.onConfirm,
				},
				kind === "assign" ? (write.executeNow ? "确认指派并立即执行" : write.taskId ? "确认指派" : WRITE_CONFIRM_LABEL.assign) : WRITE_CONFIRM_LABEL[kind] || "确认"
			)
		);
	} else if (phase !== "running") {
		if (phase === "error" && write.error && write.error.refreshHint) {
			actions.push(h("button", { key: "refresh", type: "button", className: "cid-modal-btn", "data-cyber-refresh": "1", onClick: props.onRefreshAndClose }, "刷新快照"));
		}
		actions.push(h("button", { key: "close", type: "button", className: "cid-modal-btn", "data-tone": "primary", "data-cyber-cancel": "1", onClick: props.onCancel }, "关闭"));
	}

	return h(
		"div",
		{ className: "cid-modal-backdrop", onMouseDown: props.onBackdrop },
		h(
			"div",
			{ ref: modalRef, tabIndex: -1, onKeyDown: trapFocus, className: "cid-modal", role: "dialog", "aria-modal": "true", "aria-label": title, "data-cyber-modal": "write", "data-cyber-kind": kind, "data-cyber-phase": phase },
			h("div", { className: "cid-modal-head" }, h("h4", { className: "cid-modal-title" }, title), subtitle ? h("div", { className: "cid-modal-sub" }, subtitle) : null),
			body,
			actions.length > 0 ? h("div", { className: "cid-modal-actions" }, actions) : null
		)
	);
}
