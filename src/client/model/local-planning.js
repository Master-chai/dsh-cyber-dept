// User-owned planning data only. Never persist tasks, transcripts, tool results,
// credentials or host settings. Scope by exact department session, not cwd/name.
export const MAX_PROFILES = 30;
// Covers 30 maximum-length profiles even when every character needs JSON escaping.
export const MAX_PLANNING_LENGTH = 1000000;
export const MAX_PROFILE_LENGTH = 32000;
const PREFIX = 'dsh-cyber-dept:planning:v1:';
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export function planningKey(floorId) {
  if (typeof floorId !== 'string' || !floorId || floorId.length > 256) throw new Error('缺少有效的部门会话标识');
  return PREFIX + encodeURIComponent(floorId);
}
export function profileFields(value) {
  return {
    name: clean(value?.name, 100),
    role: clean(value?.role, 2000),
    skills: clean(value?.skills, 2000),
    model: clean(value?.model, 200),
    provider: clean(value?.provider, 200),
  };
}
export function parseBudget(value, integer = false) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('预算必须是数字');
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > Number.MAX_SAFE_INTEGER || (integer && !Number.isSafeInteger(number))) throw new Error(integer ? 'Token 预算须为非负整数' : '费用预算须为非负数字');
  return number;
}
export function emptyPlanning() { return { v: 1, budget: { tokens: null, amount: null, currency: 'CNY' }, profiles: [] }; }
export function normalizePlanning(value) {
  if (!value || value.v !== 1 || !Array.isArray(value.profiles) || value.profiles.length > MAX_PROFILES) throw new Error('本地档案格式不受支持');
  const profiles = value.profiles.map(profileFields);
  if (profiles.some(profile => !profile.name)) throw new Error('档案名称不能为空');
  return { v: 1, budget: { tokens: parseBudget(value.budget?.tokens, true), amount: parseBudget(value.budget?.amount), currency: value.budget?.currency === 'USD' ? 'USD' : 'CNY' }, profiles };
}
export function readPlanning(storage, floorId) {
  let raw;
  try {
    raw = storage.getItem(planningKey(floorId));
    if (raw && raw.length > MAX_PLANNING_LENGTH) throw new Error('本地档案过大');
    return { data: raw ? normalizePlanning(JSON.parse(raw)) : emptyPlanning(), error: '', raw };
  } catch { return { data: emptyPlanning(), error: '本地档案无法读取。为避免覆盖已有数据，本次禁止保存；可备份浏览器存储后明确确认清空本部门数据。', raw }; }
}
export function savePlanning(storage, floorId, value) {
  const safe = normalizePlanning(value);
  const serialized = JSON.stringify(safe);
  if (serialized.length > MAX_PLANNING_LENGTH) throw new Error('本地档案过大，未保存');
  storage.setItem(planningKey(floorId), serialized);
  return safe;
}
/** Explicit recovery only. Never overwrite a value changed since the panel opened. */
export function resetUnreadablePlanning(storage, floorId, expectedRaw) {
  if (typeof expectedRaw !== 'string' || storage.getItem(planningKey(floorId)) !== expectedRaw) throw new Error('本地数据已变化或存储不可用，请重新打开面板');
  return savePlanning(storage, floorId, emptyPlanning());
}
export function exportProfile(value) { return JSON.stringify({ v: 1, profile: profileFields(value) }, null, 2); }
export function importProfile(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_PROFILE_LENGTH) throw new Error('档案内容过大');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('请输入有效的档案 JSON'); }
  if (parsed?.v !== 1 || !parsed.profile) throw new Error('不支持的档案格式');
  const profile = profileFields(parsed.profile);
  if (!profile.name) throw new Error('档案名称不能为空');
  return profile;
}
