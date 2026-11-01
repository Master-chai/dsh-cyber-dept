const browserGlobals = Object.fromEntries(['window','document','Image','IntersectionObserver','performance','requestAnimationFrame','cancelAnimationFrame','crypto','fetch','AbortController','AbortSignal','Response','Request','URL','setTimeout','clearTimeout','console','Uint8Array'].map(name=>[name,'readonly']));
export default [
  { ignores: ['node_modules/**','.archify/**','docs/**'] },
  { files:['client.js','index.js','src/**/*.js','scripts/**/*.mjs'], languageOptions:{ecmaVersion:'latest',globals:{...browserGlobals,DOMException:'readonly',process:'readonly',Buffer:'readonly'}}, rules:{'no-undef':'error','no-unreachable':'error','no-dupe-keys':'error'} },
];
