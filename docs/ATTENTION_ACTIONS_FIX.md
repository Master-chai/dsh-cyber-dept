# “需要你处理”交互修复

## 基线与边界

- 基于 `Master-chai/dsh-cyber-dept` main `09395394ae16c44994cbb50af4a8bdf018b0b70b`，该提交已合并 PR #2。
- 修改前本地全部 105 个受版本控制文件的 Git blob 哈希均与该提交相同。
- 用户未指定具体按钮，因此覆盖“查看任务”“查看原生会话”“去处理审批”、显示更多、操作回执展开/折叠、核对确认/取消。
- 不改 CSS、图片、模块排序、像素办公室或原有按钮文案。仅补上动作与正在打开/失败时的状态反馈。

## 已复现的缺陷

1. “查看任务”只修改任务选中和员工详情，没有打开任务看板、展开任务、清除隐藏筛选、加载任务所在页或滚动。已选中任务、折叠看板、筛选排除目标或目标在屏外时，点击可能没有可见结果。
2. 两个原生会话入口无条件吞掉导航异常和服务缺席。官方 Session Controller 对未知 Session id 可抛出 `sessions.retain: unknown session ...`，旧实现将其隐藏。
3. 旧导航在 140ms 后再切主面板。新版官方 `uiWorkspace.openSession` 已同步选择 Conversation，旧定时操作既无必要，也可能覆盖用户之后的导航。

旧基线上的新回归用例 `attention task reveal expands the board and exact row...` 失败：`folds.tasks` 为 false，预期 true。旧导航在模拟官方 unknown-session 拒绝时返回 undefined，组件没有错误状态。

## 修复行为

- “查看任务”在现有看板展开准确任务，清除筛选和搜索，加载到目标所在页并滚动、聚焦。重复点击同一任务也可再次定位。普通任务行原有展开/收起行为保持不变。
- 导航调用官方 `uiWorkspace.openSession(target)`，不再额外延时切换面板。优先使用官方已发现的子代理地址；不把部门根 id 猜作直接父会话。
- 当办公室快照早于原生 Session 列表到达，做一次只读列表刷新后再导航。列表刷新期间换会话、换主面板、点击另一成员或卸载插件会取消旧请求，不抢回当前页面。
- 显示“正在打开原生会话…”或实际失败原因。重复点击同一进行中的打开只执行一次；切换目标使用新的准确目标。失败只在用户再次点击时重试。
- 导航不回答审批、不创建/运行 Agent、不发送任务消息。“已核对，移出提醒”仍仅移除本地提醒，保留确认/取消，不宣称宿主操作成功。

## 官方接口证据

核对固定发布标签 `dsh-v0.2.2-rc.1`（2026-11-04 发布），不是将变化中的 master 当作发布版：

- [官方 uiWorkspace 导航实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/ui-workspace/src/client/navigation.ts)：`openSession(target)` 通过 `sessions.retain`、主会话选择和 `layout.selectPanel(null)` 完成导航；返回 void，不代表历史或审批加载完成。
- [官方 Session Controller 契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/api/session-controller/src/client/contract/sessions.ts)：target 为已知 Session id 或有持久直接父关系的子代理地址；提供只读 `refresh()` 和 `subagentAddress(id)`。
- [官方 Session 地址解析](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/api/session-controller/src/client/sessions/manager.ts)：未知裸 id 会拒绝，显式地址不要求预加载父目录。
- [官方子代理地址](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/subagent/subagent/src/control-types.ts)：`parentSessionId`、`childSessionId` 与 mode。

## 验证与实机验收

已运行 `npm run build` 和 `npm test`（build:check、ESLint、TypeScript、全部 Node 测试）。新增回归覆盖定位、筛选、50项后分页、重复点击、导航拒绝、列表慢加载、并发点击、导航切换、插件卸载、错误跨会话隔离与本地核对按钮。

这些测试为真实组件处理器与模拟宿主接口，不是用户 DSH 实机验收。仍需在用户已安装的具体 DSH 版本检查：

1. 先折叠任务看板并设置排除目标的筛选，再从“需要你处理”点“查看任务”，应展开并定位目标。
2. 在有待审批/错误的成员上点“查看原生会话”，应进入该成员 Conversation，审批仍由 DSH 原生面板处理。
3. 原生导航不可用时应见原因，恢复后可手动再次点击；慢加载期间切往别处不应被旧请求带回。
4. 复核既有黑白界面、布局、人物、动画未变。
