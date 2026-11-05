import React from 'react';
import {officeThemeStore} from '../office-theme.js';
import {useOfficeSession} from '../sync/use-office-session.js';
import {useOfficeView,useOfficeNotices} from '../office-interactions.js';
import {taskOwnerSeat} from '../task-board.js';
import {writeGateOf} from '../commands/protocol.js';
import {EMPTY_FLOORS,formatClock} from '../common.js';
import {FloorPane,CollapsibleSection} from './sections.js';
import {DetailPane} from './employee-card.js';
import {SeatBand} from './members.js';
import {useTaskCommands} from '../commands/use-task-commands.js';
import {WriteModal} from './write-modal.js';
const h=React.createElement;
export function Page(props) {
	var scheme = React.useSyncExternalStore(officeThemeStore.subscribe, officeThemeStore.getSnapshot, officeThemeStore.getSnapshot);
	const sessionId=props.officeSessionId;
  const {initialPreview,snapshot,validated,fetchError,activeFloor,refresh,source}=useOfficeSession(props);
  var view = useOfficeView(sessionId, props.active, !!activeFloor);
	var selectedSeatId = view.value.seatId, selectedTaskId = view.value.taskId;
	var notices = useOfficeNotices(activeFloor, props.active && validated);
	var recent = new Set(notices.map(function (notice) { return notice.key; }));
	var activeSeats = activeFloor ? activeFloor.seats : EMPTY_FLOORS;
	var activeSeat = activeSeats.find(function (seat) { return seat.id === selectedSeatId; }) || activeSeats[0] || null;
	var activeSeatId = activeSeat ? activeSeat.id : null;
	var selectedTask = activeFloor && activeFloor.tasks.find(function (task) { return task.id === selectedTaskId && task.status !== "deleted"; });
	var unassignedTask = selectedTask && !taskOwnerSeat(selectedTask, activeSeats);
	if (unassignedTask) activeSeatId = null;
	function selectSeat(id) { view.fold("detail", true); view.change({ seatId: id, taskId: null }); }
	function selectTask(task) {
		var owner = taskOwnerSeat(task, activeSeats);
		view.fold("detail", true);
		if (owner) view.fold("office", true);
		view.change({ taskId: task.id, seatId: owner ? owner.id : null });
	}
	var writeGate = writeGateOf(source, snapshot || { state: "unavailable" }, activeFloor);
  const taskCommands=useTaskCommands({floor:activeFloor,writeGate,onRefresh:refresh,onDeleted:id=>{
    const patch={};
    if(view.value.taskId===id)patch.taskId=null;
    if(view.value.expandedTaskId===id)patch.expandedTaskId=null;
    view.change(patch);
  }});
	var banner = fetchError ? "刷新失败，请重试。" : snapshot && snapshot.state === "degraded" ? "部分状态暂不可用" : "";
	return h("div", { className: "cid-root cid-current", "data-theme": scheme, "data-source": source, "data-session-id": sessionId },
		h("header", { className: "cid-header" },
			h("div", { className: "cid-logo", "aria-hidden": "true" }, "IT"),
			h("div", { className: "cid-header-main" }, h("h1", { className: "cid-title" }, "赛博 IT"),
				h("div", { className: "cid-subtitle" }, "当前会话 · " + (source === "host" ? "同步于 " + formatClock(snapshot.sampledAt) : snapshot || initialPreview ? "上次状态 · 正在更新…" : activeFloor ? "本地预览 · 正在更新…" : "正在同步…"))),
			h("button", { type: "button", className: "cid-btn", onClick: refresh }, fetchError ? "重试" : "刷新")),
		banner ? h("div", { className: "cid-banner", role: "status", title: fetchError || banner }, banner) : null,
		h("div", { className: "cid-update-toast", role: "status", "aria-live": "polite", "aria-atomic": "true" }, notices.length ? notices.slice(0, 2).map(function (notice) { return notice.text; }).join("；") + (notices.length > 2 ? "；另有 " + (notices.length - 2) + " 项更新" : "") : ""),
		h("div", { className: "cid-body", ref: view.body, onScroll: view.scroll },
			activeFloor ? h(FloorPane, { floor: activeFloor, scheme: scheme, visible: props.active, active: props.active && source === "host", preview: source === "preview", currentOnly: true, selectedSeatId: activeSeatId,
				view: view, recent: recent, writeGate, onTaskAction:taskCommands.open, taskActionStatus:taskCommands.last,
				detail: h(CollapsibleSection, { key: "detail-" + activeFloor.id, sectionKey: "detail", title: "员工介绍", meta: unassignedTask ? "未指派" : activeSeat ? activeSeat.name : "", expanded: view.value.folds.detail, onToggle: view.fold },
					unassignedTask ? h("div", { className: "cid-detail" }, h("h3", null, selectedTask.subject), h("p", null, selectedTask.description || "暂无任务说明。"), h("p", { className: "cid-muted" }, "此任务尚未关联到可用成员。可先选择成员，再用“派活”选择这项现有任务。")) :
					h(DetailPane, { seat: activeSeat, taskOverride: selectedTask && taskOwnerSeat(selectedTask, activeSeats) === activeSeat ? selectedTask : null, floor: activeFloor, writeGate: writeGate, onRefresh: refresh })),
				onSelectSeat: selectSeat, selectedTaskId: selectedTaskId,
				onSelectTask: selectTask,
                trailing: h("div", { className: "cid-side" },
                    h(CollapsibleSection, { sectionKey: "members", title: "团队成员", meta: activeSeats.length + " 位", expanded: view.value.folds.members, onToggle: view.fold },
                        h(SeatBand, { floor: activeFloor, selectedSeatId: activeSeatId, onSelectSeat: selectSeat })))
			}) : h("section", { className: "cid-floor-pane" }, h("div", { className: "cid-empty", role: "status" },
				fetchError ? "当前会话状态暂时无法读取。" : snapshot ? "当前会话尚未建立团队或任务。" : "正在读取当前会话…"))),
    taskCommands.write ? h(WriteModal,{write:taskCommands.write,onConfirm:taskCommands.confirm,onCancel:taskCommands.close,onBackdrop:taskCommands.onBackdrop,onRefreshAndClose:taskCommands.refreshAndClose}) : null);
}
