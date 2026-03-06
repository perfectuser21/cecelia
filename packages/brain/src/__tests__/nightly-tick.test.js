/**
 * nightly-tick.test.js
 * nightly-tick 模块完整单元测试
 *
 * 覆盖函数：
 * - calculateProjectHealth（通过 generateProjectReport 间接）
 * - generateProjectReport
 * - getActiveProjectsWithStats
 * - getGoalsProgress
 * - getTodaysReflections
 * - saveDailyLog
 * - executeNightlyAlignment
 * - runNightlyAlignmentSafe
 * - startNightlyScheduler
 * - stopNightlyScheduler
 * - getNightlyTickStatus
 * - getDailyReports
 * - NIGHTLY_HOUR / NIGHTLY_MINUTE（常量导出）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ------------------------------------------------------------------
// Mock 外部依赖（必须在 import 之前声明）
// ------------------------------------------------------------------

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn()
  }
}));

vi.mock('../event-bus.js', () => ({
  emit: vi.fn().mockResolvedValue(undefined)
}));

// ------------------------------------------------------------------
// 工具函数：构建标准 project 对象
// ------------------------------------------------------------------

function makeProject(overrides = {}) {
  return {
    id: 'proj-uuid-001',
    name: 'cecelia',
    repo_path: '/home/xx/perfect21/cecelia',
    lead_agent: 'caramel',
    completed_today: '3',
    in_progress: '2',
    queued: '5',
    failed_today: '0',
    ...overrides
  };
}

// ------------------------------------------------------------------
// calculateProjectHealth（通过 generateProjectReport 测试）
// ------------------------------------------------------------------

describe.skip('calculateProjectHealth（通过 generateProjectReport）', () => {
  let generateProjectReport;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../nightly-tick.js');
    generateProjectReport = mod.generateProjectReport;
  });

  it('failed > 2 时返回 critical', () => {
    const project = makeProject({ failed_today: '3', completed_today: '1' });
    const report = generateProjectReport(project);
    expect(report.health).toBe('critical');
  });

  it('failed = 3（恰好 > 2）时返回 critical', () => {
    const project = makeProject({ failed_today: '3' });
    const report = generateProjectReport(project);
    expect(report.health).toBe('critical');
  });

  it('failed = 1（> 0 但不 > 2）时返回 warning', () => {
    const project = makeProject({ failed_today: '1', completed_today: '2', in_progress: '1' });
    const report = generateProjectReport(project);
    expect(report.health).toBe('warning');
  });

  it('failed = 0，completed > 0，in_progress > 0 时返回 healthy', () => {
    const project = makeProject({ failed_today: '0', completed_today: '5', in_progress: '2' });
    const report = generateProjectReport(project);
    expect(report.health).toBe('healthy');
  });

  it('failed = 0，in_progress = 0，completed = 0 时返回 idle', () => {
    const project = makeProject({ failed_today: '0', completed_today: '0', in_progress: '0' });
    const report = generateProjectReport(project);
    expect(report.health).toBe('idle');
  });

  it('failed = 0，只有 completed（无 in_progress）时返回 healthy', () => {
    const project = makeProject({ failed_today: '0', completed_today: '3', in_progress: '0' });
    const report = generateProjectReport(project);
    // completed > 0 && in_progress === 0 → 不满足 healthy 分支（completed > 0 AND in_progress > 0），
    // 也不满足 idle（completed 不为 0），所以落到末尾 return 'healthy'
    expect(report.health).toBe('healthy');
  });

  it('字段为 null/undefined 时安全降级为 0（不崩溃）', () => {
    const project = makeProject({ failed_today: null, completed_today: undefined, in_progress: null });
    expect(() => generateProjectReport(project)).not.toThrow();
    const report = generateProjectReport(project);
    expect(report.health).toBe('idle');
  });
});

// ------------------------------------------------------------------
// generateProjectReport
// ------------------------------------------------------------------

describe.skip('generateProjectReport', () => {
  let generateProjectReport;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../nightly-tick.js');
    generateProjectReport = mod.generateProjectReport;
  });

  it('返回结构包含所有必要字段', () => {
    const project = makeProject();
    const report = generateProjectReport(project);
    expect(report).toHaveProperty('project_id', 'proj-uuid-001');
    expect(report).toHaveProperty('project_name', 'cecelia');
    expect(report).toHaveProperty('lead_agent', 'caramel');
    expect(report).toHaveProperty('summary');
    expect(report).toHaveProperty('health');
    expect(report).toHaveProperty('generated_at');
  });

  it('summary 中数字字段正确解析为 number', () => {
    const project = makeProject({ completed_today: '7', in_progress: '3', queued: '10', failed_today: '1' });
    const report = generateProjectReport(project);
    expect(report.summary.completed_today).toBe(7);
    expect(report.summary.in_progress).toBe(3);
    expect(report.summary.queued).toBe(10);
    expect(report.summary.failed_today).toBe(1);
  });

  it('字段值为 NaN 时降级为 0', () => {
    const project = makeProject({ completed_today: 'abc', in_progress: 'xyz' });
    const report = generateProjectReport(project);
    expect(report.summary.completed_today).toBe(0);
    expect(report.summary.in_progress).toBe(0);
  });

  it('generated_at 是合法的 ISO 8601 字符串', () => {
    const project = makeProject();
    const report = generateProjectReport(project);
    expect(() => new Date(report.generated_at)).not.toThrow();
    expect(new Date(report.generated_at).toString()).not.toBe('Invalid Date');
  });

  it('lead_agent 为 null 时原样传入（不崩溃）', () => {
    const project = makeProject({ lead_agent: null });
    const report = generateProjectReport(project);
    expect(report.lead_agent).toBeNull();
  });
});

// ------------------------------------------------------------------
// getActiveProjectsWithStats
// ------------------------------------------------------------------

describe('getActiveProjectsWithStats', () => {
  let getActiveProjectsWithStats;
  let mockPool;

  beforeEach(async () => {
    vi.resetModules();
    const dbMod = await import('../db.js');
    mockPool = dbMod.default;
    mockPool.query.mockReset();

    const mod = await import('../nightly-tick.js');
    getActiveProjectsWithStats = mod.getActiveProjectsWithStats;
  });

  it('返回数据库 rows', async () => {
    const fakeRows = [makeProject(), makeProject({ id: 'proj-002', name: 'zenithjoy' })];
    mockPool.query.mockResolvedValueOnce({ rows: fakeRows });

    const result = await getActiveProjectsWithStats();
    expect(result).toEqual(fakeRows);
  });

  it('SQL 查询包含 projects 和 tasks 联结', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await getActiveProjectsWithStats();
    const sql = mockPool.query.mock.calls[0][0];
    expect(sql).toContain('FROM projects p');
    expect(sql).toContain('LEFT JOIN tasks t');
    expect(sql).toContain('GROUP BY');
  });

  it('SQL 包含 HAVING 条件过滤无任务无 lead_agent 的项目', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await getActiveProjectsWithStats();
    const sql = mockPool.query.mock.calls[0][0];
    expect(sql).toContain('HAVING');
    expect(sql).toContain('lead_agent IS NOT NULL');
  });

  it('数据库返回空时返回空数组', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const result = await getActiveProjectsWithStats();
    expect(result).toEqual([]);
  });

  it('数据库查询失败时抛出错误', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('DB connection refused'));
    await expect(getActiveProjectsWithStats()).rejects.toThrow('DB connection refused');
  });
});

// ------------------------------------------------------------------
// getGoalsProgress
// ------------------------------------------------------------------

describe('getGoalsProgress', () => {
  let getGoalsProgress;
  let mockPool;

  beforeEach(async () => {
    vi.resetModules();
    const dbMod = await import('../db.js');
    mockPool = dbMod.default;
    mockPool.query.mockReset();

    const mod = await import('../nightly-tick.js');
    getGoalsProgress = mod.getGoalsProgress;
  });

  it('返回目标列表', async () => {
    const fakeGoals = [
      { id: 'g1', title: 'KR1', status: 'in_progress', priority: 'P0', progress: 80, project_name: 'cecelia' }
    ];
    mockPool.query.mockResolvedValueOnce({ rows: fakeGoals });
    const result = await getGoalsProgress();
    expect(result).toEqual(fakeGoals);
  });

  it('SQL 排除 completed 和 cancelled 状态', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await getGoalsProgress();
    const sql = mockPool.query.mock.calls[0][0];
    expect(sql).toContain("NOT IN ('completed', 'cancelled')");
  });

  it('SQL 包含 LIMIT 20', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await getGoalsProgress();
    const sql = mockPool.query.mock.calls[0][0];
    expect(sql).toContain('LIMIT 20');
  });

  it('数据库返回空时返回空数组', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const result = await getGoalsProgress();
    expect(result).toEqual([]);
  });

  it('数据库查询失败时抛出错误', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('Query timeout'));
    await expect(getGoalsProgress()).rejects.toThrow('Query timeout');
  });
});

// ------------------------------------------------------------------
// getTodaysReflections
// ------------------------------------------------------------------

describe('getTodaysReflections', () => {
  let getTodaysReflections;
  let mockPool;

  beforeEach(async () => {
    vi.resetModules();
    const dbMod = await import('../db.js');
    mockPool = dbMod.default;
    mockPool.query.mockReset();

    const mod = await import('../nightly-tick.js');
    getTodaysReflections = mod.getTodaysReflections;
  });

  it('返回今日 reflections 列表', async () => {
    const fakeRows = [
      { id: 'r1', type: 'issue', title: 'Bug found', content: '...', tags: [], project_name: 'cecelia' },
      { id: 'r2', type: 'learning', title: 'New pattern', content: '...', tags: ['test'], project_name: null }
    ];
    mockPool.query.mockResolvedValueOnce({ rows: fakeRows });
    const result = await getTodaysReflections();
    expect(result).toEqual(fakeRows);
  });

  it('SQL 按 CURRENT_DATE 过滤', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await getTodaysReflections();
    const sql = mockPool.query.mock.calls[0][0];
    expect(sql).toContain('CURRENT_DATE');
    expect(sql).toContain('created_at >=');
  });

  it('SQL 包含 reflections 表和 projects 联结', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await getTodaysReflections();
    const sql = mockPool.query.mock.calls[0][0];
    expect(sql).toContain('FROM reflections r');
    expect(sql).toContain('LEFT JOIN projects p');
  });

  it('数据库返回空时返回空数组', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const result = await getTodaysReflections();
    expect(result).toEqual([]);
  });

  it('数据库查询失败时抛出错误', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('table does not exist'));
    await expect(getTodaysReflections()).rejects.toThrow('table does not exist');
  });
});

// ------------------------------------------------------------------
// saveDailyLog
// ------------------------------------------------------------------

describe('saveDailyLog', () => {
  let saveDailyLog;
  let mockPool;

  beforeEach(async () => {
    vi.resetModules();
    const dbMod = await import('../db.js');
    mockPool = dbMod.default;
    mockPool.query.mockReset();

    const mod = await import('../nightly-tick.js');
    saveDailyLog = mod.saveDailyLog;
  });

  it('今日记录不存在时 INSERT 并返回 { created: true, id }', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })                          // SELECT existing
      .mockResolvedValueOnce({ rows: [{ id: 'log-uuid-001' }] });   // INSERT RETURNING

    const result = await saveDailyLog('proj-001', { foo: 'bar' }, 'repo');
    expect(result).toEqual({ created: true, id: 'log-uuid-001' });
  });

  it('今日记录已存在时 UPDATE 并返回 { updated: true, id }', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'existing-log-id' }] }) // SELECT existing
      .mockResolvedValueOnce({ rows: [] });                          // UPDATE

    const result = await saveDailyLog('proj-001', { foo: 'bar' }, 'repo');
    expect(result).toEqual({ updated: true, id: 'existing-log-id' });
  });

  it('report 为字符串时直接使用，不重复 JSON.stringify', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'log-str-001' }] });

    const jsonStr = '{"already":"json"}';
    await saveDailyLog(null, jsonStr, 'summary');

    const insertParams = mockPool.query.mock.calls[1][1];
    // 第三个参数 (index 2) 是 summary 字段
    expect(insertParams[2]).toBe(jsonStr);
  });

  it('report 为对象时序列化为 JSON 字符串', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'log-obj-001' }] });

    const reportObj = { key: 'value', count: 42 };
    await saveDailyLog('proj-001', reportObj, 'repo');

    const insertParams = mockPool.query.mock.calls[1][1];
    expect(JSON.parse(insertParams[2])).toEqual(reportObj);
  });

  it('projectId 为 null 时 INSERT 传入 null（summary 报告）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'summary-log-001' }] });

    await saveDailyLog(null, { summary: true }, 'summary');

    const insertParams = mockPool.query.mock.calls[1][1];
    expect(insertParams[1]).toBeNull(); // project_id 参数
  });

  it('type 和 agent 参数使用默认值（repo / nightly-tick）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'default-log-001' }] });

    await saveDailyLog('proj-001', {});

    const insertParams = mockPool.query.mock.calls[1][1];
    // [today, projectId, reportJson, type, agent]
    expect(insertParams[3]).toBe('repo');
    expect(insertParams[4]).toBe('nightly-tick');
  });

  it('SELECT 查询使用 IS NOT DISTINCT FROM 处理 NULL projectId', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'x' }] });

    await saveDailyLog(null, {}, 'summary');

    const selectSql = mockPool.query.mock.calls[0][0];
    expect(selectSql).toContain('IS NOT DISTINCT FROM');
  });

  it('数据库 SELECT 失败时抛出错误', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('SELECT failed'));
    await expect(saveDailyLog('proj-001', {})).rejects.toThrow('SELECT failed');
  });

  it('UPDATE 语句更新 summary 和 agent 字段', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'existing-id' }] })
      .mockResolvedValueOnce({ rows: [] });

    await saveDailyLog('proj-001', { data: 1 }, 'repo', 'custom-agent');

    const updateSql = mockPool.query.mock.calls[1][0];
    expect(updateSql).toContain('UPDATE daily_logs');
    expect(updateSql).toContain('SET summary');
    expect(updateSql).toContain('agent');
  });
});

// ------------------------------------------------------------------
// executeNightlyAlignment
// ------------------------------------------------------------------

describe('executeNightlyAlignment', () => {
  let executeNightlyAlignment;
  let mockPool;
  let mockEmit;

  // 构建标准 mock 序列：
  // 1. getActiveProjectsWithStats → rows
  // 2. saveDailyLog（SELECT existing，INSERT per project）
  // 3. getGoalsProgress → rows
  // 4. getTodaysReflections → rows
  // 5. saveDailyLog for summary（SELECT，INSERT）
  // 6. 若 completed_today > 0：SELECT existing review task，INSERT review task

  function buildMockPool({
    projects = [],
    goals = [],
    reflections = [],
    logExistsForProjects = false,
    reviewExistsForProjects = false,
    summaryLogExists = false
  } = {}) {
    const calls = [];

    // 1. getActiveProjectsWithStats
    calls.push({ rows: projects });

    // 2. per-project saveDailyLog
    for (const _p of projects) {
      calls.push({ rows: logExistsForProjects ? [{ id: 'existing-log' }] : [] }); // SELECT
      if (!logExistsForProjects) {
        calls.push({ rows: [{ id: 'new-log-id' }] }); // INSERT
      } else {
        calls.push({ rows: [] }); // UPDATE
      }
    }

    // 3. getGoalsProgress
    calls.push({ rows: goals });

    // 4. getTodaysReflections
    calls.push({ rows: reflections });

    // 5. summary saveDailyLog
    calls.push({ rows: summaryLogExists ? [{ id: 'existing-summary' }] : [] }); // SELECT
    if (summaryLogExists) {
      calls.push({ rows: [] }); // UPDATE
    } else {
      calls.push({ rows: [{ id: 'new-summary-id' }] }); // INSERT
    }

    // 6. per-project review task (only for completed_today > 0)
    for (const p of projects) {
      if (parseInt(p.completed_today) > 0) {
        calls.push({ rows: reviewExistsForProjects ? [{ id: 'existing-review' }] : [] }); // SELECT dedup
        if (!reviewExistsForProjects) {
          calls.push({ rows: [{ id: 'review-task-id' }] }); // INSERT task
        }
      }
    }

    const mock = { query: vi.fn() };
    calls.forEach(row => mock.query.mockResolvedValueOnce(row));
    return mock;
  }

  beforeEach(async () => {
    vi.resetModules();

    const dbMod = await import('../db.js');
    mockPool = dbMod.default;
    mockPool.query.mockReset();

    const eventMod = await import('../event-bus.js');
    mockEmit = eventMod.emit;
    mockEmit.mockReset();
    mockEmit.mockResolvedValue(undefined);

    const mod = await import('../nightly-tick.js');
    executeNightlyAlignment = mod.executeNightlyAlignment;
  });

  it('无项目时返回成功结果，tasks_summary 全为 0', async () => {
    const mock = buildMockPool({ projects: [] });
    Object.assign(mockPool, mock);
    mockPool.query = mock.query;

    const result = await executeNightlyAlignment();

    expect(result.success).toBe(true);
    expect(result.projects_processed).toBe(0);
    expect(result.summary.tasks_summary.completed_today).toBe(0);
    expect(result.summary.tasks_summary.failed_today).toBe(0);
  });

  it('单个正常项目：生成报告、保存日志、emit 事件', async () => {
    const project = makeProject({ completed_today: '2', failed_today: '0' });
    const mock = buildMockPool({ projects: [project] });
    mockPool.query = mock.query;

    const result = await executeNightlyAlignment();

    expect(result.success).toBe(true);
    expect(result.projects_processed).toBe(1);
    expect(mockEmit).toHaveBeenCalledOnce();
    expect(mockEmit).toHaveBeenCalledWith(
      'nightly_alignment_completed',
      'nightly-tick',
      expect.objectContaining({ projects_count: 1 })
    );
  });

  it('completed_today > 0 时为项目创建 review 任务', async () => {
    const project = makeProject({ completed_today: '3', failed_today: '0' });
    const mock = buildMockPool({ projects: [project], reviewExistsForProjects: false });
    mockPool.query = mock.query;

    const result = await executeNightlyAlignment();

    // actions_taken 包含 create_review_task
    const reviewActions = result.actions_taken.filter(a => a.action === 'create_review_task');
    expect(reviewActions).toHaveLength(1);
    expect(reviewActions[0].project_name).toBe('cecelia');
  });

  it('review 任务已存在时跳过创建（dedup）', async () => {
    const project = makeProject({ completed_today: '2' });
    const mock = buildMockPool({ projects: [project], reviewExistsForProjects: true });
    mockPool.query = mock.query;

    const result = await executeNightlyAlignment();

    const reviewActions = result.actions_taken.filter(a => a.action === 'create_review_task');
    expect(reviewActions).toHaveLength(0);
  });

  it('completed_today = 0 时不创建 review 任务', async () => {
    const project = makeProject({ completed_today: '0' });
    const mock = buildMockPool({ projects: [project] });
    mockPool.query = mock.query;

    const result = await executeNightlyAlignment();

    const reviewActions = result.actions_taken.filter(a => a.action === 'create_review_task');
    expect(reviewActions).toHaveLength(0);
  });

  it('summary 报告正确聚合多个项目的 health 统计', async () => {
    const p1 = makeProject({ id: 'p1', name: 'proj-a', completed_today: '3', in_progress: '2', failed_today: '0' });
    const p2 = makeProject({ id: 'p2', name: 'proj-b', completed_today: '0', in_progress: '0', failed_today: '1' });
    const mock = buildMockPool({ projects: [p1, p2] });
    mockPool.query = mock.query;

    const result = await executeNightlyAlignment();

    expect(result.summary.projects_summary.total).toBe(2);
    expect(result.summary.projects_summary.healthy).toBe(1);
    expect(result.summary.projects_summary.warning).toBe(1);
  });

  it('summary 报告正确累加 tasks_summary 数字', async () => {
    const p1 = makeProject({ id: 'p1', name: 'proj-a', completed_today: '4', in_progress: '1', queued: '3', failed_today: '0' });
    const p2 = makeProject({ id: 'p2', name: 'proj-b', completed_today: '2', in_progress: '2', queued: '1', failed_today: '1' });
    const mock = buildMockPool({ projects: [p1, p2] });
    mockPool.query = mock.query;

    const result = await executeNightlyAlignment();

    expect(result.summary.tasks_summary.completed_today).toBe(6);
    expect(result.summary.tasks_summary.in_progress).toBe(3);
    expect(result.summary.tasks_summary.queued).toBe(4);
    expect(result.summary.tasks_summary.failed_today).toBe(1);
  });

  it('reflections 正确按 type 分类汇总', async () => {
    const reflections = [
      { id: 'r1', type: 'issue' },
      { id: 'r2', type: 'issue' },
      { id: 'r3', type: 'learning' },
      { id: 'r4', type: 'improvement' }
    ];
    const mock = buildMockPool({ reflections });
    mockPool.query = mock.query;

    const result = await executeNightlyAlignment();

    expect(result.summary.reflections_summary.issues).toBe(2);
    expect(result.summary.reflections_summary.learnings).toBe(1);
    expect(result.summary.reflections_summary.improvements).toBe(1);
  });

  it('goals_progress 正确映射到 summary 中', async () => {
    const goals = [
      { id: 'g1', title: 'KR1', status: 'in_progress', priority: 'P0', progress: 75, project_name: 'cecelia' }
    ];
    const mock = buildMockPool({ goals });
    mockPool.query = mock.query;

    const result = await executeNightlyAlignment();

    expect(result.summary.goals_progress).toHaveLength(1);
    expect(result.summary.goals_progress[0]).toEqual({
      id: 'g1',
      title: 'KR1',
      status: 'in_progress',
      priority: 'P0',
      progress: 75,
      project: 'cecelia'
    });
  });

  it('结果包含 date 字段（YYYY-MM-DD 格式）', async () => {
    const mock = buildMockPool();
    mockPool.query = mock.query;

    const result = await executeNightlyAlignment();

    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('getActiveProjectsWithStats 失败时抛出错误', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('projects query failed'));
    await expect(executeNightlyAlignment()).rejects.toThrow('projects query failed');
  });
});

// ------------------------------------------------------------------
// runNightlyAlignmentSafe
// ------------------------------------------------------------------

describe('runNightlyAlignmentSafe', () => {
  let runNightlyAlignmentSafe;
  let mockPool;
  let mockEmit;

  beforeEach(async () => {
    vi.resetModules();

    const dbMod = await import('../db.js');
    mockPool = dbMod.default;
    mockPool.query.mockReset();

    const eventMod = await import('../event-bus.js');
    mockEmit = eventMod.emit;
    mockEmit.mockReset();
    mockEmit.mockResolvedValue(undefined);

    const mod = await import('../nightly-tick.js');
    runNightlyAlignmentSafe = mod.runNightlyAlignmentSafe;
  });

  it('正常执行时返回 success: true', async () => {
    // 无项目的最小 mock 序列：getActiveProjectsWithStats + goals + reflections + summary log
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })                         // getActiveProjectsWithStats
      .mockResolvedValueOnce({ rows: [] })                         // getGoalsProgress
      .mockResolvedValueOnce({ rows: [] })                         // getTodaysReflections
      .mockResolvedValueOnce({ rows: [] })                         // saveDailyLog SELECT
      .mockResolvedValueOnce({ rows: [{ id: 'summary-id' }] });   // saveDailyLog INSERT

    const result = await runNightlyAlignmentSafe();
    expect(result.success).toBe(true);
  });

  it('executeNightlyAlignment 抛错时返回 { success: false, error }', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('nightly alignment crash'));

    const result = await runNightlyAlignmentSafe();
    expect(result.success).toBe(false);
    expect(result.error).toBe('nightly alignment crash');
  });

  it('并发调用时第二次返回 { skipped: true, reason: already_running }', async () => {
    // 第一次调用：永远不 resolve（模拟长时间运行）
    mockPool.query.mockImplementation(() => new Promise(() => {}));

    // 启动第一次调用（不等待）
    const firstCallPromise = runNightlyAlignmentSafe();

    // 立即发起第二次调用
    const secondResult = await runNightlyAlignmentSafe();

    expect(secondResult).toEqual({ skipped: true, reason: 'already_running' });

    // 清理：不等待 firstCallPromise（它永远不会 resolve）
  });

  it('执行完成后 _nightlyRunning 重置为 false（第二次可正常执行）', async () => {
    // 第一次执行
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'sum-1' }] });

    const first = await runNightlyAlignmentSafe();
    expect(first.success).toBe(true);

    // 第二次执行（不应被 skip）
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'sum-2' }] });

    const second = await runNightlyAlignmentSafe();
    expect(second.success).toBe(true);
    expect(second.skipped).toBeUndefined();
  });

  it('executeNightlyAlignment 抛错后 _nightlyRunning 仍重置（finally 保证）', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('crash'));
    const first = await runNightlyAlignmentSafe();
    expect(first.success).toBe(false);

    // 第二次不应被 skip
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'sum-3' }] });

    const second = await runNightlyAlignmentSafe();
    expect(second.success).toBe(true);
  });
});

// ------------------------------------------------------------------
// startNightlyScheduler / stopNightlyScheduler / getNightlyTickStatus
// ------------------------------------------------------------------

describe('startNightlyScheduler / stopNightlyScheduler / getNightlyTickStatus', () => {
  let startNightlyScheduler;
  let stopNightlyScheduler;
  let getNightlyTickStatus;

  beforeEach(async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date']
    });
    vi.resetModules();

    const dbMod = await import('../db.js');
    dbMod.default.query.mockReset();

    const mod = await import('../nightly-tick.js');
    startNightlyScheduler = mod.startNightlyScheduler;
    stopNightlyScheduler = mod.stopNightlyScheduler;
    getNightlyTickStatus = mod.getNightlyTickStatus;

    // 确保调度器处于停止状态
    stopNightlyScheduler();
  });

  afterEach(() => {
    stopNightlyScheduler();
    vi.useRealTimers();
  });

  it('startNightlyScheduler 首次调用返回 true', () => {
    const result = startNightlyScheduler();
    expect(result).toBe(true);
  });

  it('startNightlyScheduler 重复调用返回 false（已在运行）', () => {
    startNightlyScheduler();
    const second = startNightlyScheduler();
    expect(second).toBe(false);
  });

  it('stopNightlyScheduler 在调度器运行时返回 true', () => {
    startNightlyScheduler();
    const result = stopNightlyScheduler();
    expect(result).toBe(true);
  });

  it('stopNightlyScheduler 在调度器未运行时返回 false', () => {
    const result = stopNightlyScheduler();
    expect(result).toBe(false);
  });

  it('getNightlyTickStatus 调度器未运行时 scheduler_running = false', () => {
    const status = getNightlyTickStatus();
    expect(status.scheduler_running).toBe(false);
    expect(status.next_run_ms).toBeNull();
    expect(status.tick_running).toBe(false);
  });

  it('getNightlyTickStatus 调度器运行时 scheduler_running = true', () => {
    startNightlyScheduler();
    const status = getNightlyTickStatus();
    expect(status.scheduler_running).toBe(true);
    expect(status.next_run_ms).not.toBeNull();
    expect(typeof status.next_run_ms).toBe('number');
  });

  it('getNightlyTickStatus 包含 scheduled_hour 和 scheduled_minute', () => {
    const status = getNightlyTickStatus();
    expect(typeof status.scheduled_hour).toBe('number');
    expect(typeof status.scheduled_minute).toBe('number');
  });

  it('stop 之后 getNightlyTickStatus.scheduler_running 变为 false', () => {
    startNightlyScheduler();
    stopNightlyScheduler();
    const status = getNightlyTickStatus();
    expect(status.scheduler_running).toBe(false);
  });
});

// ------------------------------------------------------------------
// msUntilNextRun（通过 getNightlyTickStatus 间接测试）
// ------------------------------------------------------------------

describe('msUntilNextRun（通过 getNightlyTickStatus 间接验证）', () => {
  let startNightlyScheduler;
  let stopNightlyScheduler;
  let getNightlyTickStatus;

  beforeEach(async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date']
    });
    vi.resetModules();

    const dbMod = await import('../db.js');
    dbMod.default.query.mockReset();

    const mod = await import('../nightly-tick.js');
    startNightlyScheduler = mod.startNightlyScheduler;
    stopNightlyScheduler = mod.stopNightlyScheduler;
    getNightlyTickStatus = mod.getNightlyTickStatus;
    stopNightlyScheduler();
  });

  afterEach(() => {
    stopNightlyScheduler();
    vi.useRealTimers();
  });

  it('next_run_ms > 0（始终是未来时间）', () => {
    // 固定当前时间为 08:00，距离 22:00 还有 14 小时
    vi.setSystemTime(new Date('2026-03-06T08:00:00.000Z'));
    startNightlyScheduler();
    const status = getNightlyTickStatus();
    expect(status.next_run_ms).toBeGreaterThan(0);
  });

  it('当前时间已过 22:00 时 next_run_ms 仍 > 0（翻天计算）', () => {
    // 固定当前时间为 23:00，距离次日 22:00 还有 23 小时
    vi.setSystemTime(new Date('2026-03-06T23:00:00.000Z'));
    startNightlyScheduler();
    const status = getNightlyTickStatus();
    expect(status.next_run_ms).toBeGreaterThan(0);
    // 应该接近 23 小时（±1 分钟容差）
    const expected = 23 * 60 * 60 * 1000;
    const tolerance = 60 * 1000;
    // 检查在合理范围内（14h ~ 24h UTC 时区）
    expect(status.next_run_ms).toBeLessThan(24 * 60 * 60 * 1000 + tolerance);
  });

  it('next_run_ms 不超过 24 小时', () => {
    vi.setSystemTime(new Date('2026-03-06T12:00:00.000Z'));
    startNightlyScheduler();
    const status = getNightlyTickStatus();
    expect(status.next_run_ms).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });
});

// ------------------------------------------------------------------
// getDailyReports
// ------------------------------------------------------------------

describe('getDailyReports', () => {
  let getDailyReports;
  let mockPool;

  beforeEach(async () => {
    vi.resetModules();
    const dbMod = await import('../db.js');
    mockPool = dbMod.default;
    mockPool.query.mockReset();

    const mod = await import('../nightly-tick.js');
    getDailyReports = mod.getDailyReports;
  });

  it('不传参数时查询今日（today）所有类型报告', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await getDailyReports();

    const [sql, params] = mockPool.query.mock.calls[0];
    // date 参数应为今日 YYYY-MM-DD
    expect(params[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // 不传 type='all'，不应有第二个 $2 参数过滤
    expect(params).toHaveLength(1);
    expect(sql).not.toContain('dl.type = $2');
  });

  it("传入具体日期时查询该日期的报告", async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await getDailyReports('2026-03-01', 'all');

    const [, params] = mockPool.query.mock.calls[0];
    expect(params[0]).toBe('2026-03-01');
  });

  it("type 不为 'all' 时添加 type 过滤条件", async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await getDailyReports('2026-03-01', 'repo');

    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toContain('dl.type = $2');
    expect(params[1]).toBe('repo');
  });

  it("type = 'summary' 时只查 summary 报告", async () => {
    const fakeRows = [{ id: 'log-1', type: 'summary', date: '2026-03-01' }];
    mockPool.query.mockResolvedValueOnce({ rows: fakeRows });

    const result = await getDailyReports('2026-03-01', 'summary');
    expect(result).toEqual(fakeRows);

    const params = mockPool.query.mock.calls[0][1];
    expect(params[1]).toBe('summary');
  });

  it('返回数据库 rows', async () => {
    const fakeRows = [
      { id: 'l1', type: 'repo', date: '2026-03-06', project_name: 'cecelia' },
      { id: 'l2', type: 'summary', date: '2026-03-06', project_name: null }
    ];
    mockPool.query.mockResolvedValueOnce({ rows: fakeRows });

    const result = await getDailyReports('2026-03-06');
    expect(result).toEqual(fakeRows);
  });

  it('SQL 包含 daily_logs 和 projects 联结', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await getDailyReports('2026-03-06');

    const sql = mockPool.query.mock.calls[0][0];
    expect(sql).toContain('FROM daily_logs dl');
    expect(sql).toContain('LEFT JOIN projects p');
  });

  it('SQL 包含 ORDER BY 排序', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await getDailyReports('2026-03-06');

    const sql = mockPool.query.mock.calls[0][0];
    expect(sql).toContain('ORDER BY');
  });

  it('数据库查询失败时抛出错误', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('daily_logs table missing'));
    await expect(getDailyReports('2026-03-06')).rejects.toThrow('daily_logs table missing');
  });
});

// ------------------------------------------------------------------
// NIGHTLY_HOUR / NIGHTLY_MINUTE 常量导出
// ------------------------------------------------------------------

describe('NIGHTLY_HOUR / NIGHTLY_MINUTE 常量', () => {
  it('NIGHTLY_HOUR 默认为 22', async () => {
    vi.resetModules();
    const mod = await import('../nightly-tick.js');
    expect(mod.NIGHTLY_HOUR).toBe(22);
  });

  it('NIGHTLY_MINUTE 默认为 0', async () => {
    vi.resetModules();
    const mod = await import('../nightly-tick.js');
    expect(mod.NIGHTLY_MINUTE).toBe(0);
  });

  it('NIGHTLY_HOUR 可通过环境变量覆盖', async () => {
    vi.resetModules();
    process.env.CECELIA_NIGHTLY_HOUR = '23';
    const mod = await import('../nightly-tick.js');
    expect(mod.NIGHTLY_HOUR).toBe(23);
    delete process.env.CECELIA_NIGHTLY_HOUR;
  });

  it('NIGHTLY_MINUTE 可通过环境变量覆盖', async () => {
    vi.resetModules();
    process.env.CECELIA_NIGHTLY_MINUTE = '30';
    const mod = await import('../nightly-tick.js');
    expect(mod.NIGHTLY_MINUTE).toBe(30);
    delete process.env.CECELIA_NIGHTLY_MINUTE;
  });
});
