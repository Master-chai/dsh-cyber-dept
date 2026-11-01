import * as React from 'react';
import { EMPTY_SESSIONS, errorText } from '../common.js';
import { mergeFloor } from '../model/floor.js';
import { createOfficeSelector, currentOfficeFloor } from './selectors.js';
import { officeViewCache, localOfficePreview } from './view-cache.js';
import { loadSnapshot } from './snapshot-client.js';
import { createSnapshotSync } from './snapshot-sync.js';

/** Data hook: the page owns selection and markup, this hook owns freshness. */
export function useOfficeSession(props) {
  const sessionId = props.officeSessionId;
  const initialPreview = React.useMemo(() => officeViewCache.get(sessionId), [sessionId]);
  const [record, setRecord] = React.useState({ sessionId, snapshot: null, validated: false, fetchError: null });
  // Never expose a previous session's data even before the old effect cleans up.
  const own = record.sessionId === sessionId ? record : { snapshot: null, validated: false, fetchError: null };
  const snapshot = own.snapshot, validated = own.validated && props.active, fetchError = own.fetchError;
  let rawFloor = currentOfficeFloor(snapshot?.floors, sessionId);
  if (!rawFloor && snapshot?.current?.sessionId === sessionId) rawFloor = currentOfficeFloor(snapshot.floors, snapshot.current.floorId);
  const trackingFloor = rawFloor || initialPreview?.floor;
  const trackedIds = [sessionId].concat(trackingFloor ? [trackingFloor.id].concat(trackingFloor.members.map(member => member.id)) : []);
  const sessionSelector = React.useMemo(() => createOfficeSelector('sessions'), []);
  const statusSelector = React.useMemo(() => createOfficeSelector('status'), []);
  const selectSessions = React.useCallback(state => sessionSelector(state, trackedIds, props.active), [sessionSelector, trackedIds.join('|'), props.active]);
  const sessions = (typeof props.useSessions === 'function' ? props.useSessions(selectSessions) : null) || EMPTY_SESSIONS;
  const statusIds = Object.keys(sessions.projectionsBySession || {});
  const selectStatus = React.useCallback(state => statusSelector(state, statusIds, props.active), [statusSelector, statusIds.join('|'), props.active]);
  const statusMap = typeof props.useSessionStatus === 'function' ? props.useSessionStatus(selectStatus) : null;
  const [refreshIndex, setRefreshIndex] = React.useState(0);
  const activeFloor = React.useMemo(() => {
    if (snapshot) return rawFloor ? mergeFloor(rawFloor, sessions, statusMap) : null;
    return initialPreview ? initialPreview.floor : localOfficePreview(sessionId, sessions, statusMap);
  }, [snapshot, rawFloor, sessions, statusMap, initialPreview, sessionId]);
  React.useEffect(() => {
    if (snapshot && validated && props.active) officeViewCache.set(sessionId, activeFloor ? { floor: activeFloor, sampledAt: snapshot.sampledAt } : null);
  }, [sessionId, snapshot, activeFloor, validated, props.active]);
  const refresh = React.useCallback(() => {
    setRecord(previous => previous.sessionId === sessionId ? { ...previous, validated: false } : previous);
    setRefreshIndex(value => value + 1);
  }, [sessionId]);
  React.useEffect(() => {
    if (!sessionId || !props.active) {
      setRecord(previous => previous.sessionId === sessionId ? { ...previous, validated: false } : previous);
      return;
    }
    const sync = createSnapshotSync({ sessionId, load: loadSnapshot,
      onSnapshot(value) { setRecord({ sessionId, snapshot: value, validated: true, fetchError: null }); },
      onError(error) {
        setRecord(previous => ({ sessionId, snapshot: previous.sessionId === sessionId ? previous.snapshot : null, validated: false, fetchError: errorText(error) }));
      },
    });
    sync.start();
    return () => sync.dispose();
  }, [sessionId, refreshIndex, props.active]);
  const source = snapshot && validated ? 'host' : activeFloor ? 'preview' : 'loading';
  return { initialPreview, snapshot, validated, fetchError, activeFloor, refresh, source };
}
