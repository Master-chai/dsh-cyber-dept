# 派活与执行修复验证

## 基准与根因

- 插件基准：main `09395394ae16c44994cbb50af4a8bdf018b0b70b`，PR #2 已合并。独立工作副本的 105 个远程 blob 逐一核对一致后再修改，没有覆盖原本地副本。
- 派活弹窗原来默认 `executeNow: false`，只调用 task.create / task.assign。DSH reassign 会把任务记为 in_progress，但不会触发模型请求。
- 原来 lead 的执行复选框禁用，看板和宿主 task.start 也拒绝 lead。直接改为 Team 自发消息仍会被官方的 TEAM_SELF_MESSAGE 拒绝。

## 改动

保持所有 CSS、像素素材、布局和组件层次不变，只修复动作与对应说明：

1. 默认勾选已有的“指派后立即执行”。用户仍可取消，只安排任务不触发执行。
2. 普通成员继续使用发布版 Team.sendMessage，交给 DSH 的 continuation 所有者处理正在运行、空闲和冷恢复。
3. Lead 通过 Team.membership 确认调用者正是在线根 Agent 后，用 Agent.steer 投递完整、不可变的 UserMessage。source.kind 为 dsh-cyber-dept，不伪造用户直接输入、其他成员或模型输出。
4. 保留任务版本、依赖、当前负责人和实时 Agent 身份检查。执行接口缺失会明确失败；成员消息缺失回执会标记“结果未知”。不重发、不假装开始模型请求、不把模型状态写成运行。
5. 已指派但执行失败的任务继续保留，不能误报成指派失败或重复创建。相同 task.start commandId 重放只返回已有回执。

## 官方接口依据

截至本次核验，最新 GitHub 发布为 `dsh-v0.2.2-rc.1`，固定提交 `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`。插件原声明最低版本 `dsh-v0.2.1-rc.5` 固定提交为 `b830ec950faba0a46dda564be3e2d854afed94f1`。两者的相关公开接口兼容：

- [发布版 Team.sendMessage 实现](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/experimental/agent-team/src/index.ts)：禁止自发消息；接收成功后返回 messageId；向 Lead 投递的原生实现同样使用 steer。
- [Agent 的 steer / followup / inject 契约](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/core/agent/src/runtime-types.ts)：steer 会唤醒空闲 Agent，运行中在下一步接收；inject 不负责唤醒。
- [UserMessage 构造与可扩展来源](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/llm/llm/src/message.ts)：id / role / content / source 的不可变值；生产者来源可扩展。
- [Task reassign 实现](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/experimental/agent-team/src/task-board.ts)：仅更新持久化任务状态和负责人。

官方 master 已有把 Team 消息、成员导航迁到 subagents 的后续改动，但发布标签仍使用上述接口。不能仅按 master 里的版本目录推断这些改动已经在用户的发布版生效。本修复没有猜测性地改成未发布 API；未来升级必须重新核对。

## 自动验证

- main 基准原有 294 项测试全部通过。
- 新增 execution-dispatch 回归直接使用生产 React hook、控制器、命令执行器和去重路由，宿主服务为明确的替身。在未修改基准上 7 项中 6 项失败、1 项通过，默认执行和 Lead 唤醒两条原始缺陷均能复现。
- 修复后 `npm run build`、产物一致性、ESLint、TypeScript 和 `npm test` 全部通过，共 301 项。
- 覆盖默认指派成员/Lead、显式取消执行、版本过期、依赖未完、执行失败后保留指派、消息超时/结果未知、缺接口、缺回执、根 Agent 身份被替换及重复命令。
- 成员运行状态仍只来自 DSH；测试明确断言接收执行指令不会由插件伪造 Agent.status。

这些是代码和接口契约验证，不等于真实 DSH 桌面或真实模型成功执行。没有在用户机器安装、运行真实任务或验证凭证/模型供应商。

## 安装后实机验收

更新包含 src/host 和 client.js 的完整插件后，彻底退出并重新启动 DSH。无需清除浏览器数据。

1. 给空闲成员派一个简单新任务，保持执行勾选。原生成员会话应出现执行指令，随后有真正的 turn / model request / 输出。
2. 给 lead 派同样任务。原生当前会话应出现来自插件的执行指令，并由 lead 执行。
3. 对原来只指派、未执行的任务点击现有“立即执行”，不要重建任务。
4. 取消“指派后立即执行”，确认仅任务看板改变，没有新增执行指令和模型调用。
5. 成员工作中再发送执行指令，确认不强制打断，而在原生后续 step 接收。
6. 冷成员由 DSH 恢复；若权限、恢复、模型或供应商有错误，以原生日志为准。回执表示接收，不能凭回执认定模型已经运行。
