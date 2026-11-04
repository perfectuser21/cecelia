import { describe, it, expect, vi } from 'vitest';
// 退役入口必须在 SQL 和任务创建之前拒绝。
const { query } = vi.hoisted(() => ({ query: vi.fn(() => { throw new Error('unexpected database access'); }) }));
vi.mock('../db.js', () => ({ default: { query } }));
import { generateArchitectureDesignTask, handlePlanInput } from '../planner.js';

describe('退役的 Initiative 规划入口', () => {
  it.each(['coding', 'content', 'operations', null])('拒绝 %s 域，不能根据历史层再造规划任务', async domain => {
    await expect(generateArchitectureDesignTask({ id: 'kr', domain }, { id: 'historical-project', domain }))
      .rejects.toThrow('layer_retired');
    expect(query).not.toHaveBeenCalled();
  });
  it.each([false, true])('旧 project 输入（dryRun=%s）明确拒绝', async dryRun => {
    await expect(handlePlanInput({ project: { title: '旧入口', repo_path: '/tmp/repo' } }, dryRun))
      .rejects.toThrow('layer_retired');
    expect(query).not.toHaveBeenCalled();
  });
});
