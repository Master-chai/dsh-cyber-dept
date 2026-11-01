import { asArray, EMPTY_SESSIONS } from "../common.js";
import { projectionOf } from "../model/floor.js";

export function currentOfficeFloor(floors, sessionId) {
	if (!sessionId) return null;
	return asArray(floors).find(function (floor) { return floor.id === sessionId; }) ||
		asArray(floors).find(function (floor) {
			return asArray(floor.members).some(function (member) { return (member.sessionId || member.id) === sessionId; });
		}) || null;
}

// Stable slices prevent another conversation's token/projection updates from
// rerendering this office. Hidden retained tabs keep their last slice frozen.
export function createOfficeSelector(kind) {
	var previous = null, previousRefs = [], previousIds = "";
	return function (state, ids, active) {
		if (!active) return previous || (kind === "status" ? null : EMPTY_SESSIONS);
		state = state || {};
		var selectedIds = new Set(ids);
		if (kind === "sessions") ids.forEach(function (id) {
			var team = projectionOf(state, id, "agentTeam");
			asArray(team && team.members).forEach(function (member) { if (member.id) selectedIds.add(member.id); });
		});
		var keys = Array.from(selectedIds).sort(), identity = keys.join("|");
		var refs = [], next = kind === "status" ? new Map() : { byId: {}, projectionsBySession: {} };
		keys.forEach(function (id) {
			if (kind === "status") {
				var value = typeof state.get === "function" ? state.get(id) : undefined;
				refs.push(value); next.set(id, value);
			} else {
				var summary = state.byId && state.byId[id], block = state.projectionsBySession && state.projectionsBySession[id];
				var values = block && block.values || {};
				refs.push(summary && summary.displayTitle, summary && summary.running, summary && summary.projectionValues && summary.projectionValues.modelSelection,
					values.agentTeam, values.cyberAgent, values.title, values.modelSelection);
				next.byId[id] = summary;
				next.projectionsBySession[id] = { values: { agentTeam: values.agentTeam, cyberAgent: values.cyberAgent, title: values.title, modelSelection: values.modelSelection } };
			}
		});
		if (previous && identity === previousIds && refs.every(function (ref, index) { return ref === previousRefs[index]; })) return previous;
		previousIds = identity; previousRefs = refs; previous = next;
		return next;
	};
}
