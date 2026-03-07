/**
 * Coding Passway 链路测试
 * 验证：Initiative 无 task → planner 自动生成 architecture_design 任务
 *
 * 使用 vi.fn() mock db.js，避免依赖真实数据库。
 * 补充 planner-initiative-plan.test.js（后者使用真实 DB 做集成测试）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock db pool
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

// mock focus.js（planner.js 在 getGlobalState 中使用，单元测试不需要真实 focus）
vi.mock('../focus.js', () => ({ getDailyFocus: vi.fn().mockResolvedValue(null) }));

const { generateArchitectureDesignTask } = await import('../planner.js');

describe('Coding Passway: generateArchitectureDesignTask', () => {
  beforeEach(() => vi.clearAllMocks());

  it('当 Initiative 无 queued tasks 时 → 创建 architecture_design 任务', async () => {
    const initiative = { id: 'ini-1', name: 'Test Initiative' };
    const insertedTask = {
      id: 'task-1',
      task_type: 'architecture_design',
      title: '架构设计 Initiative: Test Initiative',
      status: 'queued',
      priority: 'P1',
      project_id: 'ini-1',
      goal_id: 'kr-1',
      description: `该 Initiative「Test Initiative」下无任务，需要架构设计 (Mode 2): 读取 system_modules → 产出 architecture.md → 注册 /dev Tasks 到 Brain。Initiative ID: ini-1，所属 KR ID: kr-1`,
      payload: JSON.stringify({ initiative_id: 'ini-1', parent_project_id: 'proj-1', kr_id: 'kr-1' })
    };

    mockQuery
      // 第 1 次查询：查找符合条件的 initiative（无 queued/in_progress task）
      .mockResolvedValueOnce({ rows: [initiative] })
      // 第 2 次查询：检查是否已有 architecture_design task → 无
      .mockResolvedValueOnce({ rows: [] })
      // 第 3 次查询：INSERT task
      .mockResolvedValueOnce({ rows: [insertedTask] });

    const kr = { id: 'kr-1', title: 'Test KR', priority: 'P1' };
    const project = { id: 'proj-1', name: 'Test Project' };
    const result = await generateArchitectureDesignTask(kr, project);

    expect(result).not.toBeNull();
    expect(result.task_type).toBe('architecture_design');
    expect(result.status).toBe('queued');

    // 验证 INSERT 查询被调用，且 task_type 参数为 architecture_design
    const insertCall = mockQuery.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('INSERT INTO tasks'));
    expect(insertCall).toBeDefined();
    expect(insertCall[1][2]).toBe('architecture_design'); // $3 = taskType
    // 验证 INSERT 参数包含 initiative.name
    expect(insertCall[1][0]).toContain('Test Initiative');
  });

  it('当 architecture_design 任务已存在时 → 返回 null（不重复创建）', async () => {
    const initiative = { id: 'ini-1', name: 'Test Initiative' };
    const existingTask = { id: 'existing-task-1' };

    mockQuery
      // 第 1 次：找到 initiative
      .mockResolvedValueOnce({ rows: [initiative] })
      // 第 2 次：已有 architecture_design task → 不再创建
      .mockResolvedValueOnce({ rows: [existingTask] });

    const kr = { id: 'kr-1', title: 'Test KR', priority: 'P1' };
    const project = { id: 'proj-1', name: 'Test Project' };
    const result = await generateArchitectureDesignTask(kr, project);

    expect(result).toBeNull();
    // INSERT 查询不应该被调用
    const insertCall = mockQuery.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('INSERT INTO tasks'));
    expect(insertCall).toBeUndefined();
  });

  it('当 project 下无符合条件的 initiative 时 → 返回 null', async () => {
    mockQuery
      // 第 1 次：没找到任何符合条件的 initiative（rows 为空）
      .mockResolvedValueOnce({ rows: [] });

    const kr = { id: 'kr-1', title: 'Test KR', priority: 'P1' };
    const project = { id: 'proj-1', name: 'Test Project' };
    const result = await generateArchitectureDesignTask(kr, project);

    expect(result).toBeNull();
    // 只有 1 次查询（initiative 查询），后续查询不发生
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
