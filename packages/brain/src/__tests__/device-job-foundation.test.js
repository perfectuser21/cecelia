/**
 * device-job-foundation.test.js
 *
 * 排程看板第一刀·Brain 地基（task 4c77ccce，决策 1e76f0b8）。
 *
 * device_job = 手机（安卓工作机）的活。它必须能进 tasks 表当任务单，
 * 但绝不能被当成"给 LLM 跑的编码任务"派出去，也绝不能污染 Notion 投影窗口。
 *
 * 这里守四道闸，每道在对应实现被摘掉时都必须报红（变异清单见文件末尾）：
 *   闸1 类型白名单  —— tasks_task_type_check 认 device_job，否则第一条 INSERT 即 23514
 *   闸2 派发排除    —— selectNextDispatchableTask 的谓词把 device_job 排除在外
 *   闸3 投影隔离    —— pushTasks 的取数不把 device_job 推去 Notion
 *   闸4 乐观锁字段  —— tasks.row_version 存在（updated_at 被 tick 定时 touch，不能当锁）
 *
 * 闸2 是本刀最危险的一处：dispatch 谓词是**黑名单制**，没有白名单。任何新 task_type
 * 只要 status='queued' 就会被 2 分钟一轮的 tick 抢去派给执行体，真的去"跑一轮采收"——
 * 既烧模型配额，又直接撞 invariant 96054a8b（us-vps 零执行）。
 *
 * 断言一律先剥注释再匹配：0920 踩过 grep -qF 命中注释行、实现改回去也不报红的坑。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 闸2 运行时校验（团队 Task 3 审查裁决 Important #1）：静态文本断言只能证明 SQL
// 长得像 `task_type = ANY($n::text[])`，证明不了那个 $n 绑的到底是哪个数组——万一
// 参数下标算错、或绑成了别的集合，文本断言照样绿。改真调用 selectNextDispatchableTask，
// mock 掉它的四条依赖链（同 dispatch-helpers.test.js 的手法），从 mock 的 pool.query
// 调用里取出真实 SQL + 真实参数数组，逐一核对。
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));
vi.mock('../alertness-actions.js', () => ({
  getMitigationState: vi.fn(() => ({ p2_paused: false })),
}));
vi.mock('../actions.js', () => ({
  updateTask: vi.fn(),
  createTask: vi.fn(),
}));
vi.mock('../task-weight.js', () => ({
  sortTasksByWeight: vi.fn((rows) => rows),
}));
vi.mock('../quarantine.js', () => ({
  handleTaskFailure: vi.fn(),
}));
vi.mock('../slot-allocator.js', () => ({
  shouldBypassBackpressure: vi.fn(() => false),
}));

import { selectNextDispatchableTask } from '../dispatch-helpers.js';
import { PUSH_TASKS_QUERY } from '../notion-push-sync.js';
import { TICK_DISPATCH_EXCLUDED, PUSH_EXCLUDED_TASK_TYPES } from '../lib/task-type-registry.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, '..', '..', 'migrations');

// 剥掉 SQL 行注释与块注释，避免断言命中注释里的字样
function stripSqlComments(sql) {
  return sql
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

// 本刀新增的 migration：文件名带 device_job，内容是权威
function readDeviceJobMigration() {
  const file = readdirSync(MIGRATIONS_DIR).find((f) => /device_job/.test(f));
  expect(file, 'device_job 的 migration 文件不存在').toBeTruthy();
  return stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
}

describe('闸1 类型白名单：device_job 能进 tasks 表', () => {
  it('migration 重建 tasks_task_type_check 并纳入 device_job', () => {
    const sql = readDeviceJobMigration();
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS tasks_task_type_check/i);
    expect(sql).toMatch(/ADD CONSTRAINT tasks_task_type_check/i);
    expect(sql).toMatch(/'device_job'/);
  });

  it('重建时保留现行关键值（DROP+重建模式下漏抄=把别的任务类型打死）', () => {
    const sql = readDeviceJobMigration();
    for (const kept of ['harness_initiative', 'dev', 'data', 'content-pipeline', 'arch_review']) {
      expect(sql, `重建 CHECK 时漏掉了 ${kept}`).toMatch(new RegExp(`'${kept}'`));
    }
  });

  it('DDL 幂等（CI 会重放全部 migration）', () => {
    const sql = readDeviceJobMigration();
    expect(sql).toMatch(/IF EXISTS|IF NOT EXISTS/i);
  });
});

describe('闸2 派发排除：device_job 不进无头派发队列', () => {
  // 静态文本断言仍保留（防"谓词整段被删/改名"这类粗暴回退），但真正卡住行为的是
  // 下面的运行时断言——文本长得对不代表参数绑对，见上方 mock 说明。
  const dispatchSrc = stripSqlComments(
    readFileSync(join(HERE, '..', 'dispatch-helpers.js'), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n'),
  );

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it('导出的选单函数仍在（谓词搬家了要让守卫跟着走）', () => {
    expect(typeof selectNextDispatchableTask).toBe('function');
    expect(dispatchSrc).toMatch(/export\s+async\s+function\s+selectNextDispatchableTask/);
  });

  it('device_job 的排除是运行时真参数：SQL 含 AND NOT (t.task_type = ANY($，绑定的数组严格等于 TICK_DISPATCH_EXCLUDED（含 device_job）', async () => {
    await selectNextDispatchableTask(null, []);
    expect(mockQuery).toHaveBeenCalled();
    const [sql, params] = mockQuery.mock.calls[0];

    // NOT 是这道闸的开关：漏了 NOT 就从"排除"变成"只选这些类型"，两种都能让 SQL
    // 语法合法、都能命中 `= ANY($` 这种宽松正则，必须把 NOT 钉死在同一条断言里。
    expect(sql, 'SQL 里找不到 AND NOT (t.task_type = ANY($ ——排除闸可能被弱化或删掉').toMatch(
      /AND NOT \(t\.task_type = ANY\(\$1::text\[\]\)\)/,
    );
    // goalIds=null、excludeIds=[] 时 TICK_DISPATCH_EXCLUDED 是唯一参数，下标固定为 1
    // （见 dispatch-helpers.js 的 excludedTypesIdx 计算：goalCondition/excludeClause
    // 在这两个入参下都不占参数位）。
    expect(
      params[0],
      '绑定到 $1 的数组不是 TICK_DISPATCH_EXCLUDED——排除闸可能绑错了集合',
    ).toEqual(TICK_DISPATCH_EXCLUDED);
    expect(params[0]).toContain('device_job');
  });

  it('headed_manual 这道既有闸仍在（回归保护：两道闸缺一不可）', () => {
    expect(dispatchSrc).toMatch(/payload->>'headed_manual'/);
  });
});

describe('闸3 投影隔离：device_job 不进 Notion 投影窗口', () => {
  it('pushTasks 排除的 task_type 名单来自注册表 PUSH_EXCLUDED_TASK_TYPES，且含 device_job', () => {
    expect(PUSH_EXCLUDED_TASK_TYPES, '注册表 PUSH_EXCLUDED_TASK_TYPES 必须含 device_job').toContain('device_job');
  });

  it('pushTasks 取数排除 device_job（查询按注册表派生名单内联生成 NOT ANY(ARRAY[...])）', () => {
    const q = stripSqlComments(PUSH_TASKS_QUERY);
    expect(q, 'pushTasks 没有排除 device_job——每轮 LIMIT 10 的投影窗口会被手机单挤爆').toMatch(
      /NOT \(task_type = ANY\(ARRAY\[[^\]]*'device_job'[^\]]*\]::text\[\]\)\)/i,
    );
  });

  it('投影窗口仍是有界的（LIMIT 保留，防一次涌入打爆 Notion 限流）', () => {
    const q = stripSqlComments(PUSH_TASKS_QUERY);
    expect(q).toMatch(/LIMIT\s+\d+/i);
  });
});

describe('闸4 乐观锁字段：tasks.row_version', () => {
  it('migration 给 tasks 加 row_version', () => {
    const sql = readDeviceJobMigration();
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS row_version/i);
  });

  it('row_version 有非空默认值（老行也要能参与 CAS）', () => {
    const sql = readDeviceJobMigration();
    const line = sql.split('\n').find((l) => /row_version/i.test(l) && /ADD COLUMN/i.test(l)) ?? '';
    expect(line).toMatch(/NOT NULL/i);
    expect(line).toMatch(/DEFAULT\s+0/i);
  });
});

/**
 * 变异清单（proven-to-fire，标 done 前必须亲手做一遍）：
 *   1. 删掉 dispatch-helpers.js 谓词里的 device_job → 闸2 两条必须变红
 *   2. 删掉 notion-push-sync.js 里 PUSH_EXCLUDED_TASK_TYPES 内联生成的 NOT ANY(ARRAY[...]) 排除子句 → 闸3 必须变红
 *   3. 删掉 migration 里的 'device_job' → 闸1 必须变红
 *   4. 删掉 migration 里 row_version 那行 → 闸4 必须变红
 * 没亲眼见它报红过的守卫不算守卫。
 */
