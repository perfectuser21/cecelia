// 回归：10-09 22:15/22:45 获客运行拒跑——GET /runs/{id}/definition 带回整个 release（约669KB），跨境 curl 超时。
// 默认回读只带本次运行要跑的 Workflow/Activity/Step 骨架与校验 hash；完整内容 ?view=full 或 GET /releases/:id 按需取。
import { describe, expect, it, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const lib = vi.hoisted(() => ({ getRunDefinitionBinding: vi.fn(), bindRunDefinition: vi.fn() }));
vi.mock('../../lib/run-definition-binding.js', () => lib);
vi.mock('../../db.js', () => ({ default: {} }));

const { createRunDefinitionsRouter } = await import('../run-definitions.js');
const { compactRunDefinition, RUN_DEFINITION_COMPACT_LIMIT_BYTES } = await import('../../lib/run-definition-view.js');

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hex = (c) => c.repeat(64);
const pad = (n) => 'x'.repeat(n);

// 形状按生产 release 4ce8923b 实测：15 个 Activity（每个 10~26KB）、4 个 Workflow（合同 8~24KB）、
// ci_evidence 约119KB、assertion_plans 约79KB；单次运行只绑其中 1 个 Workflow 的 4 个 Activity。
function productionShapedDefinition() {
  const activities = Array.from({ length: 15 }, (_, i) => ({
    id: uuid(100 + i), activity_id: uuid(200 + i), payload_sha256: hex('a'), contract_sha256: hex('b'),
    source_repo: 'perfectuser21/zenithjoy-workspace', source_path: `contracts/a${i}.json`, source_commit: 'c'.repeat(40), created_at: '2026-10-09T00:00:00Z',
    payload: {
      activity_id: uuid(200 + i), definition_key: `cap.act${i}`, resources: [{ k: pad(100) }],
      contract: { blob: pad(5000), optional: false }, implementation_bindings: [{ blob: pad(5000) }], verification: { blob: pad(3500) },
      steps: Array.from({ length: 7 }, (_, s) => ({
        step_id: uuid(1000 + i * 10 + s), locator: { step_key: `s${s}`, activity_id: uuid(200 + i) },
        contract: { key: `s${s}`, name: `步骤${s}`, order: s + 1, optional: s === 6, dod: { blob: pad(500) }, implementation: { ref: pad(200) } },
        registration: { id: uuid(1000 + i * 10 + s), key: `cap.act${i}.s${s}`, step_order: s + 1, mode: 'checkpoint', source_sha256: hex('d'), readback: { blob: pad(200) } },
      })),
    },
  }));
  const workflows = Array.from({ length: 4 }, (_, w) => ({
    id: uuid(300 + w), workflow_id: uuid(400 + w), payload_sha256: hex('e'), contract_sha256: hex('f'),
    source_repo: 'perfectuser21/zenithjoy-workspace', source_path: `wf${w}.json`, source_commit: 'c'.repeat(40), created_at: '2026-10-09T00:00:00Z',
    payload: {
      workflow_id: uuid(400 + w), key: `wf_${w}`, name: `流程${w}`, form: 'scheduled', channel: 'douyin', capability_id: uuid(9),
      contract: { blob: pad(24000) },
      activities: [0, 1, 2, 3].map((k) => ({ slot_key: `slot${k}`, source_ref: null, sequence_no: k + 1, reference_id: uuid(500 + w * 10 + k), activity_id: uuid(200 + w * 3 + k), activity_version_id: uuid(100 + w * 3 + k) })),
    },
  }));
  const release = {
    id: uuid(1), release_key: 'rk', manifest_sha256: hex('1'), request_sha256: hex('2'), environment: 'production', target: 'xian-m4', actor: 'ci', created_at: '2026-10-09T00:00:00Z',
    payload: { schema_version: 1, components: [{ blob: pad(2700) }], activities, workflows, ci_evidence: [{ blob: pad(119000) }], assertion_plans: [{ blob: pad(79000) }], verification: {}, allowed_enabler_calls: [] },
  };
  const workflow = workflows[1];
  const ids = new Set(workflow.payload.activities.map((a) => a.activity_version_id));
  const bound = activities.filter((a) => ids.has(a.id));
  const expected_path = workflow.payload.activities.flatMap((ref) => {
    const act = bound.find((a) => a.id === ref.activity_version_id);
    const base = { reference_id: ref.reference_id, activity_id: ref.activity_id, activity_definition_version_id: ref.activity_version_id };
    return [{ ...base, required: true }, ...act.payload.steps.map((s) => ({ ...base, step_id: s.step_id, required: s.contract.optional !== true }))];
  });
  const input = { release_id: release.id, workflow_id: workflow.workflow_id, workflow_definition_version_id: workflow.id, snapshot_sha256: workflow.payload_sha256, expected_path, source_kind: 'external', attempt_key: 'a1', actor: 'runtime:x' };
  const binding = { id: uuid(2), run_id: 'wf__a1', ...input, payload_sha256: hex('9'), payload: input, created_at: '2026-10-09T00:00:00Z' };
  return { binding, release, workflow, activities: bound };
}

function appWith(definition) {
  lib.getRunDefinitionBinding.mockResolvedValue(definition);
  const app = express(); app.use(express.json()); app.use('/runs', createRunDefinitionsRouter({ pool: {} }));
  return app;
}
const bytes = (body) => Buffer.byteLength(JSON.stringify(body));

beforeEach(() => { lib.getRunDefinitionBinding.mockReset(); });

describe('GET /runs/:run_id/definition 体积上限', () => {
  it('生产形状的完整定义 >500KB（复现 10-09 拒跑的输入规模）', () => {
    expect(bytes(productionShapedDefinition())).toBeGreaterThan(500 * 1024);
  });

  it('默认回读 < 64KB 且 2 秒内返回，binding 原样、workflow.id 与路径身份/校验 hash 全在', async () => {
    const full = productionShapedDefinition();
    const started = Date.now();
    const res = await request(appWith(full)).get('/runs/wf__a1/definition');
    const elapsed = Date.now() - started;
    expect(res.status).toBe(200);
    expect(RUN_DEFINITION_COMPACT_LIMIT_BYTES).toBe(64 * 1024);
    expect(Buffer.byteLength(res.text)).toBeLessThan(64 * 1024);
    expect(elapsed).toBeLessThan(2000);
    expect(res.body.definition_view).toBe('compact');
    expect(res.body.binding).toEqual(full.binding);
    expect(res.body.workflow).toMatchObject({ id: full.workflow.id, workflow_id: full.workflow.workflow_id, payload_sha256: full.workflow.payload_sha256, contract_sha256: full.workflow.contract_sha256 });
    expect(res.body.workflow.payload.activities).toEqual(full.workflow.payload.activities);
    expect(res.body.workflow.payload.contract).toBeUndefined();
    expect(res.body.release).toMatchObject({ id: full.release.id, manifest_sha256: full.release.manifest_sha256, environment: 'production', target: 'xian-m4' });
    expect(res.body.release.payload).toBeUndefined();
    expect(res.body.release.full_href).toBe(`/api/brain/releases/${full.release.id}`);
    // 预期路径里每个 Activity/Step 身份都能在紧凑定义里找到，并带校验 hash
    for (const entry of full.binding.expected_path) {
      const act = res.body.activities.find((a) => a.id === entry.activity_definition_version_id);
      expect(act).toMatchObject({ activity_id: entry.activity_id, payload_sha256: hex('a'), contract_sha256: hex('b') });
      if (entry.step_id) {
        const step = act.payload.steps.find((s) => s.step_id === entry.step_id);
        expect(step.locator.activity_id).toBe(entry.activity_id);
        expect(step.registration.source_sha256).toBe(hex('d'));
        expect(typeof step.contract.optional).toBe('boolean');
        expect(step.contract.dod).toBeUndefined();
      }
    }
    expect(res.body.activities).toHaveLength(full.activities.length);
  });

  it('?view=full 原样返回旧形状（按需取完整定义）', async () => {
    const full = productionShapedDefinition();
    const res = await request(appWith(full)).get('/runs/wf__a1/definition?view=full');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(JSON.parse(JSON.stringify(full)));
  });

  it('未知运行仍 404', async () => {
    const res = await request(appWith(null)).get('/runs/nope/definition');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('RUN_DEFINITION_UNKNOWN');
  });

  it('紧凑化遇到异常形状不抛错（fail-safe 回退完整定义）', () => {
    const weird = { binding: { id: 'b' }, release: null, workflow: { id: 'w', payload: null }, activities: [null, { id: 'a', payload: { steps: 'oops' } }] };
    expect(() => compactRunDefinition(weird)).not.toThrow();
    expect(compactRunDefinition(weird).binding).toEqual({ id: 'b' });
  });
});
