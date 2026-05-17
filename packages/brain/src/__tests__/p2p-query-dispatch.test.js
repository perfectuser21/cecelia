/**
 * 验证 Cecelia P2P 查询派发能力的代码改动
 * - thalamus.js: 信息性查询 → create_task(explore) 规则
 * - ops.js: explore 任务创建后注册 task_interest 订阅
 * - execution.js: task_interest 回调携带 findings
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '..');

describe('P2P 查询派发能力', () => {
  describe('thalamus.js — 信息性查询分类规则', () => {
    const src = readFileSync(resolve(SRC, 'thalamus.js'), 'utf-8');

    it('规则 7 应存在：信息性查询 → create_task(explore)', () => {
      expect(src).toContain("task_type: 'explore'");
    });

    it('规则 7 应包含 mouth_reply 模板（正在查）', () => {
      expect(src).toContain('正在查，马上给你');
    });

    it('规则 5 仍然存在（普通闲聊 → handle_chat）', () => {
      expect(src).toContain('handle_chat');
    });
  });

  describe('ops.js — P2P handler task_interest 注册', () => {
    const src = readFileSync(resolve(SRC, 'routes/ops.js'), 'utf-8');

    it('explore 任务创建后应写入 task_interest 到 working_memory', () => {
      expect(src).toContain('task_interest:${createdTaskId}');
    });

    it('应使用 ASYNC_CALLBACK_TYPES 路由表而非 hardcode explore', () => {
      expect(src).toContain('ASYNC_CALLBACK_TYPES.has(');
    });

    it('应从 execResult 提取 createdTaskId', () => {
      expect(src).toContain('execResult?.actions_executed?.[0]?.result?.task_id');
    });
  });

  describe('execution.js — task_interest 回调携带 findings', () => {
    const src = readFileSync(resolve(SRC, 'routes/execution.js'), 'utf-8');

    it('task_interest 回调应从 tasks 表读取 payload', () => {
      expect(src).toContain('SELECT title, task_type, payload FROM tasks');
    });

    it('应将 payload.findings 作为 result 传入 notifyTaskCompletion', () => {
      expect(src).toContain('taskFindings');
      expect(src).toContain('result: taskFindings');
    });
  });
});
