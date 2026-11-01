import { asArray, text } from "../common.js";
import { normalizeFloor } from "../model/normalize.js";
import { projectionOf, mergeFloor } from "../model/floor.js";

export function createOfficeViewCache(capacity, ttlMs, now) {
	var entries = new Map();
	return {
		get: function (id) {
			var entry = entries.get(id);
			if (!entry) return null;
			if (now() - entry.at >= ttlMs) { entries.delete(id); return null; }
			entries.delete(id); entries.set(id, entry);
			return entry.view;
		},
		set: function (id, view) {
			entries.delete(id);
			if (!view) return;
			entries.set(id, { view: view, at: now() });
			while (entries.size > capacity) entries.delete(entries.keys().next().value);
		}
	};
}
export const officeViewCache = createOfficeViewCache(8, 120000, Date.now);

export function localOfficePreview(sessionId, sessions, statusMap) {
	var team = projectionOf(sessions, sessionId, "agentTeam");
	if (!team || asArray(team.members).length < 2) return null;
	var summary = sessions.byId && sessions.byId[sessionId];
	var floor = normalizeFloor({ id: sessionId, kind: "team", title: text(summary && summary.displayTitle) || projectionOf(sessions, sessionId, "title"), members: team.members, tasks: team.tasks });
	return mergeFloor(floor, sessions, statusMap);
}
