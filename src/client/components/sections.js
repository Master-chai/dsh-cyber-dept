import React from 'react';
import {OfficeScene} from '../office-scene.js';
import {TaskBoard} from '../task-board.js';
const h=React.createElement;
export function CollapsibleSection(props) {
	var expandedState = React.useState(true);
	var expanded = props.expanded === undefined ? expandedState[0] : props.expanded;
	var contentId = React.useId();
	return h("section", { className: "cid-fold cid-fold-" + props.sectionKey, "aria-label": props.title },
		h("h3", { className: "cid-fold-heading" },
			h("button", { type: "button", className: "cid-fold-toggle", "aria-expanded": expanded,
				"aria-controls": contentId, onClick: function () { if (props.onToggle) props.onToggle(props.sectionKey, !expanded); else expandedState[1](!expanded); } },
				h("span", { className: "cid-fold-arrow", "aria-hidden": "true" }, "›"),
				h("span", { className: "cid-fold-title" }, props.title),
				props.meta ? h("span", { className: "cid-fold-meta" }, props.meta) : null,
				h("span", { className: "cid-fold-action", "aria-hidden": "true" }, expanded ? "收起" : "展开"))),
		// Keep children mounted so task filters, selection and animation mode survive folding.
		h("div", { id: contentId, className: "cid-fold-content", hidden: !expanded }, props.lazy && !expanded ? null : props.children));
}

export function FloorPane(props) {
	var floor = props.floor;
	if (!floor) return h("section", { className: "cid-floor-pane" }, h("div", { className: "cid-empty" }, "暂无楼层数据"));
	return h(
		"section",
		{ className: "cid-floor-pane", "aria-label": props.currentOnly ? "当前会话办公室" : "楼层" },
		h(CollapsibleSection, { key: "scene-" + floor.id, sectionKey: "office", title: "办公室", meta: floor.seats.length + " 位成员", expanded: props.view.value.folds.office, onToggle: props.view.fold },
			h(OfficeScene, { floor: floor, scheme: props.scheme, visible: props.visible && props.view.value.folds.office, active: props.active && props.view.value.folds.office, selectedSeatId: props.selectedSeatId, onSelectSeat: props.onSelectSeat, recent: props.recent })),
		props.detail,
		h(CollapsibleSection, { key: "tasks-" + floor.id, sectionKey: "tasks", title: "任务看板", meta: floor.tasks.filter(function (task) { return task.status !== "deleted"; }).length + " 项", expanded: props.view.value.folds.tasks, onToggle: props.view.fold, lazy: true },
			h(TaskBoard, { floor: floor, onSelectTask: props.onSelectTask, selectedTaskId: props.selectedTaskId, view: props.view, recent: props.recent,writeGate:props.writeGate,onTaskAction:props.onTaskAction,taskActionStatus:props.taskActionStatus }))
	);
}
