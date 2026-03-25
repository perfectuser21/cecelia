/**
 * Integration Test: OKR 拆解端到端流程
 *
 * 测试新 OKR 表（objectives / key_results / okr_projects / okr_scopes / okr_initiatives）
 * 通过 Brain API 验证：
 *   1. 完整的层级创建链（Vision → Objective → KR → Project → Scope → Initiative）
 *   2. FK 级联删除（DELETE Objective → 子表全部删除）
 *   3. 树状层级查询 /api/brain/okr/tree
 *   4. KR 进度重算 recalculate-progress
 *
 * 依赖：Brain 服务运行于 localhost:5221，PostgreSQL cecelia 数据库可访问
 */
import { describe as _describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';
const OKR_BASE = `${BRAIN_URL}/api/brain/okr`;

// 直连 DB 用于 Vision 创建（顶层节点）和 afterAll 清理
const testPool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });

async function post(path, body) {
  const res = await fetch(`${OKR_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(path) {
  const res = await fetch(`${OKR_BASE}${path}`);
  return { status: res.status, body: await res.json() };
}

// 跳过条件：Brain 服务不可达时（CI 无 live Brain 服务，本地未启动时）
const brainAvailable = await fetch(`${BRAIN_URL}/api/brain/status`).then(r => r.ok).catch(() => false);
const describe = brainAvailable ? _describe : _describe.skip;

describe('OKR 拆解端到端集成测试', () => {
  let visionId, objId, krId, projectId, scopeId, initiativeId;

  beforeAll(async () => {

    // Vision 通过 DB 直接创建（隔离测试数据）
    const visionRes = await testPool.query(
      `INSERT INTO visions (title, status) VALUES ($1, 'active') RETURNING id`,
      [`[TEST] Vision-${Date.now()}`]
    );
    visionId = visionRes.rows[0].id;
  });

  afterAll(async () => {
    // 清理 tasks 的 okr_initiative_id 引用（避免 FK 违约）
    if (initiativeId) {
      await testPool.query(
        `UPDATE tasks SET okr_initiative_id = NULL WHERE okr_initiative_id = $1`,
        [initiativeId]
      );
    }
    // 删除 Vision（ON DELETE CASCADE 自动清理 Objective/KR/Project/Scope/Initiative）
    if (visionId) {
      await testPool.query(`DELETE FROM visions WHERE id = $1`, [visionId]);
    }
    await testPool.end();
  });

  // ─── 1. 层级创建链 ──────────────────────────────────────────────────────────

  describe('okr-decomposition: 层级创建链', () => {
    it('创建 Objective（绑定 Vision）', async () => {
      const { status, body } = await post('/objectives', {
        title: '[TEST] OKR 拆解测试 Objective',
        vision_id: visionId,
        status: 'active',
        priority: 'P0',
      });

      expect(status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.item.vision_id).toBe(visionId);
      objId = body.item.id;
    });

    it('创建 KeyResult（绑定 Objective）', async () => {
      if (!objId) return; // 依赖前一个 it 的 objId
      const { status, body } = await post('/key-results', {
        title: '[TEST] KR: 完成集成测试覆盖',
        objective_id: objId,
        status: 'pending',
        target_value: 100,
        unit: '%',
      });

      expect(status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.item.objective_id).toBe(objId);
      expect(parseFloat(body.item.target_value)).toBe(100);
      krId = body.item.id;
    });

    it('创建 okr_project（绑定 KR）', async () => {
      if (!krId) return;
      const { status, body } = await post('/projects', {
        title: '[TEST] Project: 补充 P0 集成测试',
        kr_id: krId,
        status: 'planning',
      });

      expect(status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.item.kr_id).toBe(krId);
      projectId = body.item.id;
    });

    it('创建 okr_scope（绑定 okr_project）', async () => {
      if (!projectId) return;
      const { status, body } = await post('/scopes', {
        title: '[TEST] Scope: Brain 测试',
        project_id: projectId,
        status: 'planning',
      });

      expect(status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.item.project_id).toBe(projectId);
      scopeId = body.item.id;
    });

    it('创建 okr_initiative（绑定 Scope）', async () => {
      if (!scopeId) return;
      const { status, body } = await post('/initiatives', {
        title: '[TEST] Initiative: 写 tick-full-loop 测试',
        scope_id: scopeId,
        status: 'planning',
      });

      expect(status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.item.scope_id).toBe(scopeId);
      initiativeId = body.item.id;
    });

    it('GET 各层级单条记录', async () => {
      if (!objId || !krId || !projectId) return;
      const { status: s1, body: b1 } = await get(`/objectives/${objId}`);
      expect(s1).toBe(200);
      expect(b1.item.id).toBe(objId);

      const { status: s2, body: b2 } = await get(`/key-results/${krId}`);
      expect(s2).toBe(200);
      expect(b2.item.id).toBe(krId);

      const { status: s3, body: b3 } = await get(`/projects/${projectId}`);
      expect(s3).toBe(200);
      expect(b3.item.id).toBe(projectId);
    });
  });

  // ─── 2. 树状层级查询 ────────────────────────────────────────────────────────

  describe('okr-decomposition: 树状查询', () => {
    it('/okr/tree 返回含测试 Vision 的完整 Objective+KR 层级', async () => {
      if (!objId || !krId) return;
      const { status, body } = await get(`/tree?vision_id=${visionId}`);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.tree)).toBe(true);
      expect(body.tree.length).toBe(1);

      const vision = body.tree[0];
      expect(vision.id).toBe(visionId);
      expect(Array.isArray(vision.objectives)).toBe(true);

      const obj = vision.objectives.find(o => o.id === objId);
      expect(obj).toBeDefined();
      expect(Array.isArray(obj.key_results)).toBe(true);
      expect(obj.key_results.some(kr => kr.id === krId)).toBe(true);
    });
  });

  // ─── 3. KR 进度重算 ─────────────────────────────────────────────────────────

  describe('okr-decomposition: recalculate-progress', () => {
    it('无 task 时 current_value = 0', async () => {
      if (!krId) return;
      const { status, body } = await post(`/key-results/${krId}/recalculate-progress`, {});

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.total_tasks).toBe(0);
      expect(body.current_value).toBe(0);
    });

    it('1/2 task 完成时 current_value = 50（target=100）', async () => {
      if (!krId || !initiativeId) return;
      // 直接 DB 插入 2 个 task，1 个 completed
      const t1Res = await testPool.query(
        `INSERT INTO tasks (title, status, priority, task_type, okr_initiative_id)
         VALUES ($1, 'completed', 'P1', 'dev', $2) RETURNING id`,
        ['[TEST] completed task', initiativeId]
      );
      const t2Res = await testPool.query(
        `INSERT INTO tasks (title, status, priority, task_type, okr_initiative_id)
         VALUES ($1, 'queued', 'P1', 'dev', $2) RETURNING id`,
        ['[TEST] queued task', initiativeId]
      );
      const t1Id = t1Res.rows[0].id;
      const t2Id = t2Res.rows[0].id;

      try {
        const { status, body } = await post(`/key-results/${krId}/recalculate-progress`, {});

        expect(status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.completed_tasks).toBe(1);
        expect(body.total_tasks).toBe(2);
        expect(body.current_value).toBe(50);

        // 验证 DB 中 current_value 确实更新
        const dbRes = await testPool.query(
          'SELECT current_value FROM key_results WHERE id = $1',
          [krId]
        );
        expect(parseFloat(dbRes.rows[0].current_value)).toBe(50);
      } finally {
        await testPool.query('DELETE FROM tasks WHERE id = ANY($1)', [[t1Id, t2Id]]);
      }
    });
  });

  // ─── 4. FK 级联删除 ─────────────────────────────────────────────────────────

  describe('okr-decomposition: cascade DELETE', () => {
    it('硬删除 Objective 后 KR/Project/Scope/Initiative 全部级联删除', async () => {
      // 确认所有子对象存在
      const krBefore = await testPool.query('SELECT id FROM key_results WHERE id = $1', [krId]);
      expect(krBefore.rows.length).toBe(1);

      // 硬删除 Objective 触发 ON DELETE CASCADE
      await testPool.query('DELETE FROM objectives WHERE id = $1', [objId]);

      // 验证级联：KR 应不存在
      const krAfter = await testPool.query('SELECT id FROM key_results WHERE id = $1', [krId]);
      expect(krAfter.rows.length).toBe(0);

      // 验证级联：okr_projects 应不存在
      const projAfter = await testPool.query('SELECT id FROM okr_projects WHERE id = $1', [projectId]);
      expect(projAfter.rows.length).toBe(0);

      // 验证级联：okr_scopes 应不存在
      const scopeAfter = await testPool.query('SELECT id FROM okr_scopes WHERE id = $1', [scopeId]);
      expect(scopeAfter.rows.length).toBe(0);

      // 验证级联：okr_initiatives 应不存在
      const initAfter = await testPool.query('SELECT id FROM okr_initiatives WHERE id = $1', [initiativeId]);
      expect(initAfter.rows.length).toBe(0);

      // 标记已删除，防止 afterAll 重复删除
      objId = null; krId = null; projectId = null; scopeId = null; initiativeId = null;
    });
  });
});
