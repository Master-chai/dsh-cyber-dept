import React from 'react';
import {Page} from '../components/page.js';
import {CyberIcon} from '../components/primitives.js';
import {PANEL_ID} from '../common.js';
import {officeThemeStore} from '../office-theme.js';
import {installStyles} from '../styles.js';
import {setRuntimeContext,openRightOffice} from './navigation.js';
const h=React.createElement;
const MemoPage=React.memo(Page);
export const inject = ["slots", "sessions", "layout", "uiWorkspace", "sidebarRightTabs", "sidebarRight", "theme"];
export function RightPane(props) {
	var info = typeof props.useTabInfo === "function" ? props.useTabInfo() : null;
	return h(MemoPage, Object.assign({}, props, { key: props.officeSessionId, active: !info || info.tab.visible }));
}
export function OfficeLauncher() { return null; }
export function apply(ctx) {
	ctx.effect(function () {
		officeThemeStore.update(ctx.theme.getTheme());
		return ctx.on("theme/change", officeThemeStore.update);
	}, "cyber-dept: follow DSH theme");
	installStyles();
	ctx.effect(function () { return setRuntimeContext(ctx); }, "cyber-dept: navigation lifetime");
	var RIGHT_TAB_ID = "cyber-dept-right";
	if (ctx.sidebarRightTabs && typeof ctx.sidebarRightTabs.register === "function") {
		ctx.effect(function () {
			return ctx.sidebarRightTabs.register({
				id: RIGHT_TAB_ID,
				kind: "cyberdept",
				title: function () { return "赛博 IT"; },
				guide: [{ id: "cyber-dept-right-entry", title: function () { return "赛博 IT 部门"; }, order: 20 }],
			});
		}, "cyber-dept: right tab type");
		ctx.effect(function () {
			return ctx.slots.inject("sidebar.right.pane.tab", function () {
				return ctx.slots.register({ name: "sidebar.right.pane.tab", key: RIGHT_TAB_ID, inject: function (sessionId) { return { officeSessionId: sessionId }; } }, RightPane);
			});
		}, "cyber-dept: right tab body");
	}
	ctx.slots.inject("main", function () {
		return ctx.slots.register({ name: "main", key: PANEL_ID }, OfficeLauncher);
	});
	// The host owns the IT row click. Redirect its panel selection synchronously,
	// before React can replace/unmount the conversation with a global page.
	ctx.effect(function () {
		function sync() {
			if (ctx.layout.panelInfo.getSnapshot().activePanelId === PANEL_ID) openRightOffice();
		}
		var dispose = ctx.layout.panelInfo.subscribe(sync);
		sync();
		return dispose;
	}, "cyber-dept: launch in current conversation sidebar");

	ctx.slots.inject("sidebar.panellist", function () {
		return ctx.slots.register({ name: "sidebar.panellist", id: PANEL_ID, order: 42, label: "IT" }, CyberIcon);
	});
}
