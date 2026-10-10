// 运行定义紧凑视图单测（任务 e961f9a9）：执行端只读 binding，紧凑化必须原样保留 binding，去掉大字段，异常形状 fail-safe。
import { describe, expect, it } from 'vitest';
import { compactRunDefinition, RUN_DEFINITION_COMPACT_LIMIT_BYTES } from '../run-definition-view.js';

const big = 'x'.repeat(200 * 1024);
function definition() {
  return {
    binding: { id: 'b1', run_id: 'wf__a1', release_id: 'r1', payload: { expected_path: [{ activity_id: 'act1', step_id: 's1' }] } },
    release: { id: 'r1', release_key: 'rk', manifest_sha256: 'm', environment: 'production', target: 'xian-m4', payload: { ci_evidence: big } },
    workflow: { id: 'wv1', workflow_id: 'w1', payload_sha256: 'p', contract_sha256: 'c', payload: { workflow_id: 'w1', key: 'wf', activities: [{ activity_version_id: 'av1' }], contract: { blob: big } } },
    activities: [{
      id: 'av1', activity_id: 'act1', payload_sha256: 'pa', contract_sha256: 'ca',
      payload: {
        activity_id: 'act1', definition_key: 'cap.act', contract: { optional: false, required: true, blob: big }, implementation_bindings: [big], verification: { big },
        steps: [{ step_id: 's1', locator: { step_key: 's' }, contract: { key: 's', order: 1, optional: true, dod: big }, registration: { id: 's1', source_sha256: 'h', readback: big } }],
      },
    }],
  };
}

describe('compactRunDefinition', () => {
  it('binding 原样保留，大字段被去掉，体积低于上限', () => {
    const full = definition();
    const out = compactRunDefinition(full);
    expect(out.definition_view).toBe('compact');
    expect(out.binding).toEqual(full.binding);
    expect(out.release).toMatchObject({ id: 'r1', manifest_sha256: 'm', full_href: '/api/brain/releases/r1' });
    expect(out.release.payload).toBeUndefined();
    expect(out.workflow.payload.contract).toBeUndefined();
    expect(out.workflow.payload.activities).toEqual(full.workflow.payload.activities);
    const act = out.activities[0];
    expect(act).toMatchObject({ id: 'av1', activity_id: 'act1', payload_sha256: 'pa', contract_sha256: 'ca' });
    expect(act.payload).toMatchObject({ activity_id: 'act1', optional: false, required: true });
    expect(act.payload.implementation_bindings).toBeUndefined();
    expect(act.payload.steps[0]).toEqual({ step_id: 's1', locator: { step_key: 's' }, contract: { key: 's', order: 1, optional: true }, registration: { id: 's1', source_sha256: 'h' } });
    expect(Buffer.byteLength(JSON.stringify(out))).toBeLessThan(RUN_DEFINITION_COMPACT_LIMIT_BYTES);
  });

  it('不修改入参', () => {
    const full = definition();
    const before = JSON.stringify(full);
    compactRunDefinition(full);
    expect(JSON.stringify(full)).toBe(before);
  });

  it('空值原样返回', () => {
    expect(compactRunDefinition(null)).toBeNull();
    expect(compactRunDefinition(undefined)).toBeUndefined();
  });

  it('紧凑化抛错时回退完整定义（fail-safe）', () => {
    const full = definition();
    Object.defineProperty(full, 'activities', { get() { throw new Error('boom'); }, enumerable: false });
    const out = compactRunDefinition(full);
    expect(out.definition_view).toBe('full');
    expect(out.binding).toEqual(full.binding);
  });
});
