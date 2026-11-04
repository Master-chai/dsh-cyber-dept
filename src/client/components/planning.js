import React from 'react';
import { MAX_PROFILES, MAX_PROFILE_LENGTH, resetUnreadablePlanning, profileFields, parseBudget, emptyPlanning, readPlanning, savePlanning, exportProfile, importProfile } from '../model/local-planning.js';
const h = React.createElement;
function browserStorage() { try { return window.localStorage; } catch { return null; } }
function field(label, value, onChange, options = {}) {
  return h('label', { className: 'cid-planning-field' }, label, h(options.multiline ? 'textarea' : 'input', {
    value, onChange: event => onChange(event.target.value), maxLength: options.maxLength || 200,
    ...(!options.multiline ? { type: options.number ? 'number' : 'text', ...(options.number ? { min: 0, step: options.integer ? 1 : 'any' } : {}) } : {}),
  }));
}
export function PlanningPane({ floor, seat }) {
  // The caller keys this component by floor.id, so drafts never cross sessions.
  const [loaded, setLoaded] = React.useState(() => readPlanning(browserStorage(), floor.id));
  const [data, setData] = React.useState(loaded.data);
  const [tokens, setTokens] = React.useState(loaded.data.budget.tokens ?? '');
  const [amount, setAmount] = React.useState(loaded.data.budget.amount ?? '');
  const [currency, setCurrency] = React.useState(loaded.data.budget.currency);
  const [draft, setDraft] = React.useState(profileFields({}));
  const [transfer, setTransfer] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [deleting, setDeleting] = React.useState(null);
  const [resetting, setResetting] = React.useState(false);
  function persist(next, message) {
    if (loaded.error) { setNotice(loaded.error); return false; }
    try {
      const storage = browserStorage();
      const latest = readPlanning(storage, floor.id);
      if (latest.error || JSON.stringify(latest.data) !== JSON.stringify(data)) {
        setNotice('本部门本地数据已在其他面板修改或无法读取。请重新打开面板后再保存，避免覆盖。');
        return false;
      }
      setData(savePlanning(storage, floor.id, next)); setNotice(message); return true;
    }
    catch { setNotice('保存失败，浏览器存储不可用或已满；未保存本次修改。'); return false; }
  }
  function clearPlanning() {
    let cleared = false;
    if (loaded.error) {
      try {
        const next = resetUnreadablePlanning(browserStorage(), floor.id, loaded.raw);
        setData(next); setLoaded({data:next,error:'',raw:JSON.stringify(next)});
        setNotice('本部门本地数据已清空，可重新保存。'); cleared = true;
      } catch (error) { setNotice(error.message); }
    } else cleared = persist(emptyPlanning(), '本部门本地数据已清空。');
    if (cleared) { setTokens(''); setAmount(''); setCurrency('CNY'); setDraft(profileFields({})); setTransfer(''); setDeleting(null); }
    setResetting(false);
  }
  function saveBudget(event) {
    event.preventDefault();
    try { persist({ ...data, budget: { tokens: parseBudget(tokens, true), amount: parseBudget(amount), currency } }, '预算已保存，仅作人工参考，不会自动停止员工。'); }
    catch (error) { setNotice(error.message); }
  }
  function patch(key, value) { setDraft(previous => ({ ...previous, [key]: value })); }
  function saveProfile(event) {
    event.preventDefault();
    if (!draft.name.trim()) { setNotice('请填写档案名称。'); return; }
    if (data.profiles.length >= MAX_PROFILES) { setNotice('最多保存 30 份档案，请先删除不再需要的档案。'); return; }
    if (persist({ ...data, profiles: [...data.profiles, profileFields(draft)] }, '档案已保存到本浏览器的当前部门。')) setDraft(profileFields({}));
  }
  const count = floor.seats?.length || 0;
  return h('section', { className: 'cid-planning', 'aria-label': '预算与本地档案' },
    h('details', null, h('summary', null, '消耗与预算'),
      h('p', { className: 'cid-muted' }, '当前部门 · ' + count + ' 位员工。宿主尚未提供已验证的用量/价格接口。不可用不代表零消耗。'),
      h('p', null, '团队 Token：不可用 · 团队费用：不可用'),
      h('ul', null, (floor.seats || []).map(member => h('li', { key: member.id }, member.name + '：Token 不可用 · 费用不可用'))),
      h('p', null, '已保存预算：' + (data.budget.tokens === null ? 'Token 未设置' : data.budget.tokens + ' Token') + ' · ' + (data.budget.amount === null ? '费用未设置' : data.budget.amount + ' ' + data.budget.currency)),
      h('form', { onSubmit: saveBudget },
        field('部门 Token 预算（留空表示未设置）', tokens, setTokens, { number: true, integer: true }),
        field('部门费用预算（留空表示未设置）', amount, setAmount, { number: true }),
        h('label', { className: 'cid-planning-field' }, '预算币种', h('select', { value: currency, onChange: event => setCurrency(event.target.value) }, h('option', { value: 'CNY' }, 'CNY'), h('option', { value: 'USD' }, 'USD'))),
        h('button', { className: 'cid-btn', type: 'submit', disabled: !!loaded.error }, '保存预算')),
      h('p', { className: 'cid-muted' }, '预算是本地计划值。无真实用量时不计算剩余额度、进度或费用估算，不执行限额拦截。')),
    h('details', null, h('summary', null, '可复用员工档案 · ' + data.profiles.length),
      h('p', { className: 'cid-muted' }, '仅保存在本浏览器、当前部门会话。不会修改 DSH 配置或创建员工，不保存项目记忆、对话或任务。跨会话复用需手动导出并导入。请勿填写密钥或敏感信息。'),
      seat ? h('button', { className: 'cid-btn', type: 'button', onClick: () => { setDraft(profileFields({ name: seat.name, model: seat.model, provider: seat.provider })); setNotice('已预填姓名与模型。请手动填写可复用岗位和技能，不自动复制项目职责。'); } }, '从选中员工预填') : null,
      h('form', { onSubmit: saveProfile },
        field('档案名称', draft.name, value => patch('name', value), { maxLength: 100 }),
        field('通用岗位', draft.role, value => patch('role', value), { multiline: true, maxLength: 2000 }),
        field('通用技能', draft.skills, value => patch('skills', value), { multiline: true, maxLength: 2000 }),
        field('模型名称（仅记录）', draft.model, value => patch('model', value)),
        field('提供商（仅记录）', draft.provider, value => patch('provider', value)),
        h('button', { className: 'cid-btn', type: 'submit', disabled: !!loaded.error }, '保存为新档案')),
      h('ul', null, data.profiles.map((profile, index) => h('li', { key: index },
        h('strong', null, profile.name), ' ',
        h('button', { className: 'cid-btn', type: 'button', onClick: () => { setDraft(profileFields(profile)); setNotice('已载入编辑区，保存会创建新档案，不会修改宿主员工。'); } }, '载入 / 复用'), ' ',
        h('button', { className: 'cid-btn', type: 'button', onClick: () => { setTransfer(exportProfile(profile)); setNotice('档案已显示在传递区，请手动复制。只包含岗位、技能与模型记录。'); } }, '导出'), ' ',
        h('button', { className: 'cid-btn', type: 'button', onClick: () => setDeleting(index) }, '删除'),
        deleting === index ? h('span', null, ' 确认删除此本地档案？ ', h('button', { type: 'button', className: 'cid-btn', onClick: () => { persist({ ...data, profiles: data.profiles.filter((_, i) => i !== index) }, '档案已删除。'); setDeleting(null); } }, '确认'), h('button', { type: 'button', className: 'cid-btn', onClick: () => setDeleting(null) }, '取消')) : null))),
      field('档案传递区（导出内容或粘贴 JSON）', transfer, setTransfer, { multiline: true, maxLength: MAX_PROFILE_LENGTH }),
      h('button', { className: 'cid-btn', type: 'button', onClick: () => { try { setDraft(importProfile(transfer)); setNotice('已导入到编辑区，请检查后保存。'); } catch (error) { setNotice(error.message); } } }, '导入到编辑区'),
      h('button', { className: 'cid-btn', type: 'button', onClick: () => setResetting(true) }, '清空本部门本地数据'),
      resetting ? h('p', null, '将删除本部门的预算与档案，无法撤销。', h('button', { className: 'cid-btn', type: 'button', onClick: clearPlanning }, '确认清空'), h('button', { className: 'cid-btn', type: 'button', onClick: () => setResetting(false) }, '取消')) : null),
    h('p', { role: 'status', 'aria-live': 'polite' }, notice || loaded.error));
}
