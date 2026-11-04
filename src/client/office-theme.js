/** DSH theme adapter. No independent preference or OS listener. */
export function resolveOfficeScheme(snapshot) {
  return snapshot && snapshot.active && snapshot.active.colorScheme === 'dark' ? 'dark' : 'light';
}
export function createOfficeThemeStore() {
  var scheme='light', listeners=new Set();
  return {
    getSnapshot:function(){return scheme;},
    subscribe:function(listener){listeners.add(listener);return function(){listeners.delete(listener);};},
    update:function(snapshot){var next=resolveOfficeScheme(snapshot);if(next===scheme)return;scheme=next;listeners.forEach(function(listener){listener();});}
  };
}
export const officeThemeStore=createOfficeThemeStore();
// Preserve room luminance and dark-theme depth; presentation is monochrome.
var OFFICE_ROOM_DARK = {
  "#a56718": "#edbd73",
  "#be4c46": "#f08080",
  "#4c8256": "#91caa5",
  "#2c896b": "#8cdbc5",
  "#758477": "#8896a3",
  "#cbd6c7": "#111b25",
  "#e5e4d4": "#293540",
  "#ecebdc": "#2c3943",
  "#e7e6d6": "#2b3741",
  "#dbddca": "#303e48",
  "#e8eee0": "#344854",
  "#f8faef": "#5b7179",
  "#bacab3": "#1b2b36",
  "#9fb49b": "#607074",
  "#a6bdb5": "#101b27",
  "#bee3e5": "#284251",
  "#d4edf0": "#355260",
  "#98bfc7": "#253a4a",
  "#f2f4d5": "#b6ad82",
  "#f7faf0": "#688286",
  "#ffffff": "#8b9b9a",
  "#a8bdb4": "#17232f",
  "#f5f8eb": "#21343d",
  "#b0c6a2": "#587569",
  "#37694f": "#a6d3bb",
  "#75846a": "#9aaeb5",
  "#d4dfcb": "#26353e",
  "#cedbc5": "#293941",
  "#c5cdbb": "#172630",
  "#d5bb91": "#ad8a65",
  "#c1ad8d": "#735e4b",
  "#dbc5a0": "#aa8967",
  "#c6ae8c": "#725c4b",
  "#dec6a0": "#b99770",
  "#f6e4c1": "#ddc29a",
  "#a28e72": "#574b40",
  "#71876b": "#95a9af",
  "#b4c7a6": "#4b6464",
  "#778e71": "#8ca6a4",
  "#a2b69a": "#181f29",
  "#b6c3a9": "#1a2730",
  "#e2cba4": "#b39472",
  "#f7e7c9": "#dbc19c",
  "#bda680": "#80664f",
  "#aa9677": "#625344",
  "#88a899": "#54777b",
  "#b7c9b5": "#7e9a99",
  "#6e9585": "#3f5d63",
  "#3c8a68": "#95d6c1",
  "#586a4f": "#050f17"
};
export function officeSceneColor(color, scheme) {
  var resolved = scheme === 'dark' ? OFFICE_ROOM_DARK[color] || color : color;
  if (!/^#[0-9a-f]{6}$/i.test(resolved)) return resolved;
  var gray = Math.round(parseInt(resolved.slice(1, 3), 16) * .2126 + parseInt(resolved.slice(3, 5), 16) * .7152 + parseInt(resolved.slice(5, 7), 16) * .0722).toString(16).padStart(2, '0');
  return '#' + gray + gray + gray;
}
