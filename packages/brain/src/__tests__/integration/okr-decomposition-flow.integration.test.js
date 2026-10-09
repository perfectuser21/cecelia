/**
 * Integration Test: OKR 拆解端到端流程
 *
 * 棒4（决策 ee4842a6/3feeae3e）：okr_scopes / okr_initiatives 层退役——写操作一律 410
 * layer_retired，只留只读历史。/api/brain/okr/projects 改指真身表 projects（与
 * /api/brain/projects 复用同一套 routes/task-projects.js handler，读同一行）。
 *
 * 测试新链路：
 *   1. Objective → KeyResult → Project（真身表 projects）创建链
 *   2. POST /scopes、POST /initiatives 一律 410 layer_retired
 *   3. 树状层级查询 /api/brain/okr/tree（project 层来自 projects 表）
 *   4. KR 进度重算 recalculate-progress（无 task 时 current_value=0；棒5起改读真身表 projects，
 *      真正的"任务完成→current_value/progress"聚合场景见 kr-progress-project-aggregation.integration.test.js）
 *   5. FK 级联行为：objective/KR 级联删除；projects.kr_id 是 ON DELETE SET NULL（非级联删除整行）
 *
 * 依赖：PostgreSQL cecelia_test 数据库可访问；路由通过进程内 Express 挂载，禁止误打生产 Brain。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import okrHierarchyRoutes from '../../routes/okr-hierarchy.js';

const app = express();
app.use(express.json());
app.use('/api/brain/okr', okrHierarchyRoutes);

// 直连 DB 用于 Vision 创建（顶层节点）和 afterAll 清理
const testPool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });

async function post(path, body) {
  const res = await request(app).post(`/api/brain/okr${path}`).send(body);
  return { status: res.status, body: res.body };
}

async function get(path) {
  const res = await request(app).get(`/api/brain/okr${path}`);
  return { status: res.status, body: res.body };
}

describe('OKR 拆解端到端集成测试', () => {
  let visionId, objId, krId, projectId;

  beforeAll(async () => {
    // Vision 通过 DB 直接创建（隔离测试数据）
    const visionRes = await testPool.query(
      `INSERT INTO visions (title, status) VALUES ($1, 'active') RETURNING id`,
      [`[TEST] Vision-${Date.now()}`]
    );
    visionId = visionRes.rows[0].id;
  });

  afterAll(async () => {
    // projects.kr_id 是 ON DELETE SET NULL，不会随 KR 删除而消失，需显式清理
    if (projectId) {
      await testPool.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
    }
    // 删除 Vision（ON DELETE CASCADE 自动清理 Objective/KR）
    if (visionId) {
      await testPool.query(`DELETE FROM visions WHERE id = $1`, [visionId]);
    }
    await testPool.end();
  });

  // ─── 1. 层级创建链（Project 层已改指真身表） ────────────────────────────────

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

    it('创建 Project（绑定 KR）——写入真身表 projects，与 /api/brain/projects 同源', async () => {
      if (!krId) return;
      const { status, body } = await post('/projects', {
        name: '[TEST] Project: 补充 P0 集成测试',
        kr_id: krId,
        status: 'planning',
      });

      expect(status).toBe(201);
      expect(body.kr_id).toBe(krId);
      expect(body.name).toBe('[TEST] Project: 补充 P0 集成测试');
      projectId = body.id;
    });

    it('POST /scopes 一律 410 layer_retired（决策 ee4842a6，scope 层已退役）', async () => {
      const { status, body } = await post('/scopes', {
        title: '[TEST] Scope: Brain 测试',
        project_id: projectId,
      });

      expect(status).toBe(410);
      expect(body.error).toBe('layer_retired');
      expect(body.decision).toBe('ee4842a6');
    });

    it('POST /initiatives 一律 410 layer_retired（决策 ee4842a6，initiative 层已退役）', async () => {
      const { status, body } = await post('/initiatives', {
        title: '[TEST] Initiative: 写 tick-full-loop 测试',
        scope_id: '00000000-0000-4000-8000-000000000000',
      });

      expect(status).toBe(410);
      expect(body.error).toBe('layer_retired');
      expect(body.decision).toBe('ee4842a6');
    });

    it('GET 各层级单条记录（/projects/:id 与 /api/brain/projects/:id 读到同一行）', async () => {
      if (!objId || !krId || !projectId) return;
      const { status: s1, body: b1 } = await get(`/objectives/${objId}`);
      expect(s1).toBe(200);
      expect(b1.item.id).toBe(objId);

      const { status: s2, body: b2 } = await get(`/key-results/${krId}`);
      expect(s2).toBe(200);
      expect(b2.item.id).toBe(krId);

      const { status: s3, body: b3 } = await get(`/projects/${projectId}`);
      expect(s3).toBe(200);
      expect(b3.id).toBe(projectId);
      expect(b3.name).toBe('[TEST] Project: 补充 P0 集成测试');
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

    it('/okr/tree KR 层包含 projects 数组（project 层来自真身表 projects，scopes 恒为空数组）', async () => {
      if (!objId || !krId) return;
      const { status, body } = await get(`/tree?vision_id=${visionId}`);

      expect(status).toBe(200);
      expect(body.success).toBe(true);

      const vision = body.tree[0];
      const obj = vision.objectives.find(o => o.id === objId);
      expect(obj).toBeDefined();

      const kr = obj.key_results.find(k => k.id === krId);
      expect(kr).toBeDefined();
      // 全树扩展：KR 必须包含 projects 数组（即使为空也应是数组）
      expect(Array.isArray(kr.projects)).toBe(true);
      // 已创建的 project（真身表 projects）应出现在 KR.projects 中
      if (projectId) {
        expect(kr.projects.some(p => p.id === projectId)).toBe(true);
        const proj = kr.projects.find(p => p.id === projectId);
        // project 必须包含 scopes 数组（scope 层已退役，新建链路下恒为空）
        expect(Array.isArray(proj.scopes)).toBe(true);
        expect(proj.scopes).toEqual([]);
      }
    });
  });

  // ─── 3. KR 进度重算（project 聚合改写留给棒5，本测试只保底"无 task 时为 0"） ──────

  describe('okr-decomposition: recalculate-progress', () => {
    it('无 task 时 current_value = 0', async () => {
      if (!krId) return;
      const { status, body } = await post(`/key-results/${krId}/recalculate-progress`, {});

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.total_tasks).toBe(0);
      expect(body.current_value).toBe(0);
    });
  });

  // ─── 4. FK 级联行为（objective/KR 级联；projects.kr_id 是 SET NULL） ─────────────

  describe('okr-decomposition: objective/KR 级联删除，project 独立存续', () => {
    it('硬删除 Objective 后 KR 级联删除；project 不删，kr_id 被置空', async () => {
      // 确认 KR 存在
      const krBefore = await testPool.query('SELECT id FROM key_results WHERE id = $1', [krId]);
      expect(krBefore.rows.length).toBe(1);

      // 硬删除 Objective 触发 ON DELETE CASCADE（objectives → key_results）
      await testPool.query('DELETE FROM objectives WHERE id = $1', [objId]);

      // 验证级联：KR 应不存在
      const krAfter = await testPool.query('SELECT id FROM key_results WHERE id = $1', [krId]);
      expect(krAfter.rows.length).toBe(0);

      // projects.kr_id 是 ON DELETE SET NULL：project 行本身不消失，只是 kr_id 变 NULL
      const projAfter = await testPool.query('SELECT id, kr_id FROM projects WHERE id = $1', [projectId]);
      expect(projAfter.rows.length).toBe(1);
      expect(projAfter.rows[0].kr_id).toBeNull();

      // 标记已删除，防止 afterAll 重复删除
      objId = null; krId = null;
    });
  });
});
