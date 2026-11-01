import React from 'react';
import {Avatar,StateBadge} from './primitives.js';
import {labelOf,roleLabelOf,taskStatusLabel} from '../common.js';
const h=React.createElement;
export function SeatCard(props) {
	var seat = props.seat;
	var taskLine = null;
	if (seat.task) {
		taskLine = h(
			"span",
			{ className: "cid-seat-task" },
			h("span", { className: "cid-seat-task-label" }, taskStatusLabel(seat.task.status)),
			h("span", { className: "cid-seat-task-value", title: seat.task.subject }, seat.task.subject)
		);
	} else if (seat.tool) {
		taskLine = h(
			"span",
			{ className: "cid-seat-task", title: seat.tool.name + (seat.tool.summary ? " · " + seat.tool.summary : "") },
			h("span", { className: "cid-seat-task-label" }, "工具"),
			h("span", { className: "cid-seat-task-value" }, seat.tool.name + (seat.tool.summary ? " · " + seat.tool.summary : ""))
		);
	}
	return h(
		"button",
		{
			type: "button",
			className: "cid-seat",
			"aria-pressed": props.selected === true,
			"aria-label": seat.name + " · " + roleLabelOf(seat.role) + " · " + labelOf(seat.state),
			onClick: function () {
				props.onSelect(seat.id);
			},
		},
		h(
			"span",
			{ className: "cid-seat-top" },
			h(Avatar, { id: seat.id, name: seat.name, state: seat.state }),
			h(
				"span",
				{ className: "cid-seat-id" },
				h("span", { className: "cid-seat-name", title: seat.name }, seat.name),
				h("span", { className: "cid-seat-role" }, roleLabelOf(seat.role) + (seat.phase === "provisioning" ? " · 启动中" : ""))
			)
		),
		h(
			"span",
			{ className: "cid-seat-badges" },
			h(StateBadge, { state: seat.state }),
			seat.approval && seat.state !== "waiting-approval" ? h("span", { className: "cid-chip", "data-tone": "warn" }, "待审批") : null,
			seat.orphan ? h("span", { className: "cid-chip", "data-tone": "muted" }, "未连会话") : null
		),
		seat.roleText ? h("span", { className: "cid-clamp" }, seat.roleText) : null,
		taskLine
	);
}

export function SeatBand(props) {
	var floor = props.floor;
	if (!floor || !Array.isArray(floor.seats) || floor.seats.length === 0) return null;
	var visible = floor.seats;
	return h(
		"aside",
		{ className: "cid-seat-band", "aria-label": "团队成员" },
		h(
			"div",
			{ className: "cid-band-head" },
			h("span", { className: "cid-band-title" }, "团队成员"),
			h("span", { className: "cid-band-count" }, String(floor.seats.length) + " 席")
		),
		h(
			"ul",
			{ className: "cid-seats cid-seats-band" },
			visible.map(function (seat) {
				return h("li", { key: seat.id }, h(SeatCard, { seat: seat, selected: seat.id === props.selectedSeatId, onSelect: props.onSelectSeat }));
			})
		),
		floor.seats.length > 12 ? h("p", { className: "cid-band-more" }, "场景按每组 12 席显示；选择成员可跳到对应工位。") : null
	);
}
