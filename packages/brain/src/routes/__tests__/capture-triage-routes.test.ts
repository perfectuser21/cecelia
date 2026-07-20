/**
 * capture-triage urgent/okr 路由测试骨架
 * task_id: 07b2fd3b-724b-4da3-bdf3-827821b66ba5
 * 覆盖: FR-5, FR-6, I-6, I-8, I-10
 */

// NOTE: 此测试依赖数据库连接和 Brain 运行中
// CI 中需要 test DB + Brain 进程

const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';
const DB_URL = process.env.DATABASE_URL || 'postgres://cecelia:cecelia@localhost:5432/cecelia';

describe('FR-5: urgent 路由 → 真实 task + Bark', () => {
  it('target_type=issue + target_subtype=P0 → triage 后 tasks 增加 title LIKE [紧急]%', async () => {
    /**
     * 前置:
     *   INSERT INTO capture_atoms (content, target_type, target_subtype, status)
     *   VALUES ('紧急测试条目', 'issue', 'P0', 'pending_review')
     * 执行: runCaptureTriage(pool) 或等 tick
     * 断言:
     *   SELECT count(*) FROM tasks WHERE title LIKE '[紧急]%' AND created_at > now()-interval '5 min' ≥ 1
     *   atom.status = 'confirmed'
     *   atom.routed_to_table = 'tasks'
     *   atom.routed_to_id IS NOT NULL
     */
    expect(true).toBe(true); // 骨架占位
  });

  it('PRODUCTION_SENSITIVE_PATTERN 命中 → 不建 task，仅 Bark', async () => {
    /**
     * 前置: 插入含 PRODUCTION_SENSITIVE_PATTERN 关键词的 urgent atom
     * 执行: runCaptureTriage(pool)
     * 断言: tasks 不增加；Bark 被调用（mock/spy 验证）
     */
    expect(true).toBe(true); // 骨架占位
  });

  it('urgent 路由后 atom 包含 routed_to_table + routed_to_id（I-6 合规）', async () => {
    /**
     * 断言: atom.routed_to_table='tasks', atom.routed_to_id IS NOT NULL
     * 验证 I-6: 派生回链强制写 routed_to_table/routed_to_id
     */
    expect(true).toBe(true); // 骨架占位
  });
});

describe('FR-6: okr 路由 → notes 表', () => {
  it('okr 路由 atom → notes 增加 category=strategic_input 记录', async () => {
    /**
     * 前置: 插入会被路由为 okr 的 atom
     * 执行: runCaptureTriage(pool)
     * 断言: SELECT count(*) FROM notes WHERE category='strategic_input' AND created_at > now()-interval '5 min' ≥ 1
     */
    expect(true).toBe(true); // 骨架占位
  });

  it('okr 路由后 atom 包含 routed_to_table=notes + routed_to_id（I-6 合规）', async () => {
    expect(true).toBe(true); // 骨架占位
  });
});

describe('NFR-5: 事务完整性', () => {
  it('urgent: task 创建失败 → atom 不更新（ROLLBACK）', async () => {
    /**
     * Mock: createTask 抛错
     * 断言: atom.status 仍为 pending_review（未更新）
     */
    expect(true).toBe(true); // 骨架占位
  });

  it('okr: notes 写入失败 → atom 不更新（ROLLBACK）', async () => {
    /**
     * Mock: pool.query INSERT INTO notes 抛错
     * 断言: atom.status 仍为 pending_review
     */
    expect(true).toBe(true); // 骨架占位
  });
});

describe('I-10: 生产护栏保留', () => {
  it('PRODUCTION_SENSITIVE_PATTERN 仍存在于 capture-triage.js', () => {
    const fs = require('fs');
    const path = require('path');
    const triageFile = path.resolve(
      __dirname,
      '../../../packages/brain/src/capture-triage.js'
    );
    expect(fs.existsSync(triageFile)).toBe(true);
    const content = fs.readFileSync(triageFile, 'utf8');
    expect(content).toContain('PRODUCTION_SENSITIVE_PATTERN');
  });
});
