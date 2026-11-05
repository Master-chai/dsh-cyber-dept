# 任务未就绪误报修复

## 结论

截图中的 `task-7` 已是 `in_progress`。DSH 对这种任务正常返回 `ready: false`，不表示被依赖阻塞，也不证明成员已经开始执行。旧 `taskEvidence()` 将所有未完成任务的 `ready: false` 都当作依赖异常，因此同一误报同时进入展开的任务详情和原“需要你处理”区域。

即使移除“需要你处理”区域，任务看板仍调用 `taskEvidence()`，因此需要修正底层语义。本补丁不改变该区域的显示配置，不重新添加任何入口。

## 固定的官方发布版依据

本次直接读取并对照两个已发布候选版本的标签文件与固定提交文件，不使用移动的 master 分支：

- [dsh-v0.2.2-rc.1 发布页](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.1)，固定提交 `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`。
- 插件支持的最低版本 `dsh-v0.2.1-rc.5`，固定提交 `b830ec950faba0a46dda564be3e2d854afed94f1`。
- [0.2.2-rc.1 的 task-view.ts](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/experimental/agent-team/src/task-view.ts#L18-L63) 与 [0.2.1-rc.5 的同一文件](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/experimental/agent-team/src/task-view.ts#L18-L63) 内容相同。

官方逻辑是：

```ts
function taskReady(state, task) {
  return task.blockedBy.every(id =>
    state.tasks.find(candidate => candidate.id === id)?.status === 'completed')
}
// projectTaskView 返回字段：
ready: task.status === 'pending' && taskReady(state, task)
```

因此 `taskReady()` 是实际依赖检查，公开的 `view.ready` 还包含 pending 条件，两者不能混用。官方 [reassign 分支](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/experimental/agent-team/src/task-board.ts#L172-L187) 在检查依赖后把任务状态改为 `in_progress`，随后投影的 `ready` 就变为 false。

保存的两份官方原文件 SHA-256 均为 `d7292d7919225ac96496f29b448044d1337268759e092e2bcfb37804b83773b8`。另将原文件通过 esbuild 转译，仅对品牌字符串类型包装使用身份函数替身，实际调用官方 `taskReady()` 与 `projectTaskView()`。两份各 24 组状态/依赖组合均符合上述语义，共 48 组通过。

## 最小改动及全链路审查

唯一生产源码改动是 `src/client/model/attention.js`：未就绪兜底复用已有 `isTaskBlocked(task)`，只对 `pending && ready === false` 生效。前面的 `blockedBy` 实际核对保持不变，任何未完成、已删除或找不到的前置任务仍会明确提示；当前任务是 `in_progress` 也不例外。

逐一核对其它消费者：

- 任务列表标记、受阻筛选/数量、成员详情中的依赖标记、派活下拉选项、任务变化通知：已使用 `isTaskBlocked()`，不会把正常的 in_progress/false 误判为受阻，无需修改。
- `deriveSeatFacts()` 的任务阻塞维度：已限制 pending，且不会把任务状态变成成员运行状态。
- 宿主快照 `tasksForSnapshot()` 与 `taskCountsOf()`：前者保留官方 pending-ready 语义，后者只在 pending 分支统计未就绪；不修改宿主 ready 值来掩盖显示问题。
- 客户端“立即执行”与宿主 `task.start`：按实际 `blockedBy` 检查依赖，没有用 false readiness 拒绝已指派任务；继续保留任务 revision、负责人、在线根 Agent 身份及命令去重检查。
- 完成/重开/指派：由任务状态及原生 Team 接口处理，不用 ready 推断执行情况；宿主仍是最终权限与依赖检查边界。
- 协议摘要、归一化和任务引用中的 ready：只传递数据，没有新增执行判断。

“进行中不代表开始执行”和“成员活动不等于本任务进度”的说明继续保留。审批、成员错误、真实依赖及原生会话入口不被移除。

## 验证

- 新增 `test/task-ready-semantics.test.mjs` 共 8 项回归。相同测试在原集成基线上 5 失败、3 通过；修复后 8/8 通过。
- 覆盖 pending/in_progress/completed/deleted 与 true/false/缺省 ready，真实与缺失依赖，成员活动独立性、错误/审批保留，展开任务详情与按钮，员工详情、派活选项、变化通知、宿主任务统计和实际执行前依赖检查。
- `npm run build`、`build:check`、ESLint、TypeScript 与全部 328 项测试通过。
- 未向真实 DSH 成员发送消息，未触发真实模型请求，未推送、安装或发布。本次验证不能证明截图中的任务实际上已运行或已完成。

集成时应用源码、测试及本文档后统一重建 `client.js`，不要覆盖其它并行修复生成的客户端产物。
