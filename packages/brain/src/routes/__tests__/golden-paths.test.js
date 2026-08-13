import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn();
const mockCreateTask = vi.fn();
vi.mock('../../db.js', () => ({
  default: {
    query: mockQuery,
    connect: mockConnect,
  },
}));
vi.mock('../../actions.js', () => ({ createTask: mockCreateTask }));

// 默认 1 slot（capacity gate: batchLimit = 1）
vi.mock('../../fleet-resource-cache.js', () => ({ getTotalEffectiveSlots: vi.fn(() => 1) }));

async function makeApp() {
  const { default: router } = await import('../golden-paths.js');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain', router);
  return app;
}
const req = async () => (await import('supertest')).default;

const GP_ROW = { id: 'gp-1', title: '朋友圈GP', one_liner: '一句话', status: 'candidate', source: 'strategist', auto_release: false, proposal_doc: null };

describe('golden-paths routes（GP 蓝图级实体，区别于既有 golden_path FR 台账）', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockRelease.mockReset();
    mockConnect.mockReset();
    mockCreateTask.mockReset();
    mockConnect.mockResolvedValue({
      query: mockQuery,
      release: mockRelease,
    });
  });

  describe('GET /golden-paths', () => {
    it('无参返回全量列表', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [GP_ROW] });
      const res = await (await req())(await makeApp()).get('/api/brain/golden-paths');
      expect(res.status).toBe(200);
      expect(res.body.golden_paths).toHaveLength(1);
      expect(mockQuery.mock.calls[0][0]).toMatch(/FROM golden_paths/);
    });

    it('?status= 过滤且参数化', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await (await req())(await makeApp()).get('/api/brain/golden-paths?status=candidate');
      expect(res.status).toBe(200);
      expect(mockQuery.mock.calls[0][0]).toMatch(/WHERE status = \$1/);
      expect(mockQuery.mock.calls[0][1]).toEqual(['candidate']);
    });

    it('非法 status 返回 400', async () => {
      const res = await (await req())(await makeApp()).get('/api/brain/golden-paths?status=bogus');
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('POST /golden-paths', () => {
    it('建 candidate 返回 201，默认 source=strategist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [GP_ROW] });
      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths')
        .send({ title: '朋友圈GP', one_liner: '一句话' });
      expect(res.status).toBe(201);
      expect(res.body.golden_path.status).toBe('candidate');
      expect(mockQuery.mock.calls[0][0]).toMatch(/INSERT INTO golden_paths/);
    });

    it('持久化 Golden Path 的四形式、Map scope 与 repo 胶水字段', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ ...GP_ROW, change_kind: 'bugfix' }] });
      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths')
        .send({
          title: '朋友圈GP',
          one_liner: '一句话',
          change_kind: 'bugfix',
          map_scope: ['capability_social_feed'],
          base_repo: 'cecelia',
          target_environment: 'local_api',
        });

      expect(res.status).toBe(201);
      expect(mockQuery.mock.calls[0][0]).toMatch(/change_kind/);
      expect(mockQuery.mock.calls[0][0]).toMatch(/map_scope/);
      expect(mockQuery.mock.calls[0][1]).toEqual(expect.arrayContaining([
        'bugfix',
        JSON.stringify(['capability_social_feed']),
        'cecelia',
        'local_api',
      ]));
    });

    it('缺 title/one_liner 返回 400', async () => {
      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths').send({ title: '只有标题' });
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('非法 source 返回 400', async () => {
      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths')
        .send({ title: 't', one_liner: 'o', source: 'hacker' });
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /golden-paths/:id 状态机', () => {
    it('合法流转 candidate→proposed 返回 200', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'candidate' }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ ...GP_ROW, status: 'proposed' }] });
      const res = await (await req())(await makeApp())
        .patch('/api/brain/golden-paths/gp-1').send({ status: 'proposed' });
      expect(res.status).toBe(200);
      expect(res.body.golden_path.status).toBe('proposed');
    });

    it('非法流转 candidate→delivered 返回 409 INVALID_TRANSITION 且回传 allowed', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'candidate' }] });
      const res = await (await req())(await makeApp())
        .patch('/api/brain/golden-paths/gp-1').send({ status: 'delivered' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INVALID_TRANSITION');
      expect(res.body.allowed).toEqual(['proposed', 'rejected', 'superseded', 'blocked_gate']);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('superseded 是终态，任何流转 409', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'superseded' }] });
      const res = await (await req())(await makeApp())
        .patch('/api/brain/golden-paths/gp-1').send({ status: 'candidate' });
      expect(res.status).toBe(409);
      expect(res.body.allowed).toEqual([]);
    });

    it('不存在返回 404', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await (await req())(await makeApp())
        .patch('/api/brain/golden-paths/nope').send({ status: 'proposed' });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('GP_NOT_FOUND');
    });

    it('流转到 approved 自动注入 approved_at 与默认 review_after(+14d)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'converged' }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ ...GP_ROW, status: 'approved' }] });
      const res = await (await req())(await makeApp())
        .patch('/api/brain/golden-paths/gp-1').send({ status: 'approved' });
      expect(res.status).toBe(200);
      const updateSql = mockQuery.mock.calls[1][0];
      expect(updateSql).toMatch(/approved_at = now\(\)/);
      expect(updateSql).toMatch(/review_after = now\(\) \+ interval '14 days'/);
    });

    it('非状态字段更新（status_reason）不需要 status', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'candidate' }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ ...GP_ROW, status_reason: 'x' }] });
      const res = await (await req())(await makeApp())
        .patch('/api/brain/golden-paths/gp-1').send({ status_reason: 'x' });
      expect(res.status).toBe(200);
    });

    it('允许为启动补齐显式 change_kind 和 map_scope', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'candidate' }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ ...GP_ROW, change_kind: 'capability_change' }] });
      const res = await (await req())(await makeApp())
        .patch('/api/brain/golden-paths/gp-1')
        .send({ change_kind: 'capability_change', map_scope: ['capability_social_feed'] });

      expect(res.status).toBe(200);
      expect(mockQuery.mock.calls[1][0]).toMatch(/change_kind = /);
      expect(mockQuery.mock.calls[1][0]).toMatch(/map_scope = /);
      expect(mockQuery.mock.calls[1][1]).toContain(JSON.stringify(['capability_social_feed']));
    });

    it('拒绝第五种 change_kind 和空 Map scope', async () => {
      mockQuery.mockResolvedValue({ rows: [{ status: 'candidate' }] });
      const app = await makeApp();

      const invalidKind = await (await req())(app)
        .patch('/api/brain/golden-paths/gp-1')
        .send({ change_kind: 'tiny_fix' });
      const emptyScope = await (await req())(app)
        .patch('/api/brain/golden-paths/gp-1')
        .send({ map_scope: [] });

      expect(invalidKind.status).toBe(400);
      expect(emptyScope.status).toBe(400);
    });

    it('空 body 返回 400', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'candidate' }] });
      const res = await (await req())(await makeApp())
        .patch('/api/brain/golden-paths/gp-1').send({});
      expect(res.status).toBe(400);
    });

    it('并发修改：UPDATE 时状态已被别处改走 → 409 CONCURRENT_MODIFICATION', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'approved' }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await (await req())(await makeApp())
        .patch('/api/brain/golden-paths/gp-1').send({ status: 'in_dev' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CONCURRENT_MODIFICATION');
      const updateSql = mockQuery.mock.calls[1][0];
      expect(updateSql).toMatch(/AND status = \$/);
    });
  });

  // ── T7 拍板端点 ────────────────────────────────────────────────────────────

  describe('POST /golden-paths/:id/select — 圈选端点（DoD F3/F4）', () => {
    it('F3: candidate→proposed 且建 golden_path_proposal 任务', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ ...GP_ROW, status: 'candidate' }] }); // SELECT gp
      mockQuery.mockResolvedValueOnce({ rows: [{ cnt: 0 }] });                          // COUNT in-flight
      mockQuery.mockResolvedValueOnce({}); // BEGIN
      mockCreateTask.mockResolvedValueOnce({ success: true, task: { id: 'task-abc' } });
      mockQuery.mockResolvedValueOnce({ rows: [{ ...GP_ROW, status: 'proposed', proposal_task_id: 'task-abc' }] }); // UPDATE gp
      mockQuery.mockResolvedValueOnce({}); // COMMIT
      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths/gp-1/select').send({});
      expect(res.status).toBe(200);
      expect(res.body.golden_path.status).toBe('proposed');
      expect(res.body.proposal_task_id).toBe('task-abc');
      expect(mockCreateTask).toHaveBeenCalledWith(expect.objectContaining({
        db: expect.any(Object),
        source: 'discovery',
        source_id: 'golden-path-proposal:gp-1',
        task_type: 'golden_path_proposal',
        mutation_intent: 'none',
      }));
      expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO tasks/i.test(sql))).toBe(false);
      expect(mockQuery.mock.calls.at(-1)[0]).toBe('COMMIT');
    });

    it('F4: 容量已满（in_flight >= batchLimit=1）→ 409 CAPACITY_EXCEEDED', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ ...GP_ROW, status: 'candidate' }] }); // SELECT gp
      mockQuery.mockResolvedValueOnce({ rows: [{ cnt: 1 }] });                          // COUNT in-flight = 1 (=batchLimit)
      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths/gp-1/select').send({});
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CAPACITY_EXCEEDED');
      expect(res.body.batch_limit).toBe(1);
    });

    it('非 candidate 状态 → 409 INVALID_TRANSITION', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ ...GP_ROW, status: 'proposed' }] });
      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths/gp-1/select').send({});
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INVALID_TRANSITION');
    });

    it('不存在 id → 404', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths/nope/select').send({});
      expect(res.status).toBe(404);
    });
  });

  describe('Golden Path 7 项合同版本端点', () => {
    const contract = {
      fr_summary: { statements: ['用户提交后看到成功'] },
      lifelines_and_nfr: {
        items: [{
          statement: '只写一次',
          class: 'lifeline',
          verification: 'SELECT COUNT(*) = 1',
          rationale: '重复写入即失败',
        }],
      },
      yield_order: {
        order: ['安全/资金正确性', '数据一致性', '功能完整', '性能', '体验顺滑'],
        override_reason: null,
      },
      external_commitment_changes: { changes: [], none: true },
      release_and_blast_radius: {
        stages: ['internal'],
        blast_radius: '单一 Journey',
        rollback_triggers: ['错误率 > 1%'],
      },
      success_and_close: {
        metrics: ['成功率 >= 99%'],
        observation_window: '24h',
        close_conditions: ['24h 达标'],
        shutdown_conditions: ['错误率连续超阈值'],
      },
      budget_guard: {
        total_cost_cap_usd: 10,
        atom_cost_cap_usd: 2,
        atom_runtime_sec: 1800,
        atom_parallelism: 1,
      },
    };

    it('GET 返回指定 GP 的版本，最新版本在前', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 'contract-2', golden_path_id: 'gp-1', version: 2 },
          { id: 'contract-1', golden_path_id: 'gp-1', version: 1 },
        ],
      });

      const res = await (await req())(await makeApp())
        .get('/api/brain/golden-paths/gp-1/contracts');

      expect(res.status).toBe(200);
      expect(res.body.contract_versions.map((row) => row.version)).toEqual([2, 1]);
      expect(mockQuery.mock.calls[0][0]).toMatch(/ORDER BY version DESC/);
      expect(mockQuery.mock.calls[0][1]).toEqual(['gp-1']);
    });

    it('POST raw contract 创建 pending 版本并返回 201', async () => {
      const pending = {
        id: 'contract-1',
        golden_path_id: 'gp-1',
        version: 1,
        content_hash: 'a'.repeat(64),
        status: 'pending_signature',
        signing_action_id: null,
      };
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ ...GP_ROW, journey_id: 'journey-1' }] })
        .mockResolvedValueOnce({ rows: [] }) // latest
        .mockResolvedValueOnce({ rows: [] }) // active tasks
        .mockResolvedValueOnce({ rows: [] }) // invalidate/supersede
        .mockResolvedValueOnce({ rows: [pending] }) // insert version
        .mockResolvedValueOnce({ rows: [{ id: 'action-1' }] })
        .mockResolvedValueOnce({
          rows: [{ ...pending, signing_action_id: 'action-1' }],
        })
        .mockResolvedValueOnce({}); // COMMIT

      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths/gp-1/contracts')
        .send(contract);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        success: true,
        pending_action_id: 'action-1',
        idempotent: false,
        contract_version: { id: 'contract-1', version: 1 },
      });
      expect(mockQuery.mock.calls.at(-1)[0]).toBe('COMMIT');
      expect(mockRelease).toHaveBeenCalledOnce();
    });

    it('POST invalid contract 返回 400 GP_CONTRACT_INVALID 并回滚', async () => {
      mockQuery.mockResolvedValueOnce({}).mockResolvedValueOnce({});

      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths/gp-1/contracts')
        .send({ fr_summary: {} });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('GP_CONTRACT_INVALID');
      expect(mockQuery.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
      expect(mockRelease).toHaveBeenCalledOnce();
    });

    it('POST missing GP 返回 404 GP_NOT_FOUND', async () => {
      mockQuery
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({});

      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths/missing/contracts')
        .send({ contract });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('GP_NOT_FOUND');
      expect(mockQuery.mock.calls.at(-1)[0]).toBe('ROLLBACK');
    });

    it('POST running-task conflict 返回 409 GP_CONTRACT_IN_FLIGHT', async () => {
      const existing = {
        id: 'contract-1',
        golden_path_id: 'gp-1',
        version: 1,
        content_hash: 'b'.repeat(64),
        status: 'signed',
      };
      mockQuery
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ ...GP_ROW, journey_id: 'journey-1' }] })
        .mockResolvedValueOnce({ rows: [existing] })
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-running',
            status: 'in_progress',
            payload: { golden_path_id: 'gp-1' },
          }],
        })
        .mockResolvedValueOnce({});

      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths/gp-1/contracts')
        .send({ contract });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('GP_CONTRACT_IN_FLIGHT');
      expect(mockQuery.mock.calls.at(-1)[0]).toBe('ROLLBACK');
    });
  });

  describe('POST /golden-paths/:id/approve — 已签合同兼容入口', () => {
    it('最新合同已签字时只返回已绑定任务，不重复创建', async () => {
      const signed = {
        id: 'contract-1',
        golden_path_id: 'gp-1',
        version: 1,
        content_hash: 'a'.repeat(64),
        status: 'signed',
      };
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ ...GP_ROW, status: 'approved' }] })
        .mockResolvedValueOnce({ rows: [signed] })
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-h1',
            task_type: 'harness_initiative',
            payload: { gp_contract_id: signed.id },
          }],
        })
        .mockResolvedValueOnce({}); // COMMIT

      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths/gp-1/approve')
        .send({ expected_version: 1 });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        harness_task_id: 'task-h1',
        contract_version: { id: 'contract-1', version: 1 },
        idempotent: true,
      });
      expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO/i.test(sql)))
        .toHaveLength(0);
      expect(mockQuery.mock.calls.at(-1)[0]).toBe('COMMIT');
    });

    it('最新合同未签字时返回 409 GP_CONTRACT_SIGNATURE_REQUIRED', async () => {
      mockQuery
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ ...GP_ROW, status: 'converged' }] })
        .mockResolvedValueOnce({
          rows: [{
            id: 'contract-1',
            version: 1,
            status: 'pending_signature',
          }],
        })
        .mockResolvedValueOnce({});

      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths/gp-1/approve')
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('GP_CONTRACT_SIGNATURE_REQUIRED');
      expect(mockQuery.mock.calls.at(-1)[0]).toBe('ROLLBACK');
    });

    it('指定旧版本时返回 409 GP_CONTRACT_STALE', async () => {
      mockQuery
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ ...GP_ROW, status: 'approved' }] })
        .mockResolvedValueOnce({
          rows: [{ id: 'contract-2', version: 2, status: 'signed' }],
        })
        .mockResolvedValueOnce({});

      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths/gp-1/approve')
        .send({ expected_version: 1 });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('GP_CONTRACT_STALE');
    });

    it('不存在 id → 404 GP_NOT_FOUND', async () => {
      mockQuery
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({});

      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths/nope/approve')
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('GP_NOT_FOUND');
    });
  });

  describe('POST /golden-paths/:id/veto — 否决端点', () => {
    it('报备中（proposed + auto_release）→ converged 回批审', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ ...GP_ROW, status: 'proposed', auto_release: true }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ ...GP_ROW, status: 'converged', status_reason: '用户否决' }] });
      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths/gp-1/veto').send({ status_reason: '用户否决' });
      expect(res.status).toBe(200);
      expect(res.body.golden_path.status).toBe('converged');
    });

    it('批审中（converged）→ rejected + status_reason', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ ...GP_ROW, status: 'converged', auto_release: false }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ ...GP_ROW, status: 'rejected', status_reason: '不够好' }] });
      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths/gp-1/veto').send({ status_reason: '不够好' });
      expect(res.status).toBe(200);
      expect(res.body.golden_path.status).toBe('rejected');
    });

    it('普通 proposed（非 auto_release）→ 409 INVALID_TRANSITION', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ ...GP_ROW, status: 'proposed', auto_release: false }] });
      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths/gp-1/veto').send({});
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INVALID_TRANSITION');
    });

    it('approved 状态 → 409 INVALID_TRANSITION（不能否决已批准）', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ ...GP_ROW, status: 'approved' }] });
      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths/gp-1/veto').send({});
      expect(res.status).toBe(409);
    });

    it('不存在 id → 404', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths/nope/veto').send({});
      expect(res.status).toBe(404);
    });
  });
});
