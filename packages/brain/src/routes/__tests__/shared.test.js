/**
 * routes/shared.js 单元测试
 *
 * 配套 PR 2b-1（shared.js 的 getActiveExecutionPaths 查询 status 改 running）。
 * 测纯导出常量（无 DB、无 mock）：动作白名单与库存阈值是真实业务契约。
 */

import { describe, it, expect } from 'vitest';
import { ALLOWED_ACTIONS, INVENTORY_CONFIG } from '../shared.js';

describe('routes/shared — ALLOWED_ACTIONS 白名单', () => {
  it('create-task 必填 title，update-task 必填 task_id', () => {
    expect(ALLOWED_ACTIONS['create-task'].required).toContain('title');
    expect(ALLOWED_ACTIONS['update-task'].required).toContain('task_id');
  });

  it('update-task 允许改 status（生命周期推进入口）', () => {
    expect(ALLOWED_ACTIONS['update-task'].optional).toContain('status');
  });
});

describe('routes/shared — INVENTORY_CONFIG 库存阈值', () => {
  it('低水位/目标就绪/批量大小为预期业务常量', () => {
    expect(INVENTORY_CONFIG.LOW_WATERMARK).toBe(3);
    expect(INVENTORY_CONFIG.TARGET_READY_TASKS).toBe(9);
    expect(INVENTORY_CONFIG.BATCH_SIZE).toBe(3);
  });
});
