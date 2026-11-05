import { randomUUID } from 'node:crypto';
import { PLUGIN_ID } from '../../shared/contract.js';

/**
 * Identified, immutable UserMessage for the public Agent.steer contract.
 * Mirrors dsh-llm's createUserMessage value shape in released rc.5 / 0.2.2-rc.1
 * without importing another copy of the host runtime into a linked plugin.
 * The producer is this plugin, never a fictitious Team member or model reply.
 */
export function createExecutionMessage(task, commandId) {
  const content = Object.freeze([Object.freeze({ type: 'text', text: executionText(task) })]);
  const source = Object.freeze({ kind: PLUGIN_ID, commandId, taskId: task.id });
  return Object.freeze({ id: randomUUID(), role: 'user', content, source });
}

export function executionText(task) {
  return `请立即执行已指派给你的任务 ${task.id}：${task.subject}\n先读取任务的最新详情、依赖和工作范围，确认任务仍由你负责且未删除、依赖已完成，再开始执行。完成后按实际结果更新任务状态并汇报；遇到阻塞请说明原因。`;
}
