import React from 'react';
import {Avatar,StateBadge,Fact} from './primitives.js';
import {WriteButton,WriteModal} from './write-modal.js';
import {useOfficeCommands} from '../commands/use-commands.js';
import {useNativeSession} from '../host/use-native-session.js';
import {labelOf,roleLabelOf,taskStatusLabel,formatClock,isTaskBlocked} from '../common.js';
const h=React.createElement;
export function DetailPane(props) {
  const navigation=useNativeSession((props.floor?.id||'')+':'+(props.seat?.id||''));
  const {seat,floor,write,last,gate,canWrite,floorId,taskRef,actionRef,actionKind,taskReady,taskCompleted,blockedReason,selfTarget,memberReady,messageAllowed,interruptAllowed,assignAllowed,taskAllowed,openMessage,openInterrupt,openComplete,openReopen,openAssign,patchWrite,closeWrite,refreshAndClose,onBackdrop,runWrite} = useOfficeCommands(props);
  if (!seat) return h("aside", {className:"cid-detail","aria-label":"员工介绍"},h("div",{className:"cid-empty"},"选择一位成员查看介绍、状态与任务。"));
  var facts = [
		seat.model ? h(Fact, { key: "model", label: "模型", value: (seat.provider ? seat.provider + " / " : "") + seat.model }) : null,
		seat.tool
			? h(Fact, {
					key: "tool",
					label: "当前工具",
					value: seat.tool.name + (seat.tool.summary ? " · " + seat.tool.summary : ""),
				})
			: null,
		seat.approval
			? h(Fact, {
					key: "approval",
					label: "待审批",
					value: h(
						"span",
						null,
						seat.approval.toolName,
						seat.approval.reason ? " · " + seat.approval.reason : "",
						h("span", { className: "cid-muted" }, "（需在会话内处理）")
					),
				})
			: null,
		seat.task
			? h(Fact, {
					key: "task",
					label: props.taskOverride ? "选中任务" : "当前任务",
					value: h(
						"span",
						null,
						seat.task.subject,
						" ",
						h("span", { className: "cid-muted" }, "[" + taskStatusLabel(seat.task.status) + (taskRef && taskRef.revision > 0 ? " · rev " + String(taskRef.revision) : " · 无 revision") + "]" + (isTaskBlocked(seat.task) ? " 依赖未就绪" : ""))
					),
				})
			: null,
		seat.error ? h(Fact, { key: "error", label: "错误", value: h("span", { className: "cid-error" }, seat.error) }) : null,
		seat.since ? h(Fact, { key: "since", label: "打卡时间：", value: formatClock(seat.since) }) : null,
		seat.updatedAt ? h(Fact, { key: "updated", label: "最后更新", value: formatClock(seat.updatedAt) }) : null,
	];

	var taskButtonTitle = actionRef ? (actionKind === "reopen" ? "task.reopen" : "task.complete") + " · " + actionRef.id + " · rev " + String(actionRef.revision) : "没有可操作的宿主任务：需要 task id 与 revision";
	var gateTitle = canWrite ? "" : blockedReason;

	return h(
		"aside",
		{ className: "cid-detail", "aria-label": "员工介绍" },
		h("div", { className: "cid-employee-card" },
			h("div", { className: "cid-employee-brand" }, h("span", null, "赛博 IT"), h("span", null, "员工介绍")),
		h(
			"div",
			{ className: "cid-employee-profile" },
			h("div", { className: "cid-employee-identity" },
			h(Avatar, { id: seat.id, name: seat.name, state: seat.state, large: true }),
			h(
				"div",
				{ className: "cid-detail-headtext" },
				h("h3", { className: "cid-detail-title" }, seat.name),
				h("div", { className: "cid-employee-status" }, h("span", { className: "cid-detail-sub" }, roleLabelOf(seat.role)), h(StateBadge, { state: seat.state }))
			)),
			h("div", { className: "cid-employee-duty" }, h("span", null, "职责"), h("p", null, seat.roleText || "暂未填写职责"))
		),
		h("section", {className:"cid-employee-current", "aria-label":"当前工作"},
      h("span", {className:"cid-employee-kicker"}, props.taskOverride ? "选中任务" : "当前任务"),
      h("h4", null, seat.task ? seat.task.subject : "暂无关联任务"),
      seat.task && seat.task.description ? h("p", null, seat.task.description) : null),
    h("dl", { className: "cid-facts cid-employee-facts" }, facts)),
		h(
			"section",
			{ className: "cid-write", "aria-label": "沟通", "data-cyber-write-enabled": canWrite ? "1" : "0", "data-cyber-write-state": canWrite ? "enabled" : "disabled" },
			h(
				"div",
				{ className: "cid-write-grid" },
				h(WriteButton, {
					action: "message",
					label: "发消息",
					disabled: !messageAllowed,
					title: !canWrite ? gateTitle : selfTarget ? "负责人不能通过团队接口给自己发消息" : !memberReady ? "成员尚未就绪" : "发送给该成员的原生会话",
					onClick: openMessage,
				}),
				h(WriteButton, {
					action: "interrupt",
					label: "打断",
					tone: "danger",
					disabled: !interruptAllowed,
					title: !canWrite ? gateTitle : selfTarget ? "负责人不能打断自己" : !interruptAllowed ? "当前没有可打断的运行回合" : "停止当前回合，保留已产生的输出",
					onClick: openInterrupt,
				}),
				h(WriteButton, {
					action: actionKind || "complete",
					label: actionKind === "reopen" ? "重开任务" : "完成任务",
					disabled: !taskAllowed,
					title: !canWrite ? gateTitle : taskAllowed ? taskButtonTitle : "请在任务看板选择进行中或已完成的具体任务",
					onClick: actionKind === "reopen" ? openReopen : openComplete,
				}),
				h(WriteButton, {
					action: "assign",
					label: "派活",
					disabled: !assignAllowed,
                            title: !canWrite ? gateTitle : !memberReady ? "成员尚未就绪" : "创建新任务或指派现有任务",
					onClick: openAssign,
				}),
				seat.approval
					? h(WriteButton, {
							action: "approval",
							label: "去处理审批",
							disabled: false,
							title: "打开该 Agent 的原生会话审批面板；办公室不注册第二个 answerer",
							onClick: function () { return navigation.open(seat); },
					  })
					: null
			),
			navigation.opening ? h("p", {className:"cid-write-status", role:"status"}, "正在打开原生会话…") : null,
			navigation.error ? h("p", {className:"cid-write-status", "data-tone":"error", role:"alert"}, navigation.error) : null,
			last ? h("p", { className: "cid-write-status", "data-tone": last.tone, role: "status", "data-cyber-write-status": "1" }, last.text) : null,
			!canWrite && gate.reason ? h("p", { className: "cid-write-note", "data-cyber-write-blocked": gate.reason }, "只读原因：" + gate.reason) : null,
			seat.approval
				? h("p", { className: "cid-write-note" }, "在原生会话中查看请求详情并处理审批。")
				: null
		),
		write
			? h(WriteModal, {
					key: "write-modal",
					write: write, tasks: floor.tasks,
					onPatch: patchWrite,
					onCancel: closeWrite,
					onConfirm: function () {
						return runWrite(write);
					},
					onRefreshAndClose: refreshAndClose,
					onBackdrop: onBackdrop,
				})
			: null
	);
}
