# 执行与待处理动作修复验收

## 交付基准

- 仓库：`Master-chai/dsh-cyber-dept`。
- 远端 main：`09395394ae16c44994cbb50af4a8bdf018b0b70b`。
- 修改前完整目录树：`5021be8fa6fbf4061f9a8c06aeb12f17516bad46`，与该远端提交精确一致，105 个文件逐一通过 Git blob 核对。
- 离线验证包生成时未推送；后续发布状态以独立修复分支及草稿 PR 为准。未安装到用户机器，也未合并 main 或部署。修复包含重新构建的 `client.js` 与宿主源码，不能只替换浏览器文件。

## 修复范围

1. 已有“指派后立即执行”默认勾选。普通成员使用已发布的 `Team.sendMessage`；Lead 通过严格根身份检查后使用 `Agent.steer`，避免 Team 自发消息被拒绝。取消勾选仍只指派，不触发模型。
2. 指派已成功、执行失败或结果未知时保留原任务，并显示对应回执。不会自动重建、重发或伪造模型运行状态。同一 `task.start` 执行命令的重放仍只返回已有回执；成员执行消息在接收后的持久化或通知异常同样按未知结果保守处理。本次未改造普通 `message.send` 的错误契约。
3. “查看任务”会展开准确任务、清除遮挡筛选、补足分页、滚动和聚焦，不再只有隐蔽的选中变化。
4. 原生会话和审批入口调用官方 `uiWorkspace.openSession`，显示打开中或失败信息。必要时先只读刷新一次会话目录。旧请求在切换目标、组件卸载、切换会话或主面板后取消，不覆盖新选择。
5. 打开会话、查看任务和本地核对提醒都不会回答审批，也不会重新派活或执行任务。

## UI 保留验证

- 未修改 CSS、图片、场景绘制、主题及办公室组件；21 个相关源码和素材文件的字节完全一致。
- 在相同输入和固定随机序列下，用真实场景绘制代码渲染浅色/深色 640 × 520 像素办公室，两种主题各 **0 个不同像素**。
- 浅色页面、深色页面及相同勾选状态的派活弹窗，React 静态渲染可视 DOM 一致；唯一忽略的属性是非视觉 `aria-busy="false"`。
- 保留原派活弹窗说明文字、模块顺序和样式。默认勾选、Lead 执行可用、定位展开及必要的错误/打开状态是本次行为修复。
- 完整 Chromium 页面截图未能执行：该验证环境禁止创建浏览器所需的本地 socket，审批运行后仍被环境阻止。因此不能把场景像素与静态 DOM 比对称为真实 DSH 页面截图验收。

## 自动检查

在 Node.js 24.22.1 / npm 11.9.0 下：

- `npm run build`：通过。
- `npm test`：**320 / 320 通过**，包含 `build:check`、ESLint、TypeScript 与全部 Node 测试。
- `git diff --check`：通过。
- 新增跨功能回归覆盖 Lead/成员的默认派活、执行结果未知、准确任务定位、核对取消/确认、明确再次执行不重复创建或指派；也验证原生导航没有执行或审批副作用。
- 导航回归覆盖目录延迟、重复点击、换目标、同楼层只换选中成员、组件卸载及旧失败不污染新页面。

官方运行时集成使用固定发布包与模拟模型传输，并直接导入本次最终集成源码。`0.2.1-rc.5` 与 `0.2.2-rc.1` 的实际 `Agent.steer` 冒烟均通过。最新 `0.2.2-rc.1` 额外通过真实 `executeOfficeCommand(task.start) → TeamService → Agent.steer → Agent Loop` 主链：只指派时模型请求为 0，执行后请求为 1，记录 `running → idle`、`user/message`、`assistant/message` 和 `turn/end`。除模型传输外没有用替身代替宿主服务。这不是实际模型供应商调用，也不是用户机器端到端验收；普通成员与冷恢复尚未做这条真实宿主主链验收。具体运行记录及可重复脚本随验证材料提供。

## 版本与官方依据

核对的发布版为最低声明版 `dsh-v0.2.1-rc.5`（`b830ec950faba0a46dda564be3e2d854afed94f1`）与最新 `dsh-v0.2.2-rc.1`（`66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`）。没有把未发布 master 当成用户安装版本。

现有 `engines.dsh` 保留 `>=0.2.1-rc.5 <0.3.0-0`。官方两版 loader 都使用 `semver.satisfies(runtimeVersion, range, { includePrerelease: true })`，因此该范围确实接受 `0.2.2-rc.1`。标准 semver 默认不接受它，但这不是 DSH 的实际检查方式。该声明不代表本次测试覆盖范围内所有未来版本。

- [发布版插件兼容检查](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/boot/app-boot/src/plugin-compatibility.ts)
- [最低声明版插件兼容检查](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/packages/boot/app-boot/src/plugin-compatibility.ts)
- [发布版 Agent Teams](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/experimental/agent-team/src/index.ts)
- [发布版任务状态实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/experimental/agent-team/src/task-board.ts)
- [发布版原生会话导航](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/ui-workspace/src/client/navigation.ts)

## 应用与最后验收

先保存当前未提交改动，在上述 main 基准运行 `git apply --check dsh-repairs.patch`，再运行 `git apply dsh-repairs.patch`。也可使用完整源码 ZIP。已有依赖用 `npm test` 验证；没有依赖时先 `npm ci`。完整重启 DSH 后验证：

1. 给空闲成员和 Lead 分别派简单任务，保持默认勾选。原生目标会话应出现执行消息，随后出现真实模型请求与输出；接收回执本身不能证明已执行。
2. 取消勾选时只有任务看板改变，没有新增执行消息。以前已指派的任务使用“立即执行”，不要重建。
3. 折叠看板并设置排除目标的筛选后，从“需要你处理”点击“查看任务”，确认准确任务可见。
4. 点击原生会话/审批入口，确认目标准确；审批仍由 DSH 原生面板处理。目录加载中切换成员或页面，不应被旧请求带回。
5. 执行回执若为未知，先在目标会话核对，勿因超时直接重发。冷恢复、运行中追加、权限、模型供应商、凭证和用户安装版本仍需实机核验。
