import React from 'react';
import {OFFICE_SPRITES} from '../assets.js';
import {officeHash} from '../scene/model.js';
import {labelOf} from '../common.js';
const h=React.createElement;
export function CyberIcon(props) {
	var size = typeof props.size === "number" && props.size > 0 ? props.size : 18;
	return h(
		"svg",
		{
			viewBox: "0 0 24 24",
			width: size,
			height: size,
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 1.6,
			strokeLinecap: "round",
			strokeLinejoin: "round",
			"aria-hidden": "true",
			focusable: "false",
		},
		h("rect", { x: 3.5, y: 8, width: 7.5, height: 12 }),
		h("rect", { x: 13, y: 12, width: 7.5, height: 8 }),
		h("path", { d: "M5.5 12h3M5.5 15.5h3M15 15.5h3.5M15 18h3.5M7.25 8V5.5h3.5" }),
		h("path", { d: "M7 5.5V3.5" }),
		h("circle", { cx: 7, cy: 2.75, r: 0.9 })
	);
}

export function Avatar(props) {
	return h(
		"span",
		{ className: "cid-avatar", "data-large": props.large === true ? "true" : "false", "aria-hidden": "true" },
		h("span", { className: "cid-avatar-pixel", style: { backgroundImage: "url(" + OFFICE_SPRITES[officeHash(props.id || props.name || "") % 6] + ")" } }),
		h("span", { className: "cid-avatar-dot", "data-state": props.state || "idle" })
	);
}

export function StateBadge(props) {
	var state = props.state || "idle";
	return h(
		"span",
		{ className: "cid-state", "data-state": state },
		h("span", { className: "cid-dot", "data-state": state }),
		labelOf(state)
	);
}

export function Fact(props) {
	return h("div", { className: "cid-fact" }, h("dt", null, props.label), h("dd", null, props.value));
}
