import { describe, it, expect, vi } from 'vitest';
const { query } = vi.hoisted(() => ({ query: vi.fn(() => { throw new Error('unexpected database access'); }) }));
vi.mock('../db.js', () => ({ default: { query } }));
import { generateArchitectureDesignTask } from '../planner.js';

// 原域继承成功例依赖向499退役表INSERT，现验证实际入口不能再触发任何域的旧拆解。
describe('历史 Initiative 域规划拒绝', () => {
  it.each(['coding', 'content', 'operations', 'research', null])('禁止 %s 域再生成旧层任务', async domain => {
    await expect(generateArchitectureDesignTask({ id: 'kr', domain }, { id: 'historical-project', domain }))
      .rejects.toThrow('layer_retired');
    expect(query).not.toHaveBeenCalled();
  });
});
